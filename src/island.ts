// Island layout. The world is a roughly round island in the ocean. The forest edge («Лесная опушка») is the
// hub in the middle, with the hero's settlement at its centre; a ring of locations surrounds it, each a
// sector of the ring with noisy borders (some wider, some narrower). The cemetery sector is walled off by a
// rocky ridge with a single gate (the magic barrier). One narrow trail winds from the settlement gate through
// the forest and the bandit fort to that gate, then through the cemetery to the arena.
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
export const ISLAND = { cx: 0, cz: -52, water: -0.3, campX: 0, campZ: -52, campR: 19 };
/** Square that holds the ground mesh, the baked ground/map textures and the zone grid. */
export const MAP_BOX = { x: -142, z: -194, size: 284 };
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
/**
 * Ring sectors, counter-clockwise from the east-north-east (angles: 0 = +Z/south, π/2 = +X/east).
 * `from` is the sector's first border; widths differ so locations are of different size.
 */
const SECTORS = ([

  { id: 'cemetery', from: 57 }, { id: 'peaks', from: 123 }, { id: 'swamp', from: 181 },
  { id: 'grove', from: 253 }, { id: 'dunes', from: 303 }, { id: 'hills', from: 365 },
] as { id: ZoneId; from: number }[]).map((d) => ({ ...d, from: (d.from * Math.PI) / 180 }));
/** Angle of border k at radius r (wobbles with the radius so borders are not straight spokes). */
const borderA = (k: number, r: number) => SECTORS[k].from + (fbm(r * 0.05 + k * 7.3, k * 3.1) - 0.5) * 0.35;

/** The settlement in the middle of the forest (palisade + yard). */
export function inCamp(x: number, z: number, pad = 0) {
  return Math.hypot(x - ISLAND.campX, z - ISLAND.campZ) < ISLAND.campR + pad;
}
export function zoneIdAt(x: number, z: number): ZoneId {
  const r = Math.hypot(x - ISLAND.cx, z - ISLAND.cz);
  const a = angleOf(x, z);
  if (r < forestR(a)) return 'forest';
  // angles measured from the first border, in [0, 2π); borders are far enough apart to stay in order
  const TAU = Math.PI * 2;
  const base = borderA(0, r);
  const rel = (v: number) => (((v - base) % TAU) + TAU * 2) % TAU;
  const ra = rel(a);
  let id = SECTORS[0].id;
  for (let k = 1; k < SECTORS.length; k++) if (ra >= rel(borderA(k, r))) id = SECTORS[k].id;
  return id;
}
export function zoneAt(x: number, z: number): ZoneDef { return ZONE_BY_ID[zoneIdAt(x, z)]; }

// ---------- ridges: every location is walled off ----------
// Rocky ridges run round the forest edge and along every border between neighbouring ring sectors
// (from the forest out to the sea). Each line is sampled every ~0.5 m and queried through a spatial hash.
const at = (a: number, r: number): [number, number] => [ISLAND.cx + Math.sin(a) * r, ISLAND.cz + Math.cos(a) * r];
export const RIDGES: [number, number][][] = (() => {
  const lines: [number, number][][] = [];
  const ring: [number, number][] = [];
  for (let a = -Math.PI; a <= Math.PI + 1e-9; a += 0.004) ring.push(at(a, forestR(a)));
  lines.push(ring);
  for (let k = 0; k < SECTORS.length; k++) {
    const spoke: [number, number][] = [];
    for (let r = forestR(SECTORS[k].from); r < 132; r += 0.5) spoke.push(at(borderA(k, r), r));
    lines.push(spoke);
  }
  return lines;
})();
const RIDGE_PTS = RIDGES.flat();
const RCELL = 4;
const rgrid = new Map<number, number[]>();
const rkey = (cx: number, cz: number) => (cx + 500) * 1000 + (cz + 500);
RIDGE_PTS.forEach(([x, z], i) => {
  const k = rkey(Math.floor(x / RCELL), Math.floor(z / RCELL));
  let a = rgrid.get(k);
  if (!a) rgrid.set(k, (a = []));
  a.push(i);
});
/** Distance to the ridge line (capped: far points report 99). */
export function ridgeDist(x: number, z: number) {
  const cx = Math.floor(x / RCELL);
  const cz = Math.floor(z / RCELL);
  let best = 99 * 99;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const a = rgrid.get(rkey(cx + dx, cz + dz));
      if (!a) continue;
      for (const i of a) {
        const d = (RIDGE_PTS[i][0] - x) ** 2 + (RIDGE_PTS[i][1] - z) ** 2;
        if (d < best) best = d;
      }
    }
  }
  return Math.sqrt(best);
}

// ---------- trail ----------
/**
 * Trail waypoints: settlement gate (north) → round the west and south of the forest → bandit fort (boss 1,
 * see FORT) → ridge gate (east) → cemetery → arena (boss 2).
 */
const WAY: [number, number][] = [
  [0, -72], [-3, -80], [-12, -86], [-22, -75], [-30, -64], [-38, -50], [-34, -34], [-22, -22], [-4, -16],
  [14, -18], [24, -28], [32, -36], [44, -40], [56, -45], [72, -56], [80, -68], [84, -80],
];
/** Where the world map writes each zone's name: the middle of each sector (the forest: above the settlement). */
export const ZONE_LABEL = Object.fromEntries(ZONE_IDS.map((id) => {
  if (id === 'forest') return [id, [ISLAND.cx, ISLAND.cz - 28]];
  const k = SECTORS.findIndex((d) => d.id === id);
  const a = (SECTORS[k].from + (k + 1 < SECTORS.length ? SECTORS[k + 1].from : SECTORS[0].from + Math.PI * 2)) / 2;
  return [id, [ISLAND.cx + Math.sin(a) * 80, ISLAND.cz + Math.cos(a) * 80]];
})) as Record<ZoneId, [number, number]>;
export const ARENA = { x: WAY[WAY.length - 1][0], z: WAY[WAY.length - 1][1], r: 15 };

