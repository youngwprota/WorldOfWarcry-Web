// Procedural attack swings: keyed rotations of the spine and the upper arm, applied on top of the clips
// (the rig only has two attack clips, both right-handed), plus a weapon trail ribbon.
import * as THREE from 'three';
import { ATTACK_HIT, type AttackAnim } from './config';
import type { ArmClips } from './armclip';

export type SwingKind = 'slashRL' | 'slashLR' | 'thrust' | 'overhead';

/**
 * One key, character space, radians, for the RIGHT hand (the left one is mirrored):
 * yaw — torso twist (+ turns to the hero's left), lean — torso bend forward,
 * fwd — arm raised forward (0 hangs, π/2 horizontal, π straight up), sweep — arm swung across (+ to the left),
 * out — arm raised sideways.
 */
type Key = [phase: number, yaw: number, lean: number, fwd: number, sweep: number, out: number];

// phase: 0 start → 1 the blow lands → 2 back to rest; missing ends are filled with zeros
const KEYS: Record<SwingKind, Key[]> = {
  slashRL: [[0.6, -0.55, 0.05, 1.3, -1.1, 0.3], [1, 0, 0.2, 1.4, 0, 0.1], [1.45, 0.6, 0.15, 1.1, 1.15, 0]],
  slashLR: [[0.6, 0.6, 0.05, 1.2, 1.05, 0], [1, 0, 0.2, 1.4, 0, 0.1], [1.45, -0.6, 0.15, 1.1, -1.15, 0.35]],
  // the blade sits across the fist: a level blade needs a low arm, the lunge comes from the torso
  thrust: [[0.6, -0.4, -0.1, -0.4, -0.2, 0.25], [1, 0.5, 0.45, 0.25, 0.1, 0], [1.4, 0.45, 0.4, 0.2, 0.1, 0]],
  overhead: [[0.6, -0.2, -0.3, 2.7, -0.1, 0.1], [1, 0.1, 0.5, 0.9, 0.1, 0], [1.4, 0.05, 0.4, 0.7, 0.05, 0]],
};
/**
 * Body keys of a clip swing (the arm and the clip's own spine come from ArmClips), on top of the clip, for the RIGHT
 * hand: [phase, yaw, lean, lunge (m forward)]. The whole body winds up and throws itself into the blow.
 */
type BodyKey = [phase: number, yaw: number, lean: number, lunge: number];
const BODY: Record<AttackAnim, BodyKey[]> = {
  // slash right → left: the torso winds up to the right and unwinds through the blow
  SwordAttack: [[0.55, -0.75, -0.05, -0.05], [1, 0.15, 0.2, 0.14], [1.45, 0.7, 0.12, 0.08]],
  // chop: leans back with the axe up, then bends into the blow and steps into it
  AxeAttack: [[0.6, -0.35, -0.3, -0.06], [1, 0.15, 0.3, 0.16], [1.4, 0.1, 0.2, 0.1]],
};
/**
 * Clip time of the windup a swing starts from (and a free hand holds while the other one strikes). Measured on the
 * blade: it must point up — the sword raised (0.2), the axe cocked behind the head (0.8). In between the clips hang
 * the blade down (sword 0.3–0.55, axe 0.25–0.7), and a blade held level backwards (sword 0.58) tips down as soon as
 * the other hand's chop leans the torso back. The swing goes from this pose straight to the blow, skipping the dip.
 */
const WINDUP: Record<AttackAnim, number> = { SwordAttack: 0.2, AxeAttack: 0.8 };

/** Share of the torso twist per spine bone, bottom up: a twist on one bone only kinks the waist. */
const YAW_SHARE = [0.45, 0.3, 0.25];

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qp = new THREE.Quaternion();
const pose = [0, 0, 0, 0, 0];

/** `off`: clip time of the windup the swing starts from; `fin`: s to blend the arm in (longer from rest). */
interface Active {
  kind: SwingKind; t: number; dur: number; impact: number; torso: number; clip: AttackAnim | null; k: number;
  off: number; fin: number;
}

/** Swing state of one character: up to one swing per hand. */
export class Swinger {
  private hands: (Active | null)[] = [null, null];
  private spine: (THREE.Object3D | null)[];
  private arms: (THREE.Object3D | null)[];
  /** Smoothed torso twist and bend: the lead swing changes hands without a jump. */
  private yaw = 0;
  private lean = 0;
  private lunge = 0;
  private baseZ: number;
  /** Attack clips on one arm (Character sets it): the left hand and both hands with two weapons. */
  armClips: ArmClips | null = null;
  /** Per hand: the attack clip whose windup the hand holds while the other hand swings (two weapons), or null. */
  ready: (AttackAnim | null)[] = [null, null];
  private readyW = [0, 0];

  constructor(private model: THREE.Object3D) {
    this.spine = ['spine_01', 'spine_02', 'spine_03'].map((n) => model.getObjectByName(n) ?? null);
    this.baseZ = model.position.z;
    this.arms = [model.getObjectByName('upperarm_r') ?? null, model.getObjectByName('upperarm_l') ?? null];
  }

