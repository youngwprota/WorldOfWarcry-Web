// Things that circle a point and cut what they pass: the thrown scythe (around the hero) and the sword pair's
// spinning blades (around a mob). Visual + motion only; the game applies the damage through `onPass`.
import * as THREE from 'three';
import { assets } from './assets';

export interface Orbit {
  obj: THREE.Object3D;
  /** Centre to circle (live vector: the hero's or a mob's position). */
  center: THREE.Vector3;
  radius: number;
  /** Seconds alive / total. */
  t: number;
  time: number;
  /** Radians per second. */
  speed: number;
  angle: number;
  /** Height of the blade above the ground, m. */
  y: number;
  /** Minimum seconds between two cuts of the same target. */
  rehit: number;
  /** Last cut time per target. */
  last: Map<object, number>;
  /** Free payload for the game (which hand / item / pair). */
  tag: unknown;
}

const _p = new THREE.Vector3();

export class Orbits {
  readonly list: Orbit[] = [];

  constructor(private scene: THREE.Scene) {}

  /** `model` is cloned from the asset cache; `scale` on top of its normalized size. */
  add(model: string, scale: number, o: Omit<Orbit, 'obj' | 't' | 'last'>): Orbit {
    const g = new THREE.Group();
    const m = assets.clone(model);
    m.scale.multiplyScalar(scale);
    // lie flat and spin around the vertical axis
    m.rotation.x = Math.PI / 2;
    g.add(m);
    this.scene.add(g);
    const orbit: Orbit = { ...o, obj: g, t: 0, last: new Map() };
    this.list.push(orbit);
    return orbit;
  }

  /**
   * Moves every orbit; `onPass(o, pos)` is called each frame with the blade's world position (the game cuts what is
   * near). Expired orbits are removed and passed to `onEnd`.
   */
  update(dt: number, onPass: (o: Orbit, pos: THREE.Vector3) => void, onEnd: (o: Orbit) => void) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt;
      if (o.t >= o.time) {
        this.remove(i);
        onEnd(o);
        continue;
      }
      o.angle += o.speed * dt;
      // fly out, circle, fly back in
      const k = Math.min(1, o.t / 0.25, (o.time - o.t) / 0.25);
      const r = o.radius * k;
      _p.set(o.center.x + Math.sin(o.angle) * r, o.y, o.center.z + Math.cos(o.angle) * r);
      o.obj.position.copy(_p);
      o.obj.rotation.y += dt * 18;
      onPass(o, _p);
    }
  }

  private remove(i: number) {
    const o = this.list[i];
    o.obj.removeFromParent();
    // clones share the cached geometry/materials: nothing of their own to dispose
    this.list.splice(i, 1);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.remove(i);
  }
}

interface Fall { obj: THREE.Object3D; t: number; dur: number; y0: number }

/** Blades dropping from the sky (nagamaki + sword pair): stuck in the ground for a moment, then gone. */
export class Falls {
  private list: Fall[] = [];
  constructor(private scene: THREE.Scene) {}

  /** Lands at `at` in `dur` s. */
  add(model: string, scale: number, at: THREE.Vector3, dur: number) {
    const g = new THREE.Group();
    const m = assets.clone(model);
    m.scale.multiplyScalar(scale);
    m.rotation.x = Math.PI; // point down
    g.add(m);
    g.position.copy(at);
    this.scene.add(g);
    this.list.push({ obj: g, t: 0, dur, y0: 7 });
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      // blade tip ends a little in the ground; its length is about 1.6 m at this scale
      f.obj.position.y = f.y0 * (1 - k * k) + 1.3;
      if (f.t > f.dur + 0.6) {
        f.obj.removeFromParent();
        this.list.splice(i, 1);
      }
    }
  }
}
