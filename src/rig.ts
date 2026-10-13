import * as THREE from 'three';
import { assets } from './assets';

/**
 * Per-weapon grip tweaks. The grip is derived from geometry (bottom of the weapon's long axis),
 * then the blade is aimed along the fist axis (hand-local +Z = forward when the arm hangs),
 * pushed a little outward from the body (hand-local +Y) and tilted up toward the forearm (+X),
 * so blades do not cut through the helmet or the torso.
 */
export const WEAPON_GRIPS: Record<string, { tilt?: number; out?: number; grip?: number; scale?: number; roll?: number }> = {
  sword_human_knight: { scale: 0.6, grip: 0.1 },
  sword_soldier: { scale: 0.7, grip: 0.12 },
  sword_orc_warrior: { scale: 0.68, grip: 0.12 },
  sword_undead_king: { scale: 0.75, grip: 0.12 },
  axe_orc_grunt: { scale: 0.7, grip: 0.16, roll: Math.PI },
  axe_orc_chieftain: { scale: 0.78, grip: 0.16, roll: Math.PI },
  axe_orc_peon: { scale: 0.78, grip: 0.18, roll: Math.PI },
  axe: { scale: 0.78, grip: 0.18, roll: Math.PI },
  hammer_human_paladin: { scale: 0.75, grip: 0.16 },
  dagger: { scale: 1.15, grip: 0.15 },
  reaper: { scale: 1.05, grip: 0.3, tilt: 0.1, out: 0.2 },
  spear_undead_warrior: { scale: 0.7, grip: 0.4, tilt: 0.1, out: 0.15 },
};

/** Palm centre in hand_r space (cm). */
const PALM = new THREE.Vector3(-9, -4, 0);
const gripCache = new Map<string, THREE.Vector3>();

function gripPoint(name: string, w: THREE.Object3D, frac: number): THREE.Vector3 {
  const key = name + frac;
  let g = gripCache.get(key);
  if (g) return g;
  // `w` is a detached root, so matrixWorld is "relative to the root's parent space".
  w.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  w.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone());
  });
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const y = minY + (maxY - minY) * frac;
  const band = (maxY - minY) * 0.06;
  const c = new THREE.Vector3();
  let n = 0;
  for (const p of pts) if (Math.abs(p.y - y) < band) { c.x += p.x; c.z += p.z; n++; }
  g = new THREE.Vector3(n ? c.x / n : 0, y, n ? c.z / n : 0);
  gripCache.set(key, g);
  return g;
}

/**
 * `left`: into hand_l. The left hand bone is the mirror of the right one (X flipped), so the palm offset and
 * the outward push flip with it.
 */
export function attachWeapon(character: THREE.Object3D, weapon: string, left = false): THREE.Object3D {
  const hand = character.getObjectByName(left ? 'hand_l' : 'hand_r')!;
  const cfg = WEAPON_GRIPS[weapon] ?? {};
  const inner = assets.clone(weapon);
  inner.scale.setScalar(1); // hand bone already lives in the 0.01-scaled character space (cm)
  inner.position.set(0, 0, 0);
  inner.rotation.set(0, 0, 0);
  // Some weapons are authored along Z instead of Y: stand them up first.
  const size = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.add(inner);
  if (size.z > size.y * 1.5) pivot.rotation.x = -Math.PI / 2;
  if (size.x > size.y * 1.5) pivot.rotation.z = Math.PI / 2;
  const grip = gripPoint(weapon, pivot, cfg.grip ?? 0.15);
  const holder = new THREE.Group();
  holder.name = 'weapon';
  const offset = new THREE.Group();
  offset.position.copy(grip).negate();
  offset.add(pivot);
  holder.add(offset);
  // Weapon +Y -> fist axis (hand +Z) tilted toward the forearm (hand +X).
  const tilt = cfg.tilt ?? 0.22;
  const dir = new THREE.Vector3(Math.sin(tilt), cfg.out ?? 0.4, Math.cos(tilt)).normalize();
  holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  if (cfg.roll) holder.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cfg.roll));
  holder.position.copy(PALM);
  if (left) mirrorX(holder);
  holder.scale.setScalar(cfg.scale ?? 1);
  hand.add(holder);
  return holder;
}

/**
 * Left hand: mirror the right-hand holder across the hand's X (the bones match in bind pose), then turn it by
 * the left/right asymmetry of the Idle pose (hand_l⁻¹ · mirrored hand_r, measured on the shared Idle clip), so
 * the left weapon is the mirror image of the right one while standing.
 */
const LEFT_FIX = new THREE.Quaternion(-0.375, 0.35, -0.123, 0.849).normalize();
function mirrorX(o: THREE.Object3D) {
  const q = o.quaternion;
  q.set(q.x, -q.y, -q.z, q.w).premultiply(LEFT_FIX);
  o.position.x = -o.position.x;
  o.position.applyQuaternion(LEFT_FIX);
}
