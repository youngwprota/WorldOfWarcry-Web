// Attack clips on one arm: the rig only has right-handed attacks. The clip is evaluated on a bone-only copy of the
// skeleton, then the right arm copies it as is and the left arm gets its mirror image (across the character's X).
import * as THREE from 'three';
import type { AttackAnim } from './config';

const CHAIN = ['clavicle', 'upperarm', 'lowerarm', 'hand'];
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const qTarget = new THREE.Quaternion();

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
  /** Left bone = mirror(right bone) × fix, both relative to the model (measured on the rest pose). */
  private fix: THREE.Quaternion[];
  private current: THREE.AnimationAction | null = null;

  constructor(model: THREE.Object3D, clips: Record<AttackAnim, THREE.AnimationClip>) {
    this.ghost = copyBones(model);
    const arm = new Set<string>();
    model.getObjectByName('clavicle_r')?.traverse((o) => arm.add(o.name));
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
    this.fix = CHAIN.map((_, i) =>
      mirror(modelQ(this.gR[i], this.ghost, new THREE.Quaternion())).invert().multiply(modelQ(this.gL[i], this.ghost, qa)));
  }

  duration(anim: AttackAnim) { return this.actions[anim].getClip().duration; }

  /** Puts the arm of `hand` at clip time `t`, blended by `w` over its current pose (after the main mixer). */
  apply(anim: AttackAnim, hand: 0 | 1, t: number, w: number) {
    const a = this.actions[anim];
    if (this.current !== a) {
      this.current?.stop();
      a.reset().play();
      this.current = a;
    }
    a.time = Math.min(t, a.getClip().duration);
    this.mixer.update(0);
    const real = this.real[hand];
    if (hand === 0) {
      for (let i = 0; i < CHAIN.length; i++) real[i].quaternion.slerp(this.gR[i].quaternion, w);
      return;
    }
    // left: mirrored model-space rotations, turned back into locals down the chain (the ghost's torso stays at rest)
    modelQ(this.gL[0].parent!, this.ghost, qParent);
    for (let i = 0; i < CHAIN.length; i++) {
      mirror(modelQ(this.gR[i], this.ghost, qTarget)).multiply(this.fix[i]);
      qb.copy(qParent).invert().multiply(qTarget);
      real[i].quaternion.slerp(qb, w);
      qParent.copy(qTarget);
    }
  }
}
