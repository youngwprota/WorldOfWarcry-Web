// The hunter's pet: a creature that runs after the hero and bites his foes. Movement and timing only; the game
// picks the foe and deals the damage through `onBite`.
import * as THREE from 'three';
import { Creature } from './creature';
import type { PetDef } from './config';

export interface PetFoe { pos: THREE.Vector3; radius: number; hittable: boolean }

/** Without a target of the hero's the pet goes for fighting mobs this close to him, m. */
export const PET_SEEK = 7;
/** Where the pet waits beside the hero, m. */
const HEEL = 1.8;
/** Further than this from the hero it gives up the foe and comes back; further still it is put next to him. */
const LEASH = 9;
const BLINK = 18;
const v = new THREE.Vector3();

export class Pet {
  readonly ch: Creature;
  private target: PetFoe | null = null;
  private atkCd = 0.5;
  /** Seconds until the bite lands (−1: not biting). */
  private impact = -1;

  constructor(readonly def: PetDef, scene: THREE.Scene) {
    this.ch = new Creature(def.model, def.scale);
    scene.add(this.ch.root);
  }

  /**
   * `pick()` returns the foe the pet should go for (the hero's target, or null); `onBite(foe)` lands a bite.
   * `heroFacing` puts its resting spot behind the hero's left shoulder.
   */
  update(dt: number, hero: THREE.Vector3, heroFacing: number, pick: () => PetFoe | null, onBite: (foe: PetFoe) => void) {
    const p = this.ch.root.position;
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
      const period = 1 / this.def.aps;
      const impactAt = Math.min(0.35, period * 0.45);
      this.ch.attack('AxeAttack', period, impactAt);
      this.impact = impactAt;
      this.atkCd = period;
    }
    if (this.impact >= 0) {
      this.impact -= dt;
      if (this.impact < 0 && t && t.hittable) onBite(t);
    }
    this.ch.update(dt, moving);
  }

  /** Puts the pet right behind the hero (spawn, respawn in the camp, lost too far behind). */
  place(hero: THREE.Vector3, heroFacing: number) {
    this.ch.root.position.set(hero.x - Math.sin(heroFacing) * HEEL, 0, hero.z - Math.cos(heroFacing) * HEEL);
    this.ch.facing = heroFacing;
    this.target = null;
    this.impact = -1;
  }

  dispose() {
    this.ch.root.removeFromParent();
    this.ch.mixer.stopAllAction();
  }
}
