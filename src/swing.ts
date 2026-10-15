// Procedural attack swings: keyed rotations of the spine and the upper arm, applied on top of the clips
// (the rig only has two attack clips, both right-handed), plus a weapon trail ribbon.
import * as THREE from 'three';

export type SwingKind = 'slashRL' | 'slashLR' | 'thrust' | 'overhead' | 'uppercut' | 'bash' | 'sweep' | 'aim' | 'draw';

/**
 * One key, character space, radians, for the RIGHT hand (the left one is mirrored):
 * yaw — torso twist (+ turns to the hero's left), lean — torso bend forward,
 * fwd — arm raised forward (0 hangs, π/2 horizontal, π straight up), sweep — arm swung across (+ to the left),
 * out — arm raised sideways.
 */
type Key = [phase: number, yaw: number, lean: number, fwd: number, sweep: number, out: number];

// phase: 0 start → 1 the blow lands → 2 back to rest; missing ends are filled with zeros
export const KEYS: Record<SwingKind, Key[]> = {
  slashRL: [[0.6, -0.55, 0.05, 1.3, -1.1, 0.3], [1, 0, 0.2, 1.4, 0, 0.1], [1.45, 0.6, 0.15, 1.1, 1.15, 0]],
  slashLR: [[0.6, 0.6, 0.05, 1.2, 1.05, 0], [1, 0, 0.2, 1.4, 0, 0.1], [1.45, -0.6, 0.15, 1.1, -1.15, 0.35]],
  // polearm: the shaft stands ~30° up in the fist, a level shaft needs a low arm (measured in viewer.html:
  // 2° up, straight at the target at the impact); the lunge comes from the torso
  thrust: [[0.6, -0.4, -0.1, -0.7, -0.2, 0.25], [1, 0.3, 0.35, -0.15, 0.05, 0], [1.4, 0.25, 0.3, -0.2, 0.05, 0]],
  overhead: [[0.6, -0.2, -0.3, 2.7, -0.1, 0.1], [1, 0.1, 0.5, 0.9, 0.1, 0], [1.4, 0.05, 0.4, 0.7, 0.05, 0]],
  uppercut: [[0.6, -0.3, 0.45, -0.2, -0.2, 0.2], [1, 0.2, -0.3, 2.7, 0.1, 0], [1.4, 0.15, -0.2, 2.4, 0.1, 0]],
  // polearm finisher under the body spin (it starts at the impact, 0.35 s): the arm stays low and a bit out so the
  // shaft stays level (2–6° up) through the whole spin; a raised arm (slashRL) stood the polearm straight up
  sweep: [[0.6, -0.5, 0.05, -0.45, -0.3, 0.4], [1, 0.1, 0.15, -0.4, 0, 0.2], [1.7, 0.05, 0.1, -0.4, 0, 0.2]],
  bash: [[0.6, -0.45, -0.05, -0.3, -0.3, 0.2], [1, 0.4, 0.35, 0.5, 0.3, 0], [1.35, 0.35, 0.3, 0.45, 0.25, 0]],
  // bow shot: `aim` raises the bow arm (the left hand) at the target, `draw` pulls the string with the other one
  // and turns the torso side-on; the arrow leaves on the impact
  aim: [[0.45, 0, 0, 1.45, 0.2, 0], [1, 0, 0, 1.5, 0.2, 0], [1.5, 0, 0, 1.35, 0.15, 0]],
  draw: [[0.45, -0.45, 0, 1.45, 0.55, 0], [0.95, -0.5, 0, 1.35, -0.2, 0.55], [1.2, -0.45, 0, 1.2, -0.45, 0.6]],
};

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qp = new THREE.Quaternion();
const pose = [0, 0, 0, 0, 0];

interface Active { kind: SwingKind; t: number; dur: number; impact: number }

/** Swing state of one character: up to one swing per hand. */
export class Swinger {
  private hands: (Active | null)[] = [null, null];
  private spine: THREE.Object3D | null;
  private arms: (THREE.Object3D | null)[];

  constructor(private model: THREE.Object3D) {
    this.spine = model.getObjectByName('spine_01') ?? null;
    this.arms = [model.getObjectByName('upperarm_r') ?? null, model.getObjectByName('upperarm_l') ?? null];
  }

  /** `impact` s after the start the blow lands; the whole swing takes `dur` s. */
  start(kind: SwingKind, hand: 0 | 1, dur: number, impact: number) {
    const a = this.hands[hand] ?? (this.hands[hand] = { kind, t: 0, dur, impact });
    a.kind = kind; a.t = 0; a.dur = Math.max(dur, impact + 0.05); a.impact = impact;
  }

  active(hand: 0 | 1) { return !!this.hands[hand]; }

  /** Call after the mixer update: the clips have just rewritten the bones' local rotations. */
  apply(dt: number) {
    let yaw = 0, lean = 0;
    for (let h = 0; h < 2; h++) {
      const a = this.hands[h];
      if (!a) continue;
      a.t += dt;
      if (a.t >= a.dur) { this.hands[h] = null; continue; }
      const phase = a.t < a.impact ? a.t / a.impact : 1 + (a.t - a.impact) / (a.dur - a.impact);
      sample(KEYS[a.kind], phase, pose);
      const m = h ? -1 : 1; // the left hand mirrors the twist and the sweep
      yaw += pose[0] * m;
      lean += pose[1];
      const arm = this.arms[h];
      if (arm) {
        // fwd: hanging (−Y) towards +Z is a negative turn about X; out: right arm to −X is negative about Z
        rotateInModel(arm, this.model, qa.setFromAxisAngle(AXIS_Z, -pose[4] * m).premultiply(qb.setFromAxisAngle(AXIS_X, -pose[2])));
        rotateInModel(arm, this.model, qa.setFromAxisAngle(AXIS_Y, pose[3] * m));
      }
    }
    if (this.spine && (yaw || lean)) {
      rotateInModel(this.spine, this.model, qa.setFromAxisAngle(AXIS_Y, Math.max(-1.2, Math.min(1.2, yaw))).multiply(qb.setFromAxisAngle(AXIS_X, Math.min(0.7, lean))));
    }
  }
}

/** Smoothstep between keys; implicit rest keys at phase 0 and 2. */
function sample(keys: Key[], phase: number, out: number[]) {
  let prev: readonly number[] = REST0;
  let next: readonly number[] = REST2;
  for (const k of keys) {
    if (k[0] <= phase) prev = k;
    else { next = k; break; }
  }
  const span = next[0] - prev[0];
  let u = span > 0 ? (phase - prev[0]) / span : 1;
  u = u * u * (3 - 2 * u);
  for (let i = 0; i < 5; i++) out[i] = prev[i + 1] + (next[i + 1] - prev[i + 1]) * u;
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
      // a new ribbon: collapse every old sample onto the blade, or the strip would stretch from wherever they were
      // (the world origin on the very first swing) to the blade
      if (this.live <= 0) {
        for (let i = 0; i < SEG; i++) {
          this.ring.set([pA.x, pA.y, pA.z, pB.x, pB.y, pB.z], i * 6);
          this.age[i] = 99;
        }
      }
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
