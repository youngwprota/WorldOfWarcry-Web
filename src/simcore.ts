// Balance simulator core: a bot plays the forest and the cemetery on a 1-D model of the trail, using the game's own
// config and formulas (src/balance.ts). No node or DOM: the CLI (tools/sim.ts) and the balance page (balance.html,
// in a worker) both run it.
import * as CONFIG from './config';
import {
  ATTACK_HIT, BREAKABLES, CEMETERY_BOARS, FACTIONS, FOREST_TREES, GLOVES_BANDITS, GUARD_PACKS, HERO, MID_SPAWNERS, MINI_SPAWNER, MINI_SPAWNER_OF, MOBS, ORBS,
  CEMETERY_AREAS, CEMETERY_PACKS, DUNES_SPAWNERS, GROVE_SPAWNERS, HILLS_BANNERS, HILLS_EXTRA, HILLS_LIONS, HILLS_PACKS, HILLS_SNAGS, LAND_ELITES, MINI_PAIR_OF, PEAKS_SPAWNERS,
  SPAWN_PRESETS, SWAMP_SPAWNERS, PETS, PROP_SPAWNERS, RESIST_MULT, SPAWNERS, STAVES, WEAPONS, ZONE_FOES, ZONE_TIER, depthMul, zoneScaleOf, mobImpact, packUnits, mobRank, zoneResist,
  tokenChance as zoneTokenChance,
  type FactionId, type MobDef, type MobRank, type OrbKind, type OrbReward, type SpawnerDef, type StatId, type ZoneId,
} from './config';
import { addStat, heroDps, armorMul, critAvg, critChance, critMul, dodgeChance, guardMul, heroStats, type HeroBuild } from './balance';
import { ARMOR, armorStats, dropItem, itemClass, makeItem, sameItem, weaponDamage, type Item } from './items';
import { CLASSES, CLASS_IDS, classSlot, kitOf, weaponClass, type HeroClass } from './party';
import { pull } from './gacha';
import {
  ARENA, BOSS_GUARDS, FORT, FOREST_PINS, GATE, GATES, GATE_GUARDS, GLOVES_PACKS, GLOVES_SPREAD, ISLAND, LAND_BOSSES, LAND_TRAILS, MAP_BOX, MID_UV, SPAWN, campToFortAt, ringSpots, inCamp,
  pathAt, pathDist, progressAt, walkable, zoneIdAt,
} from './island';

// ---------- options ----------
export interface SimOpts {
  faction: FactionId;
  /** 'party': all three classes, the bot sends the best one at each target (as a player may); or one class only. */
  cls: HeroClass | 'party';
  weapon: string; // start weapon of its class ('' = the class kit)
  off: string; // start class item of its class (a shield, an orb)
  runs: number;
  until: number; // s
  dodge: number; // share of boss slams / blasts dodged
  uptime: number; // share of the fight the hero actually swings
  combo: number; // chance a swing keeps the combo chain
  bossWin: number; // tries a boss when the estimated win rate is at least this
  seed: number;
  keep: boolean; // never change weapons
  probes: number; // dice fights behind each win-rate estimate (boss tries, minute snapshots)
  aggro: boolean; // hostile mobs near a fight's spot or the way to it join the fight (Game: idle mobs rush the hero within `aggro`)
}
const ZONE_IDS = CONFIG.ZONES.map((z) => z.id);
export const DEFAULT_OPTS: SimOpts = {
  faction: 'human', cls: 'party', weapon: '', off: '', runs: 10, until: 90 * 60, dodge: 0.6, uptime: 0.8, combo: 0.85, bossWin: 0.5, seed: 1, keep: false, probes: 12, aggro: true,
};
let OPT: SimOpts = { ...DEFAULT_OPTS };

/** What-if: config objects are mutable, so `MOBS.bandit_chief.hp` = 6000 needs no file edit (lasts until reload). */
export function applySet(path: string, value: unknown) {
  const keys = path.split('.');
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o?.[k] as Record<string, unknown>;
  if (!o || typeof o !== 'object' || !(keys[keys.length - 1] in o)) throw new Error(`--set: нет такого поля ${path}`);
  o[keys[keys.length - 1]] = value;
}

// ---------- deterministic RNG (the game code calls Math.random; simulate / bench install it) ----------
let rs = 1;
const rand = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------- map: every spawner as a point beside the trail ----------
/** `s`: progress along the trail, `off`: metres off it on `side` (±1); `x`/`z` when the world pins the exact spot. */
interface Spot { s: number; off: number; side?: number; x?: number; z?: number; zone?: ZoneId }
/** The forest and the cemetery share the trail model; every outer location is its own open ground. */
type Ground = ZoneId | 'trail';
const groundOf = (z: ZoneId): Ground => (z === 'forest' || z === 'cemetery' ? 'trail' : z);
const spotGround = (p: Spot): Ground => (p.zone ? groundOf(p.zone) : 'trail');
/** A spot of an outer location: straight lines there (no trail model). */
const landSpot = (x: number, z: number, zone: ZoneId): Spot => ({ s: 0, off: 0, x, z, zone });
const spotAt = (x: number, z: number): Spot => { const s = progressAt(x, z); const p = pathAt(s); return { s, off: Math.hypot(x - p.x, z - p.z), x, z }; };
const sCamp = progressAt(SPAWN.x, SPAWN.z);
const sFort = progressAt(FORT.x, FORT.z);
const sArena = progressAt(ARENA.x, ARENA.z);
/** Same spread as World.mobsAlong: evenly over the ranges, alternating sides, 6–13 m off the trail. */
function along(ranges: [number, number][], n: number): Spot[] {
  const total = ranges.reduce((t, [a, b]) => t + (b - a), 0);
  return Array.from({ length: n }, (_, i) => {
    let d = ((i + 0.5) / n) * total;
    let s = ranges[ranges.length - 1][1];
    for (const [a, b] of ranges) { if (d <= b - a) { s = a + d; break; } d -= b - a; }
    return { s, off: i % 4 < 2 ? 7 : 12, side: i % 2 ? 1 : -1 };
  });
}
/**
 * World.mobsOnCurve's spot for each spawner along the trail ranges: the first free point by the trail (walkable, in
 * the zone, 4+ m off the trail, out of the camp, 9+ m from other packs) trying both sides and a few offsets; pinned
 * ids stand on their pin. `packs`: centres taken so far (shared across calls like World.packCenters).
 */
function placeAlong(ranges: [number, number][], defs: SpawnerDef[], zone: ZoneId, packs: [number, number][], pins: Record<string, [number, number]> = {}): Spot[] {
  const total = ranges.reduce((t, [a, b]) => t + (b - a), 0);
  const sAt = (d: number) => { for (const [a, b] of ranges) { if (d <= b - a) return a + d; d -= b - a; } return ranges[ranges.length - 1][1]; };
  const ok = (x: number, z: number) => walkable(x, z, 3) && zoneIdAt(x, z) === zone && pathDist(x, z) > 4 && !inCamp(x, z, 4)
    && !packs.some(([px, pz]) => Math.hypot(px - x, pz - z) < 9);
  return defs.map((def, i) => {
    const pin = pins[def.id];
    if (pin) { packs.push(pin); return spotAt(pin[0], pin[1]); }
    const d = ((i + 0.5) / defs.length) * total;
    let c: { x: number; z: number } | null = null;
    search: for (const ds of [0, 4, -4, 8, -8]) {
      const p = pathAt(sAt(Math.min(total, Math.max(0, d + ds))));
      for (const side of [i % 2 ? 1 : -1, i % 2 ? -1 : 1]) {
        for (const off of i % 4 < 2 ? [7, 10, 13] : [12, 9, 6]) {
          const q = { x: p.x + p.tz * side * off, z: p.z - p.tx * side * off };
          if (ok(q.x, q.z)) { c = q; break search; }
        }
      }
    }
    if (!c) { const p = pathAt(sAt(d)); c = { x: p.x + p.tz * 6, z: p.z - p.tx * 6 }; }
    packs.push([c.x, c.z]);
    return spotAt(c.x, c.z);
  });
}
// ---------- gates: the way between locations ----------
/** Each passage's spot on its two sides' grounds (the forest-cemetery one is inside the trail and left out). */
const PASSES = GATES.filter((g) => groundOf(g.from) !== groundOf(g.to)).map((g) => {
  const at = (z: ZoneId) => (groundOf(z) === 'trail' ? spotAt(g.x, g.z) : landSpot(g.x, g.z, z));
  return { id: g.id, sides: new Map<Ground, Spot>([[groundOf(g.from), at(g.from)], [groundOf(g.to), at(g.to)]]) };
});
/** Same ground: the trail model or a straight line. */
function leg(a: Spot, b: Spot) {
  if (spotGround(a) === 'trail') return trailDist(a, b);
  const pa = posOf(a), pb = posOf(b);
  return Math.hypot(pa.x - pb.x, pa.z - pb.z);
}
/** Passages open in this run (boss.unlocks) and the shortest way between any two of them (Floyd), `via` to rebuild it. */
let openGates = new Set<string>();
let G: number[][] = [];
let via: number[][] = [];
function openGate(...ids: string[]) {
  for (const id of ids) openGates.add(id);
  const n = PASSES.length;
  G = PASSES.map((a, i) => PASSES.map((b, j) => {
    if (i === j) return 0;
    if (!openGates.has(a.id) || !openGates.has(b.id)) return Infinity;
    let best = Infinity;
    for (const [g, sa] of a.sides) { const sb = b.sides.get(g); if (sb) best = Math.min(best, leg(sa, sb)); }
    return best;
  }));
  via = PASSES.map(() => PASSES.map((_, j) => j));
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (G[i][k] + G[k][j] < G[i][j]) { G[i][j] = G[i][k] + G[k][j]; via[i][j] = via[i][k]; }
  }
}
/** Locations the hero can walk into: the forest and both sides of every open passage. */
function openZones() {
  const out = new Set<ZoneId>(['forest']);
  for (const g of GATES) if (openGates.has(g.id)) { out.add(g.from); out.add(g.to); }
  return out;
}
/** Best way from `a` to `b` through open passages: [length, first passage, last passage] (−1 on the same ground). */
function bestWay(a: Spot, b: Spot): [number, number, number] {
  const ga = spotGround(a), gb = spotGround(b);
  if (ga === gb) return [leg(a, b), -1, -1];
  let best: [number, number, number] = [Infinity, -1, -1];
  PASSES.forEach((p, i) => {
    const pa = p.sides.get(ga);
    if (!pa || !openGates.has(p.id)) return;
    const da = leg(a, pa);
    PASSES.forEach((q, j) => {
      const qb = q.sides.get(gb);
      if (!qb || !openGates.has(q.id)) return;
      const d = da + G[i][j] + leg(qb, b);
      if (d < best[0]) best = [d, i, j];
    });
  });
  return best;
}
/** Walking distance between two spots, through the passages when they are on different grounds. */
const dist = (a: Spot, b: Spot) => bestWay(a, b)[0];
/** The way `dist` walks, as points. */
function route(a: Spot, b: Spot) {
  const [d, i0, j0] = bestWay(a, b);
  const plain = (x: Spot, y: Spot) => (spotGround(x) === 'trail' ? trailRoute(x, y) : [posOf(x), posOf(y)]);
  if (i0 < 0 || !isFinite(d)) return plain(a, b);
  const seq = [i0];
  for (let i = i0; i !== j0;) { i = via[i][j0]; seq.push(i); }
  const pts: { x: number; z: number }[] = [];
  let cur = a;
  for (const k of seq) {
    const sides = [...PASSES[k].sides.values()];
    const enter = PASSES[k].sides.get(spotGround(cur))!;
    pts.push(...plain(cur, enter));
    cur = sides[0] === enter ? sides[1] : sides[0];
  }
  pts.push(...plain(cur, b));
  return pts;
}

