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

/** Plain mobs to cut down beyond the reaper limit: the weakest first. */
export function excess<T extends { hp: number }>(crowd: T[], limit: number): T[] {
  if (crowd.length <= limit) return [];
  return crowd.sort((x, y) => x.hp - y.hp).slice(0, crowd.length - limit);
}

/** Nagamaki's 4th blow. */
export type NagaSpecial = 'fall' | 'launch' | 'dash';
export const NAGA_SPECIALS: NagaSpecial[] = ['fall', 'launch', 'dash'];
