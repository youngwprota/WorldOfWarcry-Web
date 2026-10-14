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

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Tooltip line: what a sword in the other hand adds to this weapon (null: no pair bonus). */
export function pairText(def: string): string | null {
  const P = SWORD_PAIRS;
  switch (def) {
    case 'sword': return 'Меч в паре с любым другим оружием даёт бонус пары — смотри подсказку того оружия.';
    case 'dagger': return `Каждое попадание мечом ускоряет кинжалы на <b>+${pct(P.dagger.aps)}</b>, до <b>+${pct(P.dagger.max)}</b>.`;
    case 'reaper': return `Если вокруг больше <b>${P.reaper.limit}</b> обычных врагов, удар мечом сразу убивает лишних (раз в ${P.reaper.cd} с).`;
    case 'axe': return `Руки бьют вместе, меч дополнительно отрывает <b>${pct(P.axe.pct)}</b> текущего HP врага (элиткам и боссам — ${pct(P.axe.boss)}).`;
    case 'hammer': return `Молот перестаёт отбрасывать врагов и бьёт сильнее к центру удара — до <b>+${pct(P.hammer.center)}</b>.`;
    case 'shield': return `Попадание мечом с шансом <b>${pct(P.shield.chance)}</b> заставляет врага сразу ударить — и нарваться на контратаку.`;
    default: return null;
  }
}
