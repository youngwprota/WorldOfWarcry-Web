// Floating crystals of the hunter sets (the mythic hood, quiver and bows): small glowing pieces modelled apart from
// the gear. They are found once per model (detached islands of the "glow" material) and, in the vertex shader (bind
// space, before skinning, so they follow the body), float up and down and turn slowly about their own centre.
import * as THREE from 'three';

/** Seconds; every patched shader reads it (Character.update keeps it current). */
export const FLOAT_TIME = { value: 0 };

/** An island counts as a floater when it is this far (cm, bind space) from the rest of the mesh and this small. */
const MIN_GAP = 8;
const MAX_RADIUS = 15;
/** Float height (cm, up and down from the modelled spot) and speeds (rad/s: one float up and down in ~4 s). */
const BOB = 6;
const BOB_SPEED = 1.6;
const SPIN_SPEED = 1.4;

/**
 * Marks the floaters of a mesh: per-vertex `floatCenter` (the island's centre) and `floatPhase` (phase + 1; 0 = not a
 * floater, which is also what an absent attribute reads as). Returns the number found; a mesh with none is left as is.
 */
export function markFloaters(mesh: THREE.Mesh): number {
  const geo = mesh.geometry;
  if (geo.index || geo.getAttribute('floatPhase')) return 0;
  const pos = geo.getAttribute('position');
  const mats = ([] as THREE.Material[]).concat(mesh.material);
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  const glow: number[] = [];
  const rest: number[] = [];
  for (const gr of groups) {
    const isGlow = /_glow$/.test(mats[gr.materialIndex ?? 0]?.name ?? '');
    for (let i = gr.start; i < gr.start + gr.count; i += 3) (isGlow ? glow : rest).push(i);
  }
  if (!glow.length) return 0;

  // islands: glow triangles joined by shared vertex positions
  const key = (i: number) => `${Math.round(pos.getX(i) * 10)},${Math.round(pos.getY(i) * 10)},${Math.round(pos.getZ(i) * 10)}`;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k)!)!); k = parent.get(k)!; }
    return k;
  };
  for (const t of glow) {
    const ks = [key(t), key(t + 1), key(t + 2)];
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    const a = find(ks[0]);
    parent.set(find(ks[1]), a);
    parent.set(find(ks[2]), a);
  }
  const islands = new Map<string, number[]>();
  for (const t of glow) {
    const r = find(key(t));
    if (!islands.has(r)) islands.set(r, []);
    islands.get(r)!.push(t);
  }

  const center = new Float32Array(pos.count * 3);
  const phase = new Float32Array(pos.count);
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  let found = 0;
  for (const tris of islands.values()) {
    c.set(0, 0, 0);
    for (const t of tris) for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, t + k));
    c.divideScalar(tris.length * 3);
    let radius = 0;
    for (const t of tris) for (let k = 0; k < 3; k++) radius = Math.max(radius, v.fromBufferAttribute(pos, t + k).distanceTo(c));
    if (radius > MAX_RADIUS) continue;
    let gap = Infinity;
    for (const t of rest) gap = Math.min(gap, v.fromBufferAttribute(pos, t).distanceTo(c));
    if (gap < MIN_GAP) continue; // set into the gear (gems, studs): stays put
    const ph = Math.random() * Math.PI * 2 + 1;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        center.set([c.x, c.y, c.z], (t + k) * 3);
        phase[t + k] = ph;
      }
    }
    found++;
  }
  if (!found) return 0;
  geo.setAttribute('floatCenter', new THREE.BufferAttribute(center, 3));
  geo.setAttribute('floatPhase', new THREE.BufferAttribute(phase, 1));
  return found;
}

/**
 * Shader patch (onBeforeCompile): floaters float up and down (each at its own phase) and turn about their centre;
 * everything else is untouched.
 */
export function patchFloat(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.floatTime = FLOAT_TIME;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute vec3 floatCenter;
      attribute float floatPhase;
      uniform float floatTime;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      if (floatPhase > 0.5) {
        vec3 d = transformed - floatCenter;
        float a = floatTime * ${SPIN_SPEED.toFixed(2)} + floatPhase;
        float s = sin(a), co = cos(a);
        d = vec3(co * d.x + s * d.z, d.y, -s * d.x + co * d.z);
        transformed = floatCenter + d + vec3(0.0, sin(floatTime * ${BOB_SPEED.toFixed(2)} + floatPhase * 1.7) * ${BOB.toFixed(1)}, 0.0);
      }`);
}

/** Gives a material the floater motion (its own onBeforeCompile is kept). */
export function floatMaterial(m: THREE.Material) {
  if (m.userData.float) return;
  m.userData.float = true;
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => { prev(shader, renderer); patchFloat(shader); };
  m.customProgramCacheKey = () => 'float';
}
