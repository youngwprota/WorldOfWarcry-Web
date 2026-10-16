// Water: ponds and the sea round the island. Both are unlit shaders on the shared atmosphere clock (src/atmos.ts):
// colour by depth, a see-through shallow edge over the bed, drifting ripples, caustics in the shallows, the sky in the
// water toward the top of the screen, sun glints on the crests (brighter than white, so the post glow catches them),
// foam lapping at the shore and the cloud shadows passing over. Swamp pools are murky: no caustics, few glints, scum.
import * as THREE from 'three';
import { ATMOS_GLSL, atmosUniforms } from './atmos';
import { ISLAND, MAP_BOX } from './island';

/** A pond; `murky`: swamp water (dark green, lily pads and reeds round it). */
export interface Pond { x: number; z: number; r: number; murky?: boolean }

/** Shore radius of a pond at angle a (0 = +Z): wobbly, between 0.84 and 1.16 of its radius. */
export function pondR(p: Pond, a: number) {
  const s = p.x * 0.37 + p.z * 0.91; // own shape per pond
  return p.r * (1 + 0.08 * Math.sin(a * 2 + s) + 0.05 * Math.sin(a * 3 + s * 1.7) + 0.03 * Math.sin(a * 5 + s * 2.3));
}

/** Metres from a pond's shore (negative in the water). */
export const pondDist = (p: Pond, x: number, z: number) => Math.hypot(x - p.x, z - p.z) - pondR(p, Math.atan2(x - p.x, z - p.z));

/** Shared fragment code: ripples, caustics, sky, glints and foam from depth (0 shore … 1 deep) and the shore band. */
const WATER_GLSL = /* glsl */ `
uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uSky; uniform float uClear;
float waterWave(vec2 p, float k) {
  float t = uAtmosTime;
  return texture2D(uAtmosNoise, p * 0.09 * k + vec2(t * 0.011, t * 0.007)).g + texture2D(uAtmosNoise, p * 0.13 * k + vec2(-t * 0.009, t * 0.012)).b;
}
vec3 waterColor(vec3 w, float depth, float wave, float k) {
  float t = uAtmosTime;
  vec2 p = w.xz;
  vec3 col = mix(uShallow, uMid, smoothstep(0.02, 0.35, depth));
  col = mix(col, uDeep, smoothstep(0.3, 0.85, depth));
  // ripples: soft light and dark bands drifting with the waves
  col *= 0.9 + 0.2 * smoothstep(0.7, 1.3, wave);
  // caustics: a bright web of light on the bed in the shallows
  vec2 q = p * 0.55 * k + (wave - 1.0) * 0.4;
  float c1 = texture2D(uAtmosNoise, q + vec2(t * 0.035, t * 0.01)).b;
  float c2 = texture2D(uAtmosNoise, q * 1.15 - vec2(t * 0.01, t * 0.03)).b;
  float caust = smoothstep(0.8, 1.0, 1.0 - abs(c1 - c2) * 4.0) * (1.0 - smoothstep(0.1, 0.6, depth)) * uClear;
  col += vec3(0.7, 0.95, 1.0) * caust * 0.18;
  // the sky in the water: a little everywhere, more where the view grazes it (the top of the screen)
  vec3 V = normalize(cameraPosition - w);
  col = mix(col, uSky, 0.04 + 0.4 * pow(1.0 - clamp(V.y, 0.0, 1.0), 2.0));
  // sun glints: small sharp sparks on the finer ripples
  float fine = texture2D(uAtmosNoise, p * 0.42 * k + vec2(t * 0.05, -t * 0.03)).b + texture2D(uAtmosNoise, p * 0.55 * k - vec2(t * 0.04, t * 0.05)).g;
  float g = smoothstep(1.55, 1.64, fine + (wave - 1.0) * 0.15);
  col += vec3(1.0, 0.96, 0.86) * g * mix(0.1, 0.35, uClear) * smoothstep(0.05, 0.25, depth);
  return col * mix(1.0, cloudShadow(p), 0.75);
}
/** Water never goes brighter than white: no hard blown-out spots, and the post glow (HDR only) leaves it alone. */
vec3 waterSoft(vec3 c) { return min(c, vec3(0.85)); }`;

const PAL = {
  clear: { deep: 0x124a88, mid: 0x2392bc, shallow: 0x78d8cc, foam: 0xe6f4f6, sky: 0xbfe6fa, clear: 1 },
  murky: { deep: 0x1c2a1e, mid: 0x34482c, shallow: 0x66763c, foam: 0xb4bc8a, sky: 0x9cb8a4, clear: 0 },
};

function paletteUniforms(pal: (typeof PAL)['clear']) {
  return {
    uDeep: { value: new THREE.Color(pal.deep) }, uMid: { value: new THREE.Color(pal.mid) }, uShallow: { value: new THREE.Color(pal.shallow) },
    uFoam: { value: new THREE.Color(pal.foam) }, uSky: { value: new THREE.Color(pal.sky) }, uClear: { value: pal.clear },
  };
}

