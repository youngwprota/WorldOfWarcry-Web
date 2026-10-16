// Balance simulator core: a bot plays the forest and the cemetery on a 1-D model of the trail, using the game's own
// config and formulas (src/balance.ts). No node or DOM: the CLI (tools/sim.ts) and the balance page (balance.html,
// in a worker) both run it.
import * as CONFIG from './config';
import {
  ATTACK_HIT, BREAKABLES, FACTIONS, FOREST_TREES, GLOVES_BANDITS, GUARD_PACKS, HERO, MID_SPAWNERS, MINI_SPAWNER, MINI_SPAWNER_OF, MOBS, ORBS,
  PETS, PROP_SPAWNERS, RESIST_MULT, SPAWNERS, START_PET, STAVES, WEAPONS, depthMul, mobImpact, packUnits, mobRank, tokenChance as zoneTokenChance,
  type FactionId, type MobDef, type OrbKind, type OrbReward, type SpawnerDef, type StatId, type ZoneId,
} from './config';
import { addStat, heroDps, armorMul, critAvg, critChance, critMul, dodgeChance, guardMul, heroStats, type HeroBuild } from './balance';
import { ARMOR, armorStats, dropItem, itemClass, makeItem, sameItem, weaponDamage, type Item } from './items';
import { CLASSES, CLASS_IDS, classSlot, kitOf, weaponClass, type HeroClass } from './party';
import { pull } from './gacha';
import {
  ARENA, BOSS_GUARDS, FORT, FOREST_PINS, GATE, GATE_GUARDS, GLOVES_PACKS, LAND_BOSSES, MID_UV, SPAWN, campToFortAt, ringSpots, inCamp, pathAt, pathDist,
  progressAt, walkable, zoneIdAt,
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
}
export const DEFAULT_OPTS: SimOpts = {
  faction: 'human', cls: 'party', weapon: '', off: '', runs: 20, until: 45 * 60, dodge: 0.6, uptime: 0.8, combo: 0.85, bossWin: 0.5, seed: 1, keep: false, probes: 12,
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
interface Spot { s: number; off: number; side?: number; x?: number; z?: number }
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
const forestRanges: [number, number][] = [[progressAt(-3, -80), sFort - 28]];
const cemRange: [number, number][] = [[GATE.s + 12, sArena - ARENA.r - 3]];
const graveRange: [number, number][] = [[GATE.s + 6, sArena - ARENA.r]];

/** Walking distance between two spots: along the trail plus the way off it (straight line when close). */
function dist(a: Spot, b: Spot) {
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
/** The way between two spots as `dist` walks it: straight when close, else onto the trail, along it and off again. */
function route(a: Spot, b: Spot) {
  const ds = Math.abs(a.s - b.s);
  if (ds < a.off + b.off) return [posOf(a), posOf(b)];
  const pts = [posOf(a)];
  const n = Math.ceil(ds / 4);
  for (let i = 0; i <= n; i++) { const p = pathAt(a.s + ((b.s - a.s) * i) / n); pts.push({ x: p.x, z: p.z }); }
  pts.push(posOf(b));
  return pts;
}

// ---------- units ----------
interface Unit {
  id: string; kind: 'mob' | 'prop'; def: string; zone: ZoneId; spot: Spot; depth: number; charges: number[];
  n: number; respawnAt: number; temp?: boolean;
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
    for (const q of ringSpots(GLOVES_PACKS[i][0], GLOVES_PACKS[i][1], GLOVES_BANDITS[i].slots.length, 1.6, Math.PI / 2)) gloveSpots.push(spotAt(q.x, q.z));
  }
  add('mob', gloves, gloveSpots, 'forest', 'gloves', 0.3);
  // static trees: World picks trees 4–12 m off the trail, well apart — spread along it here
  add('mob', FOREST_TREES, along(forestRanges, FOREST_TREES.length).map((p) => ({ s: p.s, off: 9, side: -(p.side ?? 1) })), 'forest', 'tree', false);
  add('mob', packUnits(GUARD_PACKS.boss_guard), BOSS_GUARDS.map((p) => spotAt(p.x, p.z)), 'forest', 'bguard', false);
  add('mob', packUnits(GUARD_PACKS.gate_guard), GATE_GUARDS.map((p) => spotAt(p.x, p.z)), 'forest', 'gguard', false);
  add('mob', SPAWNERS.cemetery ?? [], placeAlong(cemRange, SPAWNERS.cemetery ?? [], 'cemetery', packs), 'cemetery', 'cemetery');
  // the fort's real tower (world.buildFort): a breakable turret south of the boss (its arrows at the hero are left out)
  const tower = OPT.faction === 'human' ? 'fort_tower_orc' : 'fort_tower_human';
  add('prop', [{ unit: 'prop', id: tower }], [spotAt(FORT.x - 1, FORT.z + 6)], 'forest', 'fort_tower', false);
  const cemMinis = LAND_BOSSES.find((l) => l.zone === 'cemetery')?.minis ?? [];
  add('mob', cemMinis.map(() => MINI_SPAWNER_OF.cemetery ?? MINI_SPAWNER), cemMinis.map(([x, z]) => spotAt(x, z)), 'cemetery', 'mini', false);
  add('prop', PROP_SPAWNERS.camp, PROP_SPAWNERS.camp.map(() => ({ s: sCamp, off: 20 })), 'forest', 'camp', false);
  add('prop', PROP_SPAWNERS.forest, along(forestRanges, PROP_SPAWNERS.forest.length).map((p) => ({ s: p.s + 3, off: 6 })), 'forest', 'pf', false);
  add('prop', PROP_SPAWNERS.cemetery, along(graveRange, PROP_SPAWNERS.cemetery.length).map((p) => ({ s: p.s, off: 9 })), 'cemetery', 'pc', false);
  add('prop', PROP_SPAWNERS.cemeteryField, PROP_SPAWNERS.cemeteryField.map(() => ({ s: sArena - 20, off: 35 })), 'cemetery', 'pcf', false);
  for (const d of BOSSES) {
    const zone = d.boss!.zone;
    const s = zone === 'forest' ? sFort : sArena;
    us.push({ id: d.id, kind: 'mob', def: d.id, zone, spot: { s, off: 0 }, depth: 0, charges: [d.respawn], n: 0, respawnAt: 0 });
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
  classes: HeroClass[]; kits: Record<HeroClass, Record<ZoneId, Kit>>; gear: Record<HeroClass, HeroBuild['equip']>;
}
const stats = (h: Hero) => heroStats(h);
/** Hero `h` with class `c` on the field, in its kit for `zone` (a copy: the bot's estimates). */
const as = (h: Hero, c: HeroClass, zone: ZoneId): Hero => ({ ...h, cls: c, weapons: h.kits[c][zone], equip: h.gear[c] });
const wear = (h: Hero, c: HeroClass, zone: ZoneId) => { h.cls = c; h.weapons = h.kits[c][zone]; h.equip = h.gear[c]; };
/** The bot plays the forest and the cemetery only: their two bosses. */
export const BOSSES = Object.values(MOBS).filter((d) => d.boss && (d.boss.zone === 'forest' || d.boss.zone === 'cemetery'));
// ---------- fight: ticks of 0.05 s ----------
const DT = 0.05;
interface FightOut { win: boolean; dur: number; swings: number; dealt: number; taken: number; hpEnd: number; slams: number; slamHits: number }
interface Foe { def: MobDef; hp: number; dmg: number }
function foeOf(u: Unit): Foe {
  const d = MOBS[u.def];
  const mul = d.boss || d.rank ? { hp: 1, dmg: 1 } : depthMul(u.zone, u.depth);
  return { def: d, hp: Math.round(d.hp * mul.hp), dmg: d.dmg * mul.dmg };
}

/**
 * One duel. `mean`: no dice (rolls at their expected value, slams hit for their expected share) — the bot's
 * quick estimate. Weapon mechanics are modelled for a single target: crowd effects are left out.
 */
function fight(h: Hero, foe: Foe, mean = false, limit = 400): FightOut {
  const st = stats(h);
  const d = foe.def;
  const boss = d.boss;
  const rank = mobRank(d);
  const roll = () => (mean ? 1 : 0.9 + rand() * 0.2);
  const chance = (p: number) => (mean ? false : rand() < p);
  let hp = h.hp;
  let mhp = foe.hp;
  const mmax = foe.hp;
  let stun = 0;
  let lastCounter = -99;
  const period = 1 / d.aps;
  let matk = mobImpact(ATTACK_HIT[d.creature ? `${d.model.human[0]}:attack` : d.anim] ?? 0.6, period);
  let special = boss ? boss.cd : Infinity;
  let phase2 = false;
  let busy = 0; // hero dodging: no swings
  let taken = 0, slams = 0, slamHits = 0, swings = 0;
  const pending: [number, number][] = []; // [time, damage] of telegraphed blasts
  // hands
  const hands = h.weapons.map((it, i) => ({ i, it, cd: 0.25 + i * 0.1 }));
  // class extras (game.ts staffHit / iceHit / throwGust / updatePet), single target: the hunter's pet bites what he
  // shoots; the fire staff burns (+vulnerability), the ice staff freezes every Nth hit, the wind staff throws an orb
  const pet = CLASSES[h.cls].pet ? PETS[START_PET] : null;
  let petCd = 0.6;
  const B = STAVES.fire.burn;
  let burn = 0, burnTick = 0, burnDps = 0, iceN = 0, windN = 0;
  const gusts: number[] = []; // landing times of wind orbs
  const vuln = () => (burn > 0 ? 1 + B.vuln : 1);
  // crits and dodges: dice, or their expected value with `mean`
  const heroCrit = () => (mean ? critAvg(st.critPts, st.critDmgPts) : chance(st.crit) ? st.critMul : 1);
  const foeHits = () => (mean ? 1 - dodgeChance(d.dodge) : chance(dodgeChance(d.dodge)) ? 0 : 1);
  /** Shield in the class slot: a blow taken (slams too) may be answered by the weapon. */
  const answer = () => {
    const g = h.weapons[1] && WEAPONS[h.weapons[1].def].guard;
    const weapon = h.weapons[0];
    if (g && weapon && t - lastCounter >= g.cd && (mean ? true : chance(g.counter[rank]))) {
      lastCounter = t;
      if (mean) hit(weapon, g.counter[rank]);
      else strike(weapon);
    }
  };
  const hurt = (raw: number) => {
    // the hero's dodge works on any blow, boss specials too
    if (mean) raw *= (1 - st.dodge) * critAvg(d.crit, d.critDmg);
    else if (chance(st.dodge)) return;
    else if (chance(critChance(d.crit))) raw *= critMul(d.critDmg);
    const dmg = Math.max(1, raw * armorMul(st.defense) * guardMul(h.weapons) * roll());
    taken += dmg;
    hp -= dmg;
    // spiked shield: a share of the blow goes back
    const reflect = h.weapons[1] && WEAPONS[h.weapons[1].def].guard?.reflect;
    if (reflect) mhp -= dmg * reflect;
  };
  const hit = (it: Item, mult: number) => {
    const w = WEAPONS[it.def];
    const r = RESIST_MULT[d.resist[w.type] ?? 'normal'];
    const dmg = weaponDamage(it, st.power, st.powerMul) * heroCrit() * foeHits() * r * mult * roll() * vuln();
    mhp -= dmg;
    return dmg;
  };
  /** One swing of a hand (counters too). */
  const strike = (it: Item) => {
    const w = WEAPONS[it.def];
    const dmg = hit(it, 1);
    if (w.staff === 'fire' && dmg > 0) { if (burn <= 0) burnTick = B.tick; burn = B.time; burnDps = dmg * B.dps; }
    if (w.staff === 'ice' && dmg > 0) {
      const f = STAVES.ice.freeze;
      iceN = (iceN + 1) % f.every;
      if (iceN === 0 && rank !== 'mini' && rank !== 'boss') stun = Math.max(stun, f.time);
    }
    if (w.staff === 'wind') {
      const o = STAVES.wind.orb;
      windN = (windN + 1) % o.every;
      if (windN === 0 && !d.static) gusts.push(t + o.flight); // orbs skip passive units
    }
    if (!boss && w.stun && (mean ? false : chance(w.stun))) stun = Math.max(stun, 0.9);
  };
  let t = 0;
  for (; t < limit && hp > 0 && mhp > 0; t += DT) {
    // hero hands
    if (busy > 0) busy -= DT;
    for (const hd of hands) {
      if (!hd.it) continue;
      const w = WEAPONS[hd.it.def];
      if (w.guard || w.orb) continue; // shields and mage orbs never swing
      hd.cd -= DT;
      if (hd.cd > 0 || busy > 0) continue;
      const per = 1 / w.aps;
      // uptime: the hero spends part of the fight repositioning — swings come later
      hd.cd = per / OPT.uptime;
      swings++;
      strike(hd.it);
    }
    // the pet: always on the target (slams do not stop it), × the plain blow of the weapon, no crits or dodges
    if (pet && h.weapons[0]) {
      petCd -= DT;
      if (petCd <= 0) {
        petCd += 1 / pet.aps;
        mhp -= weaponDamage(h.weapons[0], st.power, st.powerMul) * pet.dmg * RESIST_MULT[d.resist[pet.type] ?? 'normal'] * roll() * vuln();
      }
    }
    if (burn > 0) {
      burn -= DT;
      burnTick -= DT;
      if (burnTick <= 0) { burnTick += B.tick; mhp -= burnDps * B.tick * (1 + B.vuln); }
    }
    for (let i = gusts.length - 1; i >= 0; i--) {
      if (gusts[i] > t) continue;
      gusts.splice(i, 1);
      hit(h.weapons[0]!, STAVES.wind.orb.dmg);
    }
    if (mhp <= 0) break;
    // the foe (static units — trees — never strike back)
    if (stun > 0) stun -= DT;
    else if (d.aps > 0) {
      matk -= DT;
      if (matk <= 0) {
        matk += period;
        hurt(foe.dmg * (phase2 ? boss!.phase2Dmg : 1));
        answer();
      }
    }
    if (boss) {
      if (!phase2 && mhp < mmax * boss.phase2At) phase2 = true;
      special -= DT;
      if (special <= 0) {
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
        if (mean) { hurt(foe.dmg * mul * (1 - OPT.dodge)); busy = Math.max(busy, 0.8 * OPT.dodge); answer(); }
        else if (rand() < OPT.dodge) busy = Math.max(busy, 0.8); // stepped out of the red circle
        else { slamHits++; hurt(foe.dmg * mul); answer(); }
      }
    }
    hp = Math.min(st.maxHp, hp + st.regen * DT);
  }
  return { win: mhp <= 0 && hp > 0, dur: t, swings, dealt: mmax - Math.max(0, mhp), taken, hpEnd: Math.max(0, hp), slams, slamHits };
}

// ---------- loot and gear ----------
const VALUE: Record<StatId, number> = { power: 1, hp: 0.35, regen: 1.5, speed: 0.2, defense: 1, dodge: 2, crit: 1.5, critDmg: 1 };
const rewardOf = (u: Unit): OrbReward => {
  if (u.kind === 'prop') return BREAKABLES[u.def].reward as OrbReward;
  const d = MOBS[u.def];
  if (d.boss || d.rank) return d.reward;
  const k = depthMul(u.zone, u.depth).reward;
  const [s, n] = Object.entries(d.reward)[0] as [OrbKind, number];
  return { [s]: Math.round(n * k) } as unknown as OrbReward;
};
function giveStats(h: Hero, r: Partial<Record<OrbKind, number>>, orbs: boolean) {
  for (const [k, n] of Object.entries(r) as [OrbKind, number][]) {
    const v = orbs ? n * ORBS[k].value : n;
    addStat(h, orbs ? 'enemy' : 'mini', k, v);
    if (k === 'hp') h.hp += v;
  }
}
function lootItem(h: Hero, it: Item) {
  const own = [...h.weapons, ...Object.values(h.equip), ...h.bag].find((x) => x && sameItem(x, it));
  if (own) own.lvl += it.lvl;
  else h.bag.push(it);
  if (!OPT.keep) regear(h);
}
const dpsCache = new Map<string, number>();
/**
 * Each class: the best weapon + class item it may use (party.ts classSlot) for each location, by DPS against the
 * location's resists; armour it may wear (items.ts itemClass), the best piece per slot by defense + bonus.
 */
function regear(h: Hero) {
  const all = [...h.classes.flatMap((c) => [...h.kits[c].forest, ...h.kits[c].cemetery]), ...h.bag]
    .filter((x, i, a): x is Item => !!x && x.kind === 'weapon' && a.indexOf(x) === i);
  h.bag = h.bag.filter((x) => x.kind !== 'weapon');
  for (const c of h.classes) {
    const mains = all.filter((x) => classSlot(c, x.def) === 0);
    const offs = all.filter((x) => classSlot(c, x.def) === 1);
    for (const zone of ['forest', 'cemetery'] as ZoneId[]) {
      let bestDps = -1;
      for (const a of mains) for (const b of [null, ...offs]) {
        const key = `${c}|${zone}|${wname(a)}|${wname(b)}`;
        let dps = dpsCache.get(key);
        if (dps === undefined) dpsCache.set(key, (dps = dummyDps(h, c, [a, b], zone)));
        if (dps > bestDps) { bestDps = dps; h.kits[c][zone] = [a, b]; }
      }
    }
  }
  // weapons no class picked go back to the bag (an unused class's)
  const used = new Set(h.classes.flatMap((c) => [...h.kits[c].forest, ...h.kits[c].cemetery]));
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
  const resist = MOBS[zone === 'forest' ? 'bandit_chief' : 'death'].resist;
  const def: MobDef = { ...MOBS.bandit_thug, resist, dmg: 0, rank: 'elite' };
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
export interface FightRec { def: string; depth: number; t: number; first: boolean; dur: number; swings: number; taken: number; maxHp: number; win: boolean; cls: HeroClass }
/** What the bot did, for the map replay: a fight, a break, or a rest in the camp. */
export interface BotEvent {
  t: number; dur: number; unit: string; def: string; x: number; z: number; res: 'kill' | 'death' | 'break' | 'rest'; cls: HeroClass;
  /** Orbs picked up (counts, × ORBS value = points), the mini-boss's direct stat points, the item dropped, a gacha pull. */
  gain?: Partial<Record<OrbKind, number>>; bonus?: Partial<Record<OrbKind, number>>; item?: string; pull?: boolean;
  /** HP lost, share of max. */
  taken?: number;
}
export interface RunOut {
  snaps: Snap[]; bossAt: Record<string, number>; bossDur: Record<string, number>; fights: FightRec[]; pulls: number[]; deaths: number;
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

function run(seed: number): RunOut {
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
  for (const c of classes) { const k = startKit(c); kits[c] = { forest: k, cemetery: k } as Record<ZoneId, Kit>; gear[c] = {}; }
  const h: Hero = {
    faction: OPT.faction, src: {}, pct: {}, equip: gear[classes[0]], weapons: kits[classes[0]].forest, cls: classes[0], classes, kits, gear,
    hp: 0, bag, pulls: 0, pity: 0, spot: { s: sCamp, off: 0 },
  };
  h.hp = stats(h).maxHp;
  const units = buildUnits();
  const capped = (u: Unit) => u.zone === 'forest' && !u.temp && u.charges.length > 1 && Math.max(...u.charges) >= 3600;
  const spent = new Map<Unit, number>();
  const out: RunOut = {
    snaps: [], bossAt: {}, bossDur: {}, fights: [], pulls: [], deaths: 0, classTime: {}, path: [], events: [],
    cycle: { total: units.filter(capped).reduce((a, u) => a + u.charges.length, 0), done: 0, atBoss: {} },
  };
  dpsCache.clear();
  const open = new Set<ZoneId>(['forest']);
  const camp: Spot = { s: sCamp, off: 0 };
  const campHome = camp;
  let t = 0;
  let kills = 0;
  let nextSnap = 0;
  // estimates are kept until the hero grows by 3% or changes gear
  let ver = 0, verPower = 0, verHp = 0, verGear = '';
  type Est = FightOut & { rate?: number; cls: HeroClass };
  const est = new Map<string, Est>();
  const gearKey = () => h.classes.map((c) => [...h.kits[c].forest, ...h.kits[c].cemetery, ...Object.values(h.gear[c])].map(wname).join()).join('|');
  const checkVer = () => {
    const st = stats(h);
    const g = gearKey();
    if (st.power > verPower * 1.03 || st.maxHp > verHp * 1.03 || g !== verGear) { ver++; verPower = st.power; verHp = st.maxHp; verGear = g; est.clear(); }
  };
  /** Class `c` at full HP in its kit for `zone`. */
  const full = (c: HeroClass, zone: ZoneId): Hero => { const x = as(h, c, zone); x.hp = stats(x).maxHp; return x; };
  const bossRate = (c: HeroClass, u: Unit) => { let w = 0; for (let i = 0; i < OPT.probes; i++) if (fight(full(c, u.zone), foeOf(u)).win) w++; return w / OPT.probes; };
  /** The bot's estimate of the fight, by the best class for it: a boss by win rate, a mob by a safe and quick win. */
  /** Seconds to break a prop: its HP over the hero's plain-swing DPS against its material. */
  const propTime = (b: CONFIG.BreakableDef) => {
    const st = stats(h);
    return b.hp / Math.max(1, heroDps(h.weapons, st.power, st.powerMul, 1, b.resist));
  };
  const estimate = (u: Unit) => {
    const key = `${u.def}|${u.depth.toFixed(2)}`;
    let e = est.get(key);
    if (!e) {
      const boss = !!MOBS[u.def].boss;
      for (const c of h.classes) {
        const x: Est = { ...fight(full(c, u.zone), foeOf(u), true, boss ? 400 : 150), cls: c };
        if (boss) x.rate = bossRate(c, u);
        const safe = (y: Est) => y.win && y.taken <= 0.7 * stats(full(y.cls, u.zone)).maxHp;
        const better = !e ? true
          : boss ? x.rate! > e.rate! || (x.rate === e.rate && x.dur < e.dur)
            : safe(x) !== safe(e) ? safe(x) : safe(x) ? x.dur < e.dur : x.taken < e.taken;
        if (better) e = x;
      }
      est.set(key, e!);
    }
    return e!;
  };
  const snap = () => {
    const st = stats(h);
    const win: Record<string, number> = {};
    for (const b of BOSSES) {
      const u = units.find((x) => x.def === b.id)!;
      win[b.id] = Math.max(...h.classes.map((c) => bossRate(c, u)));
    }
    const kitName = (k: Kit) => k.map(wname).join('+');
    out.snaps.push({
      t, zone: h.spot.s > GATE.s ? 'cemetery' : 'forest', power: st.power, maxHp: st.maxHp, regen: st.regen, defense: st.defense,
      weapons: h.classes.map((c) => kitName(h.kits[c].forest) + (open.has('cemetery') && kitName(h.kits[c].cemetery) !== kitName(h.kits[c].forest) ? ` / ${kitName(h.kits[c].cemetery)}` : '')).join(' · '),
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

  while (t < OPT.until) {
    if (t >= nextSnap) { snap(); nextSnap = (Math.floor(t / 60) + 1) * 60; }
    checkVer();
    const st = stats(h);
    // pick the most worthwhile reachable target; a boss only at OPT.bossWin, unless nothing else is left
    const pick = (bossMin: number) => {
      let best: Unit | null = null, bestScore = 0, bestEst: Est | null = null;
      for (const u of units) {
        if (u.respawnAt > t || !open.has(u.zone)) continue;
        let dur = 0, e: Est | null = null;
        if (u.kind === 'mob') {
          e = estimate(u);
          const boss = !!MOBS[u.def].boss;
          if (boss ? (e.rate ?? 0) < bossMin : !e.win || e.taken > 0.7 * st.maxHp) continue;
          dur = e.dur;
        } else dur = propTime(BREAKABLES[u.def]);
        // the HP a fight costs has to be won back later: a tree or a crate is cheaper than its fight time alone says
        const score = value(u) / (dist(h.spot, u.spot) / st.speed + dur + healTime(e?.taken ?? 0, u.spot) + 2);
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
    // a player sends the class that does best and swaps to the weapons the location is weak to
    wear(h, bestEst?.cls ?? h.cls, u.zone);
    h.hp = Math.min(h.hp, stats(h).maxHp);
    const boss = u.kind === 'mob' && !!MOBS[u.def].boss;
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
      const foe = foeOf(u);
      const r = fight(h, foe);
      t += r.dur;
      const first = !out.fights.some((f) => f.def === u.def && f.depth === u.depth);
      out.fights.push({ def: u.def, depth: u.depth, t, first, dur: r.dur, swings: r.swings, taken: r.taken, maxHp: st.maxHp, win: r.win, cls: h.cls });
      out.classTime[h.cls] = (out.classTime[h.cls] ?? 0) + r.dur;
      if (!r.win) {
        event(u, t0, 'death', { taken: r.taken / st.maxHp });
        out.deaths++;
        t += 5;
        h.spot = camp;
        const c = posOf(camp);
        out.path.push([t, c.x, c.z]);
        h.hp = stats(h).maxHp;
        continue;
      }
      h.hp = r.hpEnd;
      kills++;
      const d = MOBS[u.def];
      const gain = rewardOf(u);
      giveStats(h, gain, true);
      if (d.bonus) giveStats(h, d.bonus, false);
      const item = d.drop ? dropItem(d.drop) : null;
      if (item) lootItem(h, item);
      const pulled = rand() < tokenChance(u);
      if (pulled) { h.pulls++; out.pulls.push(t); }
      event(u, t0, 'kill', { gain, bonus: d.bonus, item: item ? wname(item) : undefined, pull: pulled || undefined, taken: r.taken / st.maxHp });
      if (d.boss) {
        if (!out.bossAt[d.id]) { out.bossAt[d.id] = t; out.bossDur[d.id] = r.dur; out.cycle.atBoss[d.id] = out.cycle.done / out.cycle.total; }
        open.add('cemetery');
      }
    }
    // the gacha: every pull right away
    while (h.pulls > 0) {
      h.pulls--;
      const p = pull(h.pity, 1);
      h.pity = p.pity;
      lootItem(h, p.item);
    }
    // the spawner's next charge
    if (u.temp) { units.splice(units.indexOf(u), 1); continue; }
    if (capped(u) && (spent.get(u) ?? 0) < u.charges.length) {
      spent.set(u, (spent.get(u) ?? 0) + 1);
      if (++out.cycle.done === out.cycle.total) out.cycle.doneAt = t;
    }
    const i = u.n % u.charges.length;
    u.respawnAt = t + u.charges[i];
    u.n = (i + 1) % u.charges.length;
  }
  return out;
}

// ---------- entry points ----------
/** Trail landmarks, m along the path. */
export const TRAIL = { camp: sCamp, fort: sFort, gate: GATE.s, arena: sArena };

/** One spawner on the sim's map (World's layout; `approx`: World picks the spot at random, e.g. the static trees). */
export interface MapUnit {
  id: string; def: string; name: string; kind: 'mob' | 'prop'; zone: ZoneId; x: number; z: number; approx?: boolean;
  rank: string; depth: number; hp: number; dmg: number; charges: number[];
  /** Orbs a kill drops (counts; × ORBS value = points), the mini-boss's stat points, the item, the gacha pull chance. */
  reward: Partial<Record<OrbKind, number>>; bonus?: Partial<Record<OrbKind, number>>; drop?: string; token: number;
}
export interface SimMap { trail: [number, number][]; marks: { id: string; label: string; x: number; z: number }[]; units: MapUnit[] }

/** The map the bot plays on, with the current config (call after applySet to see edits). */
export function simMap(): SimMap {
  const trail: [number, number][] = [];
  for (let s = 0; s <= sArena; s += 2) { const p = pathAt(s); trail.push([p.x, p.z]); }
  const gp = pathAt(GATE.s);
  const marks = [
    { id: 'camp', label: 'Лагерь', x: SPAWN.x, z: SPAWN.z }, { id: 'fort', label: 'Форт', x: FORT.x, z: FORT.z },
    { id: 'gate', label: 'Ворота кладбища', x: gp.x, z: gp.z }, { id: 'arena', label: 'Арена', x: ARENA.x, z: ARENA.z },
  ];
  const units = buildUnits().map((u): MapUnit => {
    const p = posOf(u.spot);
    const base = { id: u.id, def: u.def, kind: u.kind, zone: u.zone, x: p.x, z: p.z, approx: u.id.startsWith('tree:') || undefined, depth: u.depth, charges: u.charges, reward: rewardOf(u) };
    if (u.kind === 'prop') return { ...base, name: u.def, rank: 'prop', hp: BREAKABLES[u.def].hp, dmg: 0, token: 0 };
    const d = MOBS[u.def];
    const f = foeOf(u);
    return { ...base, name: d.name, rank: mobRank(d), hp: f.hp, dmg: f.dmg, bonus: d.bonus, drop: d.drop ? wname(dropItem(d.drop)) : undefined, token: tokenChance(u) };
  });
  return { trail, marks, units };
}

/** `opts.runs` runs from seeds seed, seed+1, …; `onRun` after each (progress). */
export function simulate(opts: Partial<SimOpts> = {}, onRun?: (done: number) => void): RunOut[] {
  OPT = { ...DEFAULT_OPTS, ...opts };
  Math.random = rand;
  const runs: RunOut[] = [];
  for (let i = 0; i < OPT.runs; i++) { runs.push(run(OPT.seed + i)); onRun?.(i + 1); }
  return runs;
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
      const cls = weaponClass(a) ?? 'warrior'; // the hunter's bow comes with his pet
      const h: Hero = {
        faction: 'human', src: { debug: { hp: 1e6, regen: -HERO.regen } }, pct: {}, equip: {}, hp: 1e6, bag: [], pulls: 0, pity: 0, spot: { s: 0, off: 0 },
        weapons: [makeItem('weapon', a, 2, 1), b ? makeItem('weapon', b, 2, 1) : null], cls, classes: [cls], kits: {} as Hero['kits'], gear: {} as Hero['gear'],
      };
      sum += fight(h, { def, hp: BENCH_HP, dmg: 0 }, false, 600).dur;
    }
    return sum / n;
  };
  const rows: BenchRow[] = [];
  for (const w of Object.keys(WEAPONS)) if (!WEAPONS[w].guard && !WEAPONS[w].orb) rows.push({ label: w, ttk: ttk(w, null) });
  for (const s of Object.keys(WEAPONS)) if (WEAPONS[s].guard) rows.push({ label: `sword+${s}`, ttk: ttk('sword', s) });
  if (WEAPONS.staff_fire) for (const o of Object.keys(WEAPONS)) if (WEAPONS[o].orb) rows.push({ label: `staff_fire+${o}`, ttk: ttk('staff_fire', o) });
  return rows;
}

// ---------- summary ----------
/** Quantile `q` of `a` (undefined when empty). */
export const pct = (a: number[], q: number) => { if (!a.length) return undefined; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

export interface BossSum {
  id: string; name: string; p10?: number; p50?: number; p90?: number; won: number; dur?: number;
  /** Median share of the forest cycle spent at the first kill (runs that killed it). */
  cycle?: number;
}
export interface MobAvg { swings: number; dur: number; takenPct: number; t: number }
export interface MobSum { key: string; n: number; first: MobAvg; all: MobAvg; losses: number }
export interface SimSummary {
  runs: number; bosses: BossSum[]; pulls: Record<10 | 20 | 30, number | undefined>; deaths?: number; mobs: MobSum[];
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
    return { id: b.id, name: b.name, p10: pct(at, 0.1), p50: pct(at, 0.5), p90: pct(at, 0.9), won: at.length, dur: pct(dur, 0.5), cycle: pct(cyc, 0.5) };
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
  return { runs: runs.length, bosses, pulls: { 10: pullsBy(10), 20: pullsBy(20), 30: pullsBy(30) }, deaths: pct(runs.map((r) => r.deaths), 0.5), mobs, classShare, cycle };
}
