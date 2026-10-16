// Island layout. The forest edge («Лесная опушка») is the round hub in the middle, with the hero's settlement at
// its centre; the cemetery is the sector east of it, out to the sea. The other locations are hand-drawn polygons
// around them (the designer's map). Land is the union of all locations; their borders are rocky ridges with
// gates (magic barriers). One narrow trail winds from the settlement gate round the forest to the bandit fort (east,
// in front of the cemetery gate) and on through the cemetery to the arena; spurs lead to the other forest doors, and
// the other locations have worn paths of their own.
// Everything here is pure maths (no three.js), so terrain, world placement, maps and gameplay share it.
import { ZONES, type ZoneDef, type ZoneId } from './config';

// ---------- noise ----------
function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------- shape ----------
/** Island centre, water level and the settlement (spawn) at the centre of the forest. */
export const ISLAND = { cx: 0, cz: -52, water: -0.3, campX: 0, campZ: -52, campR: 16.5 };
/** Palisade radius of the settlement and the angle of its gate (0 = +Z/south, π = north): turned a bit to the east, towards the trail. */
export const CAMP_WALL = 14;
const CAMP_GATE_A = 2.75;
/** The settlement exit: centre of the gap in the palisade and the unit direction of walking out. */
export const CAMP_EXIT = {
  x: ISLAND.campX + Math.sin(CAMP_GATE_A) * CAMP_WALL, z: ISLAND.campZ + Math.cos(CAMP_GATE_A) * CAMP_WALL,
  dirX: Math.sin(CAMP_GATE_A), dirZ: Math.cos(CAMP_GATE_A),
};
/** Square that holds the ground mesh, the baked ground/map textures and the zone grid. */
export const MAP_BOX = { x: -172, z: -200, size: 340 };
/** Hero spawn / respawn point (settlement plaza). */
export const SPAWN = { x: ISLAND.campX, z: ISLAND.campZ + 3 };
/** Trail width, metres (about 1.1–1.25 hero widths). */
export const PATH_W = 1.0;

/** Polar angle around the island centre (0 = +Z/south, like the palisade helper). */
export const angleOf = (x: number, z: number) => Math.atan2(x - ISLAND.cx, z - ISLAND.cz);
const ring = (a: number, f: number, seed: number) => fbm(Math.cos(a) * f + seed, Math.sin(a) * f + seed);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Rim kind along the shore: < 0.42 sandy beach, > 0.56 cliffs, between: a tree line. */
function rimKind0(a: number) { return ring(a, 2.4, 17); }
const cliffOf = (e: number) => smooth(0.52, 0.6, e);
const treesOf = (e: number) => smooth(0.38, 0.46, e);
/** Where the water starts. */
function shoreR0(a: number) {
  return 108 + (ring(a, 1.6, 5) - 0.5) * 22 + 3 * Math.sin(5 * a + 1);
}

// The rim only depends on the angle: tabulate it (heightAt runs for every ground pixel and vertex).
const LUT_N = 2048;
const lut = (f: (a: number) => number) => {
  const t = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) t[i] = f(-Math.PI + (i / LUT_N) * Math.PI * 2);
  return (a: number) => {
    const f2 = ((wrap(a) + Math.PI) / (Math.PI * 2)) * LUT_N;
    const i = Math.min(LUT_N - 1, Math.floor(f2));
    return t[i] + (t[i + 1] - t[i]) * (f2 - i);
  };
};
export const rimKind = lut(rimKind0);
export const shoreR = lut(shoreR0);
/** Walkable radius: the hero stops here (beach: near the water; trees/cliffs: further in). */
export const walkR = lut((a) => {
  const e = rimKind0(a);
  return shoreR0(a) - (4.5 + 2 * treesOf(e) + 3 * cliffOf(e));
});
export const rimCliff = (a: number) => cliffOf(rimKind(a));
export const rimTrees = (a: number) => treesOf(rimKind(a)) * (1 - cliffOf(rimKind(a)));

// ---------- zones ----------
const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z])) as Record<ZoneId, ZoneDef>;
export const ZONE_IDS = ZONES.map((z) => z.id);
export const NZ = ZONE_IDS.length;
export const ZONE_INDEX = Object.fromEntries(ZONE_IDS.map((id, i) => [id, i])) as Record<ZoneId, number>;

/** Radius of the central forest (noisy). */
export const forestR = lut((a) => 53 + (ring(a, 2.2, 31) - 0.5) * 8);
/** The cemetery sector's two borders (angles: 0 = +Z/south, π/2 = +X/east). */
const CEM_BORDERS = [57, 123].map((d) => (d * Math.PI) / 180);
/** Angle of cemetery border k at radius r (wobbles with the radius so borders are not straight spokes). */
const borderA = (k: number, r: number) => CEM_BORDERS[k] + (fbm(r * 0.05 + k * 7.3, k * 3.1) - 0.5) * 0.35;
function inCemeterySector(x: number, z: number) {
  const r = Math.hypot(x - ISLAND.cx, z - ISLAND.cz);
  const TAU = Math.PI * 2;
  const base = borderA(0, r);
  const rel = (v: number) => (((v - base) % TAU) + TAU * 2) % TAU;
  return rel(angleOf(x, z)) < rel(borderA(1, r)) && r < shoreR(angleOf(x, z));
}