  /** `impact` s after the start the blow lands; the whole swing takes `dur` s; `torso` scales the twist and bend. */
  start(kind: SwingKind, hand: 0 | 1, dur: number, impact: number, torso = 1) {
    this.begin(hand, kind, dur, impact, torso, null);
  }

  /**
   * The attack clip `anim` on one arm only (mirrored on the left): the blow lands `impact` s after the start, the
   * swing lasts at most `period` s and fades out at its end.
   */
  startClip(anim: AttackAnim, hand: 0 | 1, period: number, impact: number, torso = 1) {
    const k = ATTACK_HIT[anim] / impact; // clip seconds per game second
    const dur = Math.min(period, (this.armClips?.duration(anim) ?? 1) / k);
    const a = this.begin(hand, 'overhead', dur, impact, torso, anim);
    a.k = k;
    // from the windup; a hand at rest (not held up) needs longer to get there
    const r = this.ready[hand] === anim ? this.readyW[hand] : 0;
    a.off = WINDUP[anim];
    a.fin = 0.06 + 0.18 * (1 - r);
  }

  private begin(hand: 0 | 1, kind: SwingKind, dur: number, impact: number, torso: number, clip: AttackAnim | null) {
    const a = this.hands[hand] ?? (this.hands[hand] = { kind, t: 0, dur, impact, torso, clip, k: 1, off: 0, fin: 0.06 });
    a.kind = kind; a.t = 0; a.dur = Math.max(dur, impact + 0.05); a.impact = impact; a.torso = torso; a.clip = clip;
    a.off = 0; a.fin = 0.06;
    return a;
  }

  active(hand: 0 | 1) { return !!this.hands[hand]; }