const forestRanges: [number, number][] = [[progressAt(-3, -80), sFort - 28]];
const cemRange: [number, number][] = [[GATE.s + 12, sArena - ARENA.r - 3]];
const graveRange: [number, number][] = [[GATE.s + 6, sArena - ARENA.r]];

/** Walking distance between two trail spots: along the trail plus the way off it (straight line when close). */
function trailDist(a: Spot, b: Spot) {
  const ds = Math.abs(a.s - b.s);
  if (ds < a.off + b.off) {
    const pa = posOf(a), pb = posOf(b);
    return Math.hypot(pa.x - pb.x, pa.z - pb.z);
  }
  return ds + a.off + b.off;
}
function posOf(p: Spot) {
  if (p.x !== undefined && p.z !== undefined) return { x: p.x, z: p.z };
  const pa = pathAt(p.s);
  const o = p.off * (p.side ?? 1);
  return { x: pa.x + pa.tz * o, z: pa.z - pa.tx * o };
}
/** The way between two trail spots as `trailDist` walks it: straight when close, else onto the trail, along it and off again. */
function trailRoute(a: Spot, b: Spot) {
  const ds = Math.abs(a.s - b.s);
  if (ds < a.off + b.off) return [posOf(a), posOf(b)];
  const pts = [posOf(a)];
  const n = Math.ceil(ds / 4);
  for (let i = 0; i <= n; i++) { const p = pathAt(a.s + ((b.s - a.s) * i) / n); pts.push({ x: p.x, z: p.z }); }
  pts.push(posOf(b));
  return pts;
}

