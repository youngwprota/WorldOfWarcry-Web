// Showcase jewels (rings / amulets, tools/blender/jewels.py) in a 3D scene: room reflections on the metal, glowing
// stones, star twinkles stuck on the piece and motes circling it — all animated on the GPU. One per renderer
// (the gacha forge, the banner showcase); `time` is set by the owner every frame.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FORGE3D } from './config';

const J = FORGE3D.jewel;

const GLINT_VS = /* glsl */ `
attribute float phase;
uniform float time;
uniform float scale;
varying float vA;
void main() {
  vA = pow(max(sin(phase * 6.2832 + time * (1.3 + fract(phase * 7.0) * 1.6)), 0.0), 14.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = scale * 2.6 * vA / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const GLINT_FS = /* glsl */ `
varying float vA;
void main() {
  vec2 p = abs(gl_PointCoord - 0.5);
  float star = max(0.0, 1.0 - p.x * 16.0) * (1.0 - p.y * 2.0) + max(0.0, 1.0 - p.y * 16.0) * (1.0 - p.x * 2.0);
  float core = smoothstep(0.16, 0.0, length(p));
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.88) * (1.0 + core * 2.0), clamp(star + core, 0.0, 1.0) * vA);
}`;
const MOTE_VS = /* glsl */ `
attribute vec4 orbit;
attribute vec3 tint;
uniform float time;
uniform float scale;
varying float vA;
varying vec3 vC;
void main() {
  float a = orbit.z + time * orbit.w;
  vec3 p = vec3(cos(a) * orbit.x, orbit.y + sin(time * 1.1 + orbit.z * 3.0) * 0.06, sin(a) * orbit.x);
  vA = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(time * 3.0 + orbit.z * 11.0), 3.0);
  vC = tint;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = scale * (0.3 + 0.5 * vA) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FS = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float k = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vC * (1.0 + k * 1.2), k * vA);
}`;

const WHITE = new THREE.Color(1, 1, 1);
const c1 = new THREE.Color();

export class JewelFx {
  readonly time = { value: 0 };
  private env: THREE.Texture;
  private glintMat: THREE.ShaderMaterial;
  private moteMat: THREE.ShaderMaterial;
  private geos: THREE.BufferGeometry[] = [];

  /** `scale`: the owner's point size uniform (canvas height × pixel ratio × 0.05, like the forge sparks). */
  constructor(renderer: THREE.WebGLRenderer, scale: { value: number }) {
    const pm = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.env = pm.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    });
    pm.dispose();
    const fx = { vertexShader: GLINT_VS, fragmentShader: GLINT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: this.time, scale } };
    this.glintMat = new THREE.ShaderMaterial(fx);
    this.moteMat = new THREE.ShaderMaterial({ ...fx, vertexShader: MOTE_VS, fragmentShader: MOTE_FS });
  }

  /** Shiny metal from the room reflections, the main stone glowing into the bloom (materials are shared: idempotent). */
  dress(model: THREE.Object3D) {
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
        mat.envMap = this.env;
        mat.envMapIntensity = J.env;
        // metal a bit darker than in the icon render, or warm lights burn it white
        if (mat.userData.base === undefined) mat.userData.base = mat.color.getHex();
        if (mat.name.startsWith('jewel_metal')) mat.color.setHex(mat.userData.base as number).multiplyScalar(J.metal);
        // the main stone glows, the small diamonds only sparkle
        mat.emissiveIntensity = mat.name.startsWith('jewel_gem') ? J.glow : J.diamond;
      }
    });
  }

  /** `count` twinkles on random vertices of the model in `wrap` (its world = identity now), `lift` off the surface. */
  sparkle(wrap: THREE.Group, lift: number, count: number) {
    const pos: number[] = [], nrm: number[] = [];
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    wrap.updateMatrixWorld(true);
    wrap.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const p = mesh.geometry.getAttribute('position'), q = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < p.count; i += 3) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        n.fromBufferAttribute(q, i).transformDirection(mesh.matrixWorld);
        pos.push(v.x, v.y, v.z);
        nrm.push(n.x, n.y, n.z);
      }
    });
    const out = new Float32Array(count * 3), phase = new Float32Array(count);
    for (let i = 0; i < count && pos.length; i++) {
      const j = Math.floor(Math.random() * (pos.length / 3)) * 3;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = pos[j + c] + nrm[j + c] * lift;
      phase[i] = Math.random();
    }
    const g = this.geo();
    g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    const pts = new THREE.Points(g, this.glintMat);
    pts.frustumCulled = false;
    wrap.add(pts);
  }

  /** `count` motes circling `parent` within `size` (its units) in `color`, some whiter. */
  motes(parent: THREE.Object3D, count: number, color: THREE.Color, size: number) {
    if (!count) return;
    const orbit = new Float32Array(count * 4), tint = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      orbit[i * 4] = size * (0.42 + Math.random() * 0.4);
      orbit[i * 4 + 1] = size * (Math.random() - 0.5) * 0.9;
      orbit[i * 4 + 2] = Math.random() * Math.PI * 2;
      orbit[i * 4 + 3] = (0.4 + Math.random() * 0.9) * (Math.random() < 0.5 ? -1 : 1);
      c1.copy(color).lerp(WHITE, Math.random() * 0.6);
      tint[i * 3] = c1.r; tint[i * 3 + 1] = c1.g; tint[i * 3 + 2] = c1.b;
    }
    const g = this.geo();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('orbit', new THREE.BufferAttribute(orbit, 4));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
    const pts = new THREE.Points(g, this.moteMat);
    pts.frustumCulled = false;
    parent.add(pts);
  }

  private geo() {
    const g = new THREE.BufferGeometry();
    this.geos.push(g);
    return g;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.glintMat.dispose();
    this.moteMat.dispose();
    this.env.dispose();
  }
}
