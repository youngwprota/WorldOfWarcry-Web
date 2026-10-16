// The look shared by everything in the game world: a tileable noise texture, drifting cloud shadows and wind.
// `scenery()` patches the level's Lambert materials (models placed by World): cloud shadows on the sunlit side,
// a darker base where an object meets the ground (cheap contact AO) and wind sway for foliage. The patched copies
// are cached per source material, so the shared texture atlases stay untouched for characters, the forge and the prologue.
import * as THREE from 'three';

/** Integer hash → [0, 1). */
function hash(i: number, j: number, s: number) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Tileable fbm over an n×n grid: `cells` lattice cells across the tile at the first octave. */
function tileFbm(n: number, cells: number, oct: number, seed: number) {
  const out = new Float32Array(n * n);
  for (let o = 0, amp = 1, c = cells; o < oct; o++, amp *= 0.5, c *= 2) {
    const k = c / n;
    for (let j = 0; j < n; j++) {
      const y = j * k;
      const j0 = Math.floor(y);
      const fy = y - j0;
      const vy = fy * fy * (3 - 2 * fy);
      for (let i = 0; i < n; i++) {
        const x = i * k;
        const i0 = Math.floor(x);
        const fx = x - i0;
        const vx = fx * fx * (3 - 2 * fx);
        const a = hash(i0 % c, j0 % c, seed + o);
        const b = hash((i0 + 1) % c, j0 % c, seed + o);
        const d = hash(i0 % c, (j0 + 1) % c, seed + o);
        const e = hash((i0 + 1) % c, (j0 + 1) % c, seed + o);
        out[j * n + i] += amp * (a + (b - a) * vx + (d - a) * vy + (a - b - d + e) * vx * vy);
      }
    }
  }
  // stretch to the full 0..1 range
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1);
  return out;
}