const STEP = 0.5;
function buildPath() {
  const xs: number[] = [];
  const zs: number[] = [];
  const P = (i: number) => WAY[Math.max(0, Math.min(WAY.length - 1, i))];
  for (let i = 0; i < WAY.length - 1; i++) {
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
  xs.push(WAY[WAY.length - 1][0]);
  zs.push(WAY[WAY.length - 1][1]);
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
export const PATH = buildPath();

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
PATH.x.forEach((x, i) => {
  const k = key(Math.floor(x / CELL), Math.floor(PATH.z[i] / CELL));
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
        const d = (PATH.x[i] - x) ** 2 + (PATH.z[i] - z) ** 2;
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

/** The ridge gate: where the trail crosses from the forest into the cemetery. */
export const GATE = (() => {
  for (let i = 1; i < PATH.x.length; i++) {
    if (zoneIdAt(PATH.x[i], PATH.z[i]) === 'cemetery' && zoneIdAt(PATH.x[i - 1], PATH.z[i - 1]) !== 'cemetery') {
      return { ...pathAt(i * STEP), s: i * STEP };
    }
  }
  throw new Error('trail never enters the cemetery');
})();

/**
 * Bandit fort (boss 1) on the trail at the far end of the forest, right before the ridge gate it opens:
 * the forest is crossed first, the boss guards the way on.
 */
export const FORT = (() => {
  const r = 11;
  const p = pathAt(GATE.s - r - 7);
  return { x: p.x, z: p.z, r };
})();

/** A passage through a ridge. (tx, tz) is the unit direction of travel from `from` into `to`. */
export interface Gate { id: string; from: ZoneId; to: ZoneId; x: number; z: number; tx: number; tz: number }
/**
 * Passages: one from the forest into every ring location (the cemetery's is where the trail crosses)
 * and one through every border between two neighbouring locations, halfway out to the shore.
 */
export const GATES: Gate[] = (() => {
  const out: Gate[] = [];
  const n = SECTORS.length;
  const TAU = Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const to = SECTORS[k].id;
    if (to === 'cemetery') {
      out.push({ id: `forest-${to}`, from: 'forest', to, x: GATE.x, z: GATE.z, tx: GATE.tx, tz: GATE.tz });
      continue;
    }
    const next = k + 1 < n ? SECTORS[k + 1].from : SECTORS[0].from + TAU;
    const a = (SECTORS[k].from + next) / 2;
    const [x, z] = at(a, forestR(a));
    out.push({ id: `forest-${to}`, from: 'forest', to, x, z, tx: Math.sin(a), tz: Math.cos(a) });
  }
  for (let k = 0; k < n; k++) {
    const from = SECTORS[(k + n - 1) % n].id;
    const to = SECTORS[k].id;
    const a0 = SECTORS[k].from;
    const r = (forestR(a0) + walkR(a0)) / 2;
    const [x, z] = at(borderA(k, r), r);
    const [x0, z0] = at(borderA(k, r - 1), r - 1);
    const [x1, z1] = at(borderA(k, r + 1), r + 1);
    // across the spoke, towards growing angle (from sector k-1 into sector k)
    let tx = z1 - z0;
    let tz = -(x1 - x0);
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const ax = Math.cos(borderA(k, r));
    const az = -Math.sin(borderA(k, r));
    if (tx * ax + tz * az < 0) { tx = -tx; tz = -tz; }
    out.push({ id: `${from}-${to}`, from, to, x, z, tx, tz });
  }
  return out;
})();
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
  const a = angleOf(x, z);
  const r = Math.hypot(x - ISLAND.cx, z - ISLAND.cz);
  const rw = walkR(a);
  const rs = shoreR(a);
  const ridge = r < rs ? ridgeH(x, z) : 0;
  if (r <= rw) return ridge;
  if (r < rs) {
    const t = (r - rw) / (rs - rw);
    const e = rimKind(a);
    const cliff = cliffOf(e);
    const trees = treesOf(e) * (1 - cliff);
    const hump = smooth(0, 0.35, t) * (1 - smooth(0.72, 1, t));
    const h = -0.9 * t ** 1.2 + trees * 1.6 * Math.sin(Math.PI * t) + cliff * (3 + 6 * fbm(x * 0.05 + 10, z * 0.05)) * hump;
    return ridge > 0 ? Math.max(h, ridge) : h;
  }
  return Math.max(-6, -0.9 - (r - rs) * 0.3);
}

/** Inside the walkable island and off the ridges (the passages are walkable). */
export function walkable(x: number, z: number, pad = 0) {
  const r = Math.hypot(x - ISLAND.cx, z - ISLAND.cz);
  if (r > walkR(angleOf(x, z)) - pad) return false;
  return ridgeDist(x, z) > 3.2 + pad || gateDist(x, z) < 5;
}

/** A point on the walkable edge at angle a, `inset` metres inside. */
export function edgePoint(a: number, inset = 0) {
  const r = walkR(a) - inset;
  return { x: ISLAND.cx + Math.sin(a) * r, z: ISLAND.cz + Math.cos(a) * r };
}

// ---------- zone weight grid (smooth borders for colours, fog and mist) ----------
export const ZGRID = { n: 142, cell: MAP_BOX.size / 142 };
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