/** A fixed-seed rng for the layout (the same map every run, like World's own rng streams). */
function layoutRng(seed: number) {
  let a = seed * 9973;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * A random walkable spot of `zone` 9+ m from the pack centres taken so far (World.spread / emptySpot pick at random
 * among decor the sim does not have, so this is the same kind of spot, not the same one); `ok`: extra test.
 */
function emptyIn(zone: ZoneId, r: () => number, packs: [number, number][], ok: (x: number, z: number) => boolean = () => true) {
  let best = { x: ISLAND.cx, z: ISLAND.cz }, bestD = -1;
  for (let i = 0; i < 400; i++) {
    const x = MAP_BOX.x + r() * MAP_BOX.size, z = MAP_BOX.z + r() * MAP_BOX.size;
    if (zoneIdAt(x, z) !== zone || !walkable(x, z, 2) || !ok(x, z)) continue;
    const d = packs.reduce((m, [px, pz]) => Math.min(m, Math.hypot(px - x, pz - z)), Infinity);
    if (d >= 9) { best = { x, z }; bestD = d; break; }
    if (d > bestD) { best = { x, z }; bestD = d; }
  }
  packs.push([best.x, best.z]);
  return best;
}

// ---------- units ----------
interface Unit {
  id: string; kind: 'mob' | 'prop'; def: string; zone: ZoneId; spot: Spot; depth: number; charges: number[];
  n: number; respawnAt: number; temp?: boolean;
  /** Snow Pass: every other mob has the location's `alt` resist profile (Game.zoneDef). */
  alt?: boolean;
  /** Social pack id: pulling one pulls them all (PackDef link 'social', World.joinPack). */
  pack?: string;
  /** World picks the spot at random: the sim's is the same kind of spot, not the same one. */
  approx?: boolean;
  /** A spawn slot's disposition is not hostile (a sparring camp, an ambush): it never rushes the hero by itself. */
  calm?: boolean;
}
/**
 * Aggro (Game.updateMobs): an idle hostile mob rushes the hero within its MobDef.aggro; it wanders up to 2.5 m round its
 * spot, and the hero stands a pace off his target — on average a mob joins when its spot is within aggro + this of the
 * target's. On the way the hero sees them standing and gives them a berth: only those whose aggro reaches 1.5 m past
 * the line of his way join (the Peaks gate guards stand 4–6 m off the forest trail with aggro 5.2 — skirted).
 */
const AGGRO_AT_SPOT = 2;
const AGGRO_ON_WAY = -1.5;
/**
 * The outer locations (World.buildOuterLands and its *Mobs): what stands there and in which packs, from the config
 * lists. Hand-picked spots are exact; World's random spreads are random walkable spots of the location here, its road
 * spawners spread along the location's road (LAND_TRAILS).
 */
function buildLands(us: Unit[], packs: [number, number][]) {
  const r = layoutRng(61);
  type P = { x: number; z: number };
  const one = (id: string, d: SpawnerDef, p: P, zone: ZoneId, pack?: string, approx = false, calm = false) => us.push({
    id, kind: d.unit, def: d.id, zone, spot: landSpot(p.x, p.z, zone), depth: 0, n: 0, respawnAt: 0, pack, approx: approx || undefined, calm: calm || undefined,
    charges: d.charges ?? [d.unit === 'mob' ? MOBS[d.id].respawn : BREAKABLES[d.id].respawn],
  });
  const group = (id: string, p: CONFIG.PackDef, c: P, zone: ZoneId, approx = false) =>
    ringSpots(c.x, c.z, p.slots.length, 1.8).forEach((q, i) =>
      one(`${id}:${i}`, { unit: 'mob', id: p.slots[i].id, charges: p.charges }, q, zone, p.link === 'social' ? id : undefined, approx, !!p.slots[i].behavior?.disposition && p.slots[i].behavior?.disposition !== 'hostile'));
  const pin = (x: number, z: number) => { packs.push([x, z]); return { x, z }; };
  const rnd = (zone: ZoneId) => emptyIn(zone, r, packs);
  /** `n` spots along road `k` of LAND_TRAILS, alternating sides `off` m off it, inside `zone` (else a random spot). */
  const road = (k: number, n: number, zone: ZoneId, off = 6) => {
    const line = LAND_TRAILS[k];
    const seg = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
    const total = seg.reduce((a, b) => a + b, 0);
    return Array.from({ length: n }, (_, i) => {
      let d = ((i + 0.5) / n) * total, j = 0;
      while (j < seg.length - 1 && d > seg[j]) d -= seg[j++];
      const [x0, z0] = line[j], [x1, z1] = line[j + 1];
      const k1 = Math.min(1, d / seg[j]), tx = (x1 - x0) / seg[j], tz = (z1 - z0) / seg[j], side = i % 2 ? 1 : -1;
      const x = x0 + (x1 - x0) * k1 + tz * side * off, z = z0 + (z1 - z0) * k1 - tx * side * off;
      return zoneIdAt(x, z) === zone && walkable(x, z, 1) ? pin(x, z) : rnd(zone);
    });
  };
  /** A few metres inside `zone` from passage `id`. */
  const atGate = (id: string, zone: ZoneId, d = 6) => {
    const g = GATES.find((x) => x.id === id)!;
    const s = g.to === zone ? 1 : -1;
    return pin(g.x + g.tx * s * d, g.z + g.tz * s * d);
  };

  // main bosses' «Свирепый вожак» and the loot elites
  for (const land of LAND_BOSSES) {
    if (land.zone === 'cemetery') continue;
    land.minis.forEach(([x, z], i) => {
      const id = `mini:${land.zone}:${i}`;
      const pair = MINI_PAIR_OF[land.zone];
      const warden = land.zone === 'peaks' && i === 0; // PEAKS_SPAWNERS.wardenGuard joins it
      const c = pin(x, z);
      one(id, MINI_SPAWNER_OF[land.zone] ?? MINI_SPAWNER, c, land.zone, pair || warden ? id : undefined);
      if (pair) one(`${id}:pair`, pair, { x: c.x + 1.5, z: c.z }, land.zone, id);
      if (warden) one('peaks:warden_guard', PEAKS_SPAWNERS.wardenGuard, { x: c.x - 1.5, z: c.z }, 'peaks', id);
    });
    (LAND_ELITES[land.zone] ?? []).forEach((e, i) => one(`elite:${land.zone}:${i}`, e.def, pin(e.x, e.z), land.zone));
  }

  // Snow Pass (world.snowMobs / snowBeasts)
  const P = PEAKS_SPAWNERS;
  group('peaks:guards', P.guards, atGate('forest-peaks', 'peaks'), 'peaks');
  P.elites.forEach((e, i) => one(`peaks:elite:${i}`, e.def, pin(e.x, e.z), 'peaks'));
  P.packs.forEach((p, i) => group(`peaks:pack:${i}`, p.def, pin(p.x, p.z), 'peaks'));
  P.assassins.forEach((d, i) => one(`peaks:lone:${i}`, d, rnd('peaks'), 'peaks', undefined, true));
  P.beasts.forEach((d, i) => one(`peaks:beast:${i}`, d, rnd('peaks'), 'peaks', undefined, true));
  const west = LAND_BOSSES.find((l) => l.zone === 'peaks')!.minis[1];
  group('peaks:bears', P.bears, pin(west[0] + 6, west[1]), 'peaks', true);
  road(4, P.trees.length, 'peaks', 3.2).forEach((p, i) => one(`peaks:tree:${i}`, P.trees[i], p, 'peaks', undefined, true));
  P.woodTrees.forEach((t, i) => one(`peaks:wood_tree:${i}`, t.def, pin(t.x, t.z), 'peaks'));

  // Hills: road mobs in pairs, snags on the road, lions off it, hand-picked extras and banners, a line at each gate
  const hills = SPAWNERS.hills ?? [];
  const inPair = new Map<number, string>();
  HILLS_PACKS.forEach((ids, k) => ids.forEach((i) => inPair.set(i, `hills:pack:${k}`)));
  road(0, hills.length, 'hills').forEach((p, i) => one(`hills:${i}`, hills[i], p, 'hills', inPair.get(i), true));
  road(0, HILLS_SNAGS.length, 'hills', 4).forEach((p, i) => one(`hills:snag:${i}`, HILLS_SNAGS[i], p, 'hills', undefined, true));
  HILLS_LIONS.packs.forEach((p, i) => group(`hills:lionpack:${i}`, p, rnd('hills'), 'hills', true));
  HILLS_LIONS.lions.forEach((d, i) => one(`hills:lion:${i}`, d, rnd('hills'), 'hills', undefined, true));
  HILLS_EXTRA.forEach((p, i) => group(`hills:extra:${i}`, p.def, pin(p.x, p.z), 'hills'));
  HILLS_BANNERS.forEach((b, i) => one(`hills:banner:${i}`, b.def, pin(b.x, b.z), 'hills'));
  for (const g of GATES) if (g.id.includes('hills')) group(`hills:gate:${g.id}`, SPAWN_PRESETS.gate_line.pack, atGate(g.id, 'hills'), 'hills');

  // Grove (world.groveMobs / groveAmbushes)
  const GR = GROVE_SPAWNERS;
  road(1, GR.warriors.length, 'grove', 5).forEach((c, i) => group(`grove:warriors:${i}`, GR.warriors[i], c, 'grove', true));
  GR.dragons.forEach((p, i) => group(`grove:dragon:${i}`, p, rnd('grove'), 'grove', true));
  GR.ambushes.forEach((p, i) => group(`grove:ambush:${i}`, p, rnd('grove'), 'grove', true));
  GR.bears.forEach((d, i) => one(`grove:bear:${i}`, d, rnd('grove'), 'grove', undefined, true));
  road(1, GR.trees.length, 'grove', 3.2).forEach((p, i) => one(`grove:tree:${i}`, GR.trees[i], p, 'grove', undefined, true));
  GR.woodTrees.forEach((d, i) => one(`grove:wood_tree:${i}`, d, rnd('grove'), 'grove', undefined, true));

  // Swamp (world.swampMobs): the oracle elite's guard joins it
  const SW = SWAMP_SPAWNERS;
  group('swamp:dunegate', SW.duneGate, atGate('swamp-dunes', 'swamp'), 'swamp');
  const oracle = us.find((u) => u.id === 'elite:swamp:0');
  if (oracle) {
    oracle.pack = 'swamp:oracle';
    const o = posOf(oracle.spot);
    one('swamp:elite_guard', SW.eliteGuard, { x: o.x + 1.5, z: o.z }, 'swamp', 'swamp:oracle');
  }
  road(2, SW.roadPairs.length, 'swamp', 5).forEach((c, i) => group(`swamp:road:${i}`, SW.roadPairs[i], c, 'swamp', true));
  SW.pools.forEach((p, i) => group(`swamp:pool:${i}`, p, rnd('swamp'), 'swamp', true));
  SW.shore.forEach((p, i) => group(`swamp:shore:${i}`, p, rnd('swamp'), 'swamp', true));
  SW.bandits.forEach((d, i) => one(`swamp:bandit:${i}`, d, rnd('swamp'), 'swamp', undefined, true));
  [...SW.trees, ...SW.thornTrees].forEach((d, i) => one(`swamp:tree:${i}`, d, rnd('swamp'), 'swamp', undefined, true));
  SW.assassins.forEach((d, i) => one(`swamp:assassin:${i}`, d, rnd('swamp'), 'swamp', undefined, true));
  group('swamp:mark:pack', SW.marks.pack.def, pin(SW.marks.pack.x, SW.marks.pack.z), 'swamp');
  SW.marks.singles.forEach((m, i) => one(`swamp:mark:${i}`, m.def, pin(m.x, m.z), 'swamp'));

  // Dunes (world.dunesMobs)
  const D = DUNES_SPAWNERS;
  D.battles.forEach((p, i) => group(`dunes:battle:${i}`, p, rnd('dunes'), 'dunes', true));
  group('dunes:ambush:0', D.ambush, rnd('dunes'), 'dunes', true);
  road(3, D.roadPairs.length, 'dunes', 5).forEach((c, i) => group(`dunes:road:${i}`, D.roadPairs[i], c, 'dunes', true));
  D.archerPairs.forEach((p, i) => group(`dunes:archers:${i}`, p, rnd('dunes'), 'dunes', true));
  D.escorts.forEach((p, i) => group(`dunes:escort:${i}`, p, rnd('dunes'), 'dunes', true));
  D.dragons.forEach((d, i) => one(`dunes:dragon:${i}`, d, rnd('dunes'), 'dunes', undefined, true));
  D.lionPairs.forEach((p, i) => group(`dunes:lions:${i}`, p, rnd('dunes'), 'dunes', true));
  [...D.lions, ...D.edgeLions].forEach((d, i) => one(`dunes:lion:${i}`, d, rnd('dunes'), 'dunes', undefined, true));
  D.boars.forEach((p, i) => group(`dunes:boars:${i}`, p, rnd('dunes'), 'dunes', true));
}
/** Every spawner World builds in the forest and the cemetery (world.buildForest / campToFort / glovesGuards / land minis). */
function buildUnits(): Unit[] {
  const us: Unit[] = [];
  /** `depth`: true = spread i / (n − 1) like World.mobsAlong, a number = World's fixed depth for the list. */
  const add = (kind: 'mob' | 'prop', list: SpawnerDef[], spots: Spot[], zone: ZoneId, tag: string, depth: boolean | number = true) =>
    list.forEach((d, i) => us.push({
      id: `${tag}:${i}`, kind, def: d.id, zone, spot: spots[i],
      depth: typeof depth === 'number' ? depth : depth && list.length > 1 ? i / (list.length - 1) : 0,
      charges: d.charges ?? [kind === 'mob' ? MOBS[d.id].respawn : BREAKABLES[d.id].respawn], n: 0, respawnAt: 0,
    }));
  // World's order: the guards first (other packs keep away from them), then the trail spawners
  const packs: [number, number][] = [...BOSS_GUARDS, ...GATE_GUARDS].map((p) => [p.x, p.z]);
  const forest = SPAWNERS.forest ?? [];
  add('mob', forest, placeAlong(forestRanges, forest, 'forest', packs, FOREST_PINS), 'forest', 'forest');
  add('mob', MID_SPAWNERS, MID_UV.map((uv) => { const p = campToFortAt(uv); return spotAt(p.x, p.z); }), 'forest', 'mid', 0.5);
  const gloves: SpawnerDef[] = [];
  const gloveSpots: Spot[] = [];
  for (let i = 0; i < GLOVES_BANDITS.length; i++) {
    gloves.push(...packUnits(GLOVES_BANDITS[i]));
    for (const q of ringSpots(GLOVES_PACKS[i][0], GLOVES_PACKS[i][1], GLOVES_BANDITS[i].slots.length, GLOVES_SPREAD, Math.PI / 2)) gloveSpots.push(spotAt(q.x, q.z));
  }
  add('mob', gloves, gloveSpots, 'forest', 'gloves', 0.3);
  // static trees: World picks trees 4–12 m off the trail, well apart — spread along it here
  add('mob', FOREST_TREES, along(forestRanges, FOREST_TREES.length).map((p) => ({ s: p.s, off: 9, side: -(p.side ?? 1) })), 'forest', 'tree', false);
  // guards: a pair at their spots, the third one alone somewhere empty in the forest (World.buildForest loneGuards)
  const lr = layoutRng(7);
  const lone = () => {
    const p = emptyIn('forest', lr, packs, (x, z) => !inCamp(x, z, 4) && Math.hypot(x - FORT.x, z - FORT.z) > FORT.r + 4);
    return spotAt(p.x, p.z);
  };
  add('mob', packUnits(GUARD_PACKS.boss_guard), [...BOSS_GUARDS.slice(0, 2).map((p) => spotAt(p.x, p.z)), lone()], 'forest', 'bguard', false);
  add('mob', packUnits(GUARD_PACKS.gate_guard), [...GATE_GUARDS.slice(0, 2).map((p) => spotAt(p.x, p.z)), lone()], 'forest', 'gguard', false);
  // the village and chapel specials stand in their areas (World.buildCemetery: CEMETERY_AREAS pins)
  const cemPins: Record<string, [number, number]> = {};
  for (const a of CEMETERY_AREAS) {
    const r = (a.deg * Math.PI) / 180;
    if (a.pin) cemPins[a.pin] = [ISLAND.cx + Math.sin(r) * a.d, ISLAND.cz + Math.cos(r) * a.d];
  }
  add('mob', SPAWNERS.cemetery ?? [], placeAlong(cemRange, SPAWNERS.cemetery ?? [], 'cemetery', packs, cemPins), 'cemetery', 'cemetery');
  add('mob', packUnits(CEMETERY_BOARS.pack), ringSpots(...CEMETERY_BOARS.at, 2, 1.8).map((p) => spotAt(p.x, p.z)), 'cemetery', 'cboars', 0.5);
  // the fort's real tower (world.buildFort): a breakable turret south of the boss (its arrows at the hero are left out)
  const tower = OPT.faction === 'human' ? 'fort_tower_orc' : 'fort_tower_human';
  add('prop', [{ unit: 'prop', id: tower }], [spotAt(FORT.x - 1, FORT.z + 6)], 'forest', 'fort_tower', false);
  const cemMinis = LAND_BOSSES.find((l) => l.zone === 'cemetery')?.minis ?? [];
  add('mob', cemMinis.map(() => MINI_SPAWNER_OF.cemetery ?? MINI_SPAWNER), cemMinis.map(([x, z]) => spotAt(x, z)), 'cemetery', 'mini', false);
  add('prop', PROP_SPAWNERS.camp, PROP_SPAWNERS.camp.map(() => ({ s: sCamp, off: 20 })), 'forest', 'camp', false);
  add('prop', PROP_SPAWNERS.forest, along(forestRanges, PROP_SPAWNERS.forest.length).map((p) => ({ s: p.s + 3, off: 6 })), 'forest', 'pf', false);
  add('prop', PROP_SPAWNERS.cemetery, along(graveRange, PROP_SPAWNERS.cemetery.length).map((p) => ({ s: p.s, off: 9 })), 'cemetery', 'pc', false);
  add('prop', PROP_SPAWNERS.cemeteryField, PROP_SPAWNERS.cemeteryField.map(() => ({ s: sArena - 20, off: 35 })), 'cemetery', 'pcf', false);
  buildLands(us, packs);
  for (const d of BOSSES) {
    const zone = d.boss!.zone;
    const land = LAND_BOSSES.find((l) => l.zone === zone)?.boss;
    const spot = zone === 'forest' ? { s: sFort, off: 0 } : zone === 'cemetery' || !land ? { s: sArena, off: 0 } : landSpot(land[0], land[1], zone);
    us.push({ id: d.id, kind: 'mob', def: d.id, zone, spot, depth: 0, charges: [d.respawn], n: 0, respawnAt: 0 });
  }
  // social packs of the forest and the cemetery (World.addPack / joinPack): the guard pairs, the boars, the cemetery trios
  const join = (pack: string, ids: string[]) => { for (const u of us) if (ids.includes(u.id)) u.pack = pack; };
  join('forest:boss_guard', ['bguard:0', 'bguard:1']);
  join('forest:gate_guard', ['gguard:0', 'gguard:1']);
  join('cemetery:boars', us.filter((u) => u.id.startsWith('cboars:')).map((u) => u.id));
  CEMETERY_PACKS.forEach((ids, k) => join(`cemetery:pack:${k}`, ids.map((i) => `cemetery:${i}`)));
  // Game.zoneDef: in a location with an `alt` profile every other mob (in spawn order) has it
  const altN: Partial<Record<ZoneId, number>> = {};
  for (const u of us) {
    if (u.kind !== 'mob' || !ZONE_FOES[u.zone]?.alt || MOBS[u.def].static || MOBS[u.def].boss) continue;
    u.alt = (altN[u.zone] = (altN[u.zone] ?? 0) + 1) % 2 === 0;
  }
  return us;
}

// ---------- hero ----------
type Kit = HeroBuild['weapons'];
/**
 * The party: stat points are shared, each class keeps its own weapons (per location: the bot swaps to what the
 * location is weak to) and its own armour. `weapons` / `equip` / `cls`: the member on the field.
 */
interface Hero extends HeroBuild {
  cls: HeroClass; hp: number; bag: Item[]; pulls: number; pity: number; spot: Spot;
  /** Items from the gacha (a copy merged into an owned item marks it too). */
  gacha: Set<Item>;
  classes: HeroClass[]; kits: Record<HeroClass, Record<ZoneId, Kit>>; gear: Record<HeroClass, HeroBuild['equip']>;
}
const stats = (h: Hero) => heroStats(h);
/** Hero `h` with class `c` on the field, in its kit for `zone` (a copy: the bot's estimates). */
const as = (h: Hero, c: HeroClass, zone: ZoneId): Hero => ({ ...h, cls: c, weapons: h.kits[c][zone], equip: h.gear[c] });
const wear = (h: Hero, c: HeroClass, zone: ZoneId) => { h.cls = c; h.weapons = h.kits[c][zone]; h.equip = h.gear[c]; };
/** Every location's main boss (the bot walks on through the passages each one opens). */
export const BOSSES = Object.values(MOBS).filter((d) => d.boss);
// ---------- fight: ticks of 0.05 s ----------
const DT = 0.05;
interface FightOut { win: boolean; dur: number; swings: number; dealt: number; taken: number; hpEnd: number; slams: number; slamHits: number }
interface Foe { def: MobDef; hp: number; dmg: number }
/** Game.zoneDef: a mob gets the resists of the location it stands in (a boss its home's boss profile). */
function zoneDef(def: MobDef, zone: ZoneId, alt = false): MobDef {
  if (def.static) return def;
  const z = def.boss?.zone ?? zone;
  return { ...def, resist: zoneResist(z, def.boss ? 'boss' : alt && ZONE_FOES[z]?.alt ? 'alt' : 'mob') };
}
/** Second boss a kit spawns into the fight (src/bosses BOSS_PARTNERS, rebuilt here without three): the Spring sister. */
function partnersOf(u: Unit): Foe[] {
  if (u.def !== 'elf_priestess') return [];
  const { boss: _b, ...elf } = MOBS.elf_priestess;
  const tier = ZONE_TIER[u.zone] ?? 1;
  const def: MobDef = { ...elf, id: 'elf_priestess_spring', name: 'Весенняя сестра', resist: zoneResist(u.zone, 'boss') };
  return [{ def, hp: Math.round(def.hp * tier), dmg: def.dmg * tier }];
}
/** The unit's numbers as Game.addMob gives them: zone resists, depth (plain mobs only), ZONE_TIER on HP and damage. */
function foeOf(u: Unit): Foe {
  const d = zoneDef(MOBS[u.def], u.zone, u.alt);
  const mul = d.boss || d.rank ? { hp: 1, dmg: 1 } : depthMul(u.zone, u.depth);
  const tier = ZONE_TIER[u.zone] ?? 1;
  const zs = zoneScaleOf(d, u.zone);
  return { def: d, hp: Math.round(d.hp * mul.hp * tier * zs.hp), dmg: d.dmg * mul.dmg * tier * zs.dmg };
}

/**
 * One fight against a foe or a social pack (all of them strike, the hero downs them one by one: plain mobs first,
 * the weakest first, a boss last). `mean`: no dice (rolls at their expected value, slams hit for their expected share)
 * — the bot's quick estimate. Weapon mechanics hit the current target only: crowd effects are left out.
 */
function fight(h: Hero, foes: Foe | Foe[], mean = false, limit = 400): FightOut {
  const st = stats(h);
  const list = (Array.isArray(foes) ? [...foes] : [foes]).sort((a, b) => (a.def.boss ? 1 : 0) - (b.def.boss ? 1 : 0) || a.hp - b.hp);
  const bossFoe = list.find((f) => f.def.boss);
  const boss = bossFoe?.def.boss;
  const roll = () => (mean ? 1 : 0.9 + rand() * 0.2);
  const chance = (p: number) => (mean ? false : rand() < p);
  let hp = h.hp;
  const mhp = list.map((f) => f.hp);
  const total = mhp.reduce((a, b) => a + b, 0);
  const stun = list.map(() => 0);
  const matk = list.map((f) => { const period = 1 / f.def.aps; return mobImpact(ATTACK_HIT[f.def.creature ? `${f.def.model.human[0]}:attack` : f.def.anim] ?? 0.6, period); });
  /** The hero's target: the first one still standing. */
  let cur = 0;
  let lastCounter = -99;
  let special = boss ? boss.cd : Infinity;
  let phase2 = false;
  let busy = 0; // hero dodging: no swings
  let taken = 0, slams = 0, slamHits = 0, swings = 0;
  const pending: [number, number][] = []; // [time, damage] of telegraphed blasts
  // hands
  const hands = h.weapons.map((it, i) => ({ i, it, cd: 0.25 + i * 0.1 }));
  // class extras (game.ts staffHit / iceHit / throwGust / updatePet), on the target: the hunter's pet bites what he
  // shoots; the fire staff burns (+vulnerability), the ice staff freezes every Nth hit, the wind staff throws an orb
  const petItem = h.weapons[1] && WEAPONS[h.weapons[1].def].pet ? h.weapons[1] : null;
  const pet = petItem ? PETS[WEAPONS[petItem.def].pet!] : null;
  let petCd = 0.6;
  let pounceCd = 0; // the lion opens with a leap (PetDef.pounce), then every pounce.cd s
  const B = STAVES.fire.burn;
  let burn = 0, burnTick = 0, burnDps = 0, iceN = 0, windN = 0;
  const gusts: number[] = []; // landing times of wind orbs
  const vuln = () => (burn > 0 ? 1 + B.vuln : 1);
  // crits and dodges: dice, or their expected value with `mean`
  const heroCrit = () => (mean ? critAvg(st.critPts, st.critDmgPts) : chance(st.crit) ? st.critMul : 1);
  const foeHits = (d: MobDef) => (mean ? 1 - dodgeChance(d.dodge) : chance(dodgeChance(d.dodge)) ? 0 : 1);
  /** The target is down: the next one (a burn dies with its target). */
  const next = () => { while (cur < list.length && mhp[cur] <= 0) { cur++; burn = 0; } };
  /** Shield in the class slot: a blow taken (slams too) from foe `k` may be answered by the weapon, at the target. */
  const answer = (k: number) => {
    const g = h.weapons[1] && WEAPONS[h.weapons[1].def].guard;
    const weapon = h.weapons[0];
    const rank = mobRank(list[k].def);
    if (cur < list.length && g && weapon && t - lastCounter >= g.cd && (mean ? true : chance(g.counter[rank]))) {
      lastCounter = t;
      if (mean) hit(weapon, g.counter[rank]);
      else strike(weapon);
    }
  };
  /** A blow of foe `k`. */
  const hurt = (raw: number, k: number) => {
    const d = list[k].def;
    // the hero's dodge works on any blow, boss specials too
    if (mean) raw *= (1 - st.dodge) * critAvg(d.crit, d.critDmg);
    else if (chance(st.dodge)) return;
    else if (chance(critChance(d.crit))) raw *= critMul(d.critDmg);
    const dmg = Math.max(1, raw * armorMul(st.defense) * guardMul(h.weapons) * roll());
    taken += dmg;
    hp -= dmg;
    // spiked shield: a share of the blow goes back
    const reflect = h.weapons[1] && WEAPONS[h.weapons[1].def].guard?.reflect;
    if (reflect) mhp[k] -= dmg * reflect;
  };
  const hit = (it: Item, mult: number) => {
    if (cur >= list.length) return 0;
    const d = list[cur].def;
    const w = WEAPONS[it.def];
    const r = RESIST_MULT[d.resist[w.type] ?? 'normal'];
    const dmg = weaponDamage(it, st.power, st.powerMul) * heroCrit() * foeHits(d) * r * mult * roll() * vuln();
    mhp[cur] -= dmg;
    hp = Math.min(st.maxHp, hp + dmg * st.leech); // ring of blood
    // thorn trees: the damage dealt comes straight back (no armour, dodge or shield)
    if (d.thorns) { hp -= dmg * d.thorns; taken += dmg * d.thorns; }
    return dmg;
  };
  /** One swing of a hand (counters too). */
  const strike = (it: Item) => {
    if (cur >= list.length) return;
    const d = list[cur].def;
    const rank = mobRank(d);
    const w = WEAPONS[it.def];
    const dmg = hit(it, CONFIG.attackMul(w)); // a gun's volley: its pellets that hit (PELLET_HIT)
    if (w.staff === 'fire' && dmg > 0) { if (burn <= 0) burnTick = B.tick; burn = B.time; burnDps = dmg * B.dps; }
    if (w.staff === 'ice' && dmg > 0) {
      const f = STAVES.ice.freeze;
      iceN = (iceN + 1) % f.every;
      if (iceN === 0 && rank !== 'mini' && rank !== 'boss') stun[cur] = Math.max(stun[cur], f.time);
    }
    if (w.staff === 'wind') {
      const o = STAVES.wind.orb;
      windN = (windN + 1) % o.every;
      if (windN === 0 && !d.static) gusts.push(t + o.flight); // orbs skip passive units
    }
    if (!d.boss && w.stun && (mean ? false : chance(w.stun))) stun[cur] = Math.max(stun[cur], 0.9);
  };
  let t = 0;
  for (; t < limit && hp > 0 && cur < list.length; t += DT) {
    // hero hands
    if (busy > 0) busy -= DT;
    for (const hd of hands) {
      if (!hd.it) continue;
      const w = WEAPONS[hd.it.def];
      if (w.guard || w.orb || w.pet) continue; // shields, mage orbs and pets never swing
      hd.cd -= DT;
      if (hd.cd > 0 || busy > 0) continue;
      const per = 1 / (w.aps * st.haste);
      // uptime: the hero spends part of the fight repositioning — swings come later
      hd.cd = per / OPT.uptime;
      swings++;
      strike(hd.it);
      next();
    }
    // the pet: always on the target (slams do not stop it), its item's own damage (no hero power), no crits or dodges
    // (the bear's cleave is not modelled)
    if (pet && petItem && cur < list.length) {
      petCd -= DT;
      pounceCd -= DT;
      if (petCd <= 0) {
        petCd += 1 / (pet.aps * st.haste);
        const leap = pet.pounce && pounceCd <= 0 ? pet.pounce.mult : 1;
        if (leap > 1) pounceCd = pet.pounce!.cd;
        const dmg = weaponDamage(petItem) * leap * RESIST_MULT[list[cur].def.resist[WEAPONS[petItem.def].type] ?? 'normal'] * roll() * vuln();
        mhp[cur] -= dmg;
        hp = Math.min(st.maxHp, hp + dmg * st.leech);
      }
    }
    if (burn > 0 && cur < list.length) {
      burn -= DT;
      burnTick -= DT;
      if (burnTick <= 0) { burnTick += B.tick; mhp[cur] -= burnDps * B.tick * (1 + B.vuln); }
    }
    for (let i = gusts.length - 1; i >= 0; i--) {
      if (gusts[i] > t) continue;
      gusts.splice(i, 1);
      hit(h.weapons[0]!, STAVES.wind.orb.dmg);
    }
    next();
    if (cur >= list.length) break;
    // the foes still standing (static units — trees — never strike back)
    for (let k = cur; k < list.length; k++) {
      const f = list[k];
      if (mhp[k] <= 0) continue;
      if (stun[k] > 0) { stun[k] -= DT; continue; }
      if (f.def.aps <= 0) continue;
      matk[k] -= DT;
      if (matk[k] <= 0) {
        matk[k] += 1 / f.def.aps;
        hurt(f.dmg * (phase2 && f === bossFoe ? boss!.phase2Dmg : 1), k);
        answer(k);
      }
    }
    if (boss && bossFoe) {
      const b = list.indexOf(bossFoe);
      if (!phase2 && mhp[b] < bossFoe.hp * boss.phase2At) phase2 = true;
      special -= DT;
      if (special <= 0 && mhp[b] > 0) {
        special = phase2 ? boss.cdPhase2 : boss.cd;
        const chase = phase2 && rand() < boss.chance;
        const n = chase ? boss.chaseCount : 1;
        const mul = chase ? boss.chaseMul : boss.slamMul;
        for (let i = 0; i < n; i++) pending.push([t + (chase ? boss.chaseDelay + i * boss.chaseGap : boss.slamDelay), mul]);
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i][0] > t) continue;
        const mul = pending[i][1];
        pending.splice(i, 1);
        slams++;
        if (mean) { hurt(bossFoe.dmg * mul * (1 - OPT.dodge), b); busy = Math.max(busy, 0.8 * OPT.dodge); answer(b); }
        else if (rand() < OPT.dodge) busy = Math.max(busy, 0.8); // stepped out of the red circle
        else { slamHits++; hurt(bossFoe.dmg * mul, b); answer(b); }
      }
    }
    next();
    hp = Math.min(st.maxHp, hp + st.regen * DT);
  }
  const left = mhp.reduce((a, m) => a + Math.max(0, m), 0);
  return { win: cur >= list.length && hp > 0, dur: t, swings, dealt: total - left, taken, hpEnd: Math.max(0, hp), slams, slamHits };
}

