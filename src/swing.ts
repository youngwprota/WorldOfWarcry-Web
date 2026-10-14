// Procedural attack swings: keyed rotations of the spine and the upper arm, applied on top of the clips
// (the rig only has two attack clips, both right-handed), plus a weapon trail ribbon.
import * as THREE from 'three';
import type { AttackAnim } from './config';

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
/** Body keys of an IK swing, for the RIGHT hand: [phase, yaw, lean, lunge (m forward)]. */
type BodyKey = [phase: number, yaw: number, lean: number, lunge: number];
/**
 * Arm keys of an IK swing, RIGHT hand, body frame (az: 0 forward, + to the hero's left, ±180 behind; el: + up; deg):
 * [phase, hand az, hand el, reach (share of the arm's length), blade az, blade el]. The hand target is relative to the
 * shoulder; shoulder and elbow follow from it (two-bone IK), so the whole arm swings, not just the wrist.
 */
type ArmKey = [phase: number, handAz: number, handEl: number, reach: number, bladeAz: number, bladeEl: number];
interface IkSwing { arm: ArmKey[]; pole: readonly [number, number, number]; body: BodyKey[]; lift: number }

// phase: 0 windup → 1 the blow → FOLLOW_P end of the follow-through; the hand comes back the same way (lifted by `lift`)
const IK: Record<AttackAnim, IkSwing> = {
  // level cut right → left: the arm drawn back behind the right shoulder, sweeps round to the front; past the front
  // the torso twist and the wrist carry the blade across (the short arm across the chest went into the body)
  SwordAttack: {
    arm: [[0, -120, 20, 0.8, -165, 20], [0.6, -75, 12, 0.92, -100, 8], [1, 0, -3, 0.97, 35, 0], [1.3, 18, -18, 0.95, 100, -10]],
    pole: [-0.7, -1, -0.3], lift: 0,
    body: [[0, -0.6, 0, -0.04], [1, 0.1, 0.05, 0.12], [1.3, 0.5, 0.05, 0.08]],
  },
  // diagonal chop: the hand high behind the right shoulder, the axe cocked up and back, the whole arm cuts down across
  // to the front-left, the torso turning with it (straight down from above read as a vertical chop; over the top of
  // the head the fist passed in front of the big head)
  AxeAttack: {
    arm: [[0, -130, 50, 0.8, -165, 45], [0.6, -75, 45, 0.92, -120, 55], [0.85, -55, 10, 0.97, -40, 5], [1, -5, -8, 0.97, 20, -20], [1.3, 30, -30, 0.92, 55, -40]],
    pole: [-1, -0.4, 0], lift: 0.15,
    body: [[0, -0.4, -0.04, -0.05], [1, 0.15, 0.06, 0.14], [1.3, 0.35, 0.06, 0.1]],
  },
};
const FOLLOW_P = 1.3;
/** Reach of the arm on the way back to the windup. */
const RETURN_REACH = 0.95;
/** Blade length for the edge direction, share of the arm's length. */
const BLADE = 0.7;
/** s from the blow to the end of the follow-through. */
const FOLLOW_TIME = 0.12;
/** s at least for the way back to the windup. */
const BACK_TIME = 0.12;
/** With no swing of the other hand: s before the next swing of the same hand to get back to the windup. */
const OWN_BACK = 0.25;

const DEG = Math.PI / 180;
const dirOf = (az: number, el: number) =>
  new THREE.Vector3(Math.sin(az * DEG) * Math.cos(el * DEG), Math.sin(el * DEG), Math.cos(az * DEG) * Math.cos(el * DEG));
/** The keys as vectors, made once. */
const IK_V = Object.fromEntries(Object.entries(IK).map(([k, s]) => [k, s.arm.map((a) => ({
  p: a[0], hand: dirOf(a[1], a[2]), reach: a[3], blade: dirOf(a[4], a[5]),
}))])) as Record<AttackAnim, { p: number; hand: THREE.Vector3; reach: number; blade: THREE.Vector3 }[]>;

