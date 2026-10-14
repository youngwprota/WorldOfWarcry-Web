// Sword pairs: a sword in one hand and another weapon in the other give that weapon's pair bonus (SWORD_PAIRS).
import { SWORD_PAIRS, type SwordPair } from './config';

export interface Pair {
  kind: SwordPair;
  /** Which hand holds the sword (save.weapons index). */
  sword: 0 | 1;
}

/** The pair of the two equipped weapon defs, or null (no sword, two swords, or no bonus for that weapon). */
export function swordPair(a: string | undefined, b: string | undefined): Pair | null {
  if (a === 'sword' && b && b !== 'sword' && b in SWORD_PAIRS) return { kind: b as SwordPair, sword: 0 };
  if (b === 'sword' && a && a !== 'sword' && a in SWORD_PAIRS) return { kind: a as SwordPair, sword: 1 };
  return null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Tooltip line: what a sword in the other hand adds to this weapon (null: no pair bonus). */
export function pairText(def: string): string | null {
  const P = SWORD_PAIRS;
  switch (def) {
    case 'sword': return 'Меч в паре с топором или молотом даёт бонус пары — смотри подсказку того оружия.';
    case 'axe': return `Удар мечом дополнительно отрывает <b>${pct(P.axe.pct)}</b> текущего HP врага (элиткам и боссам — ${pct(P.axe.boss)}).`;
    case 'hammer': return `Молот перестаёт отбрасывать врагов и бьёт сильнее к центру удара — до <b>+${pct(P.hammer.center)}</b>.`;
    default: return null;
  }
}