// ---------- loot and gear ----------
const VALUE: Record<StatId, number> = { power: 1, hp: 0.35, regen: 1.5, speed: 0.2, defense: 1, dodge: 2, crit: 1.5, critDmg: 1, haste: 1.5, leech: 1.5 };
const rewardOf = (u: Unit): OrbReward => {
  if (u.kind === 'prop') return BREAKABLES[u.def].reward as OrbReward;
  const d = MOBS[u.def];
  // as Mob does: every orb × the depth (plain mobs) × ZONE_SCALE reward, rounded
  const k = (d.boss || d.rank ? 1 : depthMul(u.zone, u.depth).reward) * zoneScaleOf(d, u.zone).reward;
  const out: Partial<Record<OrbKind, number>> = {};
  for (const [s, n] of Object.entries(d.reward) as [OrbKind, number][]) if (n) out[s] = Math.round(n * k);
  return out as OrbReward;
};
function giveStats(h: Hero, r: Partial<Record<OrbKind, number>>, orbs: boolean) {
  for (const [k, n] of Object.entries(r) as [OrbKind, number][]) {
    const v = orbs ? n * ORBS[k].value : n;
    addStat(h, orbs ? 'enemy' : 'mini', k, v);
    if (k === 'hp') h.hp += v;
  }
}
/** Adds the item (a copy raises the one owned); returns the item kept. */
function lootItem(h: Hero, it: Item) {
  const own = [...h.weapons, ...Object.values(h.equip), ...h.bag].find((x) => x && sameItem(x, it));
  if (own) own.lvl += it.lvl;
  else h.bag.push(it);
  if (!OPT.keep) regear(h);
  return own ?? it;
}
const RANKS: MobRank[] = ['normal', 'elite', 'mini', 'boss'];
/** The top rank of a fight's units; all static (trees, snags): 'static'. */
// a tree chopped with mobs that joined is still a chop (its length is the tree's HP): not a fight of their rank
const topRank = (g: Unit[]): MobRank | 'static' =>
  g.some((u) => MOBS[u.def].static) ? 'static' : RANKS[Math.max(...g.map((u) => RANKS.indexOf(mobRank(MOBS[u.def]))))];
