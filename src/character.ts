import * as THREE from 'three';
import { HIT_FLASH, applyHitFlash } from './hitflash';
import { SKINS, assets } from './assets';
import { WEAPON_GRIPS, attachTrim, attachWeapon } from './rig';
import { Swinger, type SwingKind } from './swing';
import { PART_PREFIXES, type VisualPart } from './items';
import { ATTACK_HIT, type AttackAnim, type BossAnim } from './config';
import { FLOAT_TIME, patchFloat } from './floaters';

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

const FULL_BODY: Record<BossAnim, true> = { SlashAdvance: true, MeleeHigh: true, MeleeLong: true, MeleeHorizontal: true };
/**
 * Inverted-hull outline: back faces of the same (skinned) mesh pushed out along the normals.
 * Works with skinning because the push happens in bind space, before the bones move it.
 */
const outlineMat = (() => {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    // floating crystals move with their shell: the push below lands before the float motion (src/floaters.ts)
    patchFloat(shader);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      // `normal` (not objectNormal): MeshBasicMaterial declares objectNormal only for skinned meshes.
      '#include <begin_vertex>\n transformed += normalize(normal) * 1.4;',
    );
  };
  return m;
})();

/**
 * Rim light on the player hero: an additive fresnel pass over the same (skinned) meshes, so the silhouette catches
 * a warm edge of light and reads against busy ground. Black diffuse: only the rim (emissive) is added.
 */