/** A pond: a disc whose rim follows pondR, rings packed toward the shore (aEdge = 0 centre … 1 shore). */
export function buildPond(p: Pond) {
  const SEG = 72;
  const RINGS = [0.3, 0.55, 0.72, 0.84, 0.92, 0.97, 1];
  const pos: number[] = [0, 0, 0];
  const edge: number[] = [0];
  for (const t of RINGS) {
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const r = pondR(p, a) * t;
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      edge.push(t);
    }
  }
  // counter-clockwise seen from above (faces point up)
  const idx: number[] = [];
  for (let i = 0; i < SEG; i++) idx.push(0, 1 + i, 1 + ((i + 1) % SEG));
  for (let k = 0; k < RINGS.length - 1; k++) {
    const a0 = 1 + k * SEG;
    const b0 = 1 + (k + 1) * SEG;
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      idx.push(a0 + i, b0 + i, a0 + j, a0 + j, b0 + i, b0 + j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, paletteUniforms(p.murky ? PAL.murky : PAL.clear)]),
    vertexShader: /* glsl */ `attribute float aEdge; varying float vEdge; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vEdge = aEdge; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: ATMOS_GLSL + WATER_GLSL + /* glsl */ `
      varying float vEdge; varying vec3 vW;
      #include <fog_pars_fragment>
      void main(){
        float t = uAtmosTime;
        float depth = 1.0 - vEdge;
        float wave = waterWave(vW.xz, 1.0);
        vec3 col = waterColor(vW, depth, wave, 1.0);
        // shore foam: a lapping line at the waterline and a thinner one breathing just inside it
        float n = texture2D(uAtmosNoise, vW.xz * 0.35 + vec2(t * 0.02, -t * 0.015)).a;
        float lap = 0.935 + 0.02 * sin(t * 1.4 + wave * 8.0);
        float ring = 0.85 + 0.03 * sin(t * 0.9);
        float foam = smoothstep(lap, lap + 0.03, vEdge) + (1.0 - smoothstep(0.0, 0.012, abs(vEdge - ring))) * 0.3;
        foam = clamp(foam * smoothstep(0.42, 0.66, n + 0.1), 0.0, 1.0);
        col = mix(col, uFoam, foam * 0.55);
        // see-through at the shore (the bed shows), the very edge melts into the wet ground
        float a = max(mix(0.42, 0.93, smoothstep(0.0, 0.35, depth)), foam * 0.7) * (1.0 - smoothstep(0.985, 1.0, vEdge));
        gl_FragColor = vec4(waterSoft(col), a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  atmosUniforms(mat); // the shared objects themselves (UniformsUtils.merge would copy them)
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(p.x, 0.04, p.z);
  return mesh;
}

/**
 * The sea round the island. `shoreTex.a`: 1 on land … 0 in deep water (baked in bakeGroundMaps), so the depth is
 * known everywhere: turquoise shallows you can see the sand through, deep blue further out, lines of foam rolling
 * in toward the beach and a lapping surf line at the water's edge.
 */
export function buildOcean(shoreTex: THREE.Texture) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, paletteUniforms({ ...PAL.clear, deep: 0x1f7fd0, mid: 0x2c9ee0, shallow: 0x52d8ee }), {
      uZone: { value: null }, uBox: { value: new THREE.Vector4(MAP_BOX.x, MAP_BOX.z, MAP_BOX.size, MAP_BOX.size) },
    }]),
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: ATMOS_GLSL + WATER_GLSL + /* glsl */ `
      varying vec3 vW; uniform sampler2D uZone; uniform vec4 uBox;
      #include <fog_pars_fragment>
      void main(){
        float t = uAtmosTime;
        vec2 uv = (vW.xz - uBox.xy) / uBox.zw;
        float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
        float sh = texture2D(uZone, clamp(uv, 0.0, 1.0)).a * inside;
        float metres = (1.0 - sh) * ${(4 + ISLAND.water).toFixed(2)};
        float depth = smoothstep(0.0, 3.4, metres);
        float wave = waterWave(vW.xz, 0.45);
        vec3 col = waterColor(vW, depth, wave, 0.5);
        // foam lines rolling in toward the beach (their phase grows with depth), broken up by noise
        float n = texture2D(uAtmosNoise, vW.xz * 0.06 + vec2(t * 0.01, t * 0.006)).a;
        float roll = smoothstep(0.85, 1.0, sin(metres * 4.2 + t * 1.25 + wave * 2.0))
          * (1.0 - smoothstep(0.35, 2.0, metres)) * smoothstep(0.38, 0.62, n);
        // the surf line at the water's edge, lapping in and out
        float surf = 1.0 - smoothstep(0.04, 0.3 + 0.12 * sin(t * 1.2 + wave * 5.0), metres);
        float foam = clamp(max(roll * 0.75, surf * smoothstep(0.25, 0.5, n + 0.2)), 0.0, 1.0);
        col = mix(col, uFoam, foam * 0.7);
        float a = max(mix(0.38, 1.0, smoothstep(0.05, 1.3, metres)), foam);
        gl_FragColor = vec4(waterSoft(col), a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uZone.value = shoreTex;
  atmosUniforms(mat);
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(420, 72).rotateX(-Math.PI / 2), mat);
  mesh.position.set(ISLAND.cx, ISLAND.water, ISLAND.cz);
  mesh.renderOrder = -1;
  return mesh;
}
