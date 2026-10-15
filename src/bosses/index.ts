import type { BossKitFactory } from './kit';
import { iceQueen, iceQueenMini } from './iceQueen';
import { sisters, sistersMini } from './sisters';
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
