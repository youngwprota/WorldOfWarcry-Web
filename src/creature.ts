import * as THREE from 'three';
import { HIT_FLASH, addUnmaskedFlash, applyHitFlash } from './hitflash';
import { assets } from './assets';
import { blobShadow } from './character';
import { ATTACK_HIT, type AttackAnim } from './config';

/**
 * Per-model rig data. stride: ground speed of the `walk` clip at scale 1 and timeScale 1 (planted-foot speed
 * measured in Blender). upperRoot: the attack plays on this bone's chain only, so the legs keep walking under it.
 * ram: boar charge (body lunge into the hit, then a step back).
 */
interface CreatureRig { stride: number; upperRoot: string; shadow: number; ram: boolean }
const BOAR: CreatureRig = { stride: 0.72, upperRoot: 'spine_5', shadow: 1.9, ram: true };
const RIGS: Record<string, CreatureRig> = {
  orc_boar: BOAR,
  undead_boar: BOAR,
  human_murloc: { stride: 0.39 * 1.3, upperRoot: 'Spine_1', shadow: 1.1, ram: false },
  // WoW creatures retextured to the game palette (wow.export glTF → _warcry pipeline). The attack moves the whole
  // body, so it plays on the full skeleton; strides measured from the planted feet of the walk clip.
  wild_bear: { stride: 2.5, upperRoot: 'bearskindrkbrown_skeleton', shadow: 1.6, ram: false },
  wild_direwolf: { stride: 2.4, upperRoot: 'direwolfskinlightblue_skeleton', shadow: 1.5, ram: false },
  wild_lion: { stride: 3.0, upperRoot: 'lionskingold_skeleton', shadow: 1.5, ram: false },
  wild_dragon: { stride: 2.6, upperRoot: 'dragonnefarian1_skeleton', shadow: 9, ram: false },
};
/**
 * Body lunge of the ram, done here because the attack clip only drives the neck: forward offset (m at scale 1)
 * by attack-clip time (s). Pulls back while the head drops, shoots forward into the uppercut hit, eases back.
 */
const LUNGE_T = [0, 0.17, 0.27, 0.375, 0.55, 1.0];
const LUNGE_D = [0, -0.06, 0, 0.27, 0.2, 0];

function lungeAt(t: number) {
  for (let i = 1; i < LUNGE_T.length; i++) {
    if (t <= LUNGE_T[i]) {
      const k = (t - LUNGE_T[i - 1]) / (LUNGE_T[i] - LUNGE_T[i - 1]);
      return LUNGE_D[i - 1] + (LUNGE_D[i] - LUNGE_D[i - 1]) * k * k * (3 - 2 * k);
    }
  }
  return 0;
}

/** Step back after the hit (attack-clip seconds, metres at scale 1): real movement, done by the mob code. */
const BACK_T0 = 0.6;
const BACK_T1 = 1.05;
const BACK_D = 0.3;

/** Splits a clip into [legs/body, neck/head] by the bones its tracks animate. */
function split(clip: THREE.AnimationClip, upper: Set<string>): [THREE.AnimationClip, THREE.AnimationClip] {
  const lower: THREE.KeyframeTrack[] = [];
  const up: THREE.KeyframeTrack[] = [];
  for (const t of clip.tracks) (upper.has(t.name.split('.')[0]) ? up : lower).push(t);
  return [
    new THREE.AnimationClip(clip.name + '_L', clip.duration, lower),
    new THREE.AnimationClip(clip.name + '_U', clip.duration, up),
  ];
}

/**
 * Animal mob from a GLB (own skeleton and idle / walk / attack / death clips). Same surface as Character
 * for the mob code. Two layers like Character: legs/body (idle/walk) and neck/head (idle/walk or the attack).
 */
export class Creature {
  readonly root = new THREE.Group();
  readonly model: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  private materials: THREE.MeshStandardMaterial[] = [];
  private flashT = 0;
  private idleL: THREE.AnimationAction;
  private walkL: THREE.AnimationAction;
  private idleU: THREE.AnimationAction;
  private walkU: THREE.AnimationAction;
  private atk: THREE.AnimationAction;
  private death: THREE.AnimationAction;
  private move = 0;
  private atkW = 0;
  private atkTimer = 0;
  dead = false;
  facing = 0;
  walkRate = 1;
  /** Ground speed (m/s) of the walk at walkRate 1: callers set walkRate = speed / stride so hooves don't slide. */
  readonly stride: number;
  private scale: number;
  private backS = 0;
  private rig: CreatureRig;
  private hitAt: number;

