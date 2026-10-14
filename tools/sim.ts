// Balance simulator: a bot plays the forest and the cemetery on a 1-D model of the trail, using the game's own
// config and formulas (src/balance.ts). Prints a per-minute curve and when each boss falls.
// Run: npm run sim -- [--faction human|orc] [--weapon sword] [--left dagger] [--runs 20] [--until 45]
//                     [--dodge 0.6] [--uptime 0.8] [--combo 0.85] [--seed 1] [--keep] [--log] [--mobs] [--bench]
//                     [--set MOBS.bandit_chief.hp=6000 --set GACHA.token.normal=0.05 ...] (what-if: config edits for this run)
import * as CONFIG from '../src/config';
import {
  ATTACK_HIT, BREAKABLES, COMBOS, FACTIONS, GACHA, HERO, MOBS, ORBS, PROP_SPAWNERS, RESIST_MULT, SPAWNERS, SWORD_PAIRS,
  WEAPONS, depthMul, mobImpact, mobRank, type FactionId, type MobDef, type OrbKind, type OrbReward, type SpawnerDef, type StatId, type ZoneId,
} from '../src/config';
import { addStat, armorMul, critAvg, critChance, critMul, dodgeChance, guardMul, handMulOf, heroStats, type HeroBuild } from '../src/balance';
import { ARMOR, armorStats, dropItem, makeItem, sameItem, weaponDamage, type Item } from '../src/items';
import { swordPair, type Pair } from '../src/offhand';
import { pull } from '../src/gacha';
import { ARENA, FORT, GATE, SPAWN, pathAt, progressAt } from '../src/island';

declare const process: { argv: string[]; exit(code?: number): never };
// ---------- options ----------
const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const OPT = {
  faction: arg('faction', 'human') as FactionId,
  weapon: arg('weapon', ''),
  left: arg('left', ''),
  runs: +arg('runs', '20'),
  until: +arg('until', '45') * 60,
  dodge: +arg('dodge', '0.6'), // share of boss slams / blasts dodged
  uptime: +arg('uptime', '0.8'), // share of the fight the hero actually swings
  combo: +arg('combo', '0.85'), // chance a swing keeps the combo chain
  bossWin: +arg('boss-win', '0.5'), // tries a boss when the estimated win rate is at least this
  seed: +arg('seed', '1'),
  keep: flag('keep'), // never change weapons
  log: flag('log'), // per-minute table of the first run
  mobs: flag('mobs'), // per-mob fight table
  bench: flag('bench'), // single-target kill time of every weapon and sword pair, then exit
};

// --set path=value: config objects are mutable, so a what-if needs no file edit
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--set') continue;
  const [path, raw] = argv[i + 1].split('=');
  const keys = path.split('.');
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  if (!o || !(keys[keys.length - 1] in o)) throw new Error(`--set: нет такого поля ${path}`);
  o[keys[keys.length - 1]] = JSON.parse(raw);
}

// ---------- deterministic RNG (the game code calls Math.random) ----------
let rs = 1;
const rand = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
Math.random = rand;

// ---------- map: every spawner as a point beside the trail ----------
interface Spot { s: number; off: number }
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
    return { s, off: i % 4 < 2 ? 7 : 12 };
  });
}
const forestRanges: [number, number][] = [[progressAt(-3, -80), sFort - 28]];
const cemRange: [number, number][] = [[GATE.s + 12, sArena - ARENA.r - 3]];
const graveRange: [number, number][] = [[GATE.s + 6, sArena - ARENA.r]];

/** Walking distance between two spots: along the trail plus the way off it (straight line when close). */
function dist(a: Spot, b: Spot) {
  const ds = Math.abs(a.s - b.s);
  if (ds < a.off + b.off) {
    const pa = pathAt(a.s), pb = pathAt(b.s);
    return Math.hypot(pa.x + pa.tz * a.off - pb.x - pb.tz * b.off, pa.z - pa.tx * a.off - pb.z + pb.tx * b.off);
  }
  return ds + a.off + b.off;
}