const dpsCache = new Map<string, number>();
/**
 * Each class: the best weapon + class item it may use (party.ts classSlot) for each location, by DPS against the
 * location's resists; armour it may wear (items.ts itemClass), the best piece per slot by defense + bonus.
 */
function regear(h: Hero, open = openZones()) {
  const all = [...h.classes.flatMap((c) => ZONE_IDS.flatMap((z) => h.kits[c][z])), ...h.bag]
    .filter((x, i, a): x is Item => !!x && x.kind === 'weapon' && a.indexOf(x) === i);
  h.bag = h.bag.filter((x) => x.kind !== 'weapon');
  for (const c of h.classes) {
    const mains = all.filter((x) => classSlot(c, x.def) === 0);
    const offs = all.filter((x) => classSlot(c, x.def) === 1);
    // closed locations keep their kit until they open (regear runs again then)
    for (const zone of ZONE_IDS) {
      if (!open.has(zone)) continue;
      let bestDps = -1;
      // locations with the same resist profile share the estimate
      const prof = JSON.stringify(zoneResist(zone));
      for (const a of mains) for (const b of [null, ...offs]) {
        const key = `${c}|${prof}|${wname(a)}|${wname(b)}`;
        let dps = dpsCache.get(key);
        if (dps === undefined) dpsCache.set(key, (dps = dummyDps(h, c, [a, b], zone)));
        if (dps > bestDps) { bestDps = dps; h.kits[c][zone] = [a, b]; }
      }
    }
  }
  // weapons no class picked go back to the bag (an unused class's)
  const used = new Set(h.classes.flatMap((c) => ZONE_IDS.flatMap((z) => h.kits[c][z])));
  h.bag.push(...all.filter((x) => !used.has(x)));
  // armour: a new piece goes to the first class it is better for; the piece it replaces waits in the bag
  const score = (it: Item) => { const s = armorStats(it); return s.defense + (s.bonus ? s.bonus.value * VALUE[s.bonus.stat] * 2 : 0); };
  for (const it of [...h.bag]) {
    if (it.kind !== 'armor') continue;
    const slot = ARMOR[it.def].slot;
    const owner = itemClass(it);
    for (const c of h.classes) {
      if (owner && owner !== c) continue;
      const cur = h.gear[c][slot];
      if (cur && score(it) <= score(cur)) continue;
      h.bag.splice(h.bag.indexOf(it), 1);
      if (cur) h.bag.push(cur);
      h.gear[c][slot] = it;
      break;
    }
  }
  wear(h, h.cls, 'forest');
}
/** A training dummy: an elite bandit that never strikes back, no resists. */
const DUMMY: MobDef = { ...MOBS.bandit_thug, resist: {}, dmg: 0, rank: 'elite' };
/** Damage per second of class `c` with a loadout on a big dummy with the zone's resists (mean rolls). */
function dummyDps(h: Hero, c: HeroClass, weapons: Kit, zone: ZoneId) {
  const def: MobDef = { ...MOBS.bandit_thug, resist: zoneResist(zone), dmg: 0, rank: 'elite' };
  const test: Hero = { ...h, cls: c, weapons, equip: h.gear[c], hp: 1e6, src: { ...h.src, debug: { hp: 1e6 } } };
  return fight(test, { def, hp: 1e7, dmg: 0 }, true, 20).dealt / 20;
}

// ---------- the bot ----------
/** Gacha pulls a kill gives on average (config tokenChance: GACHA.token, none in GACHA.noTokens locations). */
const tokenChance = (u: Unit) => (u.kind === 'mob' ? zoneTokenChance(mobRank(MOBS[u.def]), u.zone) : 0);

export interface Snap {
  t: number; zone: string; power: number; maxHp: number; regen: number; defense: number; weapons: string; kills: number; deaths: number; pulls: number;
  /** Chance to beat each boss now (best class), share of the forest cycle spent. */
  win: Record<string, number>; cycle: number;
}
export interface FightRec {
  def: string; depth: number; t: number; first: boolean; dur: number; swings: number; taken: number; maxHp: number; win: boolean; cls: HeroClass;
  /** Where, and the top rank in the fight ('static': a tree or a snag was chopped, whoever joined). */
  zone: ZoneId; rank: MobRank | 'static';
}
/** What the bot did, for the map replay: a fight, a break, or a rest in the camp. */
export interface BotEvent {
  t: number; dur: number; unit: string; def: string; x: number; z: number; res: 'kill' | 'death' | 'break' | 'rest'; cls: HeroClass;
  /** Orbs picked up (counts, × ORBS value = points), the mini-boss's direct stat points, the item dropped, a gacha pull. */
  gain?: Partial<Record<OrbKind, number>>; bonus?: Partial<Record<OrbKind, number>>; item?: string; pull?: boolean;
  /** A pack fight: the other members' unit ids (`def` is then the pack key, ids joined by '+'). */
  pack?: string[];
  /** HP lost, share of max. */
  taken?: number;
}
export interface RunOut {
  snaps: Snap[]; bossAt: Record<string, number>; bossDur: Record<string, number>; fights: FightRec[]; pulls: number[]; deaths: number;
  /** At each boss's first kill: share of the hero's might from gacha items (0…1). */
  gachaShare: Record<string, number>;
  /** When each location opened (its passage unlocked by a boss), s; the forest is open from the start. */
  openAt: Partial<Record<ZoneId, number>>;
  /** Seconds of fighting by class on the field. */
  classTime: Partial<Record<HeroClass, number>>;
  /**
   * The forest cycle: every spawner with a capped charge list (FOREST_CHARGES: …, 12 h) killed through all its charges.
   * `total` charges, `done` spent by the end, `doneAt` when the last one went, `atBoss` share spent at each boss's first kill.
   */
  cycle: { total: number; done: number; doneAt?: number; atBoss: Record<string, number> };
  /** The hero's way: [time s, x, z] points (he stands still between two equal ones). */
  path: [number, number, number][];
  events: BotEvent[];
}

export const wname = (it: Item | null) => (it ? `${it.def}${'⁰¹²³⁴⁵'[it.rarity]}${it.lvl > 1 ? `×${it.lvl}` : ''}` : '—');

/**
 * A run's state at a boss's first kill (after its loot and respawns): the bot goes on from there with `RunCtl.from`.
 * `data` is private to the sim (a structuredClone of the hero, the units, the output so far, the rng).
 */
export interface Checkpoint { boss: string; t: number; data: unknown }
interface CpData { t: number; kills: number; nextSnap: number; rs: number; gates: string[]; h: Hero; units: Unit[]; out: RunOut; spent: number[] }
export interface RunCtl {
  /** Go on from this state (cloned: one checkpoint feeds many runs). */
  from?: Checkpoint;
  /** Save a checkpoint at the first kill of each of these bosses. */
  keep?: string[];
  /** End the run right after this boss's first kill. */
  stopAt?: string;
  /** End the run at this time, s, with a checkpoint named 'time'. */
  stopTime?: number;
}

