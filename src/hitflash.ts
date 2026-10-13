import * as THREE from 'three';

const WHITE = new THREE.Color(1, 1, 1);

/** White hit tint: seconds it takes to fade out. */
export const HIT_FLASH = 0.3;

/** Blends the emissive towards white for `t` seconds left of HIT_FLASH; 0 restores the model's own emissive (glowing eyes). */
export function applyHitFlash(mats: (THREE.MeshLambertMaterial | THREE.MeshStandardMaterial)[], t: number) {
  const k = Math.max(0, t / HIT_FLASH);
  for (const m of mats) {
    const base = (m.userData.emissive0 ??= m.emissive.clone()) as THREE.Color;
    m.emissive.copy(base).lerp(WHITE, k * k * 0.85);
  }
}
