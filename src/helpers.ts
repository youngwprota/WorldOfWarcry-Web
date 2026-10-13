// Hammer + sword pair: little helpers with a sickle or a hammer who run with the hero for a while and hit the
// nearest mobs. Movement and timing only; the game deals the damage through `onHit`.
import * as THREE from 'three';
import { Character } from './character';

export type HelperKind = 'sickle' | 'hammer';

interface Foe { pos: THREE.Vector3; radius: number; hittable: boolean }

export interface Helper {
  ch: Character;
  kind: HelperKind;
  t: number;
  life: number;
  atkCd: number;
  /** Seconds until the swing lands (−1: not swinging). */
  impact: number;
  target: Foe | null;
}

const SPEED = 5.5;
const REACH = 1.3;
export const HELPER_SEEK = 7;
const v = new THREE.Vector3();

export class Helpers {
  readonly list: Helper[] = [];
  constructor(private scene: THREE.Scene) {}

  spawn(model: string, weapon: string, kind: HelperKind, at: THREE.Vector3, life: number) {
    const ch = new Character(model, weapon, 0.6);
    ch.root.position.copy(at);
    this.scene.add(ch.root);
    this.list.push({ ch, kind, t: 0, life, atkCd: 0.3, impact: -1, target: null });
  }

  /**
   * `pick(pos)` returns the nearest foe within HELPER_SEEK m (or null); `onHit(h, foe)` lands a blow.
   * Helpers keep near `hero` when nothing is around.
   */
  update(dt: number, hero: THREE.Vector3, pick: (pos: THREE.Vector3) => Foe | null, onHit: (h: Helper, foe: Foe) => void) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      const p = h.ch.root.position;
      h.t += dt;
      // pop in, shrink away at the end
      const s = Math.min(1, h.t / 0.2, (h.life - h.t) / 0.3);
      h.ch.root.scale.setScalar(Math.max(0.01, s));
      if (h.t >= h.life) {
        h.ch.dispose();
        this.list.splice(i, 1);
        continue;
      }
      if (!h.target || !h.target.hittable) h.target = pick(p);
      let moving = false;
      const t = h.target;
      const goal = t ? t.pos : hero;
      v.set(goal.x - p.x, 0, goal.z - p.z);
      const d = v.length();
      const stop = t ? t.radius + REACH * 0.8 : 1.8 + i * 0.4;
      if (d > stop) {
        v.multiplyScalar(Math.min(d - stop, SPEED * dt) / d);
        p.add(v);
        moving = true;
      }
      if (d > 0.01) h.ch.facing = Math.atan2(goal.x - p.x, goal.z - p.z);
      h.atkCd -= dt;
      if (t && d < t.radius + REACH && h.atkCd <= 0 && h.impact < 0) {
        h.ch.attack(h.kind === 'hammer' ? 'AxeAttack' : 'SwordAttack', 0.7, 0.25);
        h.impact = 0.25;
        h.atkCd = 0.7;
      }
      if (h.impact >= 0) {
        h.impact -= dt;
        if (h.impact < 0 && t && t.hittable) onHit(h, t);
      }
      h.ch.walkRate = SPEED / h.ch.stride;
      h.ch.update(dt, moving);
    }
  }
}
