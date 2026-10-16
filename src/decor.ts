// Ground clutter that fills the frame without getting in the way: pebbles along the trails, flower patches,
// mushrooms and ferns round the trees, fallen leaves in the grove, pale glowing mushrooms on the cemetery.
// All of it is knee-high or lower and has no collision. Procedural low-poly geometry, instanced in 32 m tiles
// so off-screen tiles are frustum-culled.
import * as THREE from 'three';
import { scenery } from './atmos';
import type { ZoneId } from './config';
import { MAP_BOX, PATH_W, fbm, heightAt, inCamp, pathDist, walkable, zoneIdAt } from './island';

interface Bit { x: number; z: number; s: number; r: number; c: number }

function prng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Merges non-indexed copies of the parts (positions, normals, optional vertex colours). */
function merge(parts: { geo: THREE.BufferGeometry; color?: number }[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    c.set(color ?? 0xffffff);
    for (let i = 0; i < g.getAttribute('position').count; i++) col.push(c.r, c.g, c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** A flat leaf: a diamond from the origin out along +x, tipped up by `tilt` (normals up, so it shades like the ground). */
function leafGeo(len: number, width: number, tilt: number) {
  const ty = Math.sin(tilt) * len;
  const tx = Math.cos(tilt) * len;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, tx * 0.45, ty * 0.45, width, tx, ty, 0,
    0, 0, 0, tx, ty, 0, tx * 0.45, ty * 0.45, -width,
  ], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  return g;
}

const GEO = {
  pebble: () => new THREE.IcosahedronGeometry(0.1, 0).scale(1, 0.5, 0.8).translate(0, 0.022, 0),
  /** Five flower heads at different heights: flat pentagons facing up. */
  flowers: () => {
    const heads: { geo: THREE.BufferGeometry }[] = [];
    const spots = [[0, 0, 0.24], [0.13, 0.06, 0.19], [-0.1, 0.1, 0.21], [0.04, -0.13, 0.17], [-0.12, -0.08, 0.15]];
    for (const [x, z, y] of spots) heads.push({ geo: new THREE.CircleGeometry(0.065, 5).rotateX(-Math.PI / 2).translate(x, y, z) });
    return merge(heads);
  },
  /** Three mushrooms, stems under caps (the instance colour tints both; from above the stems hardly show). */
  mushrooms: () => {
    const parts: { geo: THREE.BufferGeometry; color?: number }[] = [];
    for (const [x, z, s] of [[0, 0, 1], [0.14, 0.07, 0.7], [-0.08, 0.12, 0.55]]) {
      parts.push({ geo: new THREE.CylinderGeometry(0.03 * s, 0.04 * s, 0.16 * s, 5, 1, true).translate(x, 0.08 * s, z), color: 0xfff6e8 });
      parts.push({ geo: new THREE.SphereGeometry(0.1 * s, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(x, 0.14 * s, z) });
    }
    return merge(parts);
  },
  /** A fern: seven leaves round the centre, tipped up. */
  fern: () => {
    const parts: { geo: THREE.BufferGeometry }[] = [];
    for (let k = 0; k < 7; k++) parts.push({ geo: leafGeo(0.42 + (k % 3) * 0.08, 0.07, 0.55 + (k % 2) * 0.25).rotateY((k / 7) * Math.PI * 2 + k * 0.3) });
    return merge(parts);
  },
  /** Five fallen leaves lying flat. */
  leaves: () => {
    const parts: { geo: THREE.BufferGeometry }[] = [];
    for (let k = 0; k < 5; k++) {
      const a = k * 2.4;
      parts.push({ geo: leafGeo(0.16, 0.06, 0).translate(-0.08, 0, 0).rotateY(a * 1.7).translate(Math.cos(a) * 0.22, 0.012 + k * 0.002, Math.sin(a) * 0.22) });
    }
    return merge(parts);
  },
};

const ZONE_PEBBLES: Partial<Record<ZoneId, number[]>> = {
  forest: [0x9a9184, 0x8a8070, 0xb2aa9a, 0x7d7466], cemetery: [0x8c88a8, 0x7a7696, 0x9e9ab8], peaks: [0xb8c0cc, 0xa3aab6],
  swamp: [0x6e7060, 0x7e7a66], grove: [0xa08a70, 0x8e7a62], dunes: [0xd8c090, 0xc8ae7c], hills: [0x8a847a, 0x9c968a, 0x77716a],
};
const ZONE_FLOWERS: Partial<Record<ZoneId, number[]>> = {
  forest: [0xffe14a, 0xffffff, 0xff7aa8, 0xb48bff, 0xff9a3c, 0xfff2a0],
  grove: [0xffd040, 0xff8a30, 0xe85a30, 0xfff0c0],
  swamp: [0xf4f0ff, 0xc8a0ff, 0xe8ff90],
  hills: [0xc8b4ff, 0xffffff, 0xffd0e0],
  cemetery: [0xd8ccff, 0xb0a4e8],
};
const FLOWER_DENSITY: Partial<Record<ZoneId, number>> = { forest: 1, grove: 0.8, swamp: 0.6, hills: 0.5, cemetery: 0.25 };
const MUSHROOM_CAPS = [0xd8452f, 0xc8402a, 0xb07a48, 0xe8d0a0, 0xa86038];
const LEAF_COLS: Partial<Record<ZoneId, number[]>> = { grove: [0xd8662a, 0xe8a030, 0xb8442a, 0xf0c050, 0xc87a28], forest: [0xb89a40, 0xa88438, 0x8e9a3a] };

/**
 * Builds the clutter and returns its meshes. `free(x, z, pad)`: room on the walkable ground (no obstacle within pad);
 * `trees`: trunk spots (mushrooms and ferns grow round them).
 */
export function buildDecor(free: (x: number, z: number, pad: number) => boolean, trees: [number, number][], seed = 13) {
  const r = prng(seed);
  const out: THREE.Object3D[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const rand = () => ({ x: MAP_BOX.x + r() * MAP_BOX.size, z: MAP_BOX.z + r() * MAP_BOX.size });
  const nearTree = (d0: number, d1: number) => {
    const [tx, tz] = pick(trees);
    const a = r() * Math.PI * 2;
    const d = d0 + r() * (d1 - d0);
    return { x: tx + Math.sin(a) * d, z: tz + Math.cos(a) * d };
  };
  const offTrail = (x: number, z: number, d = PATH_W * 0.5 + 0.5) => pathDist(x, z) > d;
  const collect = (n: number, tries: number, gen: () => { x: number; z: number }, make: (x: number, z: number) => Bit | null) => {
    const bits: Bit[] = [];
    for (let i = 0; i < tries && bits.length < n; i++) {
      const p = gen();
      const b = make(p.x, p.z);
      if (b) bits.push(b);
    }
    return bits;
  };

  // pebbles: half of them line the trail edges, the rest anywhere on open ground (and the beaches)
  const pebble = (x: number, z: number): Bit | null => {
    const cols = ZONE_PEBBLES[zoneIdAt(x, z)];
    if (!cols || !free(x, z, 0.15) || inCamp(x, z, -3)) return null;
    return { x, z, s: 0.55 + r() * 1.3, r: r() * 6, c: pick(cols) };
  };
  const trailPebbles = collect(1300, 120000, rand, (x, z) => {
    const d = pathDist(x, z);
    return d > PATH_W * 0.5 + 0.08 && d < PATH_W * 0.5 + 1.1 ? pebble(x, z) : null;
  });
  const loosePebbles = collect(1400, 20000, rand, (x, z) => (offTrail(x, z, 1) ? pebble(x, z) : null));
  add(GEO.pebble(), mat({ flat: true }), [...trailPebbles, ...loosePebbles], out);

  // flower patches: noise picks the meadows, the zone its colours; each patch is mostly one colour
  const flowers = collect(950, 90000, rand, (x, z) => {
    const zone = zoneIdAt(x, z);
    const dens = FLOWER_DENSITY[zone];
    if (!dens || fbm(x * 0.13 + 3, z * 0.13 - 7) < 0.69 - dens * 0.04 || r() > dens) return null;
    if (!walkable(x, z, 0.6) || !offTrail(x, z, 1.1) || !free(x, z, 0.3) || inCamp(x, z, -4.5)) return null;
    const pal = ZONE_FLOWERS[zone]!;
    const main = pal[Math.floor(fbm(x * 0.06 + 9, z * 0.06 - 4) * pal.length * 2.3) % pal.length];
    return { x, z, s: 0.85 + r() * 0.6, r: r() * 6, c: r() < 0.75 ? main : pick(pal) };
  });
  add(GEO.flowers(), mat({ sway: 60 }), flowers, out);

  // mushrooms and ferns in the shade round the trees
  const shade = (zones: ZoneId[], pad: number) => (x: number, z: number) =>
    zones.includes(zoneIdAt(x, z)) && walkable(x, z, 0.3) && offTrail(x, z, 1) && free(x, z, pad) && !inCamp(x, z, 1);
  if (trees.length) {
    const okShroom = shade(['forest', 'swamp', 'grove'], 0.15);
    const shrooms = collect(260, 4000, () => nearTree(0.7, 2.2), (x, z) => (okShroom(x, z) ? { x, z, s: 0.8 + r() * 0.7, r: r() * 6, c: pick(MUSHROOM_CAPS) } : null));
    add(GEO.mushrooms(), mat({ vertex: true }), shrooms, out);
    const okFern = shade(['forest', 'swamp', 'grove', 'hills'], 0.25);
    // green ferns, rusty bracken in the autumn grove
    const fern = (x: number, z: number) => pick(zoneIdAt(x, z) === 'grove' ? [0xb8642a, 0xc8803a, 0x9a5a28] : [0x3f8a36, 0x4c9a3a, 0x357a32, 0x5aa040]);
    const ferns = [
      ...collect(700, 6000, () => nearTree(0.9, 3.2), (x, z) => (okFern(x, z) ? { x, z, s: 0.7 + r() * 0.8, r: r() * 6, c: fern(x, z) } : null)),
      ...collect(300, 20000, rand, (x, z) => (okFern(x, z) && fbm(x * 0.09, z * 0.09 + 11) > 0.6 ? { x, z, s: 0.6 + r() * 0.6, r: r() * 6, c: fern(x, z) } : null)),
    ];
    add(GEO.fern(), mat({ sway: 25 }), ferns, out);
  }

  // cemetery: pale mushrooms that glow a little in the mist
  const okGhost = shade(['cemetery'], 0.2);
  const ghosts = collect(170, 30000, rand, (x, z) => (okGhost(x, z) ? { x, z, s: 0.8 + r() * 0.8, r: r() * 6, c: pick([0x9ef0e0, 0xb8a8ff, 0x8ad8ff]) } : null));
  add(GEO.mushrooms(), mat({ vertex: true, glow: 0x2a8a80 }), ghosts, out);

  // fallen leaves: thick in the autumn grove, a few under the forest trees
  const leaves = [
    ...collect(1800, 40000, rand, (x, z) => (zoneIdAt(x, z) === 'grove' && walkable(x, z, 0.2) && free(x, z, 0.1) && offTrail(x, z, 0.6)
      ? { x, z, s: 0.8 + r() * 0.6, r: r() * 6, c: pick(LEAF_COLS.grove!) } : null)),
    ...(trees.length ? collect(260, 3000, () => nearTree(0.5, 2.6), (x, z) => (zoneIdAt(x, z) === 'forest' && walkable(x, z, 0.2) && free(x, z, 0.1) && offTrail(x, z, 0.7)
      ? { x, z, s: 0.7 + r() * 0.5, r: r() * 6, c: pick(LEAF_COLS.forest!) } : null)) : []),
  ];
  add(GEO.leaves(), mat({ side: THREE.DoubleSide }), leaves, out);
  return out;
}

/** Lambert material for clutter, patched for cloud shadows (and sway); no contact darkening on things this small. */
function mat(o: { flat?: boolean; sway?: number; vertex?: boolean; glow?: number; side?: THREE.Side }) {
  const m = new THREE.MeshLambertMaterial({
    color: 0xffffff, flatShading: !!o.flat, vertexColors: !!o.vertex, side: o.side ?? THREE.FrontSide,
    emissive: o.glow ?? 0x000000,
  });
  return scenery(m, { sway: o.sway ?? 0, base: 0 });
}

const TILE = 32;
/** InstancedMeshes per 32 m tile, coloured per instance, standing on the ground height. */
function add(geo: THREE.BufferGeometry, material: THREE.Material, bits: Bit[], out: THREE.Object3D[], shadow = false) {
  const tiles = new Map<number, Bit[]>();
  for (const b of bits) {
    const k = Math.floor(b.x / TILE) * 1000 + Math.floor(b.z / TILE);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k)!.push(b);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  for (const list of tiles.values()) {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((b, i) => {
      q.setFromAxisAngle(up, b.r);
      im.setMatrixAt(i, m.compose(p.set(b.x, heightAt(b.x, b.z), b.z), q, s.setScalar(b.s)));
      im.setColorAt(i, c.set(b.c));
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    out.push(im);
  }
}
