import type { MobDef } from '../config';
import type { BossKitFactory } from './kit';
import { iceQueen, iceQueenMini } from './iceQueen';
import { SISTER, sisters, sistersMini } from './sisters';
import { stormShaman, stormShamanMini } from './stormShaman';
import { murlocKing, murlocKingMini } from './murlocKing';

/** Boss and mini-boss kits by mob id (MobDef.id). */
export const BOSS_KITS: Record<string, BossKitFactory> = {
  elf_queen: iceQueen,
  elf_priestess: sisters,
  orc_shaman: stormShaman,
  murloc_king: murlocKing,
  frost_warden: iceQueenMini,
  grove_dryad: sistersMini,
  tauren_warlord: stormShamanMini,
  murloc_tidehunter: murlocKingMini,
};

/** Second boss a kit spawns into the fight (MobDef.id of the main one → its partner); the debug balance counts both. */
export const BOSS_PARTNERS: Record<string, MobDef> = { elf_priestess: SISTER };