function run(seed: number, ctl: RunCtl = {}): { out: RunOut; cps: Record<string, Checkpoint> } {
  const cps: Record<string, Checkpoint> = {};
  let h!: Hero, units!: Unit[], out!: RunOut;
  let t = 0;
  let kills = 0;
  let nextSnap = 0;
  const spent = new Map<Unit, number>();
  const capped = (u: Unit) => u.zone === 'forest' && !u.temp && u.charges.length > 1 && Math.max(...u.charges) >= 3600;
  dpsCache.clear();
  openGates = new Set();
  if (ctl.from) {
    const c = structuredClone(ctl.from.data) as CpData;
    ({ h, units, out, t, kills, nextSnap, rs } = c);
    openGates = new Set(c.gates);
    c.spent.forEach((n, i) => { if (n) spent.set(units[i], n); });
  } else {
  rs = seed * 7919;
  const f = FACTIONS[OPT.faction];
  const classes = OPT.cls === 'party' ? CLASS_IDS : [OPT.cls];
  const bag: Item[] = [];
  // start kits as save.ts classKit gives them (the mage's extra staves and orbs come with his first switch: here at once)
  const startKit = (c: HeroClass): Kit => {
    const k = CLASSES[kitOf(c)].kit;
    for (const def of k?.bag ?? []) bag.push(makeItem('weapon', def, 0, 1));
    const kit: Kit = k ? [makeItem('weapon', k.hand, 0, 1), k.left ? makeItem('weapon', k.left, 0, 1) : null] : [makeItem('weapon', f.startWeapon, 0, 1), null];
    if (OPT.weapon && weaponClass(OPT.weapon) === c) kit[0] = makeItem('weapon', OPT.weapon, 0, 1);
    if (OPT.off && weaponClass(OPT.off) === c) kit[1] = makeItem('weapon', OPT.off, 0, 1);
    return kit;
  };
  const kits = {} as Hero['kits'];
  const gear = {} as Hero['gear'];
  for (const c of classes) { const k = startKit(c); kits[c] = Object.fromEntries(ZONE_IDS.map((z) => [z, k])) as Record<ZoneId, Kit>; gear[c] = {}; }
  h = {
    faction: OPT.faction, src: {}, pct: {}, equip: gear[classes[0]], weapons: kits[classes[0]].forest, cls: classes[0], classes, kits, gear,
    hp: 0, bag, pulls: 0, pity: 0, gacha: new Set(), spot: { s: sCamp, off: 0 },
  };
  h.hp = stats(h).maxHp;
  units = buildUnits();
  out = {
    snaps: [], bossAt: {}, bossDur: {}, gachaShare: {}, openAt: { forest: 0 }, fights: [], pulls: [], deaths: 0, classTime: {}, path: [], events: [],
    cycle: { total: units.filter(capped).reduce((a, u) => a + u.charges.length, 0), done: 0, atBoss: {} },
  };
  }
  openGate();
  let open = openZones();
  const camp: Spot = { s: sCamp, off: 0 };
  const campHome = camp;
  // estimates are kept until the hero grows by 3% or changes gear
  let ver = 0, verPower = 0, verHp = 0, verGear = '';
  type Est = FightOut & { rate?: number; cls: HeroClass };
  const est = new Map<string, Est>();
  const gearKey = () => h.classes.map((c) => [...ZONE_IDS.flatMap((z) => h.kits[c][z]), ...Object.values(h.gear[c])].map(wname).join()).join('|');
  const checkVer = () => {
    const st = stats(h);
    const g = gearKey();
    if (st.power > verPower * 1.03 || st.maxHp > verHp * 1.03 || g !== verGear) { ver++; verPower = st.power; verHp = st.maxHp; verGear = g; est.clear(); }
  };
  /** Class `c` at full HP in its kit for `zone`. */
  const full = (c: HeroClass, zone: ZoneId): Hero => { const x = as(h, c, zone); x.hp = stats(x).maxHp; return x; };
  // social packs: pulling one pulls the rest of it still standing
  const packOf = new Map<string, Unit[]>();
  for (const u of units) if (u.pack) packOf.set(u.pack, [...(packOf.get(u.pack) ?? []), u]);
  /** What a pull of `u` fights: its pack (those standing), else it alone. */
  const groupOf = (u: Unit) => (u.pack ? packOf.get(u.pack)!.filter((x) => x.respawnAt <= t) : [u]);
  const foesOf = (g: Unit[]) => [...g.map(foeOf), ...g.flatMap(partnersOf)];
  // aggro: hostile mobs by grid cell (their spots never move), who stands by each unit's spot (cached)
  const CELL = 12;
  const rushes = (x: Unit) => x.kind === 'mob' && !x.calm && !x.temp && !MOBS[x.def].static && !MOBS[x.def].boss && (MOBS[x.def].behavior?.disposition ?? 'hostile') === 'hostile';
  const posU = new Map<Unit, { x: number; z: number }>();
  const grid = new Map<string, Unit[]>();
  const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  if (OPT.aggro) for (const x of units) if (rushes(x)) {
    const p = posOf(x.spot);
    posU.set(x, p);
    const k = cellKey(p.x, p.z);
    grid.set(k, [...(grid.get(k) ?? []), x]);
  }
  /** Hostile mobs whose aggro (+ `r`) reaches (x, z), into `out`. */
  const rushAt = (x: number, z: number, r: number, out: Set<Unit>) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const u of grid.get(`${cx + i},${cz + j}`) ?? []) {
      const p = posU.get(u)!;
      if (Math.hypot(p.x - x, p.z - z) < MOBS[u.def].aggro + r) out.add(u);
    }
  };
  const nearSpot = new Map<Unit, Unit[]>();
  const nearOf = (u: Unit) => {
    let n = nearSpot.get(u);
    if (!n) { const set = new Set<Unit>(); const p = posOf(u.spot); rushAt(p.x, p.z, AGGRO_AT_SPOT, set); set.delete(u); n = [...set]; nearSpot.set(u, n); }
    return n;
  };
  /** `extra` standing now, with their own social packs, that are not in `g` yet: appended to it. */
  const join = (g: Unit[], extra: Iterable<Unit>) => {
    const has = new Set(g);
    const out = [...g];
    for (const x of extra) {
      if (has.has(x) || x.respawnAt > t || !open.has(x.zone)) continue;
      for (const y of groupOf(x)) if (!has.has(y)) { has.add(y); out.push(y); }
    }
    return out;
  };
  /** A fight with `g` where it stands: those by its spots join (the bot sees them standing there). */
  const atSpot = (g: Unit[]) => (OPT.aggro && !isBoss(g) ? join(g, g.flatMap(nearOf)) : g);
  /** …and those the way from `from` passes (no warning: the bot did not weigh them). */
  const onWay = (g: Unit[], from: Spot) => {
    if (!OPT.aggro || isBoss(g)) return g;
    const set = new Set<Unit>();
    const pts = route(from, g[0].spot);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let k = 0; k <= n; k++) rushAt(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n, AGGRO_ON_WAY, set);
    }
    return join(g, set);
  };
  // the way to a target that pulled others is remembered: the bot weighs them in from then on (a player learns an ambush)
  const ambush = new Map<Unit, Unit[]>();
  const weighed = (u: Unit, g: Unit[]) => { const a = ambush.get(u); return a ? join(atSpot(g), a) : atSpot(g); };
  const isBoss = (g: Unit[]) => g.some((x) => !!MOBS[x.def].boss);
  const bossRate = (c: HeroClass, g: Unit[]) => { let w = 0; for (let i = 0; i < OPT.probes; i++) if (fight(full(c, g[0].zone), foesOf(g)).win) w++; return w / OPT.probes; };
  /** The bot's estimate of the fight, by the best class for it: a boss by win rate, a mob by a safe and quick win. */
  /** Seconds to break a prop: its HP over the hero's plain-swing DPS against its material. */
  const propTime = (b: CONFIG.BreakableDef) => {
    const st = stats(h);
    return b.hp / Math.max(1, heroDps(h.weapons, st.power, st.powerMul, 1, b.resist));
  };
  const estimate = (g: Unit[]) => {
    const u = g[0];
    const key = `${u.zone}|${g.map((x) => `${x.def}|${x.alt ? 1 : 0}|${x.depth.toFixed(2)}`).sort().join(',')}`;
    let e = est.get(key);
    if (!e) {
      const boss = isBoss(g);
      const foe = foesOf(g);
      const foeHp = foe.reduce((a, f) => a + f.hp, 0);
      // a boss: the class with the best mean fight (a win, quicker; else more of the boss's HP taken), then its
      // win rate in dice fights — the dice for that class only, they are what the sim spends its time on
      const edge = (y: Est) => (y.win ? 2 - y.dur / 400 : y.dealt / foeHp);
      const maxHp = new Map<HeroClass, number>();
      const safe = (y: Est) => y.win && y.taken <= 0.7 * maxHp.get(y.cls)!;
      for (const c of h.classes) {
        const fh = full(c, u.zone);
        maxHp.set(c, fh.hp);
        const x: Est = { ...fight(fh, foe, true, boss ? 400 : 150), cls: c };
        const better = !e ? true
          : boss ? edge(x) > edge(e)
            : safe(x) !== safe(e) ? safe(x) : safe(x) ? x.dur < e.dur : x.taken < e.taken;
        if (better) e = x;
      }
      if (boss) e!.rate = bossRate(e!.cls, g);
      est.set(key, e!);
    }
    return e!;
  };
  const snap = () => {
    const st = stats(h);
    const win: Record<string, number> = {};
    for (const b of BOSSES) {
      const u = units.find((x) => x.def === b.id)!;
      // a boss behind a closed passage: no tries (and no time spent on its estimate)
      win[b.id] = open.has(u.zone) ? estimate([u]).rate ?? 0 : 0;
    }
    const kitName = (k: Kit) => k.map(wname).join('+');
    const zone: ZoneId = h.spot.zone ?? (h.spot.s > GATE.s ? 'cemetery' : 'forest');
    out.snaps.push({
      t, zone, power: st.power, maxHp: st.maxHp, regen: st.regen, defense: st.defense,
      // each class's kit for the location the hero is in
      weapons: h.classes.map((c) => kitName(h.kits[c][zone])).join(' · '),
      kills, deaths: out.deaths, pulls: out.pulls.length, win, cycle: out.cycle.done / Math.max(1, out.cycle.total),
    });
  };
  /** Walks to `to`, logging the way for the map: time spread over the route by length. */
  const walk = (to: Spot) => {
    const dur = dist(h.spot, to) / stats(h).speed;
    const pts = route(h.spot, to);
    const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.z - pts[i].z));
    const len = seg.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    pts.forEach((p, i) => { if (i) acc += seg[i - 1]; out.path.push([t + (dur * acc) / len, p.x, p.z]); });
    t += dur;
    h.spot = to;
  };
  const event = (u: Unit, t0: number, res: BotEvent['res'], extra: Partial<BotEvent> = {}) => {
    const p = posOf(u.spot);
    out.events.push({ t: t0, dur: t - t0, unit: u.id, def: u.def, x: p.x, z: p.z, res, cls: h.cls, ...extra });
  };
  const heal = () => {
    const st = stats(h);
    const need = st.maxHp - h.hp;
    if (need <= 0) return;
    const inPlace = need / Math.max(0.1, st.regen);
    const viaCamp = (2 * dist(h.spot, camp)) / st.speed + need / (st.regen + (HERO.campRegen / 100) * st.maxHp);
    if (inPlace <= viaCamp) t += inPlace;
    else { const back = h.spot; walk(camp); t += need / (st.regen + (HERO.campRegen / 100) * st.maxHp); walk(back); }
    h.hp = st.maxHp;
  };
  /** Seconds to win back `need` HP from `at`: regen in place or a trip to the camp, whichever is quicker (as heal does). */
  const healTime = (need: number, at: Spot) => {
    if (need <= 0) return 0;
    const st = stats(h);
    const camp = need / (st.regen + (HERO.campRegen / 100) * st.maxHp);
    return Math.min(need / Math.max(0.1, st.regen), (2 * dist(at, campHome)) / st.speed + camp);
  };
  /**
   * How strong the hero is now: damage per second of the class on the field × effective HP (armour, guard, dodge,
   * ~30 s of regen), a little for running speed (less walking). Its log-change is what a reward is worth.
   */
  const might = (x: Hero) => {
    const st = stats(x);
    const test: Hero = { ...x, hp: 1e6, src: { ...x.src, debug: { ...(x.src.debug ?? {}), hp: (x.src.debug?.hp ?? 0) + 1e6 } } };
    const dps = Math.max(1e-3, fight(test, { def: DUMMY, hp: 1e7, dmg: 0 }, true, 20).dealt / 20);
    const ehp = st.maxHp / (armorMul(st.defense) * guardMul(x.weapons) * (1 - st.dodge)) + st.regen * 30;
    return dps * ehp * st.speed ** 0.3;
  };
  /** Share of the hero's might (the class on the field) that the gacha items give: 1 − might without them / with them. */
  const gachaShare = () => {
    if (!h.gacha.size) return 0;
    const no = (x: Item | null) => (x && h.gacha.has(x) ? null : x);
    const bare: Hero = { ...h, weapons: [no(h.weapons[0]), no(h.weapons[1])], equip: Object.fromEntries(Object.entries(h.equip).filter(([, x]) => !h.gacha.has(x!))) };
    return Math.max(0, 1 - might(bare) / might(h));
  };
  const worthCache = new Map<string, number>();
  let worthVer = -1;
  /** A reward's worth: 100 × log of the hero's might after / before (≈ the % it makes him stronger), for the hero as he is. */
  const worth = (r: Partial<Record<OrbKind, number>> | undefined, orbs: boolean) => {
    if (!r || !Object.keys(r).length) return 0;
    if (worthVer !== ver) { worthCache.clear(); worthVer = ver; }
    const key = `${orbs}|${JSON.stringify(r)}`;
    let w = worthCache.get(key);
    if (w === undefined) {
      const x: Hero = { ...h, hp: h.hp, src: { ...h.src, enemy: { ...h.src.enemy }, mini: { ...h.src.mini } } };
      for (const [k, n] of Object.entries(r) as [OrbKind, number][]) addStat(x, orbs ? 'enemy' : 'mini', k, orbs ? n * ORBS[k].value : n);
      w = 100 * Math.log(might(x) / might(h));
      worthCache.set(key, w);
    }
    return w;
  };
  const value = (u: Unit) => {
    let v = worth(rewardOf(u), true);
    if (u.kind === 'mob') {
      const d = MOBS[u.def];
      v += worth(d.bonus, false);
      if (d.drop) v += 15;
      if (d.boss && !out.bossAt[d.id]) v += 1000;
      v += tokenChance(u) * 20;
    }
    return v;
  };

  /** A boss first killed in this step of the loop: checkpoint / stop after its loot and respawns. */
  let firstKill: string | null = null;
  const afterKill = () => {
    if (!firstKill) return false;
    const b = firstKill;
    firstKill = null;
    if (ctl.keep?.includes(b) || ctl.stopAt === b) {
      cps[b] = { boss: b, t, data: save() };
    }
    return ctl.stopAt === b;
  };
  const save = () => structuredClone({ t, kills, nextSnap, rs, gates: [...openGates], h, units, out, spent: units.map((u) => spent.get(u) ?? 0) } satisfies CpData);
  while (t < OPT.until) {
    if (afterKill()) break;
    if (ctl.stopTime !== undefined && t >= ctl.stopTime) { cps.time = { boss: 'time', t, data: save() }; break; }
    if (t >= nextSnap) { snap(); nextSnap = (Math.floor(t / 60) + 1) * 60; }
    checkVer();
    const st = stats(h);
    // pick the most worthwhile reachable target; a boss only at OPT.bossWin, unless nothing else is left
    const pick = (bossMin: number) => {
      let best: Unit | null = null, bestScore = 0, bestEst: Est | null = null;
      for (const u of units) {
        if (u.respawnAt > t || !open.has(u.zone)) continue;
        let dur = 0, e: Est | null = null;
        const g0 = groupOf(u);
        if (g0[0] !== u) continue; // a pack is weighed once, by its first member standing
        const g = u.kind === 'mob' ? weighed(u, g0) : g0;
        if (u.kind === 'mob') {
          e = estimate(g);
          if (isBoss(g) ? (e.rate ?? 0) < bossMin : !e.win || e.taken > 0.7 * st.maxHp) continue;
          dur = e.dur;
        } else dur = propTime(BREAKABLES[u.def]);
        // the HP a fight costs has to be won back later: a tree or a crate is cheaper than its fight time alone says
        const score = g.reduce((a, x) => a + value(x), 0) / (dist(h.spot, u.spot) / st.speed + dur + healTime(e?.taken ?? 0, u.spot) + 2);
        if (score > bestScore) { bestScore = score; best = u; bestEst = e; }
      }
      return { best, bestEst };
    };
    let { best, bestEst } = pick(OPT.bossWin);
    // nothing to farm for a minute (the forest spent): a player tries the boss anyway, again and again
    const soon = units.some((u) => open.has(u.zone) && !MOBS[u.def]?.boss && u.respawnAt > t && u.respawnAt < t + 60);
    if (!best && !soon && OPT.bossWin <= 1) ({ best, bestEst } = pick(Math.min(OPT.bossWin, 0.15)));
    if (!best) {
      // nothing worth it: rest in the camp until something comes back
      walk(camp);
      h.hp = st.maxHp;
      const next = Math.min(...units.filter((u) => open.has(u.zone)).map((u) => u.respawnAt));
      const t0 = t;
      t = Math.max(t + 5, Math.min(next, t + 30));
      const c = posOf(camp);
      const last = out.events[out.events.length - 1];
      // back-to-back rests merge into one
      if (last?.res === 'rest' && Math.abs(last.t + last.dur - t0) < 1e-6) last.dur = t - last.t;
      else out.events.push({ t: t0, dur: t - t0, unit: 'camp', def: 'camp', x: c.x, z: c.z, res: 'rest', cls: h.cls });
      continue;
    }
    const u = best;
    const seen = u.kind === 'mob' ? weighed(u, groupOf(u)) : [u];
    const group = u.kind === 'mob' ? onWay(seen, h.spot) : seen;
    if (group.length > seen.length) ambush.set(u, [...(ambush.get(u) ?? []), ...group.slice(seen.length)]);
    // a player sends the class that does best and swaps to the weapons the location is weak to
    wear(h, bestEst?.cls ?? h.cls, u.zone);
    h.hp = Math.min(h.hp, stats(h).maxHp);
    const boss = u.kind === 'mob' && isBoss(group);
    if (u.kind === 'mob' && (boss || h.hp - bestEst!.taken < 0.25 * st.maxHp)) heal();
    walk(u.spot);
    const t0 = t;
    if (u.kind === 'prop') {
      const b = BREAKABLES[u.def];
      t += propTime(b);
      giveStats(h, b.reward, true);
      event(u, t0, 'break', { gain: b.reward });
      for (const ev of b.onBreak ?? []) {
        if (ev.type === 'spawnMob' && rand() < ev.chance) {
          units.push({ id: `rise${t}`, kind: 'mob', def: ev.mob, zone: u.zone, spot: u.spot, depth: 0, charges: [Infinity], n: 0, respawnAt: t + 1.3, temp: true });
        }
      }
    } else {
      const r = fight(h, foesOf(group));
      t += r.dur;
      // a pack is one row of the mobs table: its members' ids joined by '+'
      const n = new Map<string, number>();
      for (const x of group) n.set(x.def, (n.get(x.def) ?? 0) + 1);
      const key = [...n].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, k]) => (k > 1 ? `${d}×${k}` : d)).join('+');
      const first = !out.fights.some((f) => f.def === key && f.depth === u.depth);
      const packInfo = group.length > 1 ? { def: key, pack: group.slice(1).map((m) => m.id) } : {};
      out.fights.push({ def: key, depth: u.depth, t, first, dur: r.dur, swings: r.swings, taken: r.taken, maxHp: stats(h).maxHp, win: r.win, cls: h.cls, zone: u.zone, rank: topRank(group) });
      out.classTime[h.cls] = (out.classTime[h.cls] ?? 0) + r.dur;
      if (!r.win) {
        event(u, t0, 'death', { taken: r.taken / st.maxHp, ...packInfo });
        out.deaths++;
        t += 5;
        h.spot = camp;
        const c = posOf(camp);
        out.path.push([t, c.x, c.z]);
        h.hp = stats(h).maxHp;
        continue;
      }
      h.hp = r.hpEnd;
      const gain: Partial<Record<OrbKind, number>> = {}, bonus: Partial<Record<OrbKind, number>> = {};
      const items: string[] = [];
      let pulled = false;
      for (const m of group) {
        kills++;
        const md = MOBS[m.def];
        const mg = rewardOf(m);
        giveStats(h, mg, true);
        for (const [k, n] of Object.entries(mg) as [OrbKind, number][]) gain[k] = (gain[k] ?? 0) + n;
        if (md.bonus) {
          giveStats(h, md.bonus, false);
          for (const [k, n] of Object.entries(md.bonus) as [OrbKind, number][]) bonus[k] = (bonus[k] ?? 0) + n;
        }
        const item = md.drop ? dropItem(md.drop) : null;
        if (item) { lootItem(h, item); items.push(wname(item)); }
        if (rand() < tokenChance(m)) { h.pulls++; out.pulls.push(t); pulled = true; }
      }
      event(u, t0, 'kill', {
        gain, bonus: Object.keys(bonus).length ? bonus : undefined, item: items.join(', ') || undefined, pull: pulled || undefined, taken: r.taken / st.maxHp,
        ...packInfo,
      });
      const d = MOBS[group.find((m) => MOBS[m.def].boss)?.def ?? u.def];
      if (d.boss) {
        if (!out.bossAt[d.id]) {
          out.bossAt[d.id] = t; out.bossDur[d.id] = r.dur; out.cycle.atBoss[d.id] = out.cycle.done / out.cycle.total;
          out.gachaShare[d.id] = gachaShare();
          firstKill = d.id;
        }
        // the first kill opens the boss's passages (boss.unlocks → GATES)
        if (d.boss.unlocks.some((g) => !openGates.has(g))) {
          openGate(...d.boss.unlocks);
          open = openZones();
          for (const z of open) out.openAt[z] ??= t;
          regear(h);
        }
      }
    }
    // the gacha: every pull right away
    while (h.pulls > 0) {
      h.pulls--;
      const p = pull(h.pity, 1);
      h.pity = p.pity;
      h.gacha.add(lootItem(h, p.item));
    }
    // each spawner's next charge
    for (const m of group) {
      if (m.temp) { units.splice(units.indexOf(m), 1); continue; }
      if (capped(m) && (spent.get(m) ?? 0) < m.charges.length) {
        spent.set(m, (spent.get(m) ?? 0) + 1);
        if (++out.cycle.done === out.cycle.total) out.cycle.doneAt = t;
      }
      const i = m.n % m.charges.length;
      m.respawnAt = t + m.charges[i];
      m.n = (i + 1) % m.charges.length;
    }
  }
  afterKill();
  return { out, cps };
}

