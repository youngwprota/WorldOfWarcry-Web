import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Batches are split into tiles this big (metres) so off-screen ones are still frustum-culled. */
const TILE = 32;
/** Sub-meshes placed fewer times than this stay plain meshes. */
const MIN_COPIES = 3;

const PLAIN = new Set(['Object3D', 'Group', 'Mesh']);
const X = new THREE.Vector3();
const Y = new THREE.Vector3();
const Z = new THREE.Vector3();

/** Only meshes, groups and empties: the hierarchy can be dissolved into its meshes. */
function plain(root: THREE.Object3D) {
  let ok = true;
  root.traverse((o) => { if (!PLAIN.has(o.type) || (o as THREE.Mesh).morphTargetInfluences) ok = false; });
  return ok;
}

/**
 * Can a mesh with this group-space matrix become an instance and render the same? The instancing shader turns normals
 * by the instance matrix with its axes rescaled, which equals the true normal matrix only for orthogonal axes, and
 * it never flips the winding for a mirrored matrix. Transparent meshes stay sorted one by one.
 */
function instanceable(mesh: THREE.Mesh, m: THREE.Matrix4) {
  if (mesh.renderOrder !== 0 || !mesh.frustumCulled || mesh.layers.mask !== 1) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (mats.some((x) => x.transparent)) return false;
  if (m.determinant() <= 0) return false;
  m.extractBasis(X, Y, Z);
  const eps = 1e-4 * Math.max(X.lengthSq(), Y.lengthSq(), Z.lengthSq());
  return Math.abs(X.dot(Y)) < eps && Math.abs(Y.dot(Z)) < eps && Math.abs(Z.dot(X)) < eps;
}

const matKey = (m: THREE.Material | THREE.Material[]) => (Array.isArray(m) ? m.map((x) => x.id).join(',') : `${m.id}`);

/** Merged parts per model: key = the parts' geometries and offsets from the model root; null when they would not merge. */
const merged = new Map<string, THREE.BufferGeometry | null>();

/**
 * A placed model's meshes as { mesh, m } (m = group-space matrix), its opaque parts that share material and render
 * flags merged into one mesh in model-root space (geometry built once per model, shared by every copy).
 */
function modelParts(root: THREE.Object3D, toGroup: THREE.Matrix4) {
  const toRoot = root.matrixWorld.clone().invert();
  const out: { mesh: THREE.Mesh; m: THREE.Matrix4 }[] = [];
  const same = new Map<string, { mesh: THREE.Mesh; rel: THREE.Matrix4 }[]>();
  root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const rel = toRoot.clone().multiply(mesh.matrixWorld);
    const mat = mesh.material;
    if (Array.isArray(mat) || mat.transparent || rel.determinant() <= 0) {
      out.push({ mesh, m: toGroup.clone().multiply(mesh.matrixWorld) });
      return;
    }
    const attrs = Object.entries(mesh.geometry.attributes).map(([n, a]) => `${n}${a.itemSize}`).sort().join();
    const key = `${mat.id}|${+mesh.castShadow}${+mesh.receiveShadow}|${mesh.renderOrder}|${mesh.layers.mask}|${+mesh.frustumCulled}|${attrs}`;
    const list = same.get(key);
    if (list) list.push({ mesh, rel }); else same.set(key, [{ mesh, rel }]);
  });
  const m = toGroup.clone().multiply(root.matrixWorld);
  for (const list of same.values()) {
    const geoKey = list.length > 1 && list.map(({ mesh, rel }) => `${mesh.geometry.id}:${rel.elements.map((e) => e.toFixed(4))}`).join('|');
    let geo = geoKey ? merged.get(geoKey) : null;
    if (geoKey && geo === undefined) {
      // (mergeGeometries needs all parts indexed or none)
      const indexed = list.every(({ mesh }) => mesh.geometry.index);
      geo = mergeGeometries(list.map(({ mesh, rel }) => (indexed || !mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed()).applyMatrix4(rel)));
      merged.set(geoKey, geo);
    }
    if (!geo) {
      for (const { mesh } of list) out.push({ mesh, m: toGroup.clone().multiply(mesh.matrixWorld) });
      continue;
    }
    const src = list[0].mesh;
    const mesh = new THREE.Mesh(geo, src.material);
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = src.receiveShadow;
    mesh.renderOrder = src.renderOrder;
    mesh.layers.mask = src.layers.mask;
    mesh.frustumCulled = src.frustumCulled;
    out.push({ mesh, m: m.clone() });
  }
  return out;
}

/**
 * Bakes the static part of a level group once it is complete. Placed models (`props`, direct children of `group`) are
 * dissolved into their parts (modelParts): parts repeated MIN_COPIES+ times become one InstancedMesh per (geometry,
 * material, shadow flags) and 32 m tile, the rest are reparented to `group` with their world matrix. Then every
 * child of `group` except `moving` gets frozen matrices (three.js stops recomposing them each frame).
 */
export function bakeStatic(group: THREE.Group, props: readonly THREE.Object3D[], moving: readonly THREE.Object3D[]) {
  group.updateMatrixWorld(true);
  const toGroup = group.matrixWorld.clone().invert();
  const sets = new Map<string, { mesh: THREE.Mesh; m: THREE.Matrix4 }[]>();
  const loose: { mesh: THREE.Mesh; m: THREE.Matrix4 }[] = [];
  for (const root of props) {
    if (root.parent !== group || !plain(root)) continue;
    for (const { mesh, m } of modelParts(root, toGroup)) {
      if (!instanceable(mesh, m)) { loose.push({ mesh, m }); continue; }
      const key = `${mesh.geometry.id}|${matKey(mesh.material)}|${+mesh.castShadow}${+mesh.receiveShadow}`;
      const set = sets.get(key);
      if (set) set.push({ mesh, m }); else sets.set(key, [{ mesh, m }]);
    }
    root.removeFromParent();
  }

  // (meshes can parent meshes: detach them all before any is re-added or dropped)
  for (const set of sets.values()) for (const it of set) it.mesh.removeFromParent();
  for (const it of loose) it.mesh.removeFromParent();

  for (const set of sets.values()) {
    if (set.length < MIN_COPIES) { loose.push(...set); continue; }
    const tiles = new Map<number, typeof set>();
    for (const it of set) {
      const k = Math.floor(it.m.elements[12] / TILE) * 1000 + Math.floor(it.m.elements[14] / TILE);
      const tile = tiles.get(k);
      if (tile) tile.push(it); else tiles.set(k, [it]);
    }
    const { geometry, material, castShadow, receiveShadow } = set[0].mesh;
    for (const tile of tiles.values()) {
      const im = new THREE.InstancedMesh(geometry, material, tile.length);
      for (let i = 0; i < tile.length; i++) im.setMatrixAt(i, tile[i].m);
      im.castShadow = castShadow;
      im.receiveShadow = receiveShadow;
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  for (const { mesh, m } of loose) {
    mesh.clear();
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.matrix.copy(m);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  group.updateMatrixWorld(true);
  const skip = new Set(moving);
  for (const child of group.children) {
    if (skip.has(child)) continue;
    child.traverse((o) => { o.matrixAutoUpdate = false; o.matrixWorldAutoUpdate = false; });
  }
}