/** The other locations, drawn by hand (world metres); the forest and the cemetery win where they overlap. */
const POLYS: { id: ZoneId; pts: [number, number][] }[] = [
  // the cemetery grows south-east beyond its sector
  { id: 'cemetery', pts: [[50, -35], [75, 0], [100, 8], [121, -5], [116, -35], [110, -60], [80, -60]] },
  { id: 'peaks', pts: [[-10, -152.5], [-5, -165], [20, -171], [60, -167.5], [95, -160], [112.5, -145], [116, -130], [95, -126], [80, -132.5],
    [50, -142.5], [25, -145], [10, -150]] },
  { id: 'peaks', pts: [[-62, -131], [-45, -147.5], [-10, -152.5], [10, -150], [25, -145], [50, -142.5], [80, -132.5], [95, -126], [92.5, -100],
    [90, -60], [60, -55], [30, -75], [-25, -90], [-50, -125]] },
  { id: 'hills', pts: [[-147.5, -55], [-130, -77.5], [-110, -90], [-90, -105], [-72.5, -122.5], [-62, -131], [-50, -125], [-25, -90], [-40, -20],
    [-55, -5], [-70, -3], [-95, -12], [-125, -20], [-135, -40]] },
  { id: 'grove', pts: [[-140, -2], [-125, -20], [-95, -12], [-70, -3], [-55, -5], [-40, -20], [-25, -15], [-25, 25], [-40, 45], [-60, 52.5],
    [-90, 42.5], [-122.5, 45], [-135, 20]] },
  { id: 'swamp', pts: [[-25, -15], [-3, -10], [5, 20], [2.5, 65], [-10, 107.5], [-40, 110], [-70, 107.5], [-100, 85], [-122.5, 60], [-122.5, 45],
    [-90, 42.5], [-60, 52.5], [-40, 45], [-25, 25]] },
  { id: 'dunes', pts: [[-3, -10], [20, -15], [40, -25], [50, -34], [64, -24], [70, -10], [100, -5], [118, 15], [125, 30], [110, 50], [90, 70], [60, 85], [30, 100],
    [-10, 107.5], [2.5, 65], [5, 20]] },
];
const BOXES = POLYS.map(({ pts }) => {
  const xs = pts.map((q) => q[0]);
  const zs = pts.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
});
function inPoly(pts: [number, number][], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Location at a point from the shapes alone (polygon borders and coasts wobble with a domain warp); null = sea. */
function zoneOfShape(x: number, z: number): ZoneId | null {
  if (Math.hypot(x - ISLAND.cx, z - ISLAND.cz) < forestR(angleOf(x, z))) return 'forest';
  if (inCemeterySector(x, z)) return 'cemetery';
  const wx = x + (fbm(x * 0.04, z * 0.04) - 0.5) * 16;
  const wz = z + (fbm(x * 0.04 + 31, z * 0.04 - 17) - 0.5) * 16;
  for (let k = 0; k < POLYS.length; k++) {
    const b = BOXES[k];
    if (wx < b[0] || wz < b[1] || wx > b[2] || wz > b[3]) continue;
    if (inPoly(POLYS[k].pts, wx, wz)) return POLYS[k].id;
  }
  return null;
}

// ---------- 1 m raster: location per cell, distance to the coast and to the ridges ----------
const RN = MAP_BOX.size;
/** Squared-distance transform along one row (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, zb: Float32Array) {
  let k = 0;
  v[0] = 0;
  zb[0] = -Infinity;
  zb[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let t = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (t <= zb[k]) { k--; t = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++;
    v[k] = q;
    zb[k] = t;
    zb[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (zb[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}
/** Euclidean distance (cells) from every cell to the nearest source cell. */
function edt(src: Uint8Array) {
  const n = RN;
  const g = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) g[i] = src[i] ? 0 : 1e12;
  const f = new Float32Array(n);
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const zb = new Float32Array(n + 1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) f[i] = g[j * n + i];
    edt1d(f, n, d, v, zb);
    for (let i = 0; i < n; i++) g[j * n + i] = d[i];
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) f[j] = g[j * n + i];
    edt1d(f, n, d, v, zb);
    for (let j = 0; j < n; j++) g[j * n + i] = Math.sqrt(d[j]);
  }
  return g;
}
const raster = (() => {
  const n = RN;
  const zone = new Int8Array(n * n).fill(-1);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const id = zoneOfShape(MAP_BOX.x + i + 0.5, MAP_BOX.z + j + 0.5);
      if (id) zone[j * n + i] = ZONE_INDEX[id];
    }
  }
  const land = new Uint8Array(n * n);
  const water = new Uint8Array(n * n);
  const ridge = new Uint8Array(n * n);
  for (let c = 0; c < n * n; c++) { land[c] = zone[c] >= 0 ? 1 : 0; water[c] = 1 - land[c]; }
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const c = j * n + i;
      if (zone[c] < 0) continue;
      for (const o of [c - 1, c + 1, c - n, c + n]) if (zone[o] >= 0 && zone[o] !== zone[c]) { ridge[c] = 1; break; }
    }
  }
  const toWater = edt(water);
  const toLand = edt(land);
  const coast = new Float32Array(n * n);
  for (let c = 0; c < n * n; c++) coast[c] = land[c] ? toWater[c] - 0.5 : 0.5 - toLand[c];
  const ridgeD = edt(ridge);
  // the sea belongs to the nearest land's location (fog, colours and mist blend out over the water)
  const near = Int8Array.from(zone);
  let front: number[] = [];
  for (let c = 0; c < n * n; c++) if (zone[c] >= 0) front.push(c);
  while (front.length) {
    const next: number[] = [];
    for (const c of front) {
      const i = c % n;
      for (const o of [i > 0 ? c - 1 : -1, i < n - 1 ? c + 1 : -1, c - n, c + n]) {
        if (o < 0 || o >= n * n || near[o] >= 0) continue;
        near[o] = near[c];
        next.push(o);
      }
    }
    front = next;
  }
  return { zone, near, coast, ridgeD, ridge };
})();
const cellOf = (x: number, z: number) => {
  const i = Math.min(RN - 1, Math.max(0, Math.floor(x - MAP_BOX.x)));
  const j = Math.min(RN - 1, Math.max(0, Math.floor(z - MAP_BOX.z)));
  return j * RN + i;
};
/** Bilinear lookup in a 1 m raster. */
function sample(f: Float32Array, x: number, z: number) {
  const fx = Math.min(RN - 1.001, Math.max(0, x - MAP_BOX.x - 0.5));
  const fz = Math.min(RN - 1.001, Math.max(0, z - MAP_BOX.z - 0.5));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const c = j * RN + i;
  return (f[c] * (1 - u) + f[c + 1] * u) * (1 - v) + (f[c + RN] * (1 - u) + f[c + RN + 1] * u) * v;
}
/** Signed distance to the coastline: > 0 inland, < 0 out at sea. */
export const coastDist = (x: number, z: number) => sample(raster.coast, x, z);
/** How far inside the coastline the walkable land ends (beach: near the water; trees/cliffs: further in). */
function walkInset(x: number, z: number) {
  const e = rimKind(angleOf(x, z));
  return 4.5 + 2 * treesOf(e) + 3 * cliffOf(e);
}
/** Metres beyond the walkable edge (< 0 inside the walkable land). */
export const outside = (x: number, z: number) => walkInset(x, z) - coastDist(x, z);
/** Unit direction inland (up the coast distance). */
export function inland(x: number, z: number) {
  const gx = coastDist(x + 1, z) - coastDist(x - 1, z);
  const gz = coastDist(x, z + 1) - coastDist(x, z - 1);
  const l = Math.hypot(gx, gz) || 1;
  return { x: gx / l, z: gz / l };
}

