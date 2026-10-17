// Magic look of the mage orbs (WeaponDef.orb models, ORB_FX in config): the glass shell becomes a swirling nebula with
// a glowing rim, and motes fly around it in the orb's own way. Shared materials per orb kind, animated on the GPU:
// the time and the point scale are set right before drawing (onBeforeRender), so it works in any renderer.
import * as THREE from 'three';
import { ORB_FX, type OrbFx } from './config';

const time = { value: 0 };
const pxScale = { value: 300 };
const buf = new THREE.Vector2();
function tick(renderer: THREE.WebGLRenderer) {
  time.value = performance.now() / 1000;
  pxScale.value = renderer.getDrawingBufferSize(buf).y * 0.5;
}

const NOISE = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }`;

const SHELL_VS = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vP = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHELL_FS = /* glsl */ `
uniform float time;
uniform vec3 deep;
uniform vec3 glow;
uniform float swirl;
uniform float rise;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
${NOISE}
void main() {
  float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  vec3 p = vP * 2.4;
  float a = time * swirl + p.y * 1.3;
  p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
  float n = fbm(p + vec3(0.0, -time * rise, 0.0));
  float wisp = smoothstep(0.42, 0.78, n);
  float spark = smoothstep(0.86, 0.95, fbm(p * 2.7 + vec3(time * 0.3)));
  vec3 col = mix(deep, glow, wisp) * (0.5 + 1.1 * wisp) + glow * spark * 1.6 + mix(glow, vec3(1.0), 0.15) * fr * 1.3;
  float alpha = 0.22 + 0.5 * wisp + spark * 0.5 + fr * 0.85;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

// seed: angle, 0..1 radius spread, -1..1 height / latitude, 0..1 phase
const MOTE_VS = /* glsl */ `
attribute vec4 seed;
uniform float time;
uniform float scale;
uniform float speed;
uniform float radius;
uniform float size;
uniform int mode;
varying float vA;
void main() {
  float t = time * speed;
  vec3 p;
  float a;
  if (mode == 0) {
    // orbit: motes circling at different heights
    float ang = seed.x + t * (0.6 + seed.y);
    float r = radius * (1.25 + 0.4 * seed.y);
    p = vec3(cos(ang) * r, seed.z * radius * 0.7 + sin(t * 1.3 + seed.w * 6.0) * radius * 0.12, sin(ang) * r);
    a = 0.55 + 0.45 * sin(time * 4.0 + seed.w * 20.0);
  } else if (mode == 1) {
    // rise: from around the shell up into the air, fading
    float k = fract(t * 0.5 + seed.w);
    float ang = seed.x + k * 2.5;
    float r = radius * (0.65 + 0.55 * seed.y) * (1.0 - 0.45 * k);
    p = vec3(cos(ang) * r, (k * 2.6 - 0.7) * radius, sin(ang) * r);
    a = sin(k * 3.14159);
  } else {
    // shell: motes gliding over a sphere around the orb, twinkling
    float ang = seed.x + t * (0.5 + seed.y) * (seed.w > 0.5 ? 1.0 : -1.0);
    float cl = sqrt(1.0 - seed.z * seed.z);
    float r = radius * 1.32;
    p = vec3(cos(ang) * cl * r, seed.z * r, sin(ang) * cl * r);
    a = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(time * 3.0 + seed.w * 30.0), 3.0);
  }
  vA = a;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = size * length(modelMatrix[0].xyz) * scale * projectionMatrix[1][1] * (0.5 + 0.5 * a) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FS = /* glsl */ `
uniform vec3 glow;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float k = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(mix(glow, vec3(1.0), k * 0.6) * 1.4, k * vA);
}`;

interface Kind { shell: THREE.ShaderMaterial; motes: THREE.ShaderMaterial; geo: THREE.BufferGeometry; halo: THREE.SpriteMaterial }

/** Soft round glow (white, tinted per orb): the orb shines even without the forge's bloom. */
let haloTex: THREE.Texture | null = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}
const kinds = new Map<string, Kind>();

function kind(name: string, fx: OrbFx, radius: number): Kind {
  let k = kinds.get(name);
  if (k) return k;
  const glow = new THREE.Color(fx.glow), deep = new THREE.Color(fx.deep);
  const shell = new THREE.ShaderMaterial({
    vertexShader: SHELL_VS, fragmentShader: SHELL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time, deep: { value: deep }, glow: { value: glow }, swirl: { value: fx.swirl }, rise: { value: fx.rise } },
  });
  const motes = new THREE.ShaderMaterial({
    vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time, scale: pxScale, glow: { value: glow }, speed: { value: fx.speed }, radius: { value: radius },
      size: { value: radius * fx.moteSize }, mode: { value: fx.mode } },
  });
  const seed = new Float32Array(fx.motes * 4);
  for (let i = 0; i < fx.motes; i++) {
    seed[i * 4] = Math.random() * Math.PI * 2;
    seed[i * 4 + 1] = Math.random();
    seed[i * 4 + 2] = Math.random() * 2 - 1;
    seed[i * 4 + 3] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fx.motes * 3), 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const halo = new THREE.SpriteMaterial({ map: haloTexture(), color: glow, transparent: true, opacity: fx.halo, depthWrite: false,
    blending: THREE.AdditiveBlending });
  k = { shell, motes, geo, halo };
  kinds.set(name, k);
  return k;
}

/** Turns a cloned orb model `root` (model name `name`) magic: shader shell and a mote swarm. No-op for unknown orbs. */
export function magicOrb(root: THREE.Object3D, name: string) {
  const fx = ORB_FX[name];
  const shell = root.getObjectByName(name) as THREE.Mesh | undefined;
  if (!fx || !shell?.isMesh) return;
  shell.geometry.computeBoundingSphere();
  const k = kind(name, fx, shell.geometry.boundingSphere!.radius);
  shell.material = k.shell;
  shell.onBeforeRender = tick;
  const pts = new THREE.Points(k.geo, k.motes);
  pts.frustumCulled = false;
  pts.onBeforeRender = tick;
  shell.add(pts);
  const halo = new THREE.Sprite(k.halo);
  halo.scale.setScalar(shell.geometry.boundingSphere!.radius * 3.2);
  halo.renderOrder = -1;
  shell.add(halo);
}
