import * as THREE from 'three';
import type { OrbKind } from './config';

const tmp = new THREE.Vector3();

/** Pooled DOM labels projected from world space (damage numbers, pickups, barks). */
export class FloatingText {
  private pool: { el: HTMLDivElement; pos: THREE.Vector3; t: number; life: number; vy: number; lift: number; active: boolean }[] = [];

  constructor(layer: HTMLElement, private camera: THREE.Camera) {
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'ftext';
      layer.appendChild(el);
      this.pool.push({ el, pos: new THREE.Vector3(), t: 0, life: 1, vy: 0, lift: 0, active: false });
    }
  }

  /** `lift`: extra screen px upwards, to start above an over-head block (HP bar, reward chips). */
  spawn(pos: THREE.Vector3, text: string, cls: string, life = 0.8, opts: { html?: boolean; color?: string; lift?: number } = {}) {
    let p = this.pool.find((x) => !x.active);
    if (!p) p = this.pool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    p.active = true;
    p.t = 0;
    p.life = life;
    p.vy = 1.6;
    p.lift = opts.lift ?? 0;
    p.pos.copy(pos);
    p.pos.x += (Math.random() - 0.5) * 0.6;
    p.el.className = 'ftext show ' + cls;
    if (opts.html) p.el.innerHTML = text; else p.el.textContent = text;
    p.el.style.color = opts.color ?? '';
  }

  update(dt: number, w: number, h: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) { p.active = false; p.el.className = 'ftext'; continue; }
      p.pos.y += p.vy * dt;
      p.vy *= 0.92;
      tmp.copy(p.pos).project(this.camera);
      const k = p.t / p.life;
      const pop = k < 0.12 ? 0.6 + k * 5 : 1.2 - Math.min(0.2, (k - 0.12));
      p.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h - p.lift}px) translate(-50%,-50%) scale(${pop})`;
      p.el.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
    }
  }
}

interface Particle { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; t: number; life: number; active: boolean; }

/** Debris chunks and sparks (instanced would be cheaper; pooled meshes are enough here). */
export class Particles {
  private pool: Particle[] = [];
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private mats = new Map<number, THREE.MeshLambertMaterial>();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 160; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat(0xffffff));
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, life: 1, active: false });
    }
  }

  private mat(color: number) {
    let m = this.mats.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); this.mats.set(color, m); }
    return m;
  }

  burst(pos: THREE.Vector3, color: number, count: number, size: number, speed: number, life = 0.9) {
    for (let i = 0; i < count; i++) {
      const p = this.pool.find((x) => !x.active);
      if (!p) return;
      p.active = true;
      p.t = 0;
      p.life = life * (0.7 + Math.random() * 0.6);
      p.mesh.material = this.mat(color);
      p.mesh.visible = true;
      p.mesh.position.copy(pos);
      const s = size * (0.5 + Math.random());
      p.mesh.scale.set(s, s, s);
      const a = Math.random() * Math.PI * 2;
      const up = 0.5 + Math.random();
      p.vel.set(Math.cos(a) * speed * Math.random(), up * speed, Math.sin(a) * speed * Math.random());
      p.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) { p.active = false; p.mesh.visible = false; continue; }
      p.vel.y -= 18 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < p.mesh.scale.y * 0.5) {
        p.mesh.position.y = p.mesh.scale.y * 0.5;
        p.vel.y *= -0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      const k = 1 - Math.max(0, (p.t - p.life * 0.6) / (p.life * 0.4));
      p.mesh.scale.setScalar(Math.max(0.001, p.mesh.scale.x * (k < 1 ? 0.95 : 1)));
    }
  }
}

/** Red ground warnings for boss attacks (GDD 10.6: 1–1.5 s, just run out of it). */
export class Telegraphs {
  private items: {
    outer: THREE.Mesh; inner: THREE.Mesh; t: number; dur: number; r: number; cb: (tag?: unknown) => void; tag?: unknown;
    ball?: THREE.Mesh; from?: THREE.Vector3; to?: THREE.Vector3;
  }[] = [];
  private ringGeo = new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2);
  private discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private ballGeo = new THREE.SphereGeometry(0.25, 8, 6);
  private sectors = new Map<number, { fill: THREE.BufferGeometry; arc: THREE.BufferGeometry }>();
  private outerMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, depthWrite: false });
  private fillMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.28, depthWrite: false });
  private innerMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.45, depthWrite: false });
  private ballMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });

  constructor(private scene: THREE.Scene) {}

  /** A circle; `from` makes a ball fly from that point and land in it when the time is up. */
  add(pos: THREE.Vector3, r: number, dur: number, cb: (tag?: unknown) => void, tag?: unknown, from?: THREE.Vector3) {
    const outer = new THREE.Mesh(this.ringGeo, this.outerMat);
    const fill = new THREE.Mesh(this.discGeo, this.fillMat);
    outer.add(fill);
    const inner = new THREE.Mesh(this.discGeo, this.innerMat);
    this.push(outer, inner, pos, r, dur, cb, tag);
    if (!from) return;
    const it = this.items[this.items.length - 1];
    it.ball = new THREE.Mesh(this.ballGeo, this.ballMat);
    it.from = from.clone();
    it.to = pos.clone().setY(0.3);
    this.scene.add(it.ball);
  }

  /** A sector of radius `len` around the direction `yaw` (0 = +Z), `half` rad to each side. */
  addCone(pos: THREE.Vector3, yaw: number, half: number, len: number, dur: number, cb: (tag?: unknown) => void, tag?: unknown) {
    let g = this.sectors.get(half);
    if (!g) {
      g = {
        fill: new THREE.CircleGeometry(1, 24, -half, half * 2).rotateX(-Math.PI / 2),
        arc: new THREE.RingGeometry(0.97, 1, 24, 1, -half, half * 2).rotateX(-Math.PI / 2),
      };
      this.sectors.set(half, g);
    }
    const outer = new THREE.Mesh(g.arc, this.outerMat);
    outer.add(new THREE.Mesh(g.fill, this.fillMat));
    const inner = new THREE.Mesh(g.fill, this.innerMat);
    // the sector geometry points along +X; rotation.y = yaw - pi/2 turns it to the (sin yaw, cos yaw) direction
    outer.rotation.y = inner.rotation.y = yaw - Math.PI / 2;
    this.push(outer, inner, pos, len, dur, cb, tag);
  }

  private push(outer: THREE.Mesh, inner: THREE.Mesh, pos: THREE.Vector3, r: number, dur: number, cb: (tag?: unknown) => void, tag?: unknown) {
    outer.position.set(pos.x, 0.04, pos.z);
    inner.position.set(pos.x, 0.05, pos.z);
    outer.scale.setScalar(r);
    inner.scale.setScalar(0.001);
    this.scene.add(outer, inner);
    this.items.push({ outer, inner, t: 0, dur, r, cb, tag });
  }

  clear() {
    for (const it of this.items) this.remove(it);
    this.items.length = 0;
  }

  private remove(it: Telegraphs['items'][number]) {
    this.scene.remove(it.outer, it.inner);
    if (it.ball) this.scene.remove(it.ball);
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.inner.scale.setScalar(Math.max(0.001, it.r * k));
      if (it.ball) {
        it.ball.position.lerpVectors(it.from!, it.to!, k);
        it.ball.position.y += Math.sin(Math.PI * k) * 3;
      }
      if (it.t >= it.dur) {
        this.remove(it);
        this.items.splice(i, 1);
        it.cb(it.tag);
      }
    }
  }
}

export type PickupKind = OrbKind;
/** `hist`: the last TRAIL_N flight positions (newest at `head`), `hn` of them filled. */
interface Pickup { pos: THREE.Vector3; vel: THREE.Vector3; t: number; phase: number; hist: Float32Array; head: number; hn: number }

const PICKUP_CAP = 120;
const BURST_T = 0.2;
const TRAIL_N = 14;
const TRAIL_W = 0.17;
/** × the twinkle life (0.45 s, game.ts) ≈ 9 alive round each drop. */
const SPARK_RATE = 20;
const TRAIL_SLOTS = PICKUP_CAP * 4;
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const side = new THREE.Vector3();
/** Drop colours: the ORBS hues, softened toward the game's painted palette. */
export const DROP_TINT: Record<PickupKind, number> = { power: 0xc8553d, hp: 0x6fb46a, regen: 0x5ea8c4, speed: 0xd9ad4f };
const pm = new THREE.Matrix4();
const pq = new THREE.Quaternion();
const pe = new THREE.Euler();
const ps = new THREE.Vector3();
const pp = new THREE.Vector3();

/** Shapes are faceted (non-indexed, flat normals) and centred on the origin, about 0.4 m across. */
function pickupGeo(kind: PickupKind) {
  let g: THREE.BufferGeometry;
  if (kind === 'power') g = new THREE.OctahedronGeometry(0.17).scale(0.8, 1.7, 0.8);
  else if (kind === 'hp') {
    const s = new THREE.Shape();
    s.moveTo(0, -0.18);
    s.bezierCurveTo(-0.08, -0.1, -0.2, -0.02, -0.2, 0.07);
    s.bezierCurveTo(-0.2, 0.17, -0.07, 0.2, 0, 0.1);
    s.bezierCurveTo(0.07, 0.2, 0.2, 0.17, 0.2, 0.07);
    s.bezierCurveTo(0.2, -0.02, 0.08, -0.1, 0, -0.18);
    g = new THREE.ExtrudeGeometry(s, { depth: 0.08, curveSegments: 5, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 1 });
  } else if (kind === 'regen') {
    // lathe profile bottom-up: round belly (circle r 0.13 at y -0.05), then the tapering point
    const pts: THREE.Vector2[] = [];
    for (const deg of [-90, -70, -45, -15, 15, 40]) {
      const a = (deg * Math.PI) / 180;
      pts.push(new THREE.Vector2(Math.cos(a) * 0.13, -0.05 + Math.sin(a) * 0.13));
    }
    pts.push(new THREE.Vector2(0.05, 0.14), new THREE.Vector2(0, 0.23));
    g = new THREE.LatheGeometry(pts, 8);
  } else {
    const s = new THREE.Shape();
    s.moveTo(-0.02, 0.24);
    s.lineTo(0.12, 0.24);
    s.lineTo(0.03, 0.06);
    s.lineTo(0.12, 0.06);
    s.lineTo(-0.08, -0.24);
    s.lineTo(-0.01, -0.02);
    s.lineTo(-0.1, -0.02);
    g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false });
  }
  g.center();
  g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/**
 * Stat drops (GDD 4: "сами притягиваются"): pop out, then steer smoothly into the hero, each with a glowing ribbon
 * trail. Every stat has its own shape and idle motion (power: spinning crystal, hp: beating heart, regen: bobbing
 * drop, speed: flickering bolt). One InstancedMesh per stat plus one mesh for all trails: five draw calls at most.
 */
export class Pickups {
  private live: Record<PickupKind, Pickup[]> = { power: [], hp: [], regen: [], speed: [] };
  private free: Pickup[] = [];
  private meshes = {} as Record<PickupKind, THREE.InstancedMesh>;
  private tints = {} as Record<PickupKind, THREE.Color>;
  private trail: THREE.Mesh;
  private tPos = new Float32Array(TRAIL_SLOTS * TRAIL_N * 2 * 3);
  private tCol = new Float32Array(TRAIL_SLOTS * TRAIL_N * 2 * 4);
  onCollect: (kind: PickupKind) => void = () => {};
  /** About SPARK_RATE times a second per drop in flight: twinkles round it that stay behind along the trail. */
  onSparkle: (pos: THREE.Vector3, kind: PickupKind) => void = () => {};
  /** A drop popped out (the spawn flash). */
  onSpawn: (pos: THREE.Vector3, kind: PickupKind) => void = () => {};
  /** A drop reached the hero (the absorb flash), right before onCollect. */
  onArrive: (pos: THREE.Vector3, kind: PickupKind) => void = () => {};

  constructor(scene: THREE.Scene, private camera: THREE.Camera) {
    // one triangle strip per drop slot: two vertices per history sample, (TRAIL_N - 1) quads
    const idx = new Uint16Array(TRAIL_SLOTS * (TRAIL_N - 1) * 6);
    let w = 0;
    for (let s = 0; s < TRAIL_SLOTS; s++) {
      for (let j = 0; j < TRAIL_N - 1; j++) {
        const a = (s * TRAIL_N + j) * 2;
        idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], w);
        w += 6;
      }
    }
    // -1 / +1 across the ribbon: the shader fades the colour to nothing at both edges (a misty, blurred band)
    const edge = new Float32Array(TRAIL_SLOTS * TRAIL_N * 2);
    for (let i = 0; i < edge.length; i++) edge[i] = i % 2 ? 1 : -1;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tCol, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.trail = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 tint; attribute float edge; varying vec4 vT; varying float vE;
        void main(){ vT = tint; vE = edge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec4 vT; varying float vE;
        void main(){ float a = 1.0 - vE * vE; a *= a; gl_FragColor = vec4(vT.rgb * (0.7 + 0.5 * a), vT.a * a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 5;
    scene.add(this.trail);
    for (const k of Object.keys(this.live) as PickupKind[]) {
      // trails a little above white: the post glow softens them into light
      this.tints[k] = new THREE.Color(DROP_TINT[k]).multiplyScalar(1.3);
      const c = new THREE.Color(DROP_TINT[k]);
      // emissive lifts the lit side a bit above white, so the post glow gives the drop a soft shine; facets still read
      const mat = new THREE.MeshLambertMaterial({ color: c.clone().multiplyScalar(0.8), emissive: c.clone().multiplyScalar(0.8) });
      const mesh = new THREE.InstancedMesh(pickupGeo(k), mat, PICKUP_CAP);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.meshes[k] = mesh;
    }
  }

  /** False when that stat's pool is full (the caller pays the drop at once). */
  spawn(pos: THREE.Vector3, kind: PickupKind) {
    const list = this.live[kind];
    if (list.length >= PICKUP_CAP) return false;
    const p = this.free.pop() ?? { pos: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, phase: 0, hist: new Float32Array(TRAIL_N * 3), head: 0, hn: 0 };
    p.t = 0;
    p.hn = 0;
    p.phase = Math.random() * Math.PI * 2;
    p.pos.copy(pos).setY(0.8);
    const a = Math.random() * Math.PI * 2;
    const s = 3 + Math.random() * 3;
    p.vel.set(Math.cos(a) * s, 5 + Math.random() * 2, Math.sin(a) * s);
    list.push(p);
    this.onSpawn(p.pos, kind);
    return true;
  }

  update(dt: number, hero: THREE.Vector3) {
    let slot = 0;
    for (const k of Object.keys(this.live) as PickupKind[]) {
      const list = this.live[k];
      const mesh = this.meshes[k];
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (this.move(p, k, dt, hero)) { this.free.push(p); continue; }
        list[n] = p;
        this.pose(p, k);
        mesh.setMatrixAt(n++, pm);
        this.ribbon(p, this.tints[k], slot++);
      }
      list.length = n;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    const g = this.trail.geometry;
    g.setDrawRange(0, slot * (TRAIL_N - 1) * 6);
    g.attributes.position.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
  }

  /**
   * True when the drop reached the hero. A short pop up and out, then steering: the velocity turns toward the hero a
   * little more every frame while the speed grows, so the path is one smooth curve with no corner.
   */
  private move(p: Pickup, k: PickupKind, dt: number, hero: THREE.Vector3) {
    p.t += dt;
    tmp.set(hero.x, 1, hero.z).sub(p.pos);
    const d = tmp.length();
    if (p.t < BURST_T) p.vel.y -= 16 * dt;
    else {
      const speed = Math.min(28, 9 + (p.t - BURST_T) * 40);
      tA.copy(tmp).multiplyScalar(speed / Math.max(d, 1e-4));
      p.vel.lerp(tA, Math.min(1, dt * (5 + (p.t - BURST_T) * 25)));
    }
    const step = p.vel.length() * dt;
    if (p.t >= BURST_T && d <= Math.max(0.45, step)) {
      this.onArrive(p.pos, k);
      this.onCollect(k);
      return true;
    }
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y < 0.35) { p.pos.y = 0.35; p.vel.y = Math.max(0, p.vel.y); }
    if (Math.random() < dt * SPARK_RATE) this.onSparkle(p.pos, k);
    p.head = (p.head + 1) % TRAIL_N;
    p.hist[p.head * 3] = p.pos.x;
    p.hist[p.head * 3 + 1] = p.pos.y;
    p.hist[p.head * 3 + 2] = p.pos.z;
    p.hn = Math.min(TRAIL_N, p.hn + 1);
    return false;
  }

  /** The `j`-th newest position of the drop's history. */
  private sample(p: Pickup, j: number, out: THREE.Vector3) {
    const i = (p.head - j + TRAIL_N) % TRAIL_N;
    return out.set(p.hist[i * 3], p.hist[i * 3 + 1], p.hist[i * 3 + 2]);
  }

  /** Writes the drop's trail into strip `slot`: camera-facing, tapering and fading from the drop backwards. */
  private ribbon(p: Pickup, c: THREE.Color, slot: number) {
    const cam = this.camera.position;
    const last = Math.max(1, p.hn - 1);
    let v = slot * TRAIL_N * 2;
    for (let j = 0; j < TRAIL_N; j++) {
      // past the filled history the strip collapses onto the oldest sample (zero width, invisible)
      const jj = Math.min(j, p.hn - 1);
      this.sample(p, jj, tA);
      // segment direction: toward the newer neighbour, or from the older one at the newest sample
      if (jj > 0) this.sample(p, jj - 1, tB).sub(tA);
      else if (p.hn > 1) tB.copy(tA).sub(this.sample(p, 1, side));
      else tB.copy(p.vel);
      side.subVectors(cam, tA).cross(tB);
      const f = j < p.hn ? 1 - j / last : 0;
      const len = side.length();
      if (len > 1e-6) side.multiplyScalar((TRAIL_W * f) / len); else side.set(0, 0, 0);
      const a = f * f;
      for (let s = -1; s <= 1; s += 2) {
        this.tPos[v * 3] = tA.x + side.x * s;
        this.tPos[v * 3 + 1] = tA.y + side.y * s;
        this.tPos[v * 3 + 2] = tA.z + side.z * s;
        this.tCol[v * 4] = c.r;
        this.tCol[v * 4 + 1] = c.g;
        this.tCol[v * 4 + 2] = c.b;
        this.tCol[v * 4 + 3] = a;
        v++;
      }
    }
  }

  /** Writes the drop's matrix into `pm`: the stat's idle motion on top of its flight position. */
  private pose(p: Pickup, k: PickupKind) {
    const t = p.t + p.phase;
    // grows out of nothing over the first 0.15 s
    let s = Math.min(1, p.t / 0.15);
    let bob = 0;
    if (k === 'power') {
      pe.set(0.25, t * 6, 0.15);
      bob = Math.sin(t * 4) * 0.05;
    } else if (k === 'hp') {
      // lub-dub: two quick pulses, then a rest, 1.2 beats a second
      const b = (t * 1.2) % 1;
      s *= 1 + 0.22 * Math.exp(-((b - 0.08) ** 2) * 900) + 0.14 * Math.exp(-((b - 0.26) ** 2) * 900);
      pe.set(0, Math.sin(t * 2.2) * 0.7, 0);
      bob = Math.sin(t * 3) * 0.04;
    } else if (k === 'regen') {
      pe.set(Math.sin(t * 3.1) * 0.25, t * 1.5, Math.cos(t * 2.7) * 0.25);
      bob = Math.sin(t * 5) * 0.08;
    } else {
      s *= 0.9 + Math.random() * 0.25;
      // leans into its flight like a thrown spark
      pe.set(Math.max(-0.6, Math.min(0.6, p.vel.z * 0.06)), t * 7, Math.max(-0.6, Math.min(0.6, -p.vel.x * 0.06)));
    }
    pq.setFromEuler(pe);
    ps.setScalar(Math.max(0.001, s));
    pp.copy(p.pos);
    pp.y += bob;
    pm.compose(pp, pq, ps);
  }
}

const AURA_LIFE = 0.75;
/** Playback rate of the whole aura (timing, streaks, arc) over its authored AURA_LIFE. */
const AURA_SPEED = 1.1;
const AURA_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

type AuraUniforms = { uC: { value: THREE.Color }; uA: { value: number }; uT: { value: number } };
interface Aura { group: THREE.Group; column: THREE.Mesh; arc: THREE.Mesh; u: AuraUniforms; t: number }

const auraMat = (u: AuraUniforms, frag: string) => new THREE.ShaderMaterial({
  uniforms: u, vertexShader: AURA_VERT, fragmentShader: frag,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

/**
 * The buff column a hero gets when a stat drop sinks in: a see-through glowing cylinder with light streaks running up
 * it and a band rising, and a swirl arc round the body, all in the stat's colour.
 * One per stat, following the hero; a drop arriving while it shows re-pulses it instead of adding another.
 */
export class StatAuras {
  private auras = {} as Record<PickupKind, Aura>;

  constructor(scene: THREE.Scene) {
    const colGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.9, 28, 1, true).translate(0, 0.95, 0);
    const arcGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.07, 20, 1, true, 0, 2.2);
    for (const k of Object.keys(DROP_TINT) as PickupKind[]) {
      const u = { uC: { value: new THREE.Color(DROP_TINT[k]).multiplyScalar(1.3) }, uA: { value: 0 }, uT: { value: 0 } };
      // uv.x runs round the column, uv.y bottom to top; 14 columns of which about half carry a streak
      const column = new THREE.Mesh(colGeo, auraMat(u, `uniform vec3 uC; uniform float uA; uniform float uT; varying vec2 vUv;
        void main(){
          float body = pow(max(1.0 - vUv.y, 1e-4), 1.6) * 0.3;
          float c = floor(vUv.x * 14.0); float h = fract(sin(c * 12.9898) * 43758.5);
          float line = (1.0 - smoothstep(0.0, 0.12, abs(fract(vUv.x * 14.0) - 0.5))) * step(0.45, h);
          float seg = fract(vUv.y * 0.9 - uT * (1.2 + h) + h);
          float streak = line * smoothstep(0.0, 0.5, seg) * smoothstep(1.0, 0.7, seg) * (1.0 - vUv.y * 0.5);
          // squared by hand: pow() of a negative base is NaN on GPUs, and one NaN pixel wrecks the post glow blur
          float bd = (vUv.y - uT * 1.3) * 14.0;
          float band = exp(-bd * bd) * 0.5;
          float foot = smoothstep(0.06, 0.0, vUv.y) * 0.6;
          gl_FragColor = vec4(uC * (1.0 + streak), uA * (body + streak * 0.9 + band + foot)); }`));
      // the arc's tail fades along its sweep
      const arc = new THREE.Mesh(arcGeo, auraMat(u, `uniform vec3 uC; uniform float uA; varying vec2 vUv;
        void main(){ float a = vUv.x * vUv.x * (1.0 - abs(vUv.y - 0.5) * 2.0); gl_FragColor = vec4(uC * 1.4, uA * a * 1.2); }`));
      const group = new THREE.Group();
      group.add(column, arc);
      group.visible = false;
      column.renderOrder = arc.renderOrder = 5;
      scene.add(group);
      this.auras[k] = { group, column, arc, u, t: AURA_LIFE };
    }
  }

  trigger(k: PickupKind) {
    const a = this.auras[k];
    // a fresh one starts from the beginning; one already showing jumps back to full without the grow-in
    a.t = a.t >= AURA_LIFE ? 0 : Math.min(a.t, 0.12);
    a.group.visible = true;
  }

  update(dt: number, hero: THREE.Vector3) {
    for (const k of Object.keys(this.auras) as PickupKind[]) {
      const a = this.auras[k];
      if (a.t >= AURA_LIFE) continue;
      a.t += dt * AURA_SPEED;
      if (a.t >= AURA_LIFE) { a.group.visible = false; continue; }
      const x = a.t / AURA_LIFE;
      // quick swell in, a hold, then a soft fade
      const env = Math.min(1, a.t / 0.08) * (x < 0.45 ? 1 : 1 - (x - 0.45) / 0.55);
      a.u.uA.value = env;
      a.u.uT.value = a.t;
      a.group.position.set(hero.x, 0, hero.z);
      const s = 0.85 + 0.15 * Math.min(1, a.t / 0.15);
      a.column.scale.set(s, 0.9 + 0.1 * x, s);
      a.arc.rotation.y = -a.t * 9;
      a.arc.position.y = 0.3 + x * 1.1;
    }
  }
}

/** Expanding ground ring for combo finishers. */
export class Shockwaves {
  private items: { mesh: THREE.Mesh; t: number; dur: number; r: number }[] = [];
  private geo = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);

  constructor(private scene: THREE.Scene) {}

  add(pos: THREE.Vector3, radius: number, color: number, dur = 0.35) {
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    mesh.position.set(pos.x, 0.08, pos.z);
    this.scene.add(mesh);
    this.items.push({ mesh, t: 0, dur, r: radius });
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.mesh.scale.setScalar(0.3 + it.r * (1 - (1 - k) * (1 - k)));
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.scene.remove(it.mesh);
        (it.mesh.material as THREE.Material).dispose();
        this.items.splice(i, 1);
      }
    }
  }
}

export interface Bolt { mesh: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3 | null; t: number; dur: number }
interface Glow { mesh: THREE.Mesh; vel: THREE.Vector3; t: number; dur: number; size: number }

/**
 * Mage staff effects, all pooled: gradient bolts flying from the hand to a target, the wind orb's swirl where it
 * lands, and flame licks rising from burning mobs. Additive unlit materials, one per colour.
 */
export class Spells {
  private ball = new THREE.SphereGeometry(1, 12, 8);
  private shell = new THREE.IcosahedronGeometry(1, 1);
  private flameGeo = new THREE.OctahedronGeometry(1, 0);
  private mats = new Map<string, THREE.MeshBasicMaterial>();
  private boltMats = new Map<string, THREE.SpriteMaterial>();
  private bolts: Bolt[] = [];
  private swirls: Glow[] = [];
  private flames: Glow[] = [];

  constructor(private scene: THREE.Scene) {}

  private mat(color: number, opacity = 0.9, wireframe = false) {
    const key = `${color}/${opacity}/${wireframe}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, wireframe, blending: THREE.AdditiveBlending, depthWrite: false });
      this.mats.set(key, m);
    }
    return m;
  }

  /** Bolt sprite: radial gradient from `inner` at the centre to `outer`, fading out at the rim. */
  private boltMat(inner: number, outer: number) {
    const key = `${inner}/${outer}`;
    let m = this.boltMats.get(key);
    if (!m) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
      grad.addColorStop(0, css(inner));
      grad.addColorStop(0.35, css(inner));
      grad.addColorStop(0.75, css(outer));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      this.boltMats.set(key, m);
    }
    return m;
  }

  /** A hidden pool entry, or `fresh` added to the pool and the scene. */
  private take<T extends { mesh: THREE.Object3D; t: number }>(pool: T[], fresh: T | null) {
    let it = fresh;
    if (it) { pool.push(it); this.scene.add(it.mesh); } else it = pool.find((x) => !x.mesh.visible)!;
    it.mesh.visible = true;
    it.t = 0;
    return it;
  }

  private static idle(pool: { mesh: THREE.Object3D }[]) { return pool.some((x) => !x.mesh.visible); }

  /** A sphere from `from` to `to` in `dur` s; `to` is followed live (a mob's position), aimed 1 m above it. */
  bolt(from: THREE.Vector3, to: THREE.Vector3, dur: number, colors: readonly [number, number], size = 0.16) {
    const b = this.take(this.bolts, Spells.idle(this.bolts) ? null
      : { mesh: new THREE.Sprite(), from: new THREE.Vector3(), to: null, t: 0, dur: 1 });
    b.mesh.material = this.boltMat(colors[0], colors[1]);
    b.mesh.scale.setScalar(size * 2.6);
    b.mesh.position.copy(from);
    b.from.copy(from);
    b.to = to;
    b.dur = Math.max(0.05, dur);
    return b;
  }

  /** Removes bolt `b` mid-flight. */
  drop(b: Bolt) { b.mesh.visible = false; b.to = null; }

  /** A spinning see-through sphere of `radius` m at `at` for `dur` s. */
  swirl(at: THREE.Vector3, radius: number, dur: number, color: number) {
    const s = this.take(this.swirls, Spells.idle(this.swirls) ? null
      : { mesh: new THREE.Mesh(this.shell).add(new THREE.Mesh(this.ball)) as THREE.Mesh, vel: new THREE.Vector3(), t: 0, dur: 1, size: 1 });
    s.mesh.material = this.mat(color, 0.8, true);
    (s.mesh.children[0] as THREE.Mesh).material = this.mat(color, 0.25);
    s.mesh.position.set(at.x, 0.6, at.z);
    s.dur = dur;
    s.size = radius;
  }

  /** One flame lick rising from `at`. */
  flame(at: THREE.Vector3, color: number) {
    const f = this.take(this.flames, Spells.idle(this.flames) ? null
      : { mesh: new THREE.Mesh(this.flameGeo), vel: new THREE.Vector3(), t: 0, dur: 1, size: 1 });
    f.mesh.material = this.mat(color);
    f.mesh.position.set(at.x + (Math.random() - 0.5) * 0.5, at.y + Math.random() * 0.6, at.z + (Math.random() - 0.5) * 0.5);
    f.vel.set((Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3);
    f.dur = 0.4 + Math.random() * 0.25;
    f.size = 0.07 + Math.random() * 0.06;
  }

  update(dt: number) {
    for (const b of this.bolts) {
      if (!b.mesh.visible) continue;
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      tmp.copy(b.to!).setY(b.to!.y + 1);
      b.mesh.position.lerpVectors(b.from, tmp, k);
      b.mesh.position.y += Math.sin(Math.PI * k) * 0.4;
      if (k >= 1) { b.mesh.visible = false; b.to = null; }
    }
    for (const s of this.swirls) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      const k = s.t / s.dur;
      // grows in fast, holds, then collapses into its centre
      const grow = Math.min(1, k * 5) * (k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1);
      s.mesh.scale.setScalar(Math.max(0.001, s.size * 0.45 * grow));
      s.mesh.rotation.y += dt * 9;
      s.mesh.rotation.x = Math.sin(s.t * 5) * 0.3;
      if (k >= 1) s.mesh.visible = false;
    }
    for (const f of this.flames) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const k = f.t / f.dur;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.scale.set(f.size * (1 - k), f.size * 1.8 * (1 - k), f.size * (1 - k));
      if (k >= 1) f.mesh.visible = false;
    }
  }
}