/** The settlement in the middle of the forest (palisade + yard). */
export function inCamp(x: number, z: number, pad = 0) {
  return Math.hypot(x - ISLAND.campX, z - ISLAND.campZ) < ISLAND.campR + pad;
}
export function zoneIdAt(x: number, z: number): ZoneId { return ZONE_IDS[raster.near[cellOf(x, z)]]; }
export function zoneAt(x: number, z: number): ZoneDef { return ZONE_BY_ID[zoneIdAt(x, z)]; }

// ---------- ridges: every location is walled off ----------
/** Distance to the ridge line between two locations. */
export function ridgeDist(x: number, z: number) { return Math.max(0, sample(raster.ridgeD, x, z) - 0.5); }
/** Points along every ridge ~1.7 m apart, with the unit normal across it. */
export const RIDGE_POINTS: { x: number; z: number; nx: number; nz: number }[] = (() => {
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  const hashed = new Map<number, number[]>();
  const hkey = (x: number, z: number) => Math.floor(x / 2) * 1000 + Math.floor(z / 2);
  const n = RN;
  for (let c = 0; c < n * n; c++) {
    if (!raster.ridge[c]) continue;
    const x = MAP_BOX.x + (c % n) + 0.5;
    const z = MAP_BOX.z + Math.floor(c / n) + 0.5;
    let close = false;
    for (let a = -1; a <= 1 && !close; a++) {
      for (let b = -1; b <= 1 && !close; b++) {
        for (const q of hashed.get(hkey(x + a * 2, z + b * 2)) ?? []) if ((out[q].x - x) ** 2 + (out[q].z - z) ** 2 < 1.7 * 1.7) { close = true; break; }
      }
    }
    if (close) continue;
    // normal: towards the cells of the other location nearby
    let nx = 0;
    let nz = 0;
    for (let b = -2; b <= 2; b++) {
      for (let a = -2; a <= 2; a++) {
        const o = c + b * n + a;
        if (o >= 0 && o < n * n && raster.zone[o] >= 0 && raster.zone[o] !== raster.zone[c]) { nx += a; nz += b; }
      }
    }
    const l = Math.hypot(nx, nz) || 1;
    const k = hkey(x, z);
    if (!hashed.has(k)) hashed.set(k, []);
    hashed.get(k)!.push(out.length);
    out.push({ x, z, nx: nx / l, nz: nz / l });
  }
  return out;
})();