// ---------- entry points ----------
/** Trail landmarks, m along the path. */
export const TRAIL = { camp: sCamp, fort: sFort, gate: GATE.s, arena: sArena };

/** One spawner on the sim's map (World's layout; `approx`: World picks the spot at random, e.g. the static trees). */
export interface MapUnit {
  id: string; def: string; name: string; kind: 'mob' | 'prop'; zone: ZoneId; x: number; z: number; approx?: boolean;
  rank: string; depth: number; hp: number; dmg: number; charges: number[];
  /** Social pack id: fought together with the other units of it. */
  pack?: string;
  /** Orbs a kill drops (counts; × ORBS value = points), the mini-boss's stat points, the item, the gacha pull chance. */
  reward: Partial<Record<OrbKind, number>>; bonus?: Partial<Record<OrbKind, number>>; drop?: string; token: number;
}
export interface SimMap {
  trail: [number, number][]; marks: { id: string; label: string; x: number; z: number }[]; units: MapUnit[];
  /** Roads of the outer locations (LAND_TRAILS). */
  roads: [number, number][][];
}

/** The map the bot plays on, with the current config (call after applySet to see edits). */
export function simMap(): SimMap {
  const trail: [number, number][] = [];
  for (let s = 0; s <= sArena; s += 2) { const p = pathAt(s); trail.push([p.x, p.z]); }
  const gp = pathAt(GATE.s);
  const marks = [
    { id: 'camp', label: 'Лагерь', x: SPAWN.x, z: SPAWN.z }, { id: 'fort', label: 'Форт', x: FORT.x, z: FORT.z },
    { id: 'gate', label: 'Ворота кладбища', x: gp.x, z: gp.z }, { id: 'arena', label: 'Арена', x: ARENA.x, z: ARENA.z },
    // the other passages: «→ location» on the side it leads to; the boss whose first kill opens it is on the units' tooltip
    ...PASSES.map((p) => {
      const g = GATES.find((x) => x.id === p.id)!;
      const name = (z: ZoneId) => CONFIG.ZONES.find((d) => d.id === z)?.name ?? z;
      return { id: `gate:${g.id}`, label: `${name(g.from)} ↔ ${name(g.to)}`, x: g.x, z: g.z };
    }),
  ];
  const units = buildUnits().map((u): MapUnit => {
    const p = posOf(u.spot);
    const base = { id: u.id, def: u.def, kind: u.kind, zone: u.zone, x: p.x, z: p.z, approx: u.approx || u.id.startsWith('tree:') || undefined, pack: u.pack, depth: u.depth, charges: u.charges, reward: rewardOf(u) };
    if (u.kind === 'prop') return { ...base, name: u.def, rank: 'prop', hp: BREAKABLES[u.def].hp, dmg: 0, token: 0 };
    const d = MOBS[u.def];
    const f = foeOf(u);
    return { ...base, name: d.name, rank: mobRank(d), hp: f.hp, dmg: f.dmg, bonus: d.bonus, drop: d.drop ? wname(dropItem(d.drop)) : undefined, token: tokenChance(u) };
  });
  return { trail, marks, units, roads: LAND_TRAILS.map((l) => l.map(([x, z]) => [x, z] as [number, number])) };
}