// ---------- units ----------
interface Unit {
  id: string; kind: 'mob' | 'prop'; def: string; zone: ZoneId; spot: Spot; depth: number; charges: number[];
  n: number; respawnAt: number; temp?: boolean;
}
function buildUnits(): Unit[] {
  const us: Unit[] = [];
  const add = (kind: 'mob' | 'prop', list: SpawnerDef[], spots: Spot[], zone: ZoneId, tag: string, depth = true) =>
    list.forEach((d, i) => us.push({
      id: `${tag}:${i}`, kind, def: d.id, zone, spot: spots[i], depth: depth && list.length > 1 ? i / (list.length - 1) : 0,
      charges: d.charges ?? [kind === 'mob' ? MOBS[d.id].respawn : BREAKABLES[d.id].respawn], n: 0, respawnAt: 0,
    }));
  add('mob', SPAWNERS.forest ?? [], along(forestRanges, SPAWNERS.forest?.length ?? 0), 'forest', 'forest');
  add('mob', SPAWNERS.cemetery ?? [], along(cemRange, SPAWNERS.cemetery?.length ?? 0), 'cemetery', 'cemetery');
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
interface Hero extends HeroBuild { hp: number; bag: Item[]; pulls: number; pity: number; spot: Spot; kit: Record<ZoneId, HeroBuild['weapons']> }
const stats = (h: Hero) => heroStats(h);
/** The bot plays the forest and the cemetery only: their two bosses. */
const BOSSES = Object.values(MOBS).filter((d) => d.boss && (d.boss.zone === 'forest' || d.boss.zone === 'cemetery'));
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
 * quick estimate. Weapon mechanics are modelled for a single target: crowd effects (reaper pull, reaper pair,
 * pan pair's fear, hammer helpers) are left out.
 */
function fight(h: Hero, foe: Foe, mean = false, limit = 400): FightOut {
  const st = stats(h);
  const d = foe.def;
  const boss = d.boss;
  const rank = mobRank(d);
  const roll = () => (mean ? 1 : 0.9 + rand() * 0.2);
  const chance = (p: number) => (mean ? false : rand() < p);
  const pair: Pair | null = swordPair(h.weapons[0]?.def, h.weapons[1]?.def);
  let hp = h.hp;
  let mhp = foe.hp;
  const mmax = foe.hp;
  let stun = 0;
  let stacks = 0;
  let haste = 0, hasteAt = -99;
  let lastCounter = -99;
  const period = 1 / d.aps;
  let matk = mobImpact(ATTACK_HIT[d.creature ? `${d.model.human[0]}:attack` : d.anim] ?? 0.6, period);
  let special = boss ? boss.cd : Infinity;
  let phase2 = false;
  let busy = 0; // hero dodging: no swings
  let taken = 0, slams = 0, slamHits = 0, swings = 0;
  const pending: [number, number][] = []; // [time, damage] of telegraphed blasts
  // hands
  const hands = h.weapons.map((it, i) => ({ i, it, cd: 0.25 + i * 0.1, combo: 0 }));
  const orbits: { until: number; next: number; dmg: number }[] = [];
  // crits and dodges: dice, or their expected value with `mean`
  const heroCrit = () => (mean ? critAvg(st.critPts, st.critDmgPts) : chance(st.crit) ? st.critMul : 1);
  const foeHits = () => (mean ? 1 - dodgeChance(d.dodge) : chance(dodgeChance(d.dodge)) ? 0 : 1);
  const hurt = (raw: number) => {
    // the hero's dodge works on any blow, boss specials too
    if (mean) raw *= (1 - st.dodge) * critAvg(d.crit, d.critDmg);
    else if (chance(st.dodge)) return;
    else if (chance(critChance(d.crit))) raw *= critMul(d.critDmg);
    const dmg = Math.max(1, raw * armorMul(st.defense) * guardMul(h.weapons) * roll());
    taken += dmg;
    hp -= dmg;
  };
  const hit = (it: Item, mult: number) => {
    const w = WEAPONS[it.def];
    const r = RESIST_MULT[d.resist[w.type] ?? 'normal'];
    let dmg = weaponDamage(it, st.power, st.powerMul) * handMulOf(h.weapons, pair, it) * heroCrit() * foeHits() * r * mult * roll();
    if (w.stack) { dmg *= 1 + w.stack.add * stacks; stacks = Math.min(w.stack.max, stacks + 1); }
    mhp -= dmg;
    return dmg;
  };
  /** One swing of a hand (counters too). */
  const strike = (hd: { i: number; it: Item | null; combo: number }, counter = false) => {
    const it = hd.it!;
    const w = WEAPONS[it.def];
    const fin = !counter && hd.combo >= COMBOS[it.def].hits ? COMBOS[it.def] : null;
    let mult = fin ? fin.mult : 1;
    if (w.ring && chance(w.ring.chance)) mult *= w.ring.mult;
    else if (w.ring && mean) mult *= 1 + w.ring.chance * (w.ring.mult - 1);
    const swordHit = !!pair && hd.i === pair.sword;
    if (pair?.kind === 'hidden_blade' && w.assassin) mult *= SWORD_PAIRS.hidden_blade.dmg;
    if (pair?.kind === 'pan') mult *= SWORD_PAIRS.pan.dmg;
    if (pair?.kind === 'hammer' && !swordHit) mult *= 1 + SWORD_PAIRS.hammer.center * 0.5;
    if (w.orbit) {
      // the thrown scythe circles the hero: one cut per lap on a target in melee
      orbits.push({ until: t + w.orbit.time, next: t + w.orbit.time / w.orbit.turns / 2, dmg: mult });
      return;
    }
    hit(it, mult);
    if (swordHit && pair!.kind === 'axe') mhp -= mhp * (rank === 'normal' ? SWORD_PAIRS.axe.pct : SWORD_PAIRS.axe.boss);
    if (swordHit && pair!.kind === 'dagger') { haste = Math.min(SWORD_PAIRS.dagger.max, (t - hasteAt < SWORD_PAIRS.dagger.decay ? haste : 0) + SWORD_PAIRS.dagger.aps); hasteAt = t; }
    if (swordHit && pair!.kind === 'scythe') {
      const sp = SWORD_PAIRS.scythe;
      if (mean) mhp -= sp.chance * (sp.time / sp.rehit) * sp.mult * weaponDamage(it, st.power, st.powerMul) * handMulOf(h.weapons, pair, it) * heroCrit() * foeHits() * RESIST_MULT[d.resist[w.type] ?? 'normal'];
      else if (chance(sp.chance)) orbits.push({ until: t + sp.time, next: t + sp.rehit, dmg: -sp.mult });
    }
    if (fin && pair?.kind === 'nagamaki' && w.cycle) hit(it, SWORD_PAIRS.nagamaki.mult);
    if (w.assassin) {
      if (!boss) stun = Math.max(stun, w.assassin.stun);
      if (rank === 'normal' && mhp < mmax * w.assassin.execute) mhp = 0;
    } else if (!boss) {
      if (fin?.stun) stun = Math.max(stun, fin.stun);
      else if (w.stun && (mean ? false : chance(w.stun))) stun = Math.max(stun, 0.9);
    }
    if (fin) hd.combo = 0;
  };
  let t = 0;
  for (; t < limit && hp > 0 && mhp > 0; t += DT) {
    // hero hands
    if (busy > 0) busy -= DT;
    for (const hd of hands) {
      if (!hd.it) continue;
      const w = WEAPONS[hd.it.def];
      const other = h.weapons[1 - hd.i];
      if (w.guard && other && !WEAPONS[other.def].guard) continue;
      if (pair?.kind === 'hidden_blade' && hd.i === pair.sword) continue;
      hd.cd -= DT;
      if (hd.cd > 0 || busy > 0) continue;
      let per = 1 / w.aps;
      if (pair && hd.i !== pair.sword) {
        if (pair.kind === 'dagger' && t - hasteAt < SWORD_PAIRS.dagger.decay) per /= 1 + haste;
        if (pair.kind === 'hidden_blade') per /= SWORD_PAIRS.hidden_blade.aps;
      }
      if (w.orbit && orbits.some((o) => o.dmg > 0 && o.until > t)) continue;
      // uptime: the hero spends part of the fight repositioning — swings come later and the chain may break
      hd.cd = per / OPT.uptime;
      hd.combo = w.cycle || mean || rand() < OPT.combo ? hd.combo + 1 : 1;
      swings++;
      strike(hd);
    }
    for (const o of orbits) {
      if (o.until <= t || t < o.next) continue;
      const it = o.dmg > 0 ? h.weapons.find((x) => x && WEAPONS[x.def].orbit) : h.weapons[pair?.sword ?? 0];
      if (!it) { o.until = 0; continue; }
      if (o.dmg > 0) { hit(it, o.dmg); o.next += WEAPONS[it.def].orbit!.time / WEAPONS[it.def].orbit!.turns; }
      else { hit(it, -o.dmg); o.next += SWORD_PAIRS.scythe.rehit; }
    }
    if (orbits.length > 8) orbits.splice(0, orbits.length - 8);
    if (mhp <= 0) break;
    // the foe
    if (stun > 0) stun -= DT;
    else {
      matk -= DT;
      if (matk <= 0) {
        matk += period;
        hurt(foe.dmg * (phase2 ? boss!.phase2Dmg : 1));
        // shield: a blow taken may be answered by the other hand
        const sh = h.weapons.find((x) => x && WEAPONS[x.def].guard);
        const g = sh && WEAPONS[sh.def].guard!;
        const other = sh && h.weapons.find((x) => x && x !== sh);
        if (g && other && t - lastCounter >= g.cd && (mean ? true : chance(g.counter[rank]))) {
          lastCounter = t;
          if (mean) hit(other, g.counter[rank]);
          else strike({ i: h.weapons.indexOf(other), it: other, combo: 0 }, true);
        }
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
        if (mean) { hurt(foe.dmg * mul * (1 - OPT.dodge)); busy = Math.max(busy, 0.8 * OPT.dodge); }
        else if (rand() < OPT.dodge) busy = Math.max(busy, 0.8); // stepped out of the red circle
        else { slamHits++; hurt(foe.dmg * mul); }
      }
    }
    hp = Math.min(st.maxHp, hp + st.regen * DT);
  }
  return { win: mhp <= 0 && hp > 0, dur: t, swings, dealt: mmax - Math.max(0, mhp), taken, hpEnd: Math.max(0, hp), slams, slamHits };
}

// ---------- loot and gear ----------
const VALUE: Record<StatId, number> = { power: 1, hp: 0.35, regen: 1.5, speed: 0.2, defense: 1, dodge: 2, crit: 1.5, critDmg: 1 };
const rewardOf = (u: Unit): OrbReward => {
  if (u.kind === 'prop') return BREAKABLES[u.def].reward;
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
/** The best pair of hands for each open location (by DPS against its resists); armour by defense + bonus. */
function regear(h: Hero) {
  const all = [...h.weapons, ...h.bag].filter((x): x is Item => !!x && x.kind === 'weapon');
  h.bag = h.bag.filter((x) => x.kind !== 'weapon');
  for (const zone of Object.keys(h.kit) as ZoneId[]) {
    let bestDps = -1;
    for (const a of all) for (const b of [null, ...all]) {
      if (b === a) continue;
      const key = `${zone}|${wname(a)}|${wname(b)}`;
      let dps = dpsCache.get(key);
      if (dps === undefined) dpsCache.set(key, (dps = dummyDps(h, [a, b], zone)));
      if (dps > bestDps) { bestDps = dps; h.kit[zone] = [a, b]; }
    }
  }
  h.weapons = h.kit.forest;
  // armour: the best piece per slot by defense + bonus
  const score = (it: Item) => { const s = armorStats(it); return s.defense + (s.bonus ? s.bonus.value * VALUE[s.bonus.stat] * 2 : 0); };
  for (const it of [...h.bag]) {
    if (it.kind !== 'armor') continue;
    const slot = ARMOR[it.def].slot;
    const cur = h.equip[slot];
    if (!cur || score(it) > score(cur)) {
      h.bag.splice(h.bag.indexOf(it), 1);
      if (cur) h.bag.push(cur);
      h.equip[slot] = it;
    }
  }
}
/** Damage per second of a loadout on a big dummy with the zone's resists (mean rolls). */
function dummyDps(h: Hero, weapons: [Item | null, Item | null], zone: ZoneId) {
  const resist = MOBS[zone === 'forest' ? 'bandit_chief' : 'death'].resist;
  const def: MobDef = { ...MOBS.bandit_thug, resist, dmg: 0, rank: 'elite' };
  const test: Hero = { ...h, weapons, hp: 1e6, src: { ...h.src, debug: { hp: 1e6 } } };
  return fight(test, { def, hp: 1e7, dmg: 0 }, true, 20).dealt / 20;
}

// ---------- the bot ----------
/** Gacha pulls a kill gives on average (filled in by the pull drops, GACHA.token). */
const tokenChance = (u: Unit) => (u.kind === 'mob' ? GACHA.token[mobRank(MOBS[u.def])] : 0);

interface Snap { t: number; zone: string; power: number; maxHp: number; regen: number; defense: number; weapons: string; kills: number; deaths: number; pulls: number; win: Record<string, number> }
interface FightRec { def: string; depth: number; t: number; first: boolean; dur: number; swings: number; taken: number; maxHp: number; win: boolean }
interface RunOut { snaps: Snap[]; bossAt: Record<string, number>; bossDur: Record<string, number>; fights: FightRec[]; pulls: number[]; deaths: number }

const wname = (it: Item | null) => (it ? `${it.def}${'⁰¹²³⁴⁵'[it.rarity]}${it.lvl > 1 ? `×${it.lvl}` : ''}` : '—');

function run(seed: number): RunOut {
  rs = seed * 7919;
  const f = FACTIONS[OPT.faction];
  const h: Hero = {
    faction: OPT.faction, src: {}, pct: {}, equip: {},
    weapons: [makeItem('weapon', OPT.weapon || f.startWeapon, 0, 1), OPT.left ? makeItem('weapon', OPT.left, 0, 1) : null],
    hp: 0, bag: [], pulls: 0, pity: 0, spot: { s: sCamp, off: 0 }, kit: { forest: [null, null], cemetery: [null, null] } as Hero['kit'],
  };
  h.kit.forest = h.kit.cemetery = h.weapons;
  h.hp = stats(h).maxHp;
  const units = buildUnits();
  const out: RunOut = { snaps: [], bossAt: {}, bossDur: {}, fights: [], pulls: [], deaths: 0 };
  dpsCache.clear();
  const open = new Set<ZoneId>(['forest']);
  const camp: Spot = { s: sCamp, off: 0 };
  let t = 0;
  let kills = 0;
  let nextSnap = 0;
  // estimates are kept until the hero grows by 3% or changes gear
  let ver = 0, verPower = 0, verHp = 0, verGear = '';
  const est = new Map<string, FightOut & { rate?: number }>();
  const gearKey = () => h.weapons.map(wname).join('+') + Object.values(h.equip).map(wname).join();
  const checkVer = () => {
    const st = stats(h);
    const g = gearKey();
    if (st.power > verPower * 1.03 || st.maxHp > verHp * 1.03 || g !== verGear) { ver++; verPower = st.power; verHp = st.maxHp; verGear = g; est.clear(); }
  };
  const full = (zone: ZoneId): Hero => ({ ...h, weapons: h.kit[zone], hp: stats(h).maxHp });
  const estimate = (u: Unit) => {
    const key = `${u.def}|${u.depth.toFixed(2)}`;
    let e = est.get(key);
    if (!e) {
      const boss = !!MOBS[u.def].boss;
      e = fight(full(u.zone), foeOf(u), true, boss ? 400 : 150);
      if (boss) {
        let wins = 0;
        for (let i = 0; i < 6; i++) if (fight(full(u.zone), foeOf(u)).win) wins++;
        e.rate = wins / 6;
      }
      est.set(key, e);
    }
    return e;
  };
  const snap = () => {
    const st = stats(h);
    const win: Record<string, number> = {};
    for (const b of BOSSES) {
      let w = 0;
      for (let i = 0; i < 6; i++) if (fight(full(b.boss!.zone), foeOf(units.find((u) => u.def === b.id)!)).win) w++;
      win[b.id] = w / 6;
    }
    out.snaps.push({
      t, zone: h.spot.s > GATE.s ? 'cemetery' : 'forest', power: st.power, maxHp: st.maxHp, regen: st.regen, defense: st.defense,
      weapons: h.kit.forest.map(wname).join('+') + (open.has('cemetery') ? ' / ' + h.kit.cemetery.map(wname).join('+') : ''), kills, deaths: out.deaths, pulls: out.pulls.length, win,
    });
  };
  const walk = (to: Spot) => { t += dist(h.spot, to) / stats(h).speed; h.spot = to; };
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
  const value = (u: Unit) => {
    let v = 0;
    for (const [k, n] of Object.entries(rewardOf(u)) as [OrbKind, number][]) v += n * ORBS[k].value * VALUE[k];
    if (u.kind === 'mob') {
      const d = MOBS[u.def];
      if (d.bonus) for (const [k, n] of Object.entries(d.bonus) as [OrbKind, number][]) v += n * VALUE[k];
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
    // pick the most worthwhile reachable target
    let best: Unit | null = null, bestScore = 0, bestEst: FightOut | null = null;
    for (const u of units) {
      if (u.respawnAt > t || !open.has(u.zone)) continue;
      let dur = 0, e: (FightOut & { rate?: number }) | null = null;
      if (u.kind === 'mob') {
        e = estimate(u);
        const boss = !!MOBS[u.def].boss;
        if (boss ? (e.rate ?? 0) < OPT.bossWin : !e.win || e.taken > 0.7 * st.maxHp) continue;
        dur = e.dur;
      } else dur = Math.ceil(BREAKABLES[u.def].hits / RESIST_MULT[BREAKABLES[u.def].resist[WEAPONS[h.weapons[0]?.def ?? h.weapons[1]!.def].type] ?? 'normal']) / WEAPONS[(h.weapons[0] ?? h.weapons[1])!.def].aps;
      const score = value(u) / (dist(h.spot, u.spot) / st.speed + dur + 2);
      if (score > bestScore) { bestScore = score; best = u; bestEst = e; }
    }
    if (!best) {
      // nothing worth it: rest in the camp until something comes back
      walk(camp);
      h.hp = st.maxHp;
      const next = Math.min(...units.filter((u) => open.has(u.zone)).map((u) => u.respawnAt));
      t = Math.max(t + 5, Math.min(next, t + 30));
      continue;
    }
    const u = best;
    // a player switches to the weapons the location is weak to
    h.weapons = h.kit[u.zone];
    const boss = u.kind === 'mob' && !!MOBS[u.def].boss;
    if (u.kind === 'mob' && (boss || h.hp - bestEst!.taken < 0.25 * st.maxHp)) heal();
    walk(u.spot);
    if (u.kind === 'prop') {
      const b = BREAKABLES[u.def];
      const w = WEAPONS[(h.weapons[0] ?? h.weapons[1])!.def];
      t += Math.ceil(b.hits / RESIST_MULT[b.resist[w.type] ?? 'normal']) / w.aps;
      giveStats(h, b.reward, true);
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
      out.fights.push({ def: u.def, depth: u.depth, t, first, dur: r.dur, swings: r.swings, taken: r.taken, maxHp: st.maxHp, win: r.win });
      if (!r.win) {
        out.deaths++;
        t += 5;
        h.spot = camp;
        h.hp = stats(h).maxHp;
        continue;
      }
      h.hp = r.hpEnd;
      kills++;
      const d = MOBS[u.def];
      giveStats(h, rewardOf(u), true);
      if (d.bonus) giveStats(h, d.bonus, false);
      if (d.drop) lootItem(h, dropItem(d.drop));
      if (rand() < tokenChance(u)) { h.pulls++; out.pulls.push(t); }
      if (d.boss) {
        if (!out.bossAt[d.id]) { out.bossAt[d.id] = t; out.bossDur[d.id] = r.dur; }
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
    const i = u.n % u.charges.length;
    u.respawnAt = t + u.charges[i];
    u.n = (i + 1) % u.charges.length;
  }
  return out;
}

// ---------- weapon bench ----------
if (OPT.bench) {
  OPT.uptime = 1;
  OPT.combo = 1;
  const def: MobDef = { ...MOBS.bandit_thug, resist: {}, dmg: 0, rank: 'elite' };
  const ttk = (a: string, b: string | null, n = 20) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      rs = i + 1;
      const h: Hero = {
        faction: 'human', src: { debug: { hp: 1e6, regen: -HERO.regen } }, pct: {}, equip: {}, hp: 1e6, bag: [], pulls: 0, pity: 0, spot: { s: 0, off: 0 }, kit: {} as Hero['kit'],
        weapons: [makeItem('weapon', a, 2, 1), b ? makeItem('weapon', b, 2, 1) : null],
      };
      sum += fight(h, { def, hp: 4000, dmg: 0 }, false, 600).dur;
    }
    return (sum / n).toFixed(0).padStart(4);
  };
  console.log('== Стенд: время убийства цели 4000 HP (редкое ур.1, сила 0, без резистов), с — одно / в паре с мечом');
  for (const w of Object.keys(WEAPONS)) console.log(`${w.padEnd(13)} ${w === 'shield' ? '   —' : ttk(w, null)} / ${ttk(w, 'sword')}`);
  console.log(`axe+shield    ${ttk('axe', 'shield')}`);
  process.exit(0);
}

// ---------- report ----------
const mmss = (t: number | undefined) => (t === undefined ? '  —  ' : `${String(Math.floor(t / 60)).padStart(2)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
const pct = (a: number[], q: number) => { if (!a.length) return undefined; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const t0 = Date.now();
const runs: RunOut[] = Array.from({ length: OPT.runs }, (_, i) => run(OPT.seed + i));
const lines: string[] = [];
const say = (s = '') => lines.push(s);
say(`== Сим: ${OPT.faction}, ${OPT.weapon || FACTIONS[OPT.faction].startWeapon}${OPT.left ? '+' + OPT.left : ''}, прогонов ${OPT.runs}, до ${OPT.until / 60} мин; увороты ${OPT.dodge}, uptime ${OPT.uptime}, комбо ${OPT.combo}`);
say(`   тропа: лагерь s=${sCamp.toFixed(0)}, форт s=${sFort.toFixed(0)}, ворота s=${GATE.s.toFixed(0)}, арена s=${sArena.toFixed(0)} м`);
if (OPT.log) {
  say('\n== Минуты (прогон 1): время зона | сила HP реген защ | убийств смертей круток | оружие | шанс победы над боссами');
  for (const s of runs[0].snaps) {
    say(`${mmss(s.t)} ${s.zone.padEnd(8)} | ${String(s.power).padStart(4)} ${String(s.maxHp).padStart(5)} ${String(s.regen).padStart(3)} ${String(s.defense).padStart(3)} | ${String(s.kills).padStart(3)} ${String(s.deaths).padStart(2)} ${String(s.pulls).padStart(2)} | ${s.weapons.padEnd(18)} | ${BOSSES.map((b) => `${b.name} ${Math.round(s.win[b.id] * 100)}%`).join(' ')}`);
  }
}
say('\n== Боссы: первое убийство (медиана [p10–p90]), сколько прогонов успели, длительность того боя');
for (const b of BOSSES) {
  const at = runs.map((r) => r.bossAt[b.id]).filter((x): x is number => x !== undefined);
  const dur = runs.map((r) => r.bossDur[b.id]).filter((x): x is number => x !== undefined);
  say(`${b.name.padEnd(8)} ${mmss(pct(at, 0.5))} [${mmss(pct(at, 0.1))}–${mmss(pct(at, 0.9))}]  ${at.length}/${runs.length}  бой ${pct(dur, 0.5)?.toFixed(0) ?? '—'} с`);
}
const at = (m: number) => pct(runs.map((r) => r.pulls.filter((x) => x <= m * 60).length), 0.5);
say(`\nКрутки (медиана): 10 мин ${at(10)}, 20 мин ${at(20)}, 30 мин ${at(30)}; смертей за прогон ${pct(runs.map((r) => r.deaths), 0.5)}`);
if (OPT.mobs) {
  say('\n== Мобы: боёв | первый бой: когда, ударов, с, урон по герою % HP | все бои: ударов, с, % HP | поражений');
  const by = new Map<string, FightRec[]>();
  for (const r of runs) for (const f of r.fights) { const k = `${f.def}${f.depth ? `@${f.depth.toFixed(1)}` : ''}`; by.set(k, [...(by.get(k) ?? []), f]); }
  for (const [k, fs] of [...by].sort()) {
    const avg = (g: (f: FightRec) => number, a = fs) => a.reduce((x, f) => x + g(f), 0) / Math.max(1, a.length);
    const fst = fs.filter((f) => f.first);
    const cols = (a: FightRec[]) => `${avg((f) => f.swings, a).toFixed(1).padStart(5)} ${avg((f) => f.dur, a).toFixed(1).padStart(5)} ${(Math.round(avg((f) => (100 * f.taken) / f.maxHp, a)) + '%').padStart(5)}`;
    say(`${k.padEnd(22)} ${String(fs.length).padStart(4)} | ${mmss(avg((f) => f.t, fst))} ${cols(fst)} | ${cols(fs)} | ${fs.filter((f) => !f.win).length}`);
  }
}
say(`\n(${((Date.now() - t0) / 1000).toFixed(1)} с)`);
console.log(lines.join('\n'));