const rimMat = (() => {
  const m = new THREE.MeshLambertMaterial({
    color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  m.onBeforeCompile = (shader) => {
    patchFloat(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float rim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      totalEmissiveRadiance += vec3(1.0, 0.9, 0.72) * pow(rim, 2.2) * 0.5;`,
    );
  };
  return m;
})();

/** A material's colour as authored, kept on first sight (tints multiply it instead of replacing it). */
function ownColor(m: THREE.MeshLambertMaterial) {
  return (m.userData.ownColor ??= m.color.clone()) as THREE.Color;
}

const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
/** Mage orb rest point in the character's root space (right shoulder, a bit above it: the staff is in the left hand). */
const ORB_AT = new THREE.Vector3(-0.45, 1.9, -0.1);

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
  /** Right hand bone (mage spells start there). */
  readonly handR: THREE.Object3D | null;
  readonly mixer: THREE.AnimationMixer;
  weapon: THREE.Object3D | null = null;
  /** Second weapon in the left hand. */
  weaponL: THREE.Object3D | null = null;
  /** Mage orb floating above the left shoulder, and its inner core (spins). */
  private orb: THREE.Object3D | null = null;
  private orbCore: THREE.Object3D | null = null;
  private orbT = 0;
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
  /** Left-hand copy of the main weapon for clips that swing it with the left hand (rig.ts WEAPON_GRIPS.left). */
  private swapWeapon: THREE.Object3D | null = null;
  private swapAnims: string[] = [];
  /** The clip the current one replaced, while it fades out. */
  private fading: THREE.AnimationAction | null = null;
  /** A second action per clip, so a swing restarted mid-way can fade from its old self instead of snapping. */
  private attackTwin: Partial<Record<AttackAnim, THREE.AnimationAction>> = {};
  /** Clip time (s) the current swing freezes at until release(); -1 = none. */
  private holdT = -1;
  private fullBody = false;
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

  constructor(modelName: string, weaponName: string | null, scale = 1, skin?: string) {
    this.model = assets.clone(modelName);
    this.handR = this.model.getObjectByName('hand_r') ?? null;
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
      if (!c) {
        c = src.clone();
        if (skin && SKINS[skin][src.name]) c.map = assets.texture(SKINS[skin][src.name]);
        cache.set(src, c);
        this.materials.push(c);
      }
      m.material = c;
      for (const [part, prefixes] of Object.entries(PART_PREFIXES) as [VisualPart, string[]][]) {
        if (prefixes.some((p) => m.name.startsWith(p))) {
          if (!this.baseParts.has(part)) this.baseParts.set(part, []);
          this.baseParts.get(part)!.push(m);
        }
      }
    });
    // a bow is held in the left hand (like the hero's), the right arm draws the string with the attack clip
    if (weaponName) this.setWeapon(weaponName, null, weaponName.startsWith('bow_'));

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
    this.attackU = {
      SwordAttack: once(upper.SwordAttack), AxeAttack: once(upper.AxeAttack), MagicAttack: once(upper.MagicAttack),
      SlashAdvance: once(full.SlashAdvance), MeleeHigh: once(full.MeleeHigh), MeleeLong: once(full.MeleeLong), MeleeHorizontal: once(full.MeleeHorizontal),
    };
    this.hitU = once(upper.Hit);
    this.death = once(full.Death);
    // Desync idle cycles between characters.
    const off = Math.random() * 2;
    this.idleL.time = this.idleU.time = off;
    this.walkL.time = this.walkU.time = off;
  }

  /** `mainLeft`: the main weapon goes into the left hand (the mage's staff). */
  setWeapon(name: string | null, left: string | null = null, mainLeft = false) {
    this.weapon?.removeFromParent();
    this.weaponL?.removeFromParent();
    this.weapon = name ? attachWeapon(this.model, name, mainLeft) : null;
    this.weaponL = left ? attachWeapon(this.model, left, true) : null;
    this.swapWeapon?.removeFromParent();
    this.swapAnims = (name && WEAPON_GRIPS[name]?.left) || [];
    this.swapWeapon = this.swapAnims.length ? attachWeapon(this.model, name!, true) : null;
    if (this.swapWeapon) this.swapWeapon.visible = false;
    for (const w of [this.weapon, this.weaponL, this.swapWeapon]) w?.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    if (this.highlighted) this.rebuildOutline();
  }

  setOrb(name: string | null) {
    this.orb?.removeFromParent();
    this.orb = this.orbCore = null;
    if (!name) return;
    this.orb = assets.cloneCreature(name).model;
    this.orb.position.copy(ORB_AT);
    this.orbCore = this.orb.getObjectByName(`${name}_core`) ?? null;
    // the glass must not hide the core behind it
    this.orb.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m?.transparent) m.depthWrite = false; });
    this.root.add(this.orb);
  }

  /** Player hero: a bit bigger, with a dark outline and a warm rim light (no flat extra brightness: it washed the textures out). */
  setHighlight(on: boolean) {
    this.highlighted = on;
    this.model.scale.multiplyScalar(on ? 1.12 : 1 / 1.12);
    this.baseColor.setScalar(1);
    this.applyBaseColor();
    this.rebuildOutline();
  }

  /** Every material's own colour (white for the atlas ones, quality colours on the hunter sets) × the tint. */
  private applyBaseColor() {
    for (const m of this.materials) m.color.copy(ownColor(m)).multiply(this.baseColor);
  }

  private rebuildOutline() {
    for (const o of this.outlines) o.removeFromParent();
    this.outlines = [];
    if (!this.highlighted) return;
    const meshes: THREE.Mesh[] = [];
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible && m.material !== outlineMat && m.material !== rimMat) meshes.push(m);
    });
    for (const m of meshes) {
      for (const mat of [outlineMat, rimMat]) {
        let o: THREE.Mesh;
        if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
          const sm = m as THREE.SkinnedMesh;
          const so = new THREE.SkinnedMesh(sm.geometry, mat);
          so.bind(sm.skeleton, sm.bindMatrix);
          o = so;
        } else {
          o = new THREE.Mesh(m.geometry, mat); // weapon: same cm space, same push
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

  private trims = new Map<string, THREE.Object3D[]>();
  private trimsWanted: string[] = [];

  /** Armour quality pieces (GLB names, see armorTrim): loaded on demand, attached to the bones. */
  setTrims(names: string[]) {
    this.trimsWanted = names;
    for (const [n, pieces] of this.trims) {
      if (names.includes(n)) continue;
      for (const p of pieces) p.removeFromParent();
      this.trims.delete(n);
    }
    for (const n of names) {
      if (this.trims.has(n)) continue;
      assets.gear(n).then(() => {
        if (!this.trimsWanted.includes(n) || this.trims.has(n)) return;
        const pieces = attachTrim(this.model, n);
        for (const p of pieces) p.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
        this.trims.set(n, pieces);
        if (this.highlighted) this.rebuildOutline();
      }, (e) => console.warn('armour trim', n, e));
    }
    if (this.highlighted) this.rebuildOutline();
  }

  setOutfit(outfit: Partial<Record<VisualPart, string>>) {
    for (const part of Object.keys(PART_PREFIXES) as VisualPart[]) {
      const want = outfit[part] ?? null;
      const cur = this.outfitParts.get(part);
      if ((cur?.model ?? null) === want) continue;
      if (cur) {
        for (const m of cur.meshes) {
          m.removeFromParent();
          const gone = [m.material].flat();
          this.materials = this.materials.filter((x) => !gone.includes(x));
        }
        this.outfitParts.delete(part);
      }
      const base = this.baseParts.get(part) ?? [];
      for (const m of base) m.visible = !want;
      if (!want) continue;
      const src = assets.clone(want);
      // a hunter set part (models/archers) is the whole file, e.g. the chest with its quiver
      const whole = want.startsWith('archers/');
      const meshes: THREE.SkinnedMesh[] = [];
      src.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (sm.isSkinnedMesh && (whole || PART_PREFIXES[part].some((p) => sm.name.startsWith(p)))) meshes.push(sm);
      });
      const parent = base[0]?.parent ?? this.model;
      // own copies of the part's materials (several per mesh for the hunter sets), for hit flashes and tints
      const own = new Map<THREE.Material, THREE.MeshLambertMaterial>();
      const copy = (m: THREE.Material) => {
        let c = own.get(m);
        if (!c) {
          c = (m as THREE.MeshLambertMaterial).clone();
          // clone() drops the shader patch of the floating crystals (src/floaters.ts)
          if (m.userData.float) { c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; }
          c.userData.ownColor = c.color.clone();
          c.color.multiply(this.baseColor);
          own.set(m, c);
          this.materials.push(c);
        }
        return c;
      };
      for (const sm of meshes) {
        const bones = sm.skeleton.bones.map((b) => this.ownBone(b) as THREE.Bone);
        const skel = new THREE.Skeleton(bones, sm.skeleton.boneInverses);
        const bind = sm.bindMatrix.clone();
        sm.removeFromParent();
        parent.add(sm);
        sm.bind(skel, bind);
        sm.frustumCulled = false;
        sm.castShadow = true;
        sm.material = Array.isArray(sm.material) ? sm.material.map(copy) : copy(sm.material);
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

  /** Length of an attack clip (s at natural speed). */
  clipLength(anim: AttackAnim) { return this.attackU[anim].getClip().duration; }

  /** Hit marker of the attack clip (s at natural speed). */
  hitTime(anim: AttackAnim) { return ATTACK_HIT[anim]; }

  /** Starts an attack swing. `impactAt` (s) is when the damage frame should land. Returns how long the swing plays (s). */
  attack(anim: AttackAnim, period: number, impactAt: number) {
    const clipImpact = ATTACK_HIT[anim];
    let a = this.attackU[anim];
    if (a === this.current && this.atkW > 0) {
      a = this.attackTwin[anim] ??= this.mixer.clipAction(a.getClip().clone());
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    // the clip it replaces fades out (left alone it would keep its weight on its last frame and bend every later swing)
    if (this.current && this.current !== a) {
      this.current.fadeOut(0.15);
      this.fading = this.current;
      // the new swing ramps in from nothing while the old one fades
      this.atkW = 0;
    }
    this.current = a;
    this.holdT = -1;
    this.setSwapped(this.swapAnims.includes(anim));
    this.fullBody = anim in FULL_BODY;
    a.reset();
    a.timeScale = clipImpact / impactAt;
    a.setEffectiveWeight(this.atkW);
    a.play();
    // a full-body clip plays to its end, even past the attack period
    this.atkTimer = this.fullBody ? Math.max(period, a.getClip().duration / a.timeScale) : period;
    return this.atkTimer;
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
    FLOAT_TIME.value = performance.now() / 1000;
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
    if (this.orb) {
      this.orbT += dt;
      this.orb.position.y = ORB_AT.y + Math.sin(this.orbT * 2.2) * 0.06;
      if (this.orbCore) this.orbCore.rotation.y += dt * 1.5;
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
      // a fading swing still holds the pose, so idle does not blend in under it
      const fadeW = this.fading?.isScheduled() ? this.fading.getEffectiveWeight() : 0;
      const loco = 1 - Math.max(Math.min(1, this.atkW + fadeW), this.hitW);
      // a full-body attack takes the legs over too
      const legs = this.fullBody ? loco : 1;
      this.idleL.setEffectiveWeight((1 - this.move) * legs);
      this.walkL.setEffectiveWeight(this.move * legs);
      this.idleU.setEffectiveWeight((1 - this.move) * loco);
      this.walkU.setEffectiveWeight(this.move * loco);
      this.walkL.timeScale = this.walkU.timeScale = this.walkRate;
      if (this.current) this.current.setEffectiveWeight(this.atkW);
      this.hitU.setEffectiveWeight(this.atkW > 0 ? 0 : this.hitW);
      if (this.atkTimer <= 0) this.setSwapped(false);
      if (this.holdT >= 0 && this.current && this.current.time >= this.holdT) this.current.paused = true;
    }
    this.mixer.update(dt);
    if (!this.dead) this.swinger.apply(dt);
  }

  /** Freezes the current swing at `at` s into its clip (a wind-up) until release(). */
  holdAt(at: number) { this.holdT = at; }

  /** A held swing goes on, its blow landing `impactIn` s from now. */
  release(anim: AttackAnim, impactIn: number) {
    const a = this.current;
    if (!a || this.holdT < 0) return;
    this.holdT = -1;
    a.paused = false;
    a.timeScale = Math.max(0.05, (ATTACK_HIT[anim] - a.time) / impactIn);
    this.atkTimer = (a.getClip().duration - a.time) / a.timeScale;
  }

  /** The main weapon goes to the left hand (its copy there shows) or back to the right. */
  private setSwapped(left: boolean) {
    if (!this.swapWeapon || !this.weapon) return;
    this.swapWeapon.visible = left;
    this.weapon.visible = !left;
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
      m.color.copy(ownColor(m)).multiply(this.baseColor);
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity >= 1;
    }
  }
}
