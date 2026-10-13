import * as THREE from 'three';
import { HIT_FLASH, applyHitFlash } from './hitflash';
import { assets } from './assets';
import { attachWeapon } from './rig';
import { Swinger, type SwingKind } from './swing';
import { PART_PREFIXES, type VisualPart } from './items';
import { ATTACK_HIT, type AttackAnim } from './config';

const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
/**
 * Inverted-hull outline: back faces of the same (skinned) mesh pushed out along the normals.
 * Works with skinning because the push happens in bind space, before the bones move it.
 */
const outlineMat = (() => {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      // `normal` (not objectNormal): MeshBasicMaterial declares objectNormal only for skinned meshes.
      '#include <begin_vertex>\n transformed += normalize(normal) * 1.4;',
    );
  };
  return m;
})();

const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });

export function blobShadow(size: number): THREE.Mesh {
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.scale.setScalar(size);
  m.position.y = 0.02;
  m.renderOrder = -1;
  return m;
}

/**
 * Skinned character with two animation layers:
 * lower body (idle/walk) and upper body (idle/walk or attack), so attacks play while running.
 */
export class Character {
  readonly root = new THREE.Group();
  readonly model: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  weapon: THREE.Object3D | null = null;
  /** Second weapon in the left hand. */
  weaponL: THREE.Object3D | null = null;
  private materials: THREE.MeshLambertMaterial[] = [];
  private flashT = 0;
  private baseColor = new THREE.Color(1, 1, 1);
  private highlighted = false;
  private outlines: THREE.Mesh[] = [];

  private idleL: THREE.AnimationAction;
  private walkL: THREE.AnimationAction;
  private idleU: THREE.AnimationAction;
  private walkU: THREE.AnimationAction;
  private attackU: Record<AttackAnim, THREE.AnimationAction>;
  private hitU: THREE.AnimationAction;
  private death: THREE.AnimationAction;
  private move = 0; // 0..1 blend
  private atkW = 0;
  private atkTimer = 0; // remaining attack time
  private hitW = 0;
  private current: THREE.AnimationAction | null = null;
  dead = false;
  facing = 0; // yaw, radians
  walkRate = 1;
  /** Ground speed (m/s) of the walk clip at walkRate 1. */
  readonly stride = 2.1;
  /** Procedural swings on top of the clips (src/swing.ts). */
  readonly swinger: Swinger;
  private spinT = 0;
  private spinDur = 0;
  private baseParts = new Map<VisualPart, THREE.Mesh[]>();
  private outfitParts = new Map<VisualPart, { model: string; meshes: THREE.Mesh[] }>();