/** `opts.runs` runs from seeds seed, seed+1, …; `onRun` after each (progress). */
export function simulate(opts: Partial<SimOpts> = {}, onRun?: (done: number) => void): RunOut[] {
  return simulateFrom(opts, [], onRun).map((r) => r.out);
}
/**
 * Runs with checkpoints: run i starts from `ctl[i].from` when given (else from seed `opts.seed + i`), keeps / stops at
 * the bosses `ctl[i]` names. `opts.until` still caps the time.
 */
export function simulateFrom(opts: Partial<SimOpts>, ctl: RunCtl[], onRun?: (done: number) => void) {
  OPT = { ...DEFAULT_OPTS, ...opts };
  Math.random = rand;
  const runs: ReturnType<typeof run>[] = [];
  for (let i = 0; i < OPT.runs; i++) { runs.push(run(OPT.seed + i, ctl[i] ?? ctl[0] ?? {})); onRun?.(i + 1); }
  return runs;
}

/** The tuner's look at a boss fight: the hero of checkpoint `cp` at full HP, the class that does best. */
export interface BossProbe {
  /** Mean (no dice) fight: its length, s, and whether it is won; `dps`: the boss's HP lost per second of it. */
  dur: number; win: boolean; dps: number;
  /** HP of the whole fight as the field has it (ZONE_TIER, the partner): the boss's MobDef hp is a share of it. */
  hp: number;
  /** Share of `probes` dice fights won. */
  rate: number;
}
export function probeBoss(cp: Checkpoint, boss: string, opts: Partial<SimOpts>, probes = 24): BossProbe {
  OPT = { ...DEFAULT_OPTS, ...opts };
  Math.random = rand;
  const c = cp.data as CpData;
  const u = c.units.find((x) => x.def === boss);
  if (!u) throw new Error(`нет босса ${boss}`);
  const foes = () => [foeOf(u), ...partnersOf(u)];
  const hp = foes().reduce((a, f) => a + f.hp, 0);
  let best: (FightOut & { c: HeroClass }) | null = null;
  for (const cls of c.h.classes) {
    const x = as(c.h, cls, u.zone);
    x.hp = stats(x).maxHp;
    const r = { ...fight(x, foes(), true, 900), c: cls };
    const edge = (y: FightOut) => (y.win ? 2 - y.dur / 900 : y.dealt / hp);
    if (!best || edge(r) > edge(best)) best = r;
  }
  rs = 4242;
  let won = 0;
  for (let i = 0; i < probes; i++) {
    const x = as(c.h, best!.c, u.zone);
    x.hp = stats(x).maxHp;
    if (fight(x, foes(), false, 900).win) won++;
  }
  return { dur: best!.dur, win: best!.win, dps: best!.dealt / Math.max(0.05, best!.dur), rate: won / probes, hp };
}

export interface BenchRow { label: string; ttk: number }
export const BENCH_HP = 4000;
/** Weapon bench: mean time to kill a 4000 HP target (rare lvl 1, power 0, no resists): every weapon, sword + each shield, fire staff + each orb. */
export function bench(): BenchRow[] {
  OPT = { ...DEFAULT_OPTS, uptime: 1, combo: 1 };
  Math.random = rand;
  const def: MobDef = { ...MOBS.bandit_thug, resist: {}, dmg: 0, rank: 'elite' };
  const ttk = (a: string, b: string | null, n = 20) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      rs = i + 1;
      const cls = weaponClass(a) ?? 'warrior'; // (the hunter's pet is his class item: `b`, none for a lone bow)
      const h: Hero = {
        faction: 'human', src: { debug: { hp: 1e6, regen: -HERO.regen } }, pct: {}, equip: {}, hp: 1e6, bag: [], pulls: 0, pity: 0, gacha: new Set(), spot: { s: 0, off: 0 },
        weapons: [makeItem('weapon', a, 2, 1), b ? makeItem('weapon', b, 2, 1) : null], cls, classes: [cls], kits: {} as Hero['kits'], gear: {} as Hero['gear'],
      };
      sum += fight(h, { def, hp: BENCH_HP, dmg: 0 }, false, 600).dur;
    }
    return sum / n;
  };
  const rows: BenchRow[] = [];
  for (const w of Object.keys(WEAPONS)) if (!WEAPONS[w].guard && !WEAPONS[w].orb && !WEAPONS[w].pet) rows.push({ label: w, ttk: ttk(w, null) });
  for (const s of Object.keys(WEAPONS)) if (WEAPONS[s].guard) rows.push({ label: `sword+${s}`, ttk: ttk('sword', s) });
  if (WEAPONS.staff_fire) for (const o of Object.keys(WEAPONS)) if (WEAPONS[o].orb) rows.push({ label: `staff_fire+${o}`, ttk: ttk('staff_fire', o) });
  return rows;
}

// ---------- summary ----------
/** Quantile `q` of `a` (undefined when empty). */
export const pct = (a: number[], q: number) => { if (!a.length) return undefined; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

export interface BossSum {
  id: string; name: string; p10?: number; p50?: number; p90?: number; won: number; dur?: number;
  /** Median share of might from gacha items at the first kill. */
  gacha?: number;
  /** Median share of the forest cycle spent at the first kill (runs that killed it). */
  cycle?: number;
}
export interface MobAvg { swings: number; dur: number; takenPct: number; t: number }
export interface MobSum { key: string; n: number; first: MobAvg; all: MobAvg; losses: number }
export interface SimSummary {
  runs: number; bosses: BossSum[]; pulls: Record<10 | 20 | 30, number | undefined>; deaths?: number; mobs: MobSum[];
  /** Median fight length, s, by location and top rank: won fights up to the location boss's first kill (the levelling there; a pack is one fight). */
  fightDur: Partial<Record<ZoneId, Partial<Record<MobRank | 'static', number>>>>;
  /** Median share of max HP lost in a won fight, same keys. */
  fightLoss: Partial<Record<ZoneId, Partial<Record<MobRank | 'static', number>>>>;
  /** Each location: median time it opened (runs that opened it). */
  zones: { zone: ZoneId; p50?: number; n: number }[];
  /** Share of all fighting time by class on the field (0…1). */
  classShare: Partial<Record<HeroClass, number>>;
  /** The forest cycle: charges in it, median time it closes (runs that closed it, of `runs`). */
  cycle: { total: number; doneAt?: number; closed: number };
}

export function summarize(runs: RunOut[]): SimSummary {
  const bosses = BOSSES.map((b): BossSum => {
    const at = runs.map((r) => r.bossAt[b.id]).filter((x): x is number => x !== undefined);
    const dur = runs.map((r) => r.bossDur[b.id]).filter((x): x is number => x !== undefined);
    const cyc = runs.map((r) => r.cycle.atBoss[b.id]).filter((x): x is number => x !== undefined);
    const gacha = runs.map((r) => r.gachaShare[b.id]).filter((x): x is number => x !== undefined);
    return { id: b.id, name: b.name, p10: pct(at, 0.1), p50: pct(at, 0.5), p90: pct(at, 0.9), won: at.length, dur: pct(dur, 0.5), cycle: pct(cyc, 0.5), gacha: pct(gacha, 0.5) };
  });
  const pullsBy = (m: number) => pct(runs.map((r) => r.pulls.filter((x) => x <= m * 60).length), 0.5);
  const by = new Map<string, FightRec[]>();
  for (const r of runs) for (const f of r.fights) { const k = `${f.def}${f.depth ? `@${f.depth.toFixed(1)}` : ''}`; by.set(k, [...(by.get(k) ?? []), f]); }
  const avg = (a: FightRec[]): MobAvg => {
    const m = (g: (f: FightRec) => number) => a.reduce((x, f) => x + g(f), 0) / Math.max(1, a.length);
    return { swings: m((f) => f.swings), dur: m((f) => f.dur), takenPct: m((f) => (100 * f.taken) / f.maxHp), t: m((f) => f.t) };
  };
  const mobs = [...by].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, fs]): MobSum => ({
    key, n: fs.length, first: avg(fs.filter((f) => f.first)), all: avg(fs), losses: fs.filter((f) => !f.win).length,
  }));
  const time: Partial<Record<HeroClass, number>> = {};
  for (const r of runs) for (const [c, s] of Object.entries(r.classTime) as [HeroClass, number][]) time[c] = (time[c] ?? 0) + s;
  const total = Object.values(time).reduce((a, b) => a + b, 0) || 1;
  const classShare = Object.fromEntries(Object.entries(time).map(([c, s]) => [c, s / total]));
  const closed = runs.map((r) => r.cycle.doneAt).filter((x): x is number => x !== undefined);
  const cycle = { total: runs[0]?.cycle.total ?? 0, doneAt: pct(closed, 0.5), closed: closed.length };
  const zones = ZONE_IDS.map((zone) => { const at = runs.map((r) => r.openAt[zone]).filter((x): x is number => x !== undefined); return { zone, p50: pct(at, 0.5), n: at.length }; });
  const fightDur: SimSummary['fightDur'] = {};
  const fightLoss: SimSummary['fightLoss'] = {};
  const durs = new Map<string, number[]>(), losses = new Map<string, number[]>();
  const bossOf = new Map(BOSSES.map((b) => [b.boss!.zone, b.id]));
  for (const r of runs) for (const f of r.fights) if (f.win && f.t <= (r.bossAt[bossOf.get(f.zone) ?? ''] ?? Infinity)) { const k = `${f.zone}|${f.rank}`; durs.set(k, [...(durs.get(k) ?? []), f.dur]); losses.set(k, [...(losses.get(k) ?? []), f.taken / f.maxHp]); }
  for (const [k, a] of durs) { const [z, rk] = k.split('|') as [ZoneId, MobRank | 'static']; (fightDur[z] ??= {})[rk] = pct(a, 0.5); }
  for (const [k, a] of losses) { const [z, rk] = k.split('|') as [ZoneId, MobRank | 'static']; (fightLoss[z] ??= {})[rk] = pct(a, 0.5); }
  return { runs: runs.length, bosses, zones, fightDur, fightLoss, pulls: { 10: pullsBy(10), 20: pullsBy(20), 30: pullsBy(30) }, deaths: pct(runs.map((r) => r.deaths), 0.5), mobs, classShare, cycle };
}