let puffTex: THREE.Texture | null = null;
/** Soft round blob, white to transparent. */
function puffTexture() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

interface Puff { sprite: THREE.Sprite; vel: THREE.Vector3; t: number; life: number; size: number; peak: number; active: boolean }

/** Drifting fog puffs (sprites): swell, rise slowly and fade. */
export class FogPuffs {
  private pool: Puff[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, count = 140) {
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      sprite.renderOrder = 2;
      scene.add(sprite);
      this.pool.push({ sprite, vel: new THREE.Vector3(), t: 0, life: 1, size: 1, peak: 0.5, active: false });
    }
  }

  /** One puff of `size` m at `pos`, peak opacity `peak`. */
  spawn(pos: THREE.Vector3, color: number, size: number, life: number, peak = 0.5) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.active = true;
    p.t = 0;
    p.life = life;
    p.size = size;
    p.peak = peak;
    p.vel.set((Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
    p.sprite.position.copy(pos);
    (p.sprite.material as THREE.SpriteMaterial).color.set(color);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
  }

  /** `count` puffs scattered over a disc of `radius` m around `pos`. */
  cloud(pos: THREE.Vector3, radius: number, color: number, count: number, life = 1.4) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      tmp.set(pos.x + Math.sin(a) * r, pos.y + 0.3 + Math.random() * 0.5, pos.z + Math.cos(a) * r);
      this.spawn(tmp, color, 1.2 + Math.random() * 1.2, life * (0.7 + Math.random() * 0.6), 0.45);
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { p.active = false; p.sprite.visible = false; continue; }
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.size * (0.6 + 0.6 * k));
      // fade in over the first fifth, out over the rest
      (p.sprite.material as THREE.SpriteMaterial).opacity = p.peak * (k < 0.2 ? k / 0.2 : (1 - k) / 0.8);
    }
  }
}