// ---------- trail ----------
/** A forest door slid onto the actual border of two locations (hub exits are slid so the trail can meet them). */
function snapGate(from: ZoneId, to: ZoneId, x0: number, z0: number) {
  const n = RN;
  const fi = (id: ZoneId) => ZONE_INDEX[id];
  let best = Infinity;
  let bc = -1;
  for (let c = n; c < n * n - n; c++) {
    if (raster.zone[c] !== fi(from) || ![c - 1, c + 1, c - n, c + n].some((o) => raster.zone[o] === fi(to))) continue;
    const d = (MAP_BOX.x + (c % n) + 0.5 - x0) ** 2 + (MAP_BOX.z + Math.floor(c / n) + 0.5 - z0) ** 2;
    if (d < best) { best = d; bc = c; }
  }
  if (bc < 0) throw new Error(`no border ${from} → ${to}`);
  const x = MAP_BOX.x + (bc % n) + 0.5;
  const z = MAP_BOX.z + Math.floor(bc / n) + 0.5;
  // direction: from the `from` cells towards the `to` cells around the spot
  let tx = 0;
  let tz = 0;
  for (let b = -4; b <= 4; b++) {
    for (let a = -4; a <= 4; a++) {
      const k = raster.zone[bc + b * n + a];
      if (k === fi(to)) { tx += a; tz += b; } else if (k === fi(from)) { tx -= a; tz -= b; }
    }
  }
  const l = Math.hypot(tx, tz) || 1;
  return { x, z, tx: tx / l, tz: tz / l };
}
const DOOR_HILLS = snapGate('forest', 'hills', -52.5, -55);
const DOOR_SWAMP = snapGate('forest', 'swamp', -6, 14);
const DOOR_PEAKS = snapGate('forest', 'peaks', 5, -104);

/**
 * Main trail (user's drawing): settlement exit → east, north round the pond → north-west → down the west side
 * → south → bandit fort (east, in front of the cemetery gate) → ridge gate → cemetery → arena (boss 2).
 */
const WAY: [number, number][] = [
  // from the camp yard through the gate, curving straight onto the east branch (user's drawing)
  [CAMP_EXIT.x - CAMP_EXIT.dirX * 6, CAMP_EXIT.z - CAMP_EXIT.dirZ * 6], [CAMP_EXIT.x, CAMP_EXIT.z], [10.5, -66.5],
  [16, -66], [24, -64.5], [33, -66], [38.5, -71], [38, -77], [31, -80], [24, -84], [20, -89], [13, -92.5], [6, -91],
  [0, -88.5], [-6, -89], [-12, -88], [-17, -84.5], [-21, -78.5], [-26, -72], [-30.5, -65], [-35, -58], [-38.5, -50],
  [-39, -41], [-38, -35], [-35, -28.5], [-28.7, -22], [-19, -17.5], [-9.5, -15], [0, -14], [9, -15], [16, -19],
  [20.5, -23.6], [28.4, -30], [34, -35],
  [40, -40.5], [58, -40], [70, -34], [88, -24], [98, -32], [98, -52], [92, -70], [84, -80],
];
const inside = (d: { x: number; z: number; tx: number; tz: number }): [number, number] => [d.x - d.tx * 1.5, d.z - d.tz * 1.5];
/** Branches from the main trail to the hub doors (north, west), as drawn. */
const BRANCH_WAYS: [number, number][][] = [
  [[3, -89.5], [4, -96], inside(DOOR_PEAKS)],
  [[-37.5, -53], [-44, -55], inside(DOOR_HILLS)],
];
/** Where the world map writes each zone's name: the middle of each location (the forest: above the settlement). */
export const ZONE_LABEL = (() => {
  const sum = ZONE_IDS.map(() => [0, 0, 0]);
  for (let c = 0; c < RN * RN; c += 7) {
    const k = raster.zone[c];
    if (k < 0) continue;
    sum[k][0] += MAP_BOX.x + (c % RN);
    sum[k][1] += MAP_BOX.z + Math.floor(c / RN);
    sum[k][2]++;
  }
  return Object.fromEntries(ZONE_IDS.map((id, k) => (
    [id, id === 'forest' ? [ISLAND.cx, ISLAND.cz - 28] : [sum[k][0] / (sum[k][2] || 1), sum[k][1] / (sum[k][2] || 1)]]
  ))) as Record<ZoneId, [number, number]>;
})();
/**
 * Paths through the outer locations (map drawing): worn decor, and the line their mobs stand along.
 * Order: Rocky Hills, Autumn Grove, Rotten Swamp, Sand Dunes, Snow Pass, then side branches.
 */
