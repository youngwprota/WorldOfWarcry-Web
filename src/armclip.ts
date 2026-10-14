// Attack clips on one arm: the rig only has right-handed attacks. The clip is evaluated on a bone-only copy of the
// skeleton, then the right arm copies it as is and the left arm gets its mirror image (across the character's X).
import * as THREE from 'three';
import type { AttackAnim } from './config';

const CHAIN = ['clavicle', 'upperarm', 'lowerarm', 'hand'];
/** The clip's torso and head: copied (right hand) or mirrored (left) from the latest swing, see body(). */
const SPINE = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'];
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const qTarget = new THREE.Quaternion();
const qBase = new THREE.Quaternion();

/** Bones only (no meshes), same names and rest transforms; the root has no transform of its own. */
function copyBones(o: THREE.Object3D, root = true): THREE.Object3D {
  const c = new THREE.Object3D();
  c.name = o.name;
  if (!root) { c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale); }
  for (const ch of o.children) if (!(ch as THREE.Mesh).isMesh) c.add(copyBones(ch, false));
  return c;
}

/** Rotation of `bone` relative to `root`: the product of the local rotations below it. */
function modelQ(bone: THREE.Object3D, root: THREE.Object3D, out: THREE.Quaternion) {
  out.identity();
  for (let o: THREE.Object3D | null = bone; o && o !== root; o = o.parent) out.premultiply(o.quaternion);
  return out;
}

/** Reflection of a rotation across the plane x = 0. */
const mirror = (q: THREE.Quaternion) => q.set(q.x, -q.y, -q.z, q.w);

export class ArmClips {
  private ghost: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions: Record<AttackAnim, THREE.AnimationAction>;
  private real: THREE.Object3D[][];
  private gR: THREE.Object3D[];
  private gL: THREE.Object3D[];
  /**
   * Left bone = mirror(right bone) × fix, relative to the chest, measured on the Idle pose: the left weapon's grip is
   * fitted to Idle too (rig.ts LEFT_FIX), so the bind pose here would leave the left weapon twisted.
   */
  private fix: THREE.Quaternion[];
  private current: THREE.AnimationAction | null = null;
  /** The bone both clavicles hang from (spine_03): the mirror is taken in its space. */
  private chest!: THREE.Object3D;
  /** Left weapon holder, its idle rotation, its rotation in the right hand, and the turn of its mirror image. */
  private left: THREE.Object3D | null = null;
  private leftIdle = new THREE.Quaternion();
  private leftRight = new THREE.Quaternion();
  private leftFlip = new THREE.Quaternion();
  private realS: THREE.Object3D[];
  private gS: THREE.Object3D[];
  /** Spine mirror fix (like `fix`), measured in the pelvis space. */
  private fixS: THREE.Quaternion[];
  private pelvis: THREE.Object3D;
  /** The torso as last shown: eased towards the target, so the lead hand changes without a jump. */
  private bodyQ: THREE.Quaternion[];
  private bodyInit = false;

  constructor(model: THREE.Object3D, clips: Record<AttackAnim | 'Idle', THREE.AnimationClip>) {
    this.ghost = copyBones(model);
    const arm = new Set<string>();
    model.getObjectByName('clavicle_r')?.traverse((o) => arm.add(o.name));
    for (const n of SPINE) arm.add(n);
    this.mixer = new THREE.AnimationMixer(this.ghost);
    const act = (clip: THREE.AnimationClip) => {
      const c = new THREE.AnimationClip(clip.name + '_arm', clip.duration,
        clip.tracks.filter((t) => t.name.endsWith('.quaternion') && arm.has(t.name.split('.')[0])));
      const a = this.mixer.clipAction(c);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      return a;
    };
    this.actions = { SwordAttack: act(clips.SwordAttack), AxeAttack: act(clips.AxeAttack) };
    const bones = (root: THREE.Object3D, side: string) => CHAIN.map((n) => root.getObjectByName(`${n}_${side}`)!);
    this.real = [bones(model, 'r'), bones(model, 'l')];
    this.gR = bones(this.ghost, 'r');
    this.gL = bones(this.ghost, 'l');
    this.realS = SPINE.map((n) => model.getObjectByName(n)!);
    this.gS = SPINE.map((n) => this.ghost.getObjectByName(n)!);
    this.pelvis = this.gS[0].parent!;
    this.bodyQ = SPINE.map(() => new THREE.Quaternion());
    const rest = new Map<THREE.Object3D, THREE.Quaternion>();
    this.ghost.traverse((o) => rest.set(o, o.quaternion.clone()));
    const idle = this.mixer.clipAction(new THREE.AnimationClip('Idle_arm', clips.Idle.duration,
      clips.Idle.tracks.filter((t) => t.name.endsWith('.quaternion'))));
    idle.play();
    this.mixer.update(0);
    // relative to the chest: Idle turns the spine, a mirror of that would leak into the fix
    this.chest = this.gL[0].parent!;
    this.fix = CHAIN.map((_, i) =>
      mirror(modelQ(this.gR[i], this.chest, new THREE.Quaternion())).invert().multiply(modelQ(this.gL[i], this.chest, qa)));
    this.fixS = SPINE.map((_, i) =>
      mirror(modelQ(this.gS[i], this.pelvis, new THREE.Quaternion())).invert().multiply(modelQ(this.gS[i], this.pelvis, qa)));
    idle.stop();
    for (const [o, q] of rest) o.quaternion.copy(q);
  }