  constructor(modelName: string, weaponName: string | null, scale = 1) {
    this.model = assets.clone(modelName);
    this.model.scale.multiplyScalar(scale);
    this.root.add(this.model);
    this.root.add(blobShadow(1.3 * scale));
    // Per-instance materials so hit flashes do not leak to other characters.
    const cache = new Map<THREE.Material, THREE.MeshLambertMaterial>();
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false; // bind-pose bounds are unreliable after scaling/animation
      m.castShadow = true;
      const src = m.material as THREE.MeshLambertMaterial;
      let c = cache.get(src);
      if (!c) { c = src.clone(); cache.set(src, c); this.materials.push(c); }
      m.material = c;
      for (const [part, prefixes] of Object.entries(PART_PREFIXES) as [VisualPart, string[]][]) {
        if (prefixes.some((p) => m.name.startsWith(p))) {
          if (!this.baseParts.has(part)) this.baseParts.set(part, []);
          this.baseParts.get(part)!.push(m);
        }
      }
    });
    if (weaponName) this.setWeapon(weaponName);

    this.swinger = new Swinger(this.model);
    const { full, upper, lower } = assets.clipsFor(modelName);
    this.mixer = new THREE.AnimationMixer(this.model);
    const act = (clip: THREE.AnimationClip, w = 0) => {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(w);
      a.play();
      return a;
    };
    this.idleL = act(lower.Idle, 1);
    this.walkL = act(lower.Walk);
    this.idleU = act(upper.Idle, 1);
    this.walkU = act(upper.Walk);
    const once = (clip: THREE.AnimationClip) => {
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.setEffectiveWeight(0);
      return a;
    };
    this.attackU = { SwordAttack: once(upper.SwordAttack), AxeAttack: once(upper.AxeAttack) };
    this.hitU = once(upper.Hit);
    this.death = once(full.Death);
    // Desync idle cycles between characters.
    const off = Math.random() * 2;
    this.idleL.time = this.idleU.time = off;
    this.walkL.time = this.walkU.time = off;
  }

  setWeapon(name: string | null, left: string | null = null) {
    this.weapon?.removeFromParent();
    this.weaponL?.removeFromParent();
    this.weapon = name ? attachWeapon(this.model, name) : null;
    this.weaponL = left ? attachWeapon(this.model, left, true) : null;
    for (const w of [this.weapon, this.weaponL]) w?.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    if (this.highlighted) this.rebuildOutline();
  }

  /** Player hero: a bit bigger and with a dark outline (no extra brightness: it washed the textures out). */
  setHighlight(on: boolean) {
    this.highlighted = on;
    this.model.scale.multiplyScalar(on ? 1.12 : 1 / 1.12);
    this.baseColor.setScalar(1);
    for (const m of this.materials) m.color.copy(this.baseColor);
    this.rebuildOutline();
  }

  private rebuildOutline() {
    for (const o of this.outlines) o.removeFromParent();
    this.outlines = [];
    if (!this.highlighted) return;
    const meshes: THREE.Mesh[] = [];
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible && m.material !== outlineMat) meshes.push(m);
    });
    for (const m of meshes) {
      let o: THREE.Mesh;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = m as THREE.SkinnedMesh;
        const so = new THREE.SkinnedMesh(sm.geometry, outlineMat);
        so.bind(sm.skeleton, sm.bindMatrix);
        o = so;
      } else {
        o = new THREE.Mesh(m.geometry, outlineMat); // weapon: same cm space, same push
        o.scale.copy(m.scale);
      }
      o.position.copy(m.position);
      o.quaternion.copy(m.quaternion);
      o.frustumCulled = false;
      o.castShadow = false;
      m.parent!.add(o);
      this.outlines.push(o);
    }
  }

  get position() { return this.root.position; }

  /**
   * Shows armour on the body: replaces a body part with the same part of another character.
   * All Bitgem characters share one skeleton, so the borrowed skinned mesh is simply rebound to our bones.
   */
  /**
   * Our bone with the same name. A part may use bones our model lacks (the paladin's plume, the chieftain's
   * topknot): such a bone is grafted onto our skeleton under its own parent, so it follows the body
   * instead of staying behind in the borrowed model (whose vertices would then fly off).
   */
  private ownBone(b: THREE.Object3D): THREE.Object3D {
    const own = this.model.getObjectByName(b.name);
    if (own) return own;
    const parent = b.parent ? this.ownBone(b.parent) : this.model;
    const graft = b.clone(false);
    parent.add(graft);
    return graft;
  }

  setOutfit(outfit: Partial<Record<VisualPart, string>>) {
    for (const part of Object.keys(PART_PREFIXES) as VisualPart[]) {
      const want = outfit[part] ?? null;
      const cur = this.outfitParts.get(part);
      if ((cur?.model ?? null) === want) continue;
      if (cur) {
        for (const m of cur.meshes) {
          m.removeFromParent();
          this.materials = this.materials.filter((x) => x !== m.material);
        }
        this.outfitParts.delete(part);
      }
      const base = this.baseParts.get(part) ?? [];
      for (const m of base) m.visible = !want;
      if (!want) continue;
      const src = assets.clone(want);
      const meshes: THREE.SkinnedMesh[] = [];
      src.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (sm.isSkinnedMesh && PART_PREFIXES[part].some((p) => sm.name.startsWith(p))) meshes.push(sm);
      });
      const parent = base[0]?.parent ?? this.model;
      const mat = (meshes[0]?.material as THREE.MeshLambertMaterial | undefined)?.clone();
      if (mat) { mat.color.copy(this.baseColor); this.materials.push(mat); }
      for (const sm of meshes) {
        const bones = sm.skeleton.bones.map((b) => this.ownBone(b) as THREE.Bone);
        const skel = new THREE.Skeleton(bones, sm.skeleton.boneInverses);
        const bind = sm.bindMatrix.clone();
        sm.removeFromParent();
        parent.add(sm);
        sm.bind(skel, bind);
        sm.frustumCulled = false;
        sm.castShadow = true;
        if (mat) sm.material = mat;
      }
      this.outfitParts.set(part, { model: want, meshes });
    }
    if (this.highlighted) this.rebuildOutline();
  }

  /** Full-body spin (sword combo "Вихрь"). */
  spin(duration: number) {
    this.spinT = 0;
    this.spinDur = duration;
  }

  /** Hit marker of the attack clip (s at natural speed). */
  hitTime(anim: AttackAnim) { return ATTACK_HIT[anim]; }

  /** Starts an attack swing. `impactAt` (s) is when the damage frame should land. */
  attack(anim: AttackAnim, period: number, impactAt: number) {
    const clipImpact = ATTACK_HIT[anim];
    const a = this.attackU[anim];
    this.current = a;
    a.reset();
    a.timeScale = clipImpact / impactAt;
    a.setEffectiveWeight(1);
    a.play();
    this.atkTimer = period;
  }

  /** Procedural swing of one hand (no clip): the blow lands `impactAt` s after the start. */
  swing(kind: SwingKind, hand: 0 | 1, period: number, impactAt: number) {
    this.swinger.start(kind, hand, Math.min(period, impactAt * 2.4), impactAt);
  }

  hit() {
    this.flashT = HIT_FLASH;
    if (this.atkTimer <= 0 && !this.dead) {
      this.hitU.reset();
      this.hitU.timeScale = 1.6;
      this.hitU.play();
      this.hitW = 1;
    }
  }

  /** The death clip has played to its end (it clamps on the last frame). */
  get deathDone() { return this.dead && !this.death.isRunning(); }

  die() {
    this.dead = true;
    this.mixer.stopAllAction();
    this.death.reset();
    this.death.timeScale = 1.5;
    this.death.setEffectiveWeight(1);
    this.death.play();
  }

  revive() {
    this.dead = false;
    this.death.stop();
    for (const a of [this.idleL, this.walkL, this.idleU, this.walkU]) a.play();
    this.atkTimer = 0;
    this.atkW = 0;
  }

  update(dt: number, moving: boolean, animate = true) {
    this.root.rotation.y = this.facing;
    if (this.spinDur > 0) {
      this.spinT += dt;
      const k = Math.min(1, this.spinT / this.spinDur);
      this.model.rotation.y = (1 - (1 - k) * (1 - k)) * Math.PI * 2;
      if (k >= 1) { this.spinDur = 0; this.model.rotation.y = 0; }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      applyHitFlash(this.materials, this.flashT);
    }
    if (!animate) return;
    if (!this.dead) {
      const target = moving ? 1 : 0;
      this.move += (target - this.move) * Math.min(1, dt * 10);
      if (this.atkTimer > 0) {
        this.atkTimer -= dt;
        this.atkW = Math.min(1, this.atkW + dt * 14);
      } else {
        this.atkW = Math.max(0, this.atkW - dt * 6);
      }
      this.hitW = Math.max(0, this.hitW - dt * 2.5);
      const loco = 1 - Math.max(this.atkW, this.hitW);
      this.idleL.setEffectiveWeight(1 - this.move);
      this.walkL.setEffectiveWeight(this.move);
      this.idleU.setEffectiveWeight((1 - this.move) * loco);
      this.walkU.setEffectiveWeight(this.move * loco);
      this.walkL.timeScale = this.walkU.timeScale = this.walkRate;
      if (this.current) this.current.setEffectiveWeight(this.atkW);
      this.hitU.setEffectiveWeight(this.atkW > 0 ? 0 : this.hitW);
    }
    this.mixer.update(dt);
    if (!this.dead) this.swinger.apply(dt);
  }

  /** Removes the character; its materials are its own (the geometry and the weapon are shared clones). */
  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
  }

  setTint(c: THREE.ColorRepresentation, opacity = 1) {
    this.baseColor.set(c);
    for (const m of this.materials) {
      m.color.copy(this.baseColor);
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity >= 1;
    }
  }
}
