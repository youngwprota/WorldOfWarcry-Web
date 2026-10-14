// Combat and hero-stat formulas without three/DOM: the game and the balance simulator (tools/sim.ts) share them.
import { DUAL, HERO, RESIST_MULT, WEAPONS, type DamageType, type FactionId, type ResistTier } from './config';
import { armorDefense, weaponDamage, type ArmorSlot, type BonusStat, type Item } from './items';

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

/** Totals from equipped armour and jewellery: defense only. */
export function gearOf(equip: HeroBuild['equip']) {
  let defense = 0;
  for (const it of Object.values(equip)) if (it) defense += armorDefense(it);
  return { defense };
}

/** Final hero stats with gear and racials. */
export function heroStats(b: HeroBuild) {
  const g = gearOf(b.equip);
  const human = b.faction === 'human';
  const maxHp = Math.round(b.stats.hp * (human ? 1.1 : 1));
  const speedStat = Math.round(Math.min(HERO.speedCap, b.stats.speed) * (b.faction === 'orc' ? 1.05 : 1));
  return {
    power: b.stats.power,
    defense: g.defense,
    maxHp,
    shieldMax: human ? Math.round(maxHp * HUMAN_SHIELD) : 0,
    regen: Math.round(Math.min(HERO.regenCap, b.stats.regen * (human ? 1.1 : 1))),
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

/** Hand multiplier of one weapon. */
export function handMulOf(weapons: HeroBuild['weapons'], it: Item) {
  void it;
  return isDual(weapons) ? DUAL.mul : 1;
}

/** Plain-swing DPS of both hands together; `resist` applies each hand's own damage type. */
export function heroDps(weapons: HeroBuild['weapons'], pmult: number, resist?: Partial<Record<DamageType, ResistTier>>) {
  let dps = 0;
  for (const it of weapons) {
    if (!it) continue;
    const w = WEAPONS[it.def];
    const r = resist ? RESIST_MULT[resist[w.type] ?? 'normal'] : 1;
    dps += weaponDamage(it) * w.aps * r * handMulOf(weapons, it);
  }
  return dps * pmult;
}

/** GDD 10.5: armour reduction = defense / (defense + 100); returns the share that gets through. */
export const armorMul = (defense: number) => 100 / (100 + defense);
