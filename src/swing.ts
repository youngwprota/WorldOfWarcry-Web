// Procedural attack swings: keyed rotations of the spine and the upper arm, applied on top of the clips
// (the rig only has two attack clips, both right-handed), plus a weapon trail ribbon.
import * as THREE from 'three';

export type SwingKind = 'slashRL' | 'slashLR' | 'thrust' | 'overhead';

/**
 * One key, character space, radians, for the RIGHT hand (the left one is mirrored):
 * yaw — torso twist (+ turns to the hero's left), lean — torso bend forward,
 * fwd — arm raised forward (0 hangs, π/2 horizontal, π straight up), sweep — arm swung across (+ to the left),
 * out — arm raised sideways; blade (optional, 0..1) — how far the wrist turns the weapon to continue the arm (shoulder →
 * hand) instead of the idle grip that holds it upright: a slash needs a level blade, not a stick swung sideways.
 */
type Key = [phase: number, yaw: number, lean: number, fwd: number, sweep: number, out: number, blade?: number];

// phase: 0 start → 1 the blow lands → 2 back to rest; missing ends are filled with zeros
const KEYS: Record<SwingKind, Key[]> = {
  slashRL: [[0.6, -0.55, 0.05, 1.3, -1.1, 0.3], [1, 0, 0.2, 1.4, 0, 0.1], [1.45, 0.6, 0.15, 1.1, 1.15, 0]],
  slashLR: [[0.6, 0.6, 0.05, 1.2, 1.05, 0], [1, 0, 0.2, 1.4, 0, 0.1], [1.45, -0.6, 0.15, 1.1, -1.15, 0.35]],
  // the blade sits across the fist: a level blade needs a low arm, the lunge comes from the torso
  thrust: [[0.6, -0.4, -0.1, -0.4, -0.2, 0.25], [1, 0.5, 0.45, 0.25, 0.1, 0], [1.4, 0.45, 0.4, 0.2, 0.1, 0]],
  overhead: [[0.6, -0.2, -0.3, 2.7, -0.1, 0.1], [1, 0.1, 0.5, 0.9, 0.1, 0], [1.4, 0.05, 0.4, 0.7, 0.05, 0]],
};

/**
 * Two weapons: wider swings that start and end drawn back (phase 0 and 2 = the windup), and an idle hand waits drawn
 * back too — one hand strikes while the other is cocked, then they trade (a pendulum, not two pokes in front).
 */
const DUAL_WIDE: Partial<Record<SwingKind, Key[]>> = {
  slashRL: [[0, -0.7, 0, 1.25, -1.7, 0.6, 0.9], [1, 0.2, 0.15, 1.45, 0.15, 0.1, 1], [1.4, 0.65, 0.1, 1.15, 1.35, 0, 1]],
  overhead: [[0, -0.25, -0.15, 2.95, -0.2, 0.3, 0.9], [1, 0.1, 0.4, 0.8, 0.1, 0, 1], [1.4, 0.05, 0.3, 0.55, 0.05, 0, 1]],
};
const DUAL_KEYS = Object.fromEntries((Object.keys(KEYS) as SwingKind[]).map((k) => {
  const keys = DUAL_WIDE[k] ?? KEYS[k];
  // the first key is the windup: it becomes both ends of the swing
  const windup = keys[0].slice(1) as number[];
  return [k, [[0, ...windup], ...keys.slice(1), [2, ...windup]] as Key[]];
})) as Record<SwingKind, Key[]>;
/** Windup pose of each swing (yaw, lean, fwd, sweep, out): where an idle hand waits with two weapons. */
const WINDUP = Object.fromEntries((Object.keys(KEYS) as SwingKind[]).map((k) => [k, DUAL_KEYS[k][0].slice(1)])) as Record<SwingKind, number[]>;
/** Seconds after the last swing the idle hand stays drawn back. */
const COMBAT_HOLD = 1.5;
/** Upward bias of the blade over the shoulder → hand line (see Key.blade). */
const BLADE_LIFT = 0.45;

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qp = new THREE.Quaternion();
const pose = [0, 0, 0, 0, 0, 0];
const vS = new THREE.Vector3();
const vH = new THREE.Vector3();
const vCur = new THREE.Vector3();
const vWant = new THREE.Vector3();

interface Active { kind: SwingKind; t: number; dur: number; impact: number; torso: number }

/** Swing state of one character: up to one swing per hand. */
export class Swinger {
  private hands: (Active | null)[] = [null, null];
  private spine: THREE.Object3D | null;
  private arms: (THREE.Object3D | null)[];
  private wrists: (THREE.Object3D | null)[];
  /** Weapon holders (their +Y runs along the blade), set by Character.setWeapon. */
  blades: (THREE.Object3D | null)[] = [null, null];
  /** Smoothed torso twist and bend: the lead swing changes hands without a jump. */
  private yaw = 0;
  private lean = 0;
  /** Two weapons in hand: wide swings from a drawn-back hand (DUAL_KEYS). */
  dual = false;
  /** Last swing of each hand (its windup is the idle pose) and how far the idle hand is drawn back. */
  private ready: (SwingKind | null)[] = [null, null];
  private readyW = [0, 0];
  private sinceSwing = 99;

  constructor(private model: THREE.Object3D) {
    this.spine = model.getObjectByName('spine_01') ?? null;
    this.arms = [model.getObjectByName('upperarm_r') ?? null, model.getObjectByName('upperarm_l') ?? null];
    this.wrists = [model.getObjectByName('hand_r') ?? null, model.getObjectByName('hand_l') ?? null];
  }

