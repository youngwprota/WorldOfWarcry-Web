// Glow effects: soft additive particles (one draw call for all of them) and the sun's shafts on sunny locations. Colours above white feed the post glow (src/post.ts).
import * as THREE from 'three';

const v = new THREE.Vector3();
const w = new THREE.Vector3();

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
}

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
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.uPx = { value: 400 };
    const m = new THREE.ShaderMaterial({
      uniforms: { uPx: this.uPx },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uPx;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = alpha > 0.0 ? size * uPx * projectionMatrix[1][1] / -mv.z : 0.0; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, d)); a *= a;
          float core = 1.0 - smoothstep(0.0, 0.35, d); gl_FragColor = vec4(vC * (1.0 + core), vA * a); }`,
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
    const c = new THREE.Color(o.color).multiplyScalar(o.bright ?? 1);
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
    }
    this.live = Math.min(this.n, this.live + count);
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
      this.size[i] = this.base[i] * (1 - (1 - this.shrink[i]) * k);
    }
    this.live = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
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
      const normal = new THREE.Vector3().crossVectors(right, sunDir).normalize();
      r.mesh.matrix.makeBasis(right, sunDir, normal).scale(new THREE.Vector3(r.width, 18, 1)).setPosition(pos);
      r.mesh.matrixWorldNeedsUpdate = true;
      // a slow, smooth swell: never a blink
      const s = 0.5 - 0.5 * Math.cos(r.phase * Math.PI * 2);
      (r.mesh.material as THREE.ShaderMaterial).uniforms.uA.value = s * s * 0.07 * this.strength;
    }
  }
}