/**
 * Boss arena: a filled disc of drifting noise fog over `radius` m with no hard edge, plus wisps rising from it.
 * `set` fades it in or out, `flare` makes it brighter for a while.
 */
export class ArenaFog {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private k = 0;
  private on = false;
  private wispT = 0;
  private boost = 0;

  constructor(scene: THREE.Scene, private puffs: FogPuffs, private center: THREE.Vector3, private radius: number, private color: number) {
    const w = radius * 0.35;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uBoost: { value: 0 }, uColor: { value: new THREE.Color(color) }, uR: { value: radius }, uW: { value: w } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime, uAlpha, uBoost, uR, uW; uniform vec3 uColor; varying vec2 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
        void main(){
          float disc = smoothstep(uR + uW, uR - uW, length(vP));
          vec2 q = vP * 0.18;
          float f = fbm(q + vec2(uTime * 0.12, -uTime * 0.2)) * fbm(q * 1.7 - vec2(uTime * 0.07, uTime * 0.1));
          float a = disc * mix(0.25, 1.0, smoothstep(0.05, 0.4, f)) * uAlpha * (0.5 + 0.5 * uBoost);
          gl_FragColor = vec4(uColor * (0.8 + f + uBoost * 0.8), min(1.0, a * 0.8));
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry((radius + w * 2) * 2, (radius + w * 2) * 2), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(center.x, 0.1, center.z);
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  set(on: boolean) { this.on = on; }

  flare() { this.boost = 1; }

  update(dt: number, time: number) {
    this.k = Math.max(0, Math.min(1, this.k + (this.on ? dt : -dt) * 0.8));
    this.mesh.visible = this.k > 0;
    if (!this.mesh.visible) return;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uAlpha.value = this.k;
    // a flare holds for a moment, then fades over ~3 s
    this.boost = Math.max(0, this.boost - dt * 0.3);
    this.mat.uniforms.uBoost.value = Math.min(1, this.boost * 1.4);
    this.wispT -= dt;
    if (this.wispT > 0) return;
    this.wispT = 0.06 / (1 + this.boost * 2);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * this.radius;
    tmp.set(this.center.x + Math.sin(a) * r, 0.4, this.center.z + Math.cos(a) * r);
    this.puffs.spawn(tmp, this.color, 2 + Math.random() * 2, 2.5, (0.3 + 0.3 * this.boost) * this.k);
  }
}
