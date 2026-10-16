// Combat and hero-stat formulas without three/DOM: the game and the balance simulator (tools/sim.ts) share them.
import {
  DEFENSE_CAP, HERO, RESIST_MULT, STAT_CURVE, STAT_SOURCES, WEAPONS,
  type DamageType, type FactionId, type PctStat, type ResistTier, type SavedSource, type StatId, type StatSource,
} from './config';
import { armorStats, weaponDamage, type ArmorSlot, type Item } from './items';

export type StatPoints = Partial<Record<StatId, number>>;
export type PctPoints = Partial<Record<PctStat, number>>;

/** What the hero is made of: stat points by source, armour and both hands (a slice of SaveData). */
export interface HeroBuild {
  faction: FactionId;
  /** Flat stat points by source. */
  src: Partial<Record<SavedSource, StatPoints>>;
  /** Percent bonuses by source (+1 = +1%), hp / regen / power only. */
  pct: Partial<Record<SavedSource, PctPoints>>;
  equip: Partial<Record<ArmorSlot, Item>>;
  weapons: [Item | null, Item | null];
}

/** A new hero's points (source `base`). */
export const BASE_STATS: Record<StatId, number> = {
  power: HERO.power, hp: HERO.hp, regen: HERO.regen, speed: HERO.speed, defense: 0, dodge: 0, crit: 0, critDmg: 0,
};

/** One stat taken apart, as the stat window shows it. */
export interface StatBreakdown {
  /** Flat parts by source in STAT_SOURCES order; the base is always there, other zero parts are left out. */
  flat: [StatSource, number][];
  sum: number;
  /** Percent parts by source (+2 = +2%). */
  pct: [StatSource, number][];
  /** 1 + sum of the percents / 100. */
  mult: number;
  /** sum × mult. */
  value: number;
}

/** Stat `k`: flat parts summed, then × (1 + percents / 100). `g`: gear totals (gearOf) when already known. */
export function statBreakdown(b: HeroBuild, k: StatId, g = gearOf(b.equip)): StatBreakdown {
  const flat: [StatSource, number][] = [];
  const pct: [StatSource, number][] = [];
  for (const s of STAT_SOURCES) {
    const v = s === 'base' ? BASE_STATS[k] : s === 'gear' ? g[k] : s === 'weapon' ? 0 : b.src[s]?.[k] ?? 0;
    if (v || s === 'base') flat.push([s, v]);
    const p = s === 'base' || s === 'gear' || s === 'weapon' ? 0 : (b.pct[s] as Partial<Record<StatId, number>> | undefined)?.[k] ?? 0;
    if (p) pct.push([s, p]);
  }
  const sum = flat.reduce((a, [, v]) => a + v, 0);
  const mult = 1 + pct.reduce((a, [, v]) => a + v, 0) / 100;
  return { flat, sum, pct, mult, value: sum * mult };
}

/** Adds `n` points of stat `k` from `source` (orbs: enemy, micro-boss bonus: mini). */
export function addStat(b: Pick<HeroBuild, 'src'>, source: SavedSource, k: StatId, n: number) {
  const pts = (b.src[source] ??= {});
  pts[k] = (pts[k] ?? 0) + n;
}
export function addPct(b: Pick<HeroBuild, 'pct'>, source: SavedSource, k: PctStat, n: number) {
  const pts = (b.pct[source] ??= {});
  pts[k] = (pts[k] ?? 0) + n;
}

