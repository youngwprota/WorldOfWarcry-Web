import * as THREE from 'three';
import { assets } from './assets';

/** What an arrow flies at: a unit of the game (src/game.ts Unit). */
export interface ArrowTarget { pos: THREE.Vector3; radius: number; hittable: boolean }

interface Flight {
  obj: THREE.Object3D;
  /** Pool key of `obj` (model name; pellets apart, they are posed differently). */
  key: string;
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

function castShadow(o: THREE.Object3D) { if ((o as THREE.Mesh).isMesh) o.castShadow = true; }

/** Arrows in flight (bow, WeaponDef.shot): each homes in on its unit and calls `onHit` when it gets there. */
export class Arrows {
  private list: Flight[] = [];
  /** Landed arrows by pool key, reused by the next shot of that model. */
  private free = new Map<string, THREE.Object3D[]>();

  constructor(private scene: THREE.Scene) {}

  /** `pellet`: a round shot in metres (the gun, src/mocks.ts), flown as it is. */
  fire(model: string, from: THREE.Vector3, target: ArrowTarget, speed: number, onHit: () => void, pellet = false) {
    const key = pellet ? '•' + model : model;
    const obj = this.free.get(key)?.pop() ?? this.build(model, pellet);
    obj.position.copy(from);
    const aim = target.pos.clone().setY(target.pos.y + CHEST);
    obj.lookAt(aim);
    this.scene.add(obj);
    this.list.push({ obj, key, target, aim, speed, onHit });
  }

  private build(model: string, pellet: boolean) {
    const obj = new THREE.Group();
    const mesh = assets.clone(model);
    if (!pellet) {
      // authored along Y with the head at −Y (fletching at the origin): lay the head along the group's +Z,
      // which lookAt() turns at the aim
      // (the undead arrow is authored along +Z already, head forward, 1.11 m)
      const alongZ = model.startsWith('arrow_undead');
      if (!alongZ) mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.scale.multiplyScalar(SCALE);
      // the head on the flight point, the shaft trailing behind it (the hit lands when the head arrives)
      mesh.position.z = (alongZ ? -1.11 : -1.21) * SCALE;
    }
    mesh.traverse(castShadow);
    obj.add(mesh);
    return obj;
  }

  update(dt: number) {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (f.target.hittable) f.aim.copy(f.target.pos).setY(f.target.pos.y + CHEST);
      const p = f.obj.position;
      const d = p.distanceTo(f.aim);
      const step = f.speed * dt;
      // arrives at the unit's edge, not its centre
      if (d - Math.min(f.target.radius, 0.5) <= step) {
        this.release(f);
        if (f.target.hittable) f.onHit();
        continue;
      }
      p.add(v.subVectors(f.aim, p).multiplyScalar(step / d));
      f.obj.lookAt(f.aim);
      this.list[n++] = f;
    }
    this.list.length = n;
  }

  clear() {
    for (const f of this.list) this.release(f);
    this.list.length = 0;
  }

  /** Pooled arrows share their geometry and materials with the asset sources, so only the scene links go. */
  dispose() {
    this.clear();
    for (const pool of this.free.values()) for (const o of pool) o.removeFromParent();
    this.free.clear();
  }

  private release(f: Flight) {
    f.obj.removeFromParent();
    let pool = this.free.get(f.key);
    if (!pool) this.free.set(f.key, pool = []);
    pool.push(f.obj);
  }
}