/** 256² tileable noise: r = broad fbm (clouds, big patches), g = medium, b = fine, a = medium with another seed. */
function noiseTexture() {
  const n = 256;
  const chans = [tileFbm(n, 4, 5, 11), tileFbm(n, 8, 4, 23), tileFbm(n, 16, 3, 37), tileFbm(n, 6, 4, 51)];
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = chans[c][i] * 255;
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Shared uniforms (the same objects go into every patched material). */
export const ATMOS = {
  time: { value: 0 },
  noise: { value: noiseTexture() },
  /** Cloud shadow strength 0..1 (how much sunlight a passing cloud takes away). */
  cloud: { value: 0.4 },
  /** Wind for the cloud shadows, m/s on the ground. */
  wind: { value: new THREE.Vector2(1.3, 0.75) },
};

/** GLSL: uniforms and the cloud shadow lookup (1 = sunlit … 1 - uCloud under a cloud). */
export const ATMOS_GLSL = /* glsl */ `
uniform sampler2D uAtmosNoise; uniform float uAtmosTime; uniform float uCloud; uniform vec2 uWind;
float cloudShadow(vec2 xz) {
  vec2 p = (xz - uWind * uAtmosTime) * 0.011;
  float c = texture2D(uAtmosNoise, p).r * 0.75 + texture2D(uAtmosNoise, p * 2.7 + 0.37).g * 0.25;
  return 1.0 - uCloud * smoothstep(0.5, 0.66, c);
}`;

/** Adds the shared uniforms to a shader in onBeforeCompile. */
export function atmosUniforms(sh: { uniforms: Record<string, THREE.IUniform> }) {
  sh.uniforms.uAtmosNoise = ATMOS.noise;
  sh.uniforms.uAtmosTime = ATMOS.time;
  sh.uniforms.uCloud = ATMOS.cloud;
  sh.uniforms.uWind = ATMOS.wind;
}

/**
 * How a scenery material is patched: `sway` = foliage bend in the wind (0 = rigid), `base` = contact darkening 0..1,
 * `recolor`: the instance colour repaints the leaves (green texels) by their brightness instead of multiplying the
 * whole texture — autumn or swamp foliage on the green elf trees, trunks keep their own colour.
 */
export interface SceneryLook { sway?: number; base?: number; recolor?: boolean }

const cache = new Map<THREE.Material, Map<string, THREE.Material>>();

/** Patched copy of a level material (cached per source and look). Non-Lambert materials are returned as they are. */
export function scenery(src: THREE.Material, look: SceneryLook = {}): THREE.Material {
  if (!(src as THREE.MeshLambertMaterial).isMeshLambertMaterial) return src;
  const key = `${look.sway ?? 0}|${look.base ?? 1}|${look.recolor ? 1 : 0}`;
  let byLook = cache.get(src);
  if (!byLook) cache.set(src, (byLook = new Map()));
  let m = byLook.get(key);
  if (m) return m;
  m = patchScenery(src.clone(), look);
  byLook.set(key, m);
  return m;
}

/** Patches `m` itself (for per-object materials, e.g. breakables with their own hit flash). */
export function patchScenery<M extends THREE.Material>(m: M, look: SceneryLook = {}): M {
  const uSway = { value: look.sway ?? 0 };
  const uBase = { value: look.base ?? 1 };
  const uRecolor = { value: look.recolor ? 1 : 0 };
  m.onBeforeCompile = (sh) => {
    atmosUniforms(sh);
    sh.uniforms.uSway = uSway;
    sh.uniforms.uBaseAo = uBase;
    sh.uniforms.uRecolor = uRecolor;
    sh.vertexShader = 'uniform float uAtmosTime; uniform float uSway;\nvarying vec3 vAtW;\nvarying float vAtH;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
      {
        vec4 atL = vec4(transformed, 1.0);
        vec4 atO = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          atL = instanceMatrix * atL;
          atO = instanceMatrix * atO;
        #endif
        vec4 atW = modelMatrix * atL;
        vec3 atB = (modelMatrix * atO).xyz;
        float h = max(0.0, atW.y - atB.y);
        if (uSway > 0.0) {
          float ph = atB.x * 0.37 + atB.z * 0.23;
          float s = sin(uAtmosTime * 1.7 + ph) * 0.65 + sin(uAtmosTime * 2.9 + ph * 1.9) * 0.25;
          vec3 off = vec3(1.0, 0.0, 0.5) * s * uSway * h * h * 0.01;
          atW.xyz += off;
          mvPosition.xyz += mat3(viewMatrix) * off;
          gl_Position = projectionMatrix * mvPosition;
        }
        vAtW = atW.xyz;
        vAtH = h;
      }`,
    );
    sh.fragmentShader = ATMOS_GLSL + '\nuniform float uBaseAo; uniform float uRecolor;\nvarying vec3 vAtW;\nvarying float vAtH;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n vec3 atTex = diffuseColor.rgb;',
    ).replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
      #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
      if (uRecolor > 0.5) {
        float leafy = smoothstep(0.01, 0.07, atTex.g - max(atTex.r, atTex.b));
        vec3 rec = vec3(dot(atTex, vec3(0.3, 0.59, 0.11))) * vColor.rgb * 2.3;
        diffuseColor.rgb = mix(atTex, rec, leafy);
      }
      #endif`,
    ).replace(
      '#include <lights_fragment_end>',
      /* glsl */ `#include <lights_fragment_end>
      reflectedLight.directDiffuse *= cloudShadow(vAtW.xz);
      float atAo = mix(1.0, smoothstep(-0.15, 1.1, vAtH) * 0.45 + 0.55, uBaseAo);
      reflectedLight.indirectDiffuse *= atAo;
      reflectedLight.directDiffuse *= mix(1.0, atAo, 0.6);`,
    );
  };
  return m;
}

/** Applies scenery() to every mesh under `root` (multi-material meshes too). */
export function applyScenery(root: THREE.Object3D, look: SceneryLook = {}) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((x) => scenery(x, look)) : scenery(mesh.material, look);
  });
}
