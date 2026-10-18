import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** One merged mesh of a model: which parts (index in traversal order) it replaces, its bones and its shared geometry. */
interface MergedGroup {
  parts: number[];
  /** Per bone slot of the merged skeleton: [part, bone index in that part's skeleton]. */
  slots: [number, number][];
  inverses: THREE.Matrix4[];
  geometry: THREE.BufferGeometry;
}

const plans = new Map<string, MergedGroup[]>();
const IDENTITY = new THREE.Matrix4();

/**
 * Turns a freshly cloned model's skinned parts into one SkinnedMesh per material (one draw call instead of one per part).
 * The merged geometry is cached under `key`, so every clone of a model shares it. Call before the model's world
 * matrices are updated; parts that are hidden or can't be merged stay as they are.
 */
export function mergeSkinnedParts(model: THREE.Object3D, key: string) {
  const parts: THREE.SkinnedMesh[] = [];
  model.traverseVisible((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh); });
  let plan = plans.get(key);
  if (!plan) plans.set(key, (plan = planMerge(parts)));
  for (const g of plan) {
    const first = parts[g.parts[0]];
    const mesh = new THREE.SkinnedMesh(g.geometry, first.material);
    mesh.name = 'merged:' + g.parts.map((i) => parts[i].name).join('+');
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = first.layers.mask;
    first.parent!.add(mesh);
    mesh.bind(new THREE.Skeleton(g.slots.map(([p, b]) => parts[p].skeleton.bones[b]), g.inverses), IDENTITY);
    for (const i of g.parts) parts[i].removeFromParent();
  }
}

function planMerge(parts: THREE.SkinnedMesh[]): MergedGroup[] {
  const groups: { sig: string; parts: number[]; slotOf: Map<string, number>; slots: [number, number][]; inverses: THREE.Matrix4[] }[] = [];
  parts.forEach((m, i) => {
    const sig = signature(m);
    if (!sig) return;
    let g = groups.find((x) => x.sig === sig && fits(x.slotOf, x.inverses, m));
    if (g) g.parts.push(i);
    else groups.push((g = { sig, parts: [i], slotOf: new Map(), slots: [], inverses: [] }));
    for (const [j, b] of m.skeleton.bones.entries()) {
      if (g.slotOf.has(b.name)) continue;
      g.slotOf.set(b.name, g.slots.length);
      g.slots.push([i, j]);
      g.inverses.push(m.skeleton.boneInverses[j]);
    }
  });
  const out: MergedGroup[] = [];
  for (const g of groups) {
    if (g.parts.length < 2) continue;
    const geometry = mergeGeometries(g.parts.map((i) => bakedPart(parts[i], g.slotOf)));
    if (geometry) out.push({ parts: g.parts, slots: g.slots, inverses: g.inverses, geometry });
  }
  return out;
}

/** What parts must share to be drawn as one mesh; null = never merged. */
function signature(m: THREE.SkinnedMesh) {
  const geo = m.geometry;
  if (Array.isArray(m.material) || m.bindMode !== THREE.AttachedBindMode || geo.groups.length || Object.keys(geo.morphAttributes).length) return null;
  // baking the bind matrix into the vertices keeps the culling sphere where it was only if the part sits at its bind matrix
  m.updateMatrix();
  if (!m.matrix.elements.every((x, k) => Math.abs(x - m.bindMatrix.elements[k]) < 1e-4)) return null;
  const attrs: string[] = [];
  for (const [n, a] of Object.entries(geo.attributes)) {
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return null;
    if (n !== 'skinIndex') attrs.push(`${n}:${a.array.constructor.name}:${a.itemSize}:${a.normalized}`);
  }
  return [m.material.uuid, m.parent!.uuid, m.castShadow, m.receiveShadow, m.renderOrder, m.layers.mask, !!geo.index, attrs.sort().join()].join('|');
}

/** Every bone the part shares by name with the group has the same bind pose (FBX parts each carry their own copy of the skeleton). */
function fits(slotOf: Map<string, number>, inverses: THREE.Matrix4[], m: THREE.SkinnedMesh) {
  return m.skeleton.bones.every((b, j) => {
    const s = slotOf.get(b.name);
    return s === undefined || inverses[s].elements.every((x, k) => Math.abs(x - m.skeleton.boneInverses[j].elements[k]) < 1e-3);
  });
}

/** The part's geometry in bind space (bind matrix applied), its bone indices pointing at the merged skeleton's slots. */
function bakedPart(m: THREE.SkinnedMesh, slotOf: Map<string, number>) {
  const src = m.geometry;
  const g = new THREE.BufferGeometry();
  for (const [n, a] of Object.entries(src.attributes) as [string, THREE.BufferAttribute][]) {
    if (n !== 'skinIndex') { g.setAttribute(n, a.clone()); continue; }
    const idx = new Uint16Array(a.array.length);
    for (let k = 0; k < idx.length; k++) idx[k] = slotOf.get(m.skeleton.bones[a.array[k]].name)!;
    g.setAttribute(n, new THREE.BufferAttribute(idx, a.itemSize));
  }
  if (src.index) g.setIndex(src.index.clone());
  if (!m.bindMatrix.equals(IDENTITY)) g.applyMatrix4(m.bindMatrix);
  return g;
}