  constructor(modelName: string, scale = 1) {
    this.scale = scale;
    this.hitAt = ATTACK_HIT[modelName + ':attack'];
    this.rig = RIGS[modelName];
    this.stride = this.rig.stride * scale;
    const { model, clips } = assets.cloneCreature(modelName);
    this.model = model;
    this.model.scale.setScalar(scale);
    this.root.add(this.model);
    this.root.add(blobShadow(this.rig.shadow * scale));
    const cache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      m.castShadow = true;
      const src = m.material as THREE.MeshStandardMaterial;
      let c = cache.get(src);
      if (!c) {
        c = src.clone();
        if (c.emissiveMap) addUnmaskedFlash(c);
        cache.set(src, c);
        this.materials.push(c);
      }
      m.material = c;
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    const loop = (clip: THREE.AnimationClip, w: number) => {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(w);
      a.play();
      return a;
    };
    const once = (clip: THREE.AnimationClip) => {
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.setEffectiveWeight(0);
      return a;
    };
    const upper = new Set<string>();
    this.model.getObjectByName(this.rig.upperRoot)!.traverse((o) => upper.add(o.name));
    const [idleL, idleU] = split(clips.idle, upper);
    const [walkL, walkU] = split(clips.walk, upper);
    this.idleL = loop(idleL, 1);
    this.walkL = loop(walkL, 0);
    this.idleU = loop(idleU, 1);
    this.walkU = loop(walkU, 0);
    this.atk = once(split(clips.attack, upper)[1]);
    this.death = once(clips.death);
    this.idleL.time = this.idleU.time = Math.random() * clips.idle.duration;
    this.walkL.time = this.walkU.time = Math.random() * clips.walk.duration;
  }

  get position() { return this.root.position; }

  hitTime(_anim: AttackAnim) { return this.hitAt; }

  /** Recovery after the hit: the legs walk backwards while the mob code moves the body back. */
  get backingOff() { return this.rig.ram && this.atk.isRunning() && this.atk.time > BACK_T0 && this.atk.time < BACK_T1; }

  /** Distance (m) to move back since the last call; eased in and out over the recovery, 0 outside it. */
  backstep() {
    if (!this.rig.ram || !this.atk.isRunning()) { this.backS = 0; return 0; }
    const k = Math.min(1, Math.max(0, (this.atk.time - BACK_T0) / (BACK_T1 - BACK_T0)));
    const s = BACK_D * this.scale * k * k * (3 - 2 * k);
    const d = s - this.backS;
    this.backS = s;
    return d;
  }

  attack(_anim: AttackAnim, period: number, impactAt: number) {
    this.atk.reset();
    this.atk.timeScale = this.hitAt / impactAt;
    this.atk.play();
    this.atkTimer = period;
    return period;
  }

  hit() {
    this.flashT = HIT_FLASH;
  }

  /** The death clip has played to its end (it clamps on the last frame). */
  get deathDone() { return this.dead && !this.death.isRunning(); }

  die() {
    this.dead = true;
    this.model.position.z = 0;
    this.mixer.stopAllAction();
    this.death.reset();
    this.death.timeScale = 1.3;
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
    if (this.flashT > 0) {
      this.flashT -= dt;
      applyHitFlash(this.materials, this.flashT);
    }
    if (!animate) return;
    if (!this.dead) {
      const back = this.backingOff;
      this.move += ((moving || back ? 1 : 0) - this.move) * Math.min(1, dt * 10);
      if (this.atkTimer > 0) {
        this.atkTimer -= dt;
        this.atkW = Math.min(1, this.atkW + dt * 14);
      } else {
        this.atkW = Math.max(0, this.atkW - dt * 6);
      }
      const loco = 1 - this.atkW;
      this.idleL.setEffectiveWeight(1 - this.move);
      this.walkL.setEffectiveWeight(this.move);
      this.idleU.setEffectiveWeight((1 - this.move) * loco);
      this.walkU.setEffectiveWeight(this.move * loco);
      // Backing off: average backstep speed over the walk stride (scale cancels out), clip played in reverse
      this.walkL.timeScale = this.walkU.timeScale = back
        ? -(BACK_D / (BACK_T1 - BACK_T0) / this.rig.stride) * this.atk.timeScale
        : this.walkRate;
      this.atk.setEffectiveWeight(this.atkW);
      // glTF forward is +Z
      this.model.position.z = this.rig.ram && this.atk.isRunning() ? lungeAt(this.atk.time) * this.scale : 0;
    }
    this.mixer.update(dt);
  }

  /** Multiplies the model's own colours by `c` (white = as authored). */
  setTint(c: THREE.ColorRepresentation) {
    for (const m of this.materials) {
      const base = (m.userData.color0 ??= m.color.clone()) as THREE.Color;
      m.color.copy(base).multiply(tintColor.set(c));
    }
  }
}

const tintColor = new THREE.Color();
