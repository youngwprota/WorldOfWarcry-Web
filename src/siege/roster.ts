import { MOBS, type FactionId, type MobDef } from '../config';
import type { MiniKind, SiegeKind } from './types';

/** Siege mobs run 5-10% faster than their body table says (rolled per spawn). */
export const SPEED_MIN = 1.05;
export const SPEED_MAX = 1.1;

/** Player hits a mob of the kind takes (siege/balance.ts mobStats). */
export const KIND_HITS: Record<SiegeKind, 3 | 4 | 5> = {
  bandit: 3, elf_rogue: 3, warrior: 4, archer: 4, elf_blade: 4, elf_archer: 4, heavy: 5,
};

/** Blow rate per kind (balance.ts divides the per-mob DPS by it); also the def's own `aps`. */
export const KIND_APS: Record<SiegeKind, number> = {
  bandit: 0.7, warrior: 0.8, archer: 0.7, heavy: 0.6, elf_blade: 0.8, elf_rogue: 0.9, elf_archer: 0.7,
};

const both = (model: string, weapon: string): Record<FactionId, [string, string]> => ({ human: [model, weapon], orc: [model, weapon] });

/** Everything but id/name/model/anim/hp/dmg: stats are given, resists neutral, no loot, no respawn. */
interface Body {
  name: string; model: MobDef['model']; anim: MobDef['anim']; range: number; speed: number; aggro: number; scale: number;
  shot?: MobDef['shot']; behavior?: MobDef['behavior'];
}
const BODY: Record<SiegeKind, Body> = {
  bandit: { name: 'Разбойник', model: MOBS.bandit_thug.model, anim: 'SwordAttack', range: 1.5, speed: 3.0, aggro: 9, scale: 1 },
  warrior: { name: 'Воин', model: MOBS.bandit_fighter.model, anim: 'SwordAttack', range: 1.6, speed: 3.4, aggro: 9, scale: 1.08 },
  heavy: { name: 'Латник', model: MOBS.bandit_hammerer.model, anim: 'SwordAttack', range: 1.8, speed: 3.0, aggro: 10, scale: 1.3 },
  archer: {
    name: 'Лучник', anim: 'SwordAttack', range: 9, speed: 3.2, aggro: 11, scale: 1,
    model: { human: ['orc_archer', 'bow_orc_archer'], orc: ['human_archer', 'bow_human_archer'] },
    shot: { speed: 24, arrow: { human: 'arrow_orc_archer', orc: 'arrow_human_archer' } }, behavior: { combat: 'kite' },
  },
  elf_blade: { name: 'Эльф-клинок', model: both('elf_warrior', 'sword_elf_warrior'), anim: 'SwordAttack', range: 1.7, speed: 3.4, aggro: 9, scale: 1.1 },
  elf_rogue: { name: 'Эльф-разбойник', model: both('elf_assassin', 'dagger'), anim: 'SwordAttack', range: 1.5, speed: 3.6, aggro: 9, scale: 1 },
  elf_archer: {
    name: 'Эльф-лучник', anim: 'SwordAttack', range: 9, speed: 3.2, aggro: 11, scale: 1.15,
    model: both('elf_assassin', 'bow_human_archer'), shot: MOBS.elf_archer.shot, behavior: { combat: 'kite' },
  },
};

/** `speedMul`: the per-mob run speed roll (SPEED_MIN..SPEED_MAX), kept out of the shared BODY table. */
export function siegeDef(kind: SiegeKind, hp: number, dmg: number, speedMul = 1): MobDef {
  const b = BODY[kind];
  return {
    id: `siege_${kind}`, name: b.name, model: b.model, anim: b.anim, hp, dmg, aps: KIND_APS[kind], range: b.range, speed: b.speed * speedMul,
    aggro: b.aggro, scale: b.scale, resist: {}, regen: 0, reward: {}, respawn: 0, shot: b.shot, behavior: b.behavior,
  };
}

export function miniDef(kind: MiniKind, hp: number, dmg: number, speedMul = 1): MobDef {
  // id stays 'frost_warden': BOSS_KITS is keyed by it (the ice kit)
  if (kind === 'frost') {
    return { ...MOBS.frost_warden, speed: MOBS.frost_warden.speed * speedMul, resist: {}, hp, dmg, regen: 0, aggro: 40, reward: {}, bonus: undefined, drop: undefined, respawn: 0 };
  }
  return {
    id: 'siege_flame', name: 'Пламенный страж', rank: 'mini', model: MOBS.dune_nomad.model, anim: 'SwordAttack', hp, dmg, aps: 0.7, range: 2.1,
    speed: 3.2 * speedMul, aggro: 40, scale: 1.5, resist: {}, regen: 0, reward: {}, respawn: 0,
    aura: { radius: 4.5, dmg: 0.35, color: 0xff7a2a },
  };
}