  /** `impact` s after the start the blow lands; the whole swing takes `dur` s; `torso` scales the twist and bend. */
  start(kind: SwingKind, hand: 0 | 1, dur: number, impact: number, torso = 1) {
    const a = this.hands[hand] ?? (this.hands[hand] = { kind, t: 0, dur, impact, torso });
    a.kind = kind; a.t = 0; a.dur = Math.max(dur, impact + 0.05); a.impact = impact; a.torso = torso;
    this.ready[hand] = kind;
    this.sinceSwing = 0;
  }

  active(hand: 0 | 1) { return !!this.hands[hand]; }

  /** Call after the mixer update: the clips have just rewritten the bones' local rotations. */
  apply(dt: number) {
    let yaw = 0, lean = 0;
    // the torso follows only the latest swing: two hands twisting it at once made it jerk back and forth
    let lead = -1, leadT = Infinity;
    for (let h = 0; h < 2; h++) {
      const a = this.hands[h];
      if (a && a.t + dt < a.dur && a.t < leadT) { lead = h; leadT = a.t; }
    }
    this.sinceSwing += dt;
    const k = 1 - Math.exp(-dt * 16);
    for (let h = 0; h < 2; h++) {
      let a = this.hands[h];
      if (a) {
        a.t += dt;
        if (a.t >= a.dur) { this.hands[h] = a = null; }
      }
      const m = h ? -1 : 1; // the left hand mirrors the twist and the sweep
      if (a) {
        const phase = a.t < a.impact ? a.t / a.impact : 1 + (a.t - a.impact) / (a.dur - a.impact);
        sample(this.dual ? DUAL_KEYS[a.kind] : KEYS[a.kind], phase, pose);
        if (h === lead) { yaw = pose[0] * m * a.torso; lean = pose[1] * a.torso * a.torso; }
        this.readyW[h] = this.dual ? 1 : 0;
      } else {
        // two weapons in a fight: the idle hand waits drawn back for its next blow, then eases down
        const r = this.ready[h];
        const want = this.dual && r && this.sinceSwing < COMBAT_HOLD ? 1 : 0;
        this.readyW[h] += (want - this.readyW[h]) * (want ? k : 1 - Math.exp(-dt * 4));
        if (!r || this.readyW[h] < 0.01) continue;
        const w = WINDUP[r];
        for (let i = 0; i < 6; i++) pose[i] = w[i] * this.readyW[h];
      }
      const arm = this.arms[h];
      if (arm) {
        // fwd: hanging (−Y) towards +Z is a negative turn about X; out: right arm to −X is negative about Z
        rotateInModel(arm, this.model, qa.setFromAxisAngle(AXIS_Z, -pose[4] * m).premultiply(qb.setFromAxisAngle(AXIS_X, -pose[2])));
        rotateInModel(arm, this.model, qa.setFromAxisAngle(AXIS_Y, pose[3] * m));
        const blade = this.blades[h], wrist = this.wrists[h];
        if (pose[5] > 0.01 && blade && wrist) {
          // turn the wrist so the blade runs on from the arm (shoulder → hand), by `blade`
          arm.updateMatrixWorld(true);
          vCur.set(0, 1, 0).applyQuaternion(blade.getWorldQuaternion(qa));
          // a little above the arm line: the arm slopes down from the shoulder, the blade should stay about level
          vWant.subVectors(wrist.getWorldPosition(vH), arm.getWorldPosition(vS)).normalize();
          vWant.y += BLADE_LIFT;
          vWant.normalize();
          vWant.lerp(vCur, 1 - Math.min(1, pose[5])).normalize();
          rotateInWorld(wrist, qa.setFromUnitVectors(vCur, vWant));
        }
      }
    }
    this.yaw += (yaw - this.yaw) * k;
    this.lean += (lean - this.lean) * k;
    if (this.spine && (Math.abs(this.yaw) > 1e-3 || Math.abs(this.lean) > 1e-3)) {
      rotateInModel(this.spine, this.model, qa.setFromAxisAngle(AXIS_Y, Math.max(-1.2, Math.min(1.2, this.yaw))).multiply(qb.setFromAxisAngle(AXIS_X, Math.min(0.7, this.lean))));
    }
  }
}

/** Smoothstep between keys; implicit rest keys at phase 0 and 2. */
function sample(keys: Key[], phase: number, out: number[]) {
  let prev: readonly (number | undefined)[] = REST0;
  let next: readonly (number | undefined)[] = REST2;
  for (const k of keys) {
    if (k[0] <= phase) prev = k;
    else { next = k; break; }
  }
  const span = next[0]! - prev[0]!;
  let u = span > 0 ? (phase - prev[0]!) / span : 0;
  u = u * u * (3 - 2 * u);
  for (let i = 0; i < 6; i++) out[i] = (prev[i + 1] ?? 0) + ((next[i + 1] ?? 0) - (prev[i + 1] ?? 0)) * u;
}
const REST0 = [0, 0, 0, 0, 0, 0, 0] as const;
const REST2 = [2, 0, 0, 0, 0, 0, 0] as const;

/** Turn a bone by `r` given in world space (its world matrices must be current). */
function rotateInWorld(bone: THREE.Object3D, r: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(qp);
  bone.quaternion.premultiply(qb.copy(qp).invert().multiply(r).multiply(qp));
}

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
