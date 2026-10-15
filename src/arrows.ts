import * as THREE from 'three';
import { assets } from './assets';

/** What an arrow flies at: a unit of the game (src/game.ts Unit). */
export interface ArrowTarget { pos: THREE.Vector3; radius: number; hittable: boolean }

interface Flight {
  obj: THREE.Object3D;
  target: ArrowTarget;
  /** Where it flies: the target's chest while it can be hit, then the last point it was seen at. */
  aim: THREE.Vector3;
  speed: number;
  onHit: () => void;
}

/** Height of the aim point over the target's feet, m. */
const CHEST = 1.0;
/** Arrow model size (the FBX is a 1.24 m arrow). */
const SCALE = 0.7;
const v = new THREE.Vector3();

/** Arrows in flight (bow, WeaponDef.shot): each homes in on its unit and calls `onHit` when it gets there. */
export class Arrows {
  private list: Flight[] = [];

  constructor(private scene: THREE.Scene) {}

  fire(model: string, from: THREE.Vector3, target: ArrowTarget, speed: number, onHit: () => void) {
    const obj = new THREE.Group();
    const mesh = assets.clone(model);
    // authored along Y with the head at −Y (fletching at the origin): lay the head along the group's +Z,
    // which lookAt() turns at the aim
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.scale.multiplyScalar(SCALE);
    // the head on the flight point, the shaft trailing behind it (the hit lands when the head arrives)
    mesh.position.z = -1.21 * SCALE;
    mesh.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    obj.add(mesh);
    obj.position.copy(from);
    const aim = target.pos.clone().setY(target.pos.y + CHEST);
    obj.lookAt(aim);
    this.scene.add(obj);
    this.list.push({ obj, target, aim, speed, onHit });
  }

  update(dt: number) {
    this.list = this.list.filter((f) => {
      if (f.target.hittable) f.aim.copy(f.target.pos).setY(f.target.pos.y + CHEST);
      const p = f.obj.position;
      const d = p.distanceTo(f.aim);
      const step = f.speed * dt;
      // arrives at the unit's edge, not its centre
      if (d - Math.min(f.target.radius, 0.5) <= step) {
        if (f.target.hittable) f.onHit();
        f.obj.removeFromParent();
        return false;
      }
      p.add(v.subVectors(f.aim, p).multiplyScalar(step / d));
      f.obj.lookAt(f.aim);
      return true;
    });
  }

  clear() {
    for (const f of this.list) f.obj.removeFromParent();
    this.list = [];
  }
}