/** Hand target (share of the arm, from the shoulder) and blade direction at `p`, body frame, right hand. */
function armAt(anim: AttackAnim, p: number, hand: THREE.Vector3, blade: THREE.Vector3) {
  const keys = IK_V[anim];
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1].p) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const u = Math.max(0, Math.min(1, (p - k0.p) / (k1.p - k0.p)));
  hand.copy(k0.hand).lerp(k1.hand, u).normalize().multiplyScalar(k0.reach + (k1.reach - k0.reach) * u);
  blade.copy(k0.blade).lerp(k1.blade, u).normalize();
}

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
/** Where the edge faces at `p`: the way the blade tip moves on the cut (also while held or coming back). */
function edgeAt(anim: AttackAnim, p: number, out: THREE.Vector3) {
  const c = Math.max(0.05, Math.min(FOLLOW_P - 0.05, p));
  armAt(anim, c + 0.05, tA, tB);
  out.copy(tA).addScaledVector(tB, BLADE);
  armAt(anim, c - 0.05, tA, tB);
  return out.sub(tA).addScaledVector(tB, -BLADE);
}

/** Share of the torso twist per spine bone, bottom up: a twist on one bone only kinks the waist. */
const YAW_SHARE = [0.45, 0.3, 0.25];

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qp = new THREE.Quaternion();
const qr = new THREE.Quaternion();
const qFrame = new THREE.Quaternion();
const pose = [0, 0, 0, 0, 0];
const vHand = new THREE.Vector3();
const vBlade = new THREE.Vector3();
const vEdge = new THREE.Vector3();
const vPole = new THREE.Vector3();
const vS = new THREE.Vector3();
const vE = new THREE.Vector3();
const vW = new THREE.Vector3();
const vT = new THREE.Vector3();
const vU = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const qBase = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
/** Midpoint of the shoulders and half their span: the hands' targets are taken from symmetric points around it. */
const vMid = new THREE.Vector3();
let halfSpan = 0;

/** `fin`: s to blend the arm in (longer from rest); `hit`: past the blow (IK swings). */
interface Active {
  kind: SwingKind; t: number; dur: number; impact: number; torso: number; clip: AttackAnim | null;
  fin: number; hit: boolean;
}

/**
 * What a hand holds after its IK swing's blow: phase `at` on the follow-through, `back` 0..1 of the way back to the
 * windup, blended in by `w` (fades out once neither hand swings).
 */
interface Held { anim: AttackAnim | null; at: number; back: number; w: number }

/** Swing state of one character: up to one swing per hand. */
export class Swinger {
  private hands: (Active | null)[] = [null, null];
  private spine: (THREE.Object3D | null)[];
  private arms: (THREE.Object3D | null)[];
  private chain: (THREE.Object3D | null)[][];
  /** Smoothed torso twist and bend: the lead swing changes hands without a jump. */
  private yaw = 0;
  private lean = 0;
  private lunge = 0;
  private baseZ: number;
  /** The hero: attack swings move the whole arm by IK (startClip). */
  ik = false;
  /** Weapon holders per hand (Character.setWeapon): their blade and edge are turned into the cut. */
  blades: (THREE.Object3D | null)[] = [null, null];
  private held: Held[] = [{ anim: null, at: 0, back: 0, w: 0 }, { anim: null, at: 0, back: 0, w: 0 }];

  constructor(private model: THREE.Object3D) {
    this.spine = ['spine_01', 'spine_02', 'spine_03'].map((n) => model.getObjectByName(n) ?? null);
    this.baseZ = model.position.z;
    this.arms = [model.getObjectByName('upperarm_r') ?? null, model.getObjectByName('upperarm_l') ?? null];
    this.chain = ['r', 'l'].map((s) => ['upperarm', 'lowerarm', 'hand'].map((n) => model.getObjectByName(`${n}_${s}`) ?? null));
  }

  /** `impact` s after the start the blow lands; the whole swing takes `dur` s; `torso` scales the twist and bend. */
  start(kind: SwingKind, hand: 0 | 1, dur: number, impact: number, torso = 1) {
    this.begin(hand, kind, dur, impact, torso, null);
  }

  /**
   * The attack `anim` on one arm (mirrored on the left) by IK along its keys: the blow lands `impact` s after the
   * start; the hand comes back to the windup as soon as the other hand swings, or by the end of the `period`.
   */
  startClip(anim: AttackAnim, hand: 0 | 1, period: number, impact: number, torso = 1) {
    const a = this.begin(hand, 'overhead', period, impact, torso, anim);
    // a hand still out on its follow-through (or at rest) needs longer to get to the windup
    const hd = this.held[hand];
    a.fin = 0.06 + 0.2 * (1 - (hd.anim === anim ? hd.w * hd.back : 0));
  }

  /** The weapon changed: drop the held poses. */
  resetHeld() { for (const hd of this.held) { hd.anim = null; hd.w = 0; } }

