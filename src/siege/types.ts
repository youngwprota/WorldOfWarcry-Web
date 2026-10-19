import type { Item } from '../items';

export type SiegeKind = 'bandit' | 'warrior' | 'archer' | 'heavy' | 'elf_blade' | 'elf_rogue' | 'elf_archer';
export type MiniKind = 'frost' | 'flame';
export type SiegePhase = 'forest' | 'gate' | 'yard' | 'done';
export interface SiegeSpot { x: number; z: number }
/** A spawn socket of the yard; (dx, dz): unit vector into the yard. */
export interface SiegeDoor extends SiegeSpot { id: string; dx: number; dz: number }
/** `trigger`: an ambush, spawned once the hero's z drops below it. */
export interface SiegePack { kinds: SiegeKind[]; at: SiegeSpot; formation: 'ring' | 'line'; trigger?: number }
/** `pct` 0..1: (kills + minis × miniWeight) / (maxKills + maxMinis × miniWeight). */
export interface SiegeResult { completed: boolean; kills: number; minis: number; maxKills: number; maxMinis: number; pct: number; time: number }
export interface SiegeReward { pulls: number; items: Item[]; rarity: number }
/** `hit`: one player hit (all swinging hands + the pet bite); `eff`: share of a mob blow that gets through (armour, shields, dodge). */
export interface BalanceIn { hit: number; maxHp: number; regen: number; eff: number }
export interface DirectorEvents {
  kill(total: number, chain: number): void;
  mini(n: number, of: number): void;
  phase(p: SiegePhase): void;
  timer(secLeft: number | null): void;
  announce(text: string, kind: 'mini' | 'wave' | 'gate'): void;
  done(completed: boolean): void;
}
export const SIEGE_GATE_ID = 'castle';
