// Combat and hero-stat formulas without three/DOM: the game and the balance simulator (tools/sim.ts) share them.
import { DUAL, HERO, RESIST_MULT, SWORD_PAIRS, WEAPONS, type DamageType, type FactionId, type ResistTier } from './config';
import { armorStats, weaponDamage, type ArmorSlot, type BonusStat, type Item } from './items';
import type { Pair } from './offhand';

/** What the hero is made of: base stats, armour and both hands (a slice of SaveData). */
export interface HeroBuild {
  faction: FactionId;
  stats: Record<BonusStat, number>;
  equip: Partial<Record<ArmorSlot, Item>>;
  weapons: [Item | null, Item | null];
}

/** Orc racial: up to +30% damage as HP drops. */
export const BLOODLUST = 0.3;
/** Human racial: a shield of this share of max HP, back after SHIELD_DELAY s without damage. */
export const HUMAN_SHIELD = 0.15;
export const SHIELD_DELAY = 6;

/** Totals from equipped armour and jewellery. */
export function gearOf(equip: HeroBuild['equip']) {
  const g = { defense: 0, hp: 0, regen: 0, power: 0, speed: 0 } as { defense: number } & Record<BonusStat, number>;
  for (const it of Object.values(equip)) {
    if (!it) continue;
    const s = armorStats(it);
    g.defense += s.defense;
    if (s.bonus) g[s.bonus.stat] += s.bonus.value;
  }
  return g;
}

/** Final hero stats with gear and racials. */
export function heroStats(b: HeroBuild) {
  const g = gearOf(b.equip);
  const human = b.faction === 'human';
  const maxHp = Math.round((b.stats.hp + g.hp) * (human ? 1.1 : 1));
  const speedStat = Math.round(Math.min(HERO.speedCap, b.stats.speed + g.speed) * (b.faction === 'orc' ? 1.05 : 1));
  return {
    power: b.stats.power + g.power,
    defense: g.defense,
    maxHp,
    shieldMax: human ? Math.round(maxHp * HUMAN_SHIELD) : 0,
    regen: Math.round(Math.min(HERO.regenCap, (b.stats.regen + g.regen) * (human ? 1.1 : 1))),
    speedStat,
    /** Running speed, m/s (100 points = 4 m/s). */
    speed: (speedStat / HERO.speedPerMs) * HERO.speedMul,
  };
}

export function powerMult(faction: FactionId, power: number, hpFrac: number) {
  let m = 1 + power / 100;
  if (faction === 'orc') m *= 1.1 * (1 + BLOODLUST * (1 - hpFrac));
  return m;
}

const isDual = (w: HeroBuild['weapons']) => !!w[0] && !!w[1];

/** Hand multiplier of one weapon: the hidden blade carries the folded-in sword at full damage. */
export function handMulOf(weapons: HeroBuild['weapons'], pair: Pair | null, it: Item) {
  if (pair?.kind === 'hidden_blade' && it.def !== 'sword') return 1;
  // beside a shield the weapon is the only one that swings
  const other = weapons[weapons[0] === it ? 1 : 0];
  return other && WEAPONS[other.def].guard && !WEAPONS[it.def].guard ? 1 : isDual(weapons) ? DUAL.mul : 1;
}

/** Plain-swing DPS of both hands together; `resist` applies each hand's own damage type. */
export function heroDps(weapons: HeroBuild['weapons'], pair: Pair | null, pmult: number, resist?: Partial<Record<DamageType, ResistTier>>) {
  let dps = 0;
  const blade = pair?.kind === 'hidden_blade';
  for (const it of weapons) {
    if (!it) continue;
    const w = WEAPONS[it.def];
    if (w.guard && isDual(weapons)) continue;
    if (blade && it.def === 'sword') continue;
    const r = resist ? RESIST_MULT[resist[w.type] ?? 'normal'] : 1;
    const k = blade ? SWORD_PAIRS.hidden_blade.dmg * SWORD_PAIRS.hidden_blade.aps : 1;
    dps += weaponDamage(it) * w.aps * r * k * handMulOf(weapons, pair, it);
  }
  return dps * pmult;
}

/** Incoming damage multiplier from the shields in hand. */
export function guardMul(weapons: HeroBuild['weapons']) {
  let k = 1;
  for (const it of weapons) if (it && WEAPONS[it.def].guard) k *= 1 - WEAPONS[it.def].guard!.reduce;
  return k;
}

/** GDD 10.5: armour reduction = defense / (defense + 100); returns the share that gets through. */
export const armorMul = (defense: number) => 100 / (100 + defense);