  private begin(hand: 0 | 1, kind: SwingKind, dur: number, impact: number, torso: number, clip: AttackAnim | null) {
    const a = this.hands[hand] ?? (this.hands[hand] = { kind, t: 0, dur, impact, torso, clip, fin: 0.06, hit: false });
    a.kind = kind; a.t = 0; a.dur = Math.max(dur, impact + 0.05); a.impact = impact; a.torso = torso; a.clip = clip;
    a.fin = 0.06; a.hit = false;
    return a;
  }

  active(hand: 0 | 1) { return !!this.hands[hand]; }

  /** Call after the mixer update: the clips have just rewritten the bones' local rotations. */
  apply(dt: number) {
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
      const m = h ? -1 : 1; // the left hand mirrors the twist and the sweep
      if (a.clip && this.ik) {
        if (h === lead) {
          sample(IK[a.clip].body, phaseOf(a), pose, 3);
          yaw = pose[0] * m * a.torso; lean = pose[1] * a.torso; lunge = pose[2] * a.torso;
        }
        continue; // the arm: ikArms() below, after the torso
      }
      const phase = a.t < a.impact ? a.t / a.impact : 1 + (a.t - a.impact) / (a.dur - a.impact);
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
    if (this.ik) this.ikArms(dt);
  }

  /** The arms of IK swings: the held pose (follow-through → back to the windup), then a swing's way to its blow. */
  private ikArms(dt: number) {
    let ready = false;
    for (let h = 0; h < 2; h++) {
      const a = this.hands[h];
      const o = this.hands[1 - h];
      const hd = this.held[h];
      if (a?.clip && a.t >= a.impact) {
        if (!a.hit) { a.hit = true; hd.anim = a.clip; hd.back = 0; }
        hd.at = phaseOf(a);
        hd.w = 1;
      }
      if (hd.anim && (!a || a.hit)) {
        // back to the windup together with the other hand's swing (from its start, fast at first); with no other
        // hand, over the last OWN_BACK s of the own swing; never before the own follow-through is done
        let to = 0;
        if (o?.clip && !o.hit) to = 1 - (1 - o.t / o.impact) ** 2;
        if (a) to = Math.max(to, 1 - (a.dur - a.t) / OWN_BACK);
        if (a && a.t - a.impact < FOLLOW_TIME) to = 0;
        hd.back = Math.min(1, Math.max(hd.back, Math.min(to, hd.back + dt / BACK_TIME)));
        if (!a && !o) hd.w = Math.max(0, hd.w - dt / 0.35);
        if (hd.w <= 0) hd.anim = null;
      }
      const holding = !!hd.anim && hd.w > 0.001;
      const swinging = !!a?.clip && !a.hit;
      if (!holding && !swinging) continue;
      if (!ready) {
        // the bones as the clips and the torso left them
        this.model.updateMatrixWorld(true);
        this.model.getWorldQuaternion(qFrame).multiply(qa.setFromAxisAngle(AXIS_Y, this.yaw));
        this.chain[0][0]?.getWorldPosition(v1);
        this.chain[1][0]?.getWorldPosition(v2);
        vMid.addVectors(v1, v2).multiplyScalar(0.5);
        halfSpan = v1.distanceTo(v2) / 2;
        ready = true;
      }
      if (holding) {
        const b = smooth(hd.back);
        this.ikArm(h as 0 | 1, hd.anim!, hd.at * (1 - b), Math.sin(Math.PI * b), hd.w);
      }
      // a swing on its way to the blow, over the held pose
      if (swinging) this.ikArm(h as 0 | 1, a!.clip!, phaseOf(a!), 0, Math.min(1, a!.t / a!.fin));
    }
  }