export const LAND_TRAILS: [number, number][][] = [
  [[-53, -55.5], [-61, -57], [-68.5, -61], [-70.5, -74.5], [-66, -86], [-57, -96], [-52, -100], [-53.5, -106.5], [-60.5, -109.5], [-68.5, -107.5],
    [-80.5, -96.5], [-93.5, -85], [-105.5, -73.5], [-115.5, -61.5], [-117, -51.5], [-113.5, -38.5], [-105.5, -31], [-90.5, -28.5],
    [-75.5, -23.5], [-68.5, -15], [-66.5, -6.5]],
  [[-114.5, -5], [-112, 3.5], [-105.5, 8.5], [-90.5, 11.5], [-70.5, 13.5], [-53.5, 12.5], [-47, 18.5], [-43, 25], [-38.5, 31.5], [-32.5, 35],
    [-23, 44.5], [-14.5, 52], [-11, 55.5]],
  [[-3.5, -13.5], [-2, -6.5], [-1.5, -1], [-3.5, 8.5], [-7, 21.5], [-8.5, 35], [-11.5, 48.5], [-11, 55.5], [-15.5, 61.5], [-21, 66.5],
    [-25, 72], [-30, 87.5], [-50, 95], [-70, 85], [-75, 65], [-91, 56]],
  [[4, 61.5], [16.5, 63.5], [28, 61.5], [29.5, 48.5], [30.5, 31.5], [33, 15], [39.5, 5], [49.5, 1.5], [59.5, 5], [64.5, 15], [69.5, 25],
    [78, 30], [88, 28.5], [99.5, 23.5], [111.5, 19.5]],
  [[3, -105], [1.5, -114.5], [-1, -123], [-3.5, -127.5], [-3.5, -135], [-1.5, -143], [3.5, -149], [11.5, -155], [18, -160], [33, -161],
    [49.5, -160.5], [63, -157.5], [73, -154.5], [80.5, -150.5]],
  [[-66.5, -6], [-64.5, 1.5], [-60.5, 6.5], [-53.5, 12.5]],
  [[-11, 55.5], [-3.5, 60], [4, 61.5]],
  [[88, 28.5], [87, 38.5], [84.5, 48.5], [78, 56.5]],
  [[-3.5, -127], [-13.5, -128.5], [-23.5, -131], [-35.5, -132.5]],
];
/** The enemy boss camp (bandit fort): the east edge of the hub, in front of the cemetery gate. */
/** «Свирепый вожак» of the forest. */
export const FOREST_MINI: [number, number] = [-10.6, -11.6];
/** The gloves elite (bandit_veteran): between the pond and the trail out of the settlement. */
export const GLOVES_AT: [number, number] = [20, -77];
/** Forest spawners pinned to a spot (the rest spread along the trail): the mini-boss and four elites. */
export const FOREST_PINS: Record<string, [number, number]> = {
  // the elites spread over the whole forest (west, east, south), the gloves one by the pond
  bandit_warlord: FOREST_MINI, bandit_lumberjack: [19, -13], bandit_veteran: GLOVES_AT, bandit_brute: [-27, -61], bandit_runner_elite: [41, -62],
};
/** Two bandit trios in the trees by the gloves elite (GLOVES_BANDITS, one pack each). */
export const GLOVES_PACKS: [number, number][] = [[14, -74], [27, -76]];
/** Bandits in the wood between the settlement and the fort (MID_SPAWNERS): [along, side] m on the camp → fort line. */
export const MID_UV: [number, number][] = [[18, 1], [24, 1.5], [27.5, 0], [20.7, 6.9], [17.5, 4.5]];
/** A point [along, side] on the straight line from the settlement to the fort. */
export function campToFortAt([u, v]: readonly number[]) {
  const len = Math.hypot(FORT.x - ISLAND.campX, FORT.z - ISLAND.campZ);
  const dx = (FORT.x - ISLAND.campX) / len;
  const dz = (FORT.z - ISLAND.campZ) / len;
  return { x: ISLAND.campX + u * dx - v * dz, z: ISLAND.campZ + u * dz + v * dx };
}
export const ARENA = { x: WAY[WAY.length - 1][0], z: WAY[WAY.length - 1][1], r: 15 };

