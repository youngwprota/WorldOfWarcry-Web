import type * as THREE from 'three';
import type { MobDef } from '../config';
import type { FloatingText, FogPuffs, Particles, Shockwaves, Telegraphs } from '../fx';
import type { Mob } from '../mobs/mob';

/** What a boss kit may use from the game. */
export interface BossHost {
  readonly scene: THREE.Scene;
  readonly fx: FloatingText;
  readonly particles: Particles;
  readonly telegraphs: Telegraphs;
  readonly waves: Shockwaves;
  readonly puffs: FogPuffs;
  time(): number;
  heroPos(): THREE.Vector3;
  heroDead(): boolean;
  heroHp(): number;
  /** Living mobs, the hero's foes and the boss's minions included. */
  mobs(): readonly Mob[];
  /** `dot`: a tick of damage over time — no dodge, no counter, no crit; defense still cuts it. */
  hurtHero(raw: number, from: THREE.Vector3, src?: Mob, dot?: boolean): void;
  /** Hero run speed × `k` for this frame (the lowest call wins). */
  slowHero(k: number): void;
  /** A round obstacle for the hero and the mobs, gone after `life` s (or on `remove()`). */
  addBlocker(x: number, z: number, r: number, life: number): { remove(): void };
  /** A minion of `boss` (removed with its fight). */
  spawnMinion(boss: Mob, def: MobDef, at: THREE.Vector3): Mob;
  /** Kills the unit at once (loot and rewards as usual). */
  kill(m: Mob): void;
  /** A shout over the unit. */
  bark(m: Mob, text: string): void;
}

/**
 * One boss's own mechanics (src/bosses/<boss>.ts), one instance per boss mob. Every hook is optional.
 * The default specials (slam, cones, chasing blasts) keep running unless `ownSpecials` is set.
 */
export interface BossKit {
  ownSpecials?: boolean;
  /** Bosses never get knocked back; true lets the hero's knockback move this one. */
  knockable?: boolean;
  /** Every frame while the boss fights the hero. */
  fight?(dt: number, dHero: number): void;
  /** Damage the hero deals to the boss or one of its minions (`target`), before it lands. */
  damageTaken?(target: Mob, dmg: number, crit: boolean): number;
  /** The fight ended without a kill (hero died, boss leashed): back to the start. */
  reset?(): void;
  died?(): void;
}

export type BossKitFactory = (host: BossHost, boss: Mob) => BossKit;
