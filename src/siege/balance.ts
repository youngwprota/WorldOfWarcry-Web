import { WEAPONS, attackMul } from '../config';
import { armorMul, guardMul } from '../balance';
import type { Game } from '../game';
import type { Item } from '../items';
import { KIND_APS, KIND_HITS } from './roster';
import type { BalanceIn, MiniKind, SiegeKind } from './types';

/**
 * hitRoll: lowest damage roll (k hits always kill); ttd: seconds `horde` mobs need to kill the hero; miniHits: a mini's
 * HP in hits; miniDmg: a mini's damage × a melee mob's; miniWeight: kills a mini is worth in the kill share.
 */
export const SIEGE_BAL = { hitRoll: 0.9, ttd: 40, horde: 6, miniHits: 30, miniDmg: 1.6, miniWeight: 5, regenPerKill: 0.005, regenBonusMax: 1 };

/** A mini's damage is this many times the warrior's. */
const MELEE_REF: SiegeKind = 'warrior';

function handHit(g: Game, it: Item | null) {
  if (!it) return 0;
  const w = WEAPONS[it.def];
  if (w.guard || w.orb) return 0;
  return w.pet ? g.itemDamage(it) : g.itemDamage(it) * attackMul(w);
}

export function balanceIn(g: Game): BalanceIn {
  const s = g.stats;
  const weapons = g.save.weapons;
  return {
    hit: handHit(g, weapons[0]) + handHit(g, weapons[1]),
    maxHp: g.maxHp,
    regen: g.regen,
    eff: armorMul(s.defense) * guardMul(weapons) * (1 - s.dodge),
  };
}

/** Damage per blow that makes `horde` mobs of `aps` kill the hero in `ttd` s. */
function blow(b: BalanceIn, aps: number) {
  const perMobDps = (b.maxHp / SIEGE_BAL.ttd + b.regen) / (SIEGE_BAL.horde * Math.max(0.05, b.eff));
  return perMobDps / aps;
}

export function mobStats(kind: SiegeKind, b: BalanceIn): { hp: number; dmg: number } {
  return { hp: Math.max(1, Math.round(KIND_HITS[kind] * b.hit * SIEGE_BAL.hitRoll)), dmg: blow(b, KIND_APS[kind]) };
}

export function miniStats(_kind: MiniKind, b: BalanceIn): { hp: number; dmg: number } {
  return { hp: Math.max(1, Math.round(SIEGE_BAL.miniHits * b.hit)), dmg: SIEGE_BAL.miniDmg * blow(b, KIND_APS[MELEE_REF]) };
}
