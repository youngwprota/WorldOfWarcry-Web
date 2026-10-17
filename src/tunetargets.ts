// Balance targets for the tuner (src/tuner.ts, `npm run tune`, balance.html → «Цели»): what the bot of an average player
// should see. Defaults only: the page keeps its own copy (localStorage), the CLI takes `--targets file.json`.
import type { ZoneId } from './config';

export type FightRank = 'normal' | 'elite' | 'mini';
export interface BossTarget {
  /** Minute of the first kill, counted from the start of the game. */
  at: number;
  /** Length of that fight, s. */
  fight: number;
  /** Share of the hero's might from gacha items at that kill (0…1). */
  gacha: number;
}
export interface TuneTargets {
  /** Allowed relative miss (0.1 = ±10%); the gacha share is off by at most this many points × 100. */
  tol: number;
  /** By boss id (MOBS key). */
  bosses: Record<string, BossTarget>;
  /** Mean fight length, s, by location and rank (a pack is one fight). */
  fights: Partial<Record<ZoneId, Partial<Record<FightRank, number>>>>;
}

const fights = (normal: number, elite: number, mini: number) => ({ normal, elite, mini });
/** The first pass (assumption): a boss each 15 min after the forest, 1.5–2.5 min fights, the gacha grows to a third. */
export const DEFAULT_TARGETS: TuneTargets = {
  tol: 0.1,
  bosses: {
    bandit_chief: { at: 10, fight: 90, gacha: 0 },
    death: { at: 30, fight: 100, gacha: 0.1 },
    elf_queen: { at: 45, fight: 110, gacha: 0.15 },
    orc_shaman: { at: 60, fight: 120, gacha: 0.2 },
    elf_priestess: { at: 75, fight: 130, gacha: 0.25 },
    murloc_king: { at: 90, fight: 140, gacha: 0.3 },
    sand_boar: { at: 105, fight: 150, gacha: 0.33 },
  },
  fights: {
    forest: fights(8, 20, 30), cemetery: fights(8, 20, 30), peaks: fights(9, 22, 32), hills: fights(9, 22, 32),
    grove: fights(10, 24, 35), swamp: fights(10, 24, 35), dunes: fights(10, 25, 36),
  },
};
