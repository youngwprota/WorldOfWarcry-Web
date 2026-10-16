// The hunter's pet: a creature that runs after the hero and bites his foes. Movement and timing only; the game
// picks the foe and deals the damage through `onBite`.
import * as THREE from 'three';
import { Creature } from './creature';
import { PET_RARITY, type PetDef } from './config';

export interface PetFoe { pos: THREE.Vector3; radius: number; hittable: boolean }

/** Without a target of the hero's the pet goes for fighting mobs this close to him, m. */
export const PET_SEEK = 7;
/** Where the pet waits beside the hero, m. */
const HEEL = 1.8;
/** Further than this from the hero it gives up the foe and comes back; further still it is put next to him. */
const LEASH = 9;
const BLINK = 18;
/** Leap (PetDef.pounce) duration, s, and arc height, m. */
const LEAP_TIME = 0.4;
const LEAP_HEIGHT = 1.1;
const v = new THREE.Vector3();

export class Pet {
  readonly ch: Creature;
  private target: PetFoe | null = null;
  private atkCd = 0.5;
  /** The hero's attack speed multiplier (stat `haste`): the pet bites faster too. */
  haste = 1;
  /** Seconds until the bite lands (−1: not biting). */
  private impact = -1;
  /** Damage multiplier of the bite in flight (the pounce's landing bite). */
  private biteMul = 1;
  private pounceCd = 0;
  /** Seconds into a leap (−1: on the ground); it flies from `leapFrom` to `leapTo`. */
  private leapT = -1;
  private leapFrom = new THREE.Vector3();
  private leapTo = new THREE.Vector3();

  /** `rarity`: the pet item's quality (bigger and harder-biting, config PET_RARITY). */
  constructor(readonly def: PetDef, readonly rarity: number, scene: THREE.Scene) {
    this.ch = new Creature(def.model, def.scale * PET_RARITY.scale[rarity]);
    scene.add(this.ch.root);
  }

  /**
   * `pick()` returns the foe the pet should go for (the hero's target, or null); `onBite(foe)` lands a bite.
   * `heroFacing` puts its resting spot behind the hero's left shoulder.
   */
  update(dt: number, hero: THREE.Vector3, heroFacing: number, pick: () => PetFoe | null, onBite: (foe: PetFoe, mul: number) => void) {
    const p = this.ch.root.position;
    this.pounceCd -= dt;
    if (this.leapT >= 0) { this.updateLeap(dt, onBite); return; }
    if (p.distanceTo(hero) > BLINK) this.place(hero, heroFacing);
    const want = pick();
    if (want !== this.target) { this.target = want; this.impact = -1; }
    const t = this.target && this.target.hittable && this.target.pos.distanceTo(hero) < LEASH ? this.target : null;
    if (!t) this.target = null;
    // resting spot: behind the hero, off to one side
    const back = heroFacing + Math.PI - 0.7;
    const goal = t ? t.pos : v.set(hero.x + Math.sin(back) * HEEL, 0, hero.z + Math.cos(back) * HEEL);
    const dx = goal.x - p.x;
    const dz = goal.z - p.z;
    const d = Math.hypot(dx, dz);
    const stop = t ? t.radius + this.def.range * 0.8 : 0.3;
    // the lion leaps at a foe in pounce range instead of running up to it
    const pc = this.def.pounce;
    if (t && pc && this.pounceCd <= 0 && d > stop + 1.5 && d < pc.range) {
      this.pounceCd = pc.cd;
      this.leapT = 0;
      this.target = t;
      this.leapFrom.copy(p);
      this.leapTo.set(t.pos.x - (dx / d) * stop, 0, t.pos.z - (dz / d) * stop);
      this.ch.facing = Math.atan2(dx, dz);
      this.ch.attack('AxeAttack', LEAP_TIME + 0.2, LEAP_TIME);
      return;
    }
    let moving = false;
    if (d > stop) {
      // runs faster the further behind it is, so it never loses the hero
      const speed = this.def.speed * (t ? 1 : Math.min(1.6, 0.6 + d / 4));
      const step = Math.min(d - stop, speed * dt);
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
      moving = step > 0.002;
      this.ch.walkRate = speed / this.ch.stride;
    }
    // turn by the shortest arc: the hero's facing is not wrapped (it can be many turns off atan2's −π..π)
    const yaw = t || d > 0.4 ? Math.atan2(dx, dz) : heroFacing;
    const diff = Math.atan2(Math.sin(yaw - this.ch.facing), Math.cos(yaw - this.ch.facing));
    this.ch.facing += diff * Math.min(1, dt * (t || moving ? 12 : 4));
    this.atkCd -= dt;
    if (t && d < t.radius + this.def.range && this.atkCd <= 0 && this.impact < 0) {
      const period = 1 / (this.def.aps * this.haste);
      const impactAt = Math.min(0.35, period * 0.45);
      this.ch.attack('AxeAttack', period, impactAt);
      this.impact = impactAt;
      this.biteMul = 1;
      this.atkCd = period;
    }
    if (this.impact >= 0) {
      this.impact -= dt;
      if (this.impact < 0 && t && t.hittable) onBite(t, this.biteMul);
    }
    this.ch.update(dt, moving);
  }

  /** In the air (PetDef.pounce): an arc onto the foe, the landing bite deals × pounce.mult. */
  private updateLeap(dt: number, onBite: (foe: PetFoe, mul: number) => void) {
    this.leapT += dt;
    const k = Math.min(1, this.leapT / LEAP_TIME);
    this.ch.root.position.lerpVectors(this.leapFrom, this.leapTo, k);
    this.ch.root.position.y = Math.sin(k * Math.PI) * LEAP_HEIGHT;
    if (k >= 1) {
      this.leapT = -1;
      this.ch.root.position.y = 0;
      const t = this.target;
      if (t && t.hittable) onBite(t, this.def.pounce!.mult);
      this.atkCd = 1 / (this.def.aps * this.haste);
    }
    this.ch.update(dt, false);
  }

  /** Puts the pet right behind the hero (spawn, respawn in the camp, lost too far behind). */
  place(hero: THREE.Vector3, heroFacing: number) {
    this.ch.root.position.set(hero.x - Math.sin(heroFacing) * HEEL, 0, hero.z - Math.cos(heroFacing) * HEEL);
    this.ch.facing = heroFacing;
    this.target = null;
    this.impact = -1;
    this.leapT = -1;
  }

  dispose() {
    this.ch.root.removeFromParent();
    this.ch.mixer.stopAllAction();
  }
}