/** Diminishing returns of `p` points (STAT_CURVE): `base + max · p / (p + k)`. */
export function curve(c: { base: number; max: number; k: number }, p: number) {
  return c.base + (p > 0 ? (c.max * p) / (p + c.k) : 0);
}
export const dodgeChance = (p = 0) => curve(STAT_CURVE.dodge, p);
export const critChance = (p = 0) => curve(STAT_CURVE.crit, p);
export const critMul = (p = 0) => curve(STAT_CURVE.critDmg, p);
/** Average damage multiplier from crits (DPS, the simulator's quick estimate). */
export const critAvg = (crit = 0, critDmg = 0) => 1 + critChance(crit) * (critMul(critDmg) - 1);
/** Run speed, m/s: 100 points = HERO.baseSpeed, the points above it on the speed curve. */
export const runSpeed = (points: number) => HERO.baseSpeed * curve(STAT_CURVE.speed, points - HERO.speed);

/** Totals from equipped armour and jewellery. */
export function gearOf(equip: HeroBuild['equip']) {
  const g = { defense: 0, hp: 0, regen: 0, power: 0, speed: 0, dodge: 0, crit: 0, critDmg: 0 } as Record<StatId, number>;
  for (const it of Object.values(equip)) {
    if (!it) continue;
    const s = armorStats(it);
    g.defense += s.defense;
    if (s.bonus) g[s.bonus.stat] += s.bonus.value;
  }
  return g;
}

/**
 * Final hero stats (statBreakdown of each); the curve stats also as their effect (chances, multipliers, m/s).
 * Damage: `power` is added to the weapon's base, `powerMul` multiplies the two (weaponDamage).
 */
export function heroStats(b: HeroBuild) {
  const g = gearOf(b.equip);
  const p = (k: StatId) => statBreakdown(b, k, g).sum;
  const power = statBreakdown(b, 'power', g);
  const speedStat = p('speed');
  const orb = orbMul(b.weapons);
  return {
    power: power.sum,
    powerMul: power.mult * orb.power,
    defense: p('defense') * orb.defense,
    maxHp: Math.round(statBreakdown(b, 'hp', g).value),
    /** HP per second (percents may make it fractional). */
    regen: statBreakdown(b, 'regen', g).value * orb.regen,
    speedStat,
    /** Running speed, m/s. */
    speed: runSpeed(speedStat) * orb.speed,
    dodgePts: p('dodge'),
    critPts: p('crit'),
    critDmgPts: p('critDmg'),
    dodge: dodgeChance(p('dodge')),
    crit: critChance(p('crit')),
    critMul: critMul(p('critDmg')),
  };
}

/** Passive multipliers of the equipped mage orb (1 without one). */
export function orbMul(weapons: HeroBuild['weapons']) {
  const o = weapons[1] && WEAPONS[weapons[1].def].orb;
  return { regen: 1 + (o?.regen ?? 0), power: 1 + (o?.power ?? 0), speed: 1 + (o?.speed ?? 0), defense: 1 + (o?.defense ?? 0) };
}

/**
 * Plain-swing DPS of the swinging weapons (a shield never swings beside a weapon, an orb never swings); `resist`
 * applies each one's damage type.
 */
export function heroDps(weapons: HeroBuild['weapons'], power: number, powerMul: number, crit: number, resist?: Partial<Record<DamageType, ResistTier>>) {
  let dps = 0;
  for (const it of weapons) {
    if (!it) continue;
    const w = WEAPONS[it.def];
    if (w.orb || (w.guard && weapons.some((x) => x && !WEAPONS[x.def].guard))) continue;
    const r = resist ? RESIST_MULT[resist[w.type] ?? 'normal'] : 1;
    dps += weaponDamage(it, power, powerMul) * w.aps * r;
  }
  return dps * crit;
}

/** Incoming damage multiplier from the shields in hand. */
export function guardMul(weapons: HeroBuild['weapons']) {
  let k = 1;
  for (const it of weapons) if (it && WEAPONS[it.def].guard) k *= 1 - WEAPONS[it.def].guard!.reduce;
  return k;
}

/** GDD 10.5: armour reduction = defense / (defense + 100), at most DEFENSE_CAP; returns the share that gets through. */
export const armorMul = (defense: number) => Math.max(1 - DEFENSE_CAP, 100 / (100 + Math.max(0, defense)));
