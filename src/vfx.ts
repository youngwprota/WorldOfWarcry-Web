// Glow effects: soft additive particles (one draw call for all of them) and the sun's shafts on sunny locations. Colours above white feed the post glow (src/post.ts).
import * as THREE from 'three';

const v = new THREE.Vector3();
const w = new THREE.Vector3();
const nrm = new THREE.Vector3();
const sz = new THREE.Vector3();
const c = new THREE.Color();

/** Options of one glow particle burst (Glows.emit). Speeds in m/s, sizes in m. */
export interface GlowOpts {
  color: number;
  /** HDR boost of the colour (1 = as is; above ~1.3 it blooms). */
  bright?: number;
  size?: number;
  life?: number;
  /** Random speed in every direction, plus `up` straight up. */
  speed?: number;
  up?: number;
  /** A base velocity added to every particle (sparks thrown one way). */
  vel?: THREE.Vector3;
  gravity?: number;
  drag?: number;
  /** Random offset of the start point, m. */
  spread?: number;
  /** Size at the end of life as a share of the start one. */
  shrink?: number;
  shape?: GlowShape;
  /** Random spin, rad/s either way (shaped particles only show it). */
  spin?: number;
  /** Twinkle rate, Hz (each particle randomised ±40% and out of phase); 0 = steady. */
  flicker?: number;
}

export type GlowShape = 'round' | 'diamond' | 'triangle' | 'sparkle' | 'star';
const SHAPE_ID: Record<GlowShape, number> = { round: 0, diamond: 1, triangle: 2, sparkle: 3, star: 4 };

/**
 * Soft round glowing particles as one THREE.Points: sparks, motes, embers, souls, twinkles. Pooled (`max`), CPU-moved,
 * additive; each fades in fast and out over its life.
 */
export class Glows {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private base: Float32Array; // start size
  private age: Float32Array;
  private life: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private shrink: Float32Array;
  private shape: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private flick: Float32Array;
  private next = 0;
  private live = 0;
  private uPx: { value: number };

