import * as THREE from 'three';
import { HIT_FLASH, applyHitFlash } from './hitflash';
import { assets } from './assets';
import type { AttackAnim } from './config';

/** Seconds a dead static unit takes to tip over. */
const FALL = 0.7;
/** Seconds of the wobble after a hit. */
const SHAKE = 0.25;

/**
 * Body of a static unit (MobDef.static): a level model (a tree, a crate…) that only stands on its spawn point.
 * Same surface as Character / Creature for the mob code, but it never walks or attacks: a hit makes it
 * flash and wobble, death tips it over (then the mob code sinks it like any corpse).
 */
export class StaticBody {
  readonly root = new THREE.Group();
  readonly model: THREE.Group;
  /** Height of the model (m) at its scale: the HP bar sits above it. */
  readonly height: number;
  private materials: THREE.MeshStandardMaterial[] = [];
  private flashT = 0;
  private shakeT = 0;
  private fallT = -1;
  dead = false;
  facing = 0;
  walkRate = 1;
  readonly stride = 1;

  constructor(modelName: string, scale = 1, tint?: THREE.Color) {
    this.model = assets.clone(modelName);
    this.model.scale.multiplyScalar(scale);
    this.root.add(this.model);
    const cache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      const src = m.material as THREE.MeshStandardMaterial;
      let c = cache.get(src);
      if (!c) {
        c = src.clone();
        if (tint) c.color.multiply(tint);
        cache.set(src, c);
        this.materials.push(c);
      }
      m.material = c;
    });
    this.height = new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3()).y;
  }

  get position() { return this.root.position; }

  // the mob code's attack and walk hooks: a static unit has none
  hitTime(_anim: AttackAnim) { return 0; }
  backstep() { return 0; }
  attack(_anim: AttackAnim, _period: number, _impactAt: number) { return 0; }

  hit() {
    this.flashT = HIT_FLASH;
    this.shakeT = SHAKE;
  }

  /** Has finished tipping over. */
  get deathDone() { return this.dead && this.fallT >= FALL; }

  die() {
    this.dead = true;
    this.fallT = 0;
  }

  revive() {
    this.dead = false;
    this.fallT = -1;
    this.shakeT = 0;
    this.model.rotation.set(0, 0, 0);
  }

  update(dt: number, _moving: boolean, animate = true) {
    this.root.rotation.y = this.facing;
    if (this.flashT > 0) {
      this.flashT -= dt;
      applyHitFlash(this.materials, this.flashT);
    }
    if (!animate) return;
    if (this.fallT >= 0) {
      this.fallT = Math.min(FALL, this.fallT + dt);
      const k = this.fallT / FALL;
      this.model.rotation.set(k * k * Math.PI * 0.48, 0, 0);
      return;
    }
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      this.model.rotation.z = Math.sin(this.shakeT * 70) * 0.06 * (this.shakeT / SHAKE);
    }
  }
}