  /** Call after the mixer update: the clips have just rewritten the bones' local rotations. */
  apply(dt: number) {
    this.armClips?.resetLeft();
    let yaw = 0, lean = 0, lunge = 0;
    // the torso follows only the latest swing: two hands twisting it at once made it jerk back and forth
    let lead = -1, leadT = Infinity;
    for (let h = 0; h < 2; h++) {
      const a = this.hands[h];
      if (a && a.t + dt < a.dur && a.t < leadT) { lead = h; leadT = a.t; }
    }
    for (let h = 0; h < 2; h++) {
      const a = this.hands[h];
      if (!a) continue;
      a.t += dt;
      if (a.t >= a.dur) { this.hands[h] = null; continue; }
      const phase = a.t < a.impact ? a.t / a.impact : 1 + (a.t - a.impact) / (a.dur - a.impact);
      const m = h ? -1 : 1; // the left hand mirrors the twist and the sweep
      if (a.clip && this.armClips) {
        sample(BODY[a.clip], phase, pose, 3);
        if (h === lead) { yaw = pose[0] * m * a.torso; lean = pose[1] * a.torso; lunge = pose[2] * a.torso; }
        // eased in and out, so a swing cut short by the next one does not snap
        const w = Math.min(1, a.t / a.fin, (a.dur - a.t) / 0.15);
        if (a.t < a.impact) {
          // windup pose → the blow's pose, accelerating
          this.armClips.apply(a.clip, h as 0 | 1, a.off, w);
          this.armClips.apply(a.clip, h as 0 | 1, ATTACK_HIT[a.clip], w * toBlow(a));
        } else this.armClips.apply(a.clip, h as 0 | 1, clipTime(a), w);
        continue;
      }
      sample(KEYS[a.kind], phase, pose, 5);
      if (h === lead) { yaw = pose[0] * m * a.torso; lean = pose[1] * a.torso * a.torso; }
      const arm = this.arms[h];
      if (arm) {
        // fwd: hanging (−Y) towards +Z is a negative turn about X; out: right arm to −X is negative about Z
        rotateInModel(arm, this.model, qa.setFromAxisAngle(AXIS_Z, -pose[4] * m).premultiply(qb.setFromAxisAngle(AXIS_X, -pose[2])));
        rotateInModel(arm, this.model, qa.setFromAxisAngle(AXIS_Y, pose[3] * m));
      }
    }
    const k = 1 - Math.exp(-dt * 16);
    if (this.armClips) {
      // the free hand rises into its windup while the other one swings, and holds it there
      for (let h = 0; h < 2; h++) {
        const anim = this.ready[h];
        const own = this.hands[h];
        const up = !!anim && !!this.hands[1 - h] && (!own || own.t > own.impact);
        this.readyW[h] += ((up ? 1 : 0) - this.readyW[h]) * (1 - Math.exp(-dt * 9));
        if (anim && this.readyW[h] > 0.01) this.armClips.apply(anim, h as 0 | 1, WINDUP[anim], smooth(this.readyW[h]));
      }
      // the clip's own torso and head from the lead swing
      const a = lead >= 0 ? this.hands[lead] : null;
      if (a?.clip) this.armClips.body(a.clip, lead as 0 | 1, clipTime(a), Math.min(1, a.t / a.fin, (a.dur - a.t) / 0.15), k);
      else this.armClips.body(null, 0, 0, 0, k);
    }
    this.yaw += (yaw - this.yaw) * k;
    this.lean += (lean - this.lean) * k;
    this.lunge += (lunge - this.lunge) * k;
    this.model.position.z = this.baseZ + this.lunge;
    if (Math.abs(this.yaw) > 1e-3 || Math.abs(this.lean) > 1e-3) {
      const yawAll = Math.max(-1.2, Math.min(1.2, this.yaw));
      for (let i = 0; i < 3; i++) {
        const b = this.spine[i];
        if (!b) continue;
        qa.setFromAxisAngle(AXIS_Y, yawAll * YAW_SHARE[i]);
        // the bend at the waist only
        if (i === 0) qa.multiply(qb.setFromAxisAngle(AXIS_X, Math.min(0.7, this.lean)));
        rotateInModel(b, this.model, qa);
      }
    }
  }
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** 0 → 1 on the way from the windup to the blow: slow out of the windup, fast into the blow. */
const toBlow = (a: Active) => (a.t / a.impact) ** 2;

/** Clip time of a clip swing (the torso follows it): windup → blow, then on at the clip's own pace. */
function clipTime(a: Active) {
  if (a.t >= a.impact) return ATTACK_HIT[a.clip!] + (a.t - a.impact) * a.k;
  return a.off + (ATTACK_HIT[a.clip!] - a.off) * toBlow(a);
}

/** Smoothstep between keys; implicit rest keys at phase 0 and 2. */
function sample(keys: readonly (readonly number[])[], phase: number, out: number[], n: number) {
  let prev: readonly number[] = REST0;
  let next: readonly number[] = REST2;
  for (const k of keys) {
    if (k[0] <= phase) prev = k;
    else { next = k; break; }
  }
  const span = next[0] - prev[0];
  let u = span > 0 ? (phase - prev[0]) / span : 1;
  u = u * u * (3 - 2 * u);
  for (let i = 0; i < n; i++) out[i] = prev[i + 1] + (next[i + 1] - prev[i + 1]) * u;
}
const REST0 = [0, 0, 0, 0, 0, 0] as const;
const REST2 = [2, 0, 0, 0, 0, 0] as const;

/** Turn a bone by `r` given in model space, around the bone's own pivot. */
function rotateInModel(bone: THREE.Object3D, model: THREE.Object3D, r: THREE.Quaternion) {
  // parent orientation relative to the model, from the local rotations up the chain
  qp.identity();
  for (let o = bone.parent; o && o !== model; o = o.parent) qp.premultiply(o.quaternion);
  // local' = P⁻¹ · R · P · local
  bone.quaternion.premultiply(qb.copy(qp).invert().multiply(r).multiply(qp));
}

const SEG = 14;
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();

/** Fading ribbon behind a weapon blade, in world space. */
export class Trail {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private ring = new Float32Array(SEG * 6); // base xyz, tip xyz per sample
  private age = new Float32Array(SEG).fill(99);
  private head = 0;
  private live = 0;
  private color = new THREE.Color();

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(SEG * 2 * 3);
    this.col = new Float32Array(SEG * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx: number[] = [];
    for (let i = 0; i < SEG - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** `on`: the blade is swinging, sample it; otherwise just let the ribbon fade. */
  update(dt: number, weapon: THREE.Object3D | null, on: boolean, color: number) {
    for (let i = 0; i < SEG; i++) this.age[i] += dt;
    if (on && weapon) {
      const tip = (weapon.userData.tip as number | undefined) ?? 60;
      weapon.localToWorld(pA.set(0, tip * 0.35, 0));
      weapon.localToWorld(pB.set(0, tip, 0));
      const k = this.head * 6;
      this.ring[k] = pA.x; this.ring[k + 1] = pA.y; this.ring[k + 2] = pA.z;
      this.ring[k + 3] = pB.x; this.ring[k + 4] = pB.y; this.ring[k + 5] = pB.z;
      this.age[this.head] = 0;
      this.head = (this.head + 1) % SEG;
      this.live = 0.25;
      this.color.set(color);
    }
    this.live -= dt;
    this.mesh.visible = this.live > 0;
    if (!this.mesh.visible) return;
    // oldest → newest
    for (let i = 0; i < SEG; i++) {
      const s = (this.head + i) % SEG;
      const f = Math.max(0, 1 - this.age[s] / 0.2) * (i / (SEG - 1));
      for (let e = 0; e < 2; e++) {
        const v = (i * 2 + e) * 3;
        const r = s * 6 + e * 3;
        this.pos[v] = this.ring[r]; this.pos[v + 1] = this.ring[r + 1]; this.pos[v + 2] = this.ring[r + 2];
        const w = f * (e ? 1 : 0.15);
        this.col[v] = this.color.r * w; this.col[v + 1] = this.color.g * w; this.col[v + 2] = this.color.b * w;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
