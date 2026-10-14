import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);

/** White hit tint: seconds it takes to fade out. */
export const HIT_FLASH = 0.3;

/** Blends the emissive towards white for `t` seconds left of HIT_FLASH; 0 restores the model's own emissive (glowing eyes). */
export function applyHitFlash(mats: (THREE.MeshLambertMaterial | THREE.MeshStandardMaterial)[], t: number) {
  const k = Math.max(0, t / HIT_FLASH);
  for (const m of mats) {
    const flash = m.userData.flash as { value: THREE.Color } | undefined;
    if (flash) { flash.value.copy(WHITE).multiplyScalar(k * k * 0.85); continue; }
    const base = (m.userData.emissive0 ??= m.emissive.clone()) as THREE.Color;
    m.emissive.copy(base).lerp(WHITE, k * k * 0.85);
  }
}

/**
 * For materials whose emissive is masked by an emissiveMap (GLB creatures with glowing eyes): the emissive tint only
 * shows where the map is bright, so the flash is added unmasked through its own uniform instead.
 */
export function addUnmaskedFlash(m: THREE.Material) {
  m.userData.flash = { value: new THREE.Color(0, 0, 0) };
  m.onBeforeCompile = injectFlash;
  m.customProgramCacheKey = flashCacheKey;
}

function injectFlash(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.flashColor = this.userData.flash;
  shader.fragmentShader = 'uniform vec3 flashColor;\n' + shader.fragmentShader.replace(
    '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += flashColor;');
}

function flashCacheKey() { return 'unmasked-flash'; }