const STEP = 0.5;
function buildCurve(way: [number, number][]) {
  const xs: number[] = [];
  const zs: number[] = [];
  const P = (i: number) => way[Math.max(0, Math.min(way.length - 1, i))];
  for (let i = 0; i < way.length - 1; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.25));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      xs.push(cr(p0[0], p1[0], p2[0], p3[0]));
      zs.push(cr(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  xs.push(way[way.length - 1][0]);
  zs.push(way[way.length - 1][1]);
  // resample at an even STEP so index ↔ arc length
  const ox: number[] = [xs[0]];
  const oz: number[] = [zs[0]];
  let carry = 0;
  for (let i = 1; i < xs.length; i++) {
    let ax = xs[i - 1];
    let az = zs[i - 1];
    let seg = Math.hypot(xs[i] - ax, zs[i] - az);
    while (carry + seg >= STEP) {
      const k = (STEP - carry) / seg;
      ax += (xs[i] - ax) * k;
      az += (zs[i] - az) * k;
      ox.push(ax);
      oz.push(az);
      seg = Math.hypot(xs[i] - ax, zs[i] - az);
      carry = 0;
    }
    carry += seg;
  }
  return { x: ox, z: oz, length: (ox.length - 1) * STEP };
}
export const PATH = buildCurve(WAY);
export const BRANCH_PATHS = BRANCH_WAYS.map(buildCurve);
/** Abandoned path on from the arena through the Snow Pass gate; drawn fading out, overgrown. */
export const OLD_TRAIL = buildCurve([[84, -80], [76, -89], [68.5, -96], [58.5, -102.5], [49, -107], [40.5, -111]]);

/** Point and unit tangent on the trail at arc length s. */
export function pathAt(s: number) {
  const n = PATH.x.length;
  const i = Math.max(0, Math.min(n - 2, Math.floor(s / STEP)));
  const f = Math.max(0, Math.min(1, s / STEP - i));
  const x = PATH.x[i] + (PATH.x[i + 1] - PATH.x[i]) * f;
  const z = PATH.z[i] + (PATH.z[i + 1] - PATH.z[i]) * f;
  const tx = PATH.x[i + 1] - PATH.x[i];
  const tz = PATH.z[i + 1] - PATH.z[i];
  const l = Math.hypot(tx, tz) || 1;
  return { x, z, tx: tx / l, tz: tz / l };
}

// spatial hash of trail samples for fast "distance to the trail" queries
const CELL = 4;
const grid = new Map<number, number[]>();
const key = (cx: number, cz: number) => (cx + 500) * 1000 + (cz + 500);
const TRAIL_X = PATH.x.concat(...BRANCH_PATHS.map((c) => c.x));
const TRAIL_Z = PATH.z.concat(...BRANCH_PATHS.map((c) => c.z));
TRAIL_X.forEach((x, i) => {
  const k = key(Math.floor(x / CELL), Math.floor(TRAIL_Z[i] / CELL));
  let a = grid.get(k);
  if (!a) grid.set(k, (a = []));
  a.push(i);
});
/** Distance to the trail (capped at ~CELL: farther points just report a big number). */
export function pathDist(x: number, z: number) {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  let best = 99;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const a = grid.get(key(cx + dx, cz + dz));
      if (!a) continue;
      for (const i of a) {
        const d = (TRAIL_X[i] - x) ** 2 + (TRAIL_Z[i] - z) ** 2;
        if (d < best) best = d;
      }
    }
  }
  return best === 99 ? 99 : Math.sqrt(best);
}
/** Arc length of the closest trail point (how far along the journey a spot is). */
export function progressAt(x: number, z: number) {
  let best = Infinity;
  let bi = 0;
  for (let i = 0; i < PATH.x.length; i++) {
    const d = (PATH.x[i] - x) ** 2 + (PATH.z[i] - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  return bi * STEP;
}

/** A guard trio at a trail point: two flanking it (`gap` m either side), the third behind their gap along the trail. */
const flank = (x: number, z: number, tx: number, tz: number, gap: number) => [
  { x: x + tz * gap, z: z - tx * gap }, { x: x - tz * gap, z: z + tx * gap }, { x: x + tx * 1.5, z: z + tz * 1.5 },
];
/** n spots on a circle of radius r round (x, z), from angle a0. */
export function ringSpots(x: number, z: number, n: number, r: number, a0 = 0) {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out.push({ x: x + Math.sin(a) * r, z: z + Math.cos(a) * r });
  }
  return out;
}
/** Guards just inside the north gate (hub → Snow Pass), either side of the door. */
export const GATE_GUARDS = flank(DOOR_PEAKS.x - DOOR_PEAKS.tx * 8, DOOR_PEAKS.z - DOOR_PEAKS.tz * 8, DOOR_PEAKS.tx, DOOR_PEAKS.tz, 2.6);

/** The ridge gate: where the trail crosses from the forest into the cemetery. */
export const GATE = (() => {
  for (let i = 1; i < PATH.x.length; i++) {
    if (zoneIdAt(PATH.x[i], PATH.z[i]) === 'cemetery' && zoneIdAt(PATH.x[i - 1], PATH.z[i - 1]) !== 'cemetery') {
      return { ...pathAt(i * STEP), s: i * STEP };
    }
  }
  throw new Error('trail never enters the cemetery');
})();
/** Bandit fort on the trail before the ridge gate; its palisade runs on into the ridge, the gate is its only back way out. */
export const FORT = (() => {
  const p = pathAt(GATE.s - 12);
  return { x: p.x, z: p.z, r: Math.hypot(GATE.x - p.x, GATE.z - p.z) + 1.5 };
})();
/** Elite guards of the boss camp: on the trail just before the fort's west entrance. */
export const BOSS_GUARDS = (() => {
  let s = progressAt(FORT.x, FORT.z);
  while (s > 0 && Math.hypot(pathAt(s).x - FORT.x, pathAt(s).z - FORT.z) < FORT.r) s -= STEP;
  const p = pathAt(s - 4);
  return flank(p.x, p.z, p.tx, p.tz, 2.4);
})();

/** A passage through a ridge. (tx, tz) is the unit direction of travel from `from` into `to`. */
export interface Gate { id: string; from: ZoneId; to: ZoneId; x: number; z: number; tx: number; tz: number }
/**
 * Passages: the cemetery one is where the trail crosses; the others are placed by hand (map drawing) and slid
 * onto the nearest stretch of the actual border, facing from `from` into `to`.
 */
export const GATES: Gate[] = (() => {
  const out: Gate[] = [{ id: 'forest-cemetery', from: 'forest', to: 'cemetery', x: GATE.x, z: GATE.z, tx: GATE.tx, tz: GATE.tz }];
  const manual: [ZoneId, ZoneId, number, number][] = [
    ['forest', 'hills', DOOR_HILLS.x, DOOR_HILLS.z], ['hills', 'grove', -66.5, -1.5], ['forest', 'swamp', DOOR_SWAMP.x, DOOR_SWAMP.z],
    ['grove', 'swamp', -30, 40], ['swamp', 'dunes', 5, 62.5], ['cemetery', 'peaks', 69.5, -96], ['forest', 'peaks', DOOR_PEAKS.x, DOOR_PEAKS.z],
  ];
  for (const [from, to, x0, z0] of manual) out.push({ id: `${from}-${to}`, from, to, ...snapGate(from, to, x0, z0) });
  return out;
})();
/** Main boss and «Свирепый вожак» spots of the cemetery and the outer locations (map drawing; slid onto walkable land). */
export const LAND_BOSSES: { zone: ZoneId; boss?: [number, number]; minis: [number, number][] }[] = [
  { zone: 'peaks', boss: [89.5, -149], minis: [[36.5, -131], [-40, -130]] },
  { zone: 'hills', boss: [-122.5, -52.5], minis: [[-70, -87.5]] },
  { zone: 'grove', boss: [-118.5, 4.5], minis: [[-61.5, 30]] },
  { zone: 'swamp', boss: [-93.5, 55.5], minis: [[-47.5, 72.5]] },
  { zone: 'dunes', boss: [74, 61], minis: [[111.5, 20]] },
];

/** Distance to the nearest passage. */
export function gateDist(x: number, z: number) {
  let best = Infinity;
  for (const g of GATES) best = Math.min(best, Math.hypot(x - g.x, z - g.z));
  return best;
}

// ---------- height ----------
/** Ridge height (0 at the gate). The rocks on it block walking; the walkable floor stays flat. */
export function ridgeH(x: number, z: number) {
  const d = ridgeDist(x, z);
  if (d > 3.4) return 0;
  const gate = smooth(5, 9, gateDist(x, z));
  return gate * 3.6 * smooth(3.4, 0.6, d) * (0.6 + 0.8 * fbm(x * 0.15, z * 0.15));
}

/** Ground height: 0 on the walkable island, a rim (beach / tree bank / cliffs) and the sea floor around it. */
export function heightAt(x: number, z: number) {
  const d = coastDist(x, z);
  const e = rimKind(angleOf(x, z));
  const inset = 4.5 + 2 * treesOf(e) + 3 * cliffOf(e);
  const ridge = d > 0 ? ridgeH(x, z) : 0;
  if (d >= inset) return ridge;
  if (d > 0) {
    const t = (inset - d) / inset;
    const cliff = cliffOf(e);
    const trees = treesOf(e) * (1 - cliff);
    const hump = smooth(0, 0.35, t) * (1 - smooth(0.72, 1, t));
    const h = -0.9 * t ** 1.2 + trees * 1.6 * Math.sin(Math.PI * t) + cliff * (3 + 6 * fbm(x * 0.05 + 10, z * 0.05)) * hump;
    return ridge > 0 ? Math.max(h, ridge) : h;
  }
  return Math.max(-6, -0.9 + d * 0.3);
}

/** Inside the walkable island and off the ridges (the passages are walkable). */
/** No-go band along every ridge between locations (m from the ridge line), open only round the gates. */
export const BORDER = 5.5;
export const BORDER_GATE_R = 6;
/** No-walk band along the ridges: BORDER wide, narrowing smoothly through each passage (negative right in it). */
export function borderAt(x: number, z: number) {
  return (BORDER + 1) * smooth(1.5, BORDER_GATE_R + 3, gateDist(x, z)) - 1;
}
/** Metres of room beyond the ridge border (< 0 inside it). */
export const borderRoom = (x: number, z: number) => ridgeDist(x, z) - borderAt(x, z);
/** Unit direction out of the ridge border (up borderRoom, which also bends round the passage funnels). */
export function borderAway(x: number, z: number) {
  const gx = borderRoom(x + 1, z) - borderRoom(x - 1, z);
  const gz = borderRoom(x, z + 1) - borderRoom(x, z - 1);
  const l = Math.hypot(gx, gz) || 1;
  return { x: gx / l, z: gz / l };
}
export function walkable(x: number, z: number, pad = 0) {
  if (outside(x, z) > -pad) return false;
  return borderRoom(x, z) > pad;
}
/** Unit direction away from the nearest ridge. */
export function ridgeAway(x: number, z: number) {
  const gx = ridgeDist(x + 1, z) - ridgeDist(x - 1, z);
  const gz = ridgeDist(x, z + 1) - ridgeDist(x, z - 1);
  const l = Math.hypot(gx, gz) || 1;
  return { x: gx / l, z: gz / l };
}

/** A point on the walkable edge at angle a, `inset` metres inside (along the ray from the island centre). */
export function edgePoint(a: number, inset = 0) {
  let r = 20;
  while (r < 200 && outside(ISLAND.cx + Math.sin(a) * r, ISLAND.cz + Math.cos(a) * r) < -inset) r += 0.5;
  return { x: ISLAND.cx + Math.sin(a) * r, z: ISLAND.cz + Math.cos(a) * r };
}

// ---------- zone weight grid (smooth borders for colours, fog and mist) ----------
export const ZGRID = { n: 170, cell: MAP_BOX.size / 170 };
/** w: NZ weights per cell (blurred zone membership, in ZONES order); land: 1 on land … 0 in deep sea. */
export const zoneGrid = (() => {
  const { n, cell } = ZGRID;
  let w = new Float32Array(n * n * NZ);
  const land = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = MAP_BOX.x + (i + 0.5) * cell;
      const z = MAP_BOX.z + (j + 0.5) * cell;
      w[(j * n + i) * NZ + ZONE_INDEX[zoneIdAt(x, z)]] = 1;
      land[j * n + i] = Math.min(1, Math.max(0, (heightAt(x, z) + 4) / 3.7));
    }
  }
  // two separable box-blur passes (radius 3 cells ≈ 6 m)
  const R = 3;
  for (let pass = 0; pass < 2; pass++) {
    for (const horiz of [true, false]) {
      const out = new Float32Array(w.length);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < NZ; c++) {
            let s = 0;
            let cnt = 0;
            for (let k = -R; k <= R; k++) {
              const ii = horiz ? i + k : i;
              const jj = horiz ? j : j + k;
              if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
              s += w[(jj * n + ii) * NZ + c];
              cnt++;
            }
            out[(j * n + i) * NZ + c] = s / cnt;
          }
        }
      }
      w = out;
    }
  }
  return { w, land };
})();

/** Bilinear zone weights at a point (NZ values, ZONES order). */
export function zoneWeights(x: number, z: number, out: number[] = new Array(NZ).fill(0)) {
  const { n, cell } = ZGRID;
  const fx = Math.min(n - 1.001, Math.max(0, (x - MAP_BOX.x) / cell - 0.5));
  const fz = Math.min(n - 1.001, Math.max(0, (z - MAP_BOX.z) / cell - 0.5));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const w = zoneGrid.w;
  for (let c = 0; c < NZ; c++) {
    const a = w[(j * n + i) * NZ + c];
    const b = w[(j * n + i + 1) * NZ + c];
    const d = w[((j + 1) * n + i) * NZ + c];
    const e = w[((j + 1) * n + i + 1) * NZ + c];
    out[c] = (a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v;
  }
  return out;
}