  duration(anim: AttackAnim) { return this.actions[anim].getClip().duration; }

  /** The weapon in the left hand (rig.ts attachWeapon holder), or null. */
  setLeft(holder: THREE.Object3D | null) {
    this.left = holder;
    if (!holder) return;
    this.leftIdle.copy(holder.quaternion);
    this.leftRight.copy(holder.userData.rightQ as THREE.Quaternion);
    // a weapon is symmetric across its flat plane: its mirror image is the weapon turned half round its shaft when
    // the head reaches out along X, and the weapon itself when along Z
    this.leftFlip.setFromAxisAngle(AXIS_Y, holder.userData.wideX ? Math.PI : 0);
  }

  /** Before the swings of a frame: the left weapon back in its idle grip. */
  resetLeft() { this.left?.quaternion.copy(this.leftIdle); }

  /**
   * The torso and head after the swings of a frame: the clip pose of the lead swing (mirrored for the left hand),
   * blended by `w` over the current pose; `anim` null — back to the current pose. Eased by `k` (0..1).
   */
  body(anim: AttackAnim | null, hand: 0 | 1, t: number, w: number, k: number) {
    const real = this.realS;
    if (!this.bodyInit) { for (let i = 0; i < SPINE.length; i++) this.bodyQ[i].copy(real[i].quaternion); this.bodyInit = true; }
    if (anim) this.pose(anim, t);
    qParent.identity();
    for (let i = 0; i < SPINE.length; i++) {
      qBase.copy(real[i].quaternion);
      if (anim) {
        modelQ(this.gS[i], this.pelvis, qTarget);
        if (hand) mirror(qTarget).multiply(this.fixS[i]);
        qb.copy(qParent).invert().multiply(qTarget);
        qParent.copy(qTarget);
        qBase.slerp(qb, w);
      }
      real[i].quaternion.copy(this.bodyQ[i].slerp(qBase, k));
    }
  }

  private pose(anim: AttackAnim, t: number) {
    const a = this.actions[anim];
    if (this.current !== a) {
      this.current?.stop();
      a.reset().play();
      this.current = a;
    }
    a.time = Math.min(t, a.getClip().duration);
    this.mixer.update(0);
  }

  /** Puts the arm of `hand` at clip time `t`, blended by `w` over its current pose (after the main mixer). */
  apply(anim: AttackAnim, hand: 0 | 1, t: number, w: number) {
    this.pose(anim, t);
    const real = this.real[hand];
    if (hand === 0) {
      for (let i = 0; i < CHAIN.length; i++) real[i].quaternion.slerp(this.gR[i].quaternion, w);
      return;
    }
    // left: mirrored chest-space rotations, turned back into locals down the chain
    qParent.identity();
    for (let i = 0; i < CHAIN.length; i++) {
      mirror(modelQ(this.gR[i], this.chest, qTarget)).multiply(this.fix[i]);
      qb.copy(qParent).invert().multiply(qTarget);
      real[i].quaternion.slerp(qb, w);
      qParent.copy(qTarget);
    }
    // the weapon: the exact mirror image of the same weapon in the right hand, not the idle grip carried along
    // (the left grip is fitted to the asymmetric Idle pose and twists the blade in a swing)
    if (this.left) {
      mirror(modelQ(this.gR[CHAIN.length - 1], this.chest, qb).multiply(this.leftRight)).multiply(this.leftFlip);
      qa.copy(qParent).invert().multiply(qb);
      this.left.quaternion.slerp(qa, w);
    }
  }
}