  /**
   * One arm at phase `p` of `anim` by two-bone IK, the blade and its edge turned along the cut; `back` 0..1..0 over
   * the way back to the windup; blended by `w`.
   */
  private ikArm(h: 0 | 1, anim: AttackAnim, p: number, back: number, w: number) {
    const [up, lo, hand] = this.chain[h];
    if (!up || !lo || !hand) return;
    qBase[0].copy(up.quaternion); qBase[1].copy(lo.quaternion); qBase[2].copy(hand.quaternion);
    armAt(anim, p, vHand, vBlade);
    edgeAt(anim, p, vEdge);
    const pl = IK[anim].pole;
    vPole.set(pl[0], pl[1], pl[2]);
    if (back) {
      // on the way back: the arm kept long (a folded arm brought the fist to the face), lifted by `lift`
      const lift = IK[anim].lift * back;
      vHand.setLength(vHand.length() + (RETURN_REACH - vHand.length()) * back);
      vHand.y += lift * vHand.length(); vBlade.y += lift; vBlade.normalize();
    }
    if (h) { vHand.x = -vHand.x; vBlade.x = -vBlade.x; vEdge.x = -vEdge.x; vPole.x = -vPole.x; }
    vHand.applyQuaternion(qFrame); vBlade.applyQuaternion(qFrame); vEdge.applyQuaternion(qFrame); vPole.applyQuaternion(qFrame);
    // shoulder, elbow, wrist; the target from a point mirrored across the body, not from the shoulder itself: the Idle
    // stance turns the chest (right shoulder 7 cm back, left 7 cm forward), and the right hand cut into the chest
    up.getWorldPosition(vS); lo.getWorldPosition(vE); hand.getWorldPosition(vW);
    const la = vE.distanceTo(vS), lb = vW.distanceTo(vE);
    vT.set(h ? halfSpan : -halfSpan, 0, 0).applyQuaternion(qFrame).add(vMid).addScaledVector(vHand, la + lb);
    vU.subVectors(vT, vS);
    const d = Math.max(Math.abs(la - lb) + 1e-4, Math.min((la + lb) * 0.999, vU.length()));
    vU.normalize();
    vT.copy(vS).addScaledVector(vU, d);
    const cosA = Math.max(-1, Math.min(1, (la * la + d * d - lb * lb) / (2 * la * d)));
    // the elbow bends towards the pole
    vPole.addScaledVector(vU, -vPole.dot(vU));
    if (vPole.lengthSq() < 1e-8) vPole.set(0, -1, 0);
    vPole.normalize();
    v1.copy(vS).addScaledVector(vU, la * cosA).addScaledVector(vPole, la * Math.sqrt(1 - cosA * cosA));
    aim(up, vS, vE, v1);
    lo.getWorldPosition(vE); hand.getWorldPosition(vW);
    aim(lo, vE, vW, vT);
    const holder = this.blades[h];
    if (holder) {
      // the blade along vBlade, then rolled about it so the edge leads
      holder.getWorldPosition(v1);
      holder.localToWorld(v2.set(0, holder.userData.tip as number, 0)).sub(v1).normalize();
      rotateWorld(hand, qr.setFromUnitVectors(v2, vBlade));
      const e = holder.userData.edge as THREE.Vector3 | undefined;
      if (e) {
        v1.copy(e).transformDirection(holder.matrixWorld);
        v1.addScaledVector(vBlade, -v1.dot(vBlade));
        vEdge.addScaledVector(vBlade, -vEdge.dot(vBlade));
        if (v1.lengthSq() > 1e-8 && vEdge.lengthSq() > 1e-8) {
          v1.normalize(); vEdge.normalize();
          const ang = Math.atan2(v2.crossVectors(v1, vEdge).dot(vBlade), v1.dot(vEdge));
          rotateWorld(hand, qr.setFromAxisAngle(vBlade, ang));
        }
      }
    }
    if (w < 1) {
      up.quaternion.copy(qBase[0].slerp(up.quaternion, w));
      lo.quaternion.copy(qBase[1].slerp(lo.quaternion, w));
      hand.quaternion.copy(qBase[2].slerp(hand.quaternion, w));
      up.updateMatrixWorld(true);
    }
  }
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Phase of an IK swing: windup → blow (slow out of the windup, fast into the blow) → follow-through. */
function phaseOf(a: Active) {
  if (a.t >= a.impact) return 1 + (FOLLOW_P - 1) * Math.min(1, (a.t - a.impact) / FOLLOW_TIME);
  return (a.t / a.impact) ** 1.6;
}

/** Turn `bone` so that the direction from `from` to `cur` (world) points to `to`. */
function aim(bone: THREE.Object3D, from: THREE.Vector3, cur: THREE.Vector3, to: THREE.Vector3) {
  v2.subVectors(cur, from).normalize();
  tC.subVectors(to, from).normalize();
  rotateWorld(bone, qr.setFromUnitVectors(v2, tC));
}

/** Turn `bone` by `r` given in world space; its subtree's matrices follow. */
function rotateWorld(bone: THREE.Object3D, r: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(qp);
  bone.getWorldQuaternion(qb);
  bone.quaternion.copy(qp.invert().multiply(r).multiply(qb));
  bone.updateMatrixWorld(true);
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
