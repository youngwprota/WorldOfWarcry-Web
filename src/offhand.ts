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

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Tooltip line: what a sword in the other hand adds to this weapon (null: no pair bonus). */
export function pairText(def: string): string | null {
  const P = SWORD_PAIRS;
  switch (def) {
    case 'sword': return 'Меч в паре с любым другим оружием даёт бонус пары — смотри подсказку того оружия.';
    case 'dagger': return `Каждое попадание мечом ускоряет кинжалы на <b>+${pct(P.dagger.aps)}</b>, до <b>+${pct(P.dagger.max)}</b>.`;
    case 'reaper': return `Если вокруг больше <b>${P.reaper.limit}</b> обычных врагов, удар мечом сразу убивает лишних (раз в ${P.reaper.cd} с).`;
    case 'scythe': return `Попадание косой с шансом <b>${pct(P.scythe.chance)}</b> запускает меч кружить вокруг врага; меч может перескочить на соседа.`;
    case 'axe': return `Руки бьют вместе, меч дополнительно отрывает <b>${pct(P.axe.pct)}</b> текущего хп врага (элиткам и боссам — ${pct(P.axe.boss)}).`;
    case 'hammer': return `Меч становится серпом. Молот не отбрасывает и бьёт сильнее к центру; серп может призвать товарища с серпом или молотом на ${P.hammer.time} с.`;
    case 'shield': return `Попадание мечом с шансом <b>${pct(P.shield.chance)}</b> заставляет врага сразу ударить — и нарваться на контратаку.`;
    case 'nagamaki': return 'После укола — четвёртый удар: падающий меч, подброс врагов или рывок сквозь толпу.';
    case 'pan': return `Меч становится кухонным ножом: враги в ${P.pan.radius} м в ужасе разбегаются. Урон ×${P.pan.dmg}, ящики не бьются.`;
    case 'hidden_blade': return `Меч бьёт вместе с клинком: урон <b>×${P.hidden_blade.dmg}</b>, скорость ×${P.hidden_blade.aps}.`;
    default: return null;
  }
}