  constructor(scene: THREE.Scene, max = 1400) {
    this.n = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max);
    this.age = new Float32Array(max).fill(1);
    this.life = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.shrink = new Float32Array(max);
    this.shape = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.flick = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('shape', new THREE.BufferAttribute(this.shape, 1));
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1));
    this.uPx = { value: 400 };
    // shaped particles: signed distance (negative inside) in point space -1..1, a soft rim and a brighter centre
    const m = new THREE.ShaderMaterial({
      uniforms: { uPx: this.uPx },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; attribute float shape; attribute float rot;
        varying vec3 vC; varying float vA; varying float vS; varying vec2 vR; uniform float uPx;
        void main(){ vC = color; vA = alpha; vS = shape; vR = vec2(cos(rot), sin(rot));
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = alpha > 0.0 ? size * uPx * projectionMatrix[1][1] / -mv.z : 0.0; }`,
      fragmentShader: `varying vec3 vC; varying float vA; varying float vS; varying vec2 vR;
        float triangle(vec2 p, float r){ const float k = 1.7320508; p.x = abs(p.x) - r; p.y = p.y + r / k;
          if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0; p.x -= clamp(p.x, -2.0 * r, 0.0); return -length(p) * sign(p.y); }
        float star5(vec2 p, float r, float rf){ const vec2 k1 = vec2(0.809017, -0.587785); const vec2 k2 = vec2(-0.809017, -0.587785);
          p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2; p.x = abs(p.x); p.y -= r;
          vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0); float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
          return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y); }
        void main(){
          vec2 q = (gl_PointCoord - 0.5) * 2.0;
          if (vS < 0.5) { float d = length(q); float a = (1.0 - smoothstep(0.0, 1.0, d)); a *= a;
            float core = 1.0 - smoothstep(0.0, 0.35, d); gl_FragColor = vec4(vC * (1.0 + core), vA * a); return; }
          q = vec2(q.x * vR.x - q.y * vR.y, q.x * vR.y + q.y * vR.x); q.y = -q.y;
          float sd;
          if (vS < 1.5) sd = (abs(q.x) * 1.35 + abs(q.y) - 0.9) * 0.6;
          else if (vS < 2.5) sd = triangle(q, 0.78);
          else if (vS < 3.5) sd = (sqrt(abs(q.x)) + sqrt(abs(q.y)) - 0.92) * 0.5;
          else sd = star5(q, 0.88, 0.45);
          float a = 1.0 - smoothstep(-0.1, 0.04, sd);
          float core = 1.0 - smoothstep(-0.45, -0.1, sd);
          gl_FragColor = vec4(vC * (0.75 + 0.6 * core), vA * a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** Half the drawing-buffer height in pixels (the point size scale): set when the view size changes. */
  setViewport(heightPx: number) { this.uPx.value = heightPx / 2; }

  emit(at: THREE.Vector3, count: number, o: GlowOpts) {
    c.setHex(o.color).multiplyScalar(o.bright ?? 1);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const s = o.spread ?? 0;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * s;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * s;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * s;
      // a random direction inside the unit ball times `speed`
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((o.speed ?? 0) * (0.4 + Math.random() * 0.6));
      if (o.vel) v.add(w.copy(o.vel).multiplyScalar(0.7 + Math.random() * 0.6));
      this.vel[i * 3] = v.x;
      this.vel[i * 3 + 1] = v.y + (o.up ?? 0) * (0.6 + Math.random() * 0.8);
      this.vel[i * 3 + 2] = v.z;
      this.col[i * 3] = c.r;
      this.col[i * 3 + 1] = c.g;
      this.col[i * 3 + 2] = c.b;
      this.base[i] = (o.size ?? 0.12) * (0.6 + Math.random() * 0.8);
      this.size[i] = this.base[i];
      this.life[i] = (o.life ?? 0.8) * (0.7 + Math.random() * 0.6);
      this.age[i] = 0;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1;
      this.shrink[i] = o.shrink ?? 0.3;
      this.shape[i] = SHAPE_ID[o.shape ?? 'round'];
      this.rot[i] = Math.random() * Math.PI * 2;
      this.spin[i] = (Math.random() * 2 - 1) * (o.spin ?? 0);
      this.flick[i] = (o.flicker ?? 0) * Math.PI * 2 * (0.6 + Math.random() * 0.8);
    }
    this.live = Math.min(this.n, this.live + count);
    this.points.geometry.attributes.shape.needsUpdate = true;
  }

  update(dt: number) {
    if (this.live <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; } continue; }
      alive++;
      this.age[i] += dt;
      const k = Math.min(1, this.age[i] / this.life[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.03, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.min(1, k * 8) * (1 - k);
      if (this.flick[i] > 0) {
        // a sharp twinkle: mostly dim, brief bright peaks; the slot index offsets the phase
        const s = 0.5 + 0.5 * Math.sin(this.age[i] * this.flick[i] + i * 2.4);
        this.alpha[i] *= 0.2 + 0.8 * s * s;
      }
      this.size[i] = this.base[i] * (1 - (1 - this.shrink[i]) * k);
      this.rot[i] += this.spin[i] * dt;
    }
    this.live = alive;
    const g = this.points.geometry;
    g.attributes.rot.needsUpdate = true;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

interface Ray { mesh: THREE.Mesh; phase: number; speed: number; off: THREE.Vector2; width: number }

/**
 * Sunny locations: a few soft slanted shafts of light from the sun's side round the hero. They follow the hero
 * (no jumps), and each slowly fades in and out over half a minute or so. `strength` 0..1 by location.
 */
export class SunLight {
  private rays: Ray[] = [];
  private group = new THREE.Group();
  strength = 0;

  constructor(scene: THREE.Scene) {
    const rayMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uA; varying vec2 vUv;
        void main(){ float x = 1.0 - abs(vUv.x - 0.5) * 2.0; float a = x * x * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
          gl_FragColor = vec4(vec3(1.0, 0.94, 0.78), a * uA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const rayGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    // three shafts spread across the view above the hero, out of step with each other
    const offs: [number, number][] = [[-6, -7], [2, -10], [8, -4]];
    offs.forEach(([x, z], i) => {
      const mesh = new THREE.Mesh(rayGeo, rayMat.clone());
      mesh.renderOrder = 4;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.rays.push({ mesh, phase: i / offs.length, speed: 0.025 + i * 0.006, off: new THREE.Vector2(x, z), width: 2 + i * 0.6 });
    });
    scene.add(this.group);
  }

  /** `sunDir`: from the ground toward the sun (normalised); `camPos`: the camera; `centre`: where the hero is. */
  update(dt: number, sunDir: THREE.Vector3, camPos: THREE.Vector3, centre: THREE.Vector3) {
    this.group.visible = this.strength > 0.01;
    if (!this.group.visible) return;
    for (const r of this.rays) {
      r.phase = (r.phase + dt * r.speed) % 1;
      const pos = w.set(centre.x + r.off.x, 0, centre.z + r.off.y);
      // long axis along the sun direction, the face turned to the camera
      const right = v.subVectors(camPos, pos).cross(sunDir).negate().normalize();
      const normal = nrm.crossVectors(right, sunDir).normalize();
      r.mesh.matrix.makeBasis(right, sunDir, normal).scale(sz.set(r.width, 18, 1)).setPosition(pos);
      r.mesh.matrixWorldNeedsUpdate = true;
      // a slow, smooth swell: never a blink
      const s = 0.5 - 0.5 * Math.cos(r.phase * Math.PI * 2);
      (r.mesh.material as THREE.ShaderMaterial).uniforms.uA.value = s * s * 0.07 * this.strength;
    }
  }

  dispose() {
    this.group.removeFromParent();
    // one plane geometry shared by the three rays; the template material was never drawn
    this.rays[0]?.mesh.geometry.dispose();
    for (const r of this.rays) (r.mesh.material as THREE.Material).dispose();
    this.rays.length = 0;
  }
}
