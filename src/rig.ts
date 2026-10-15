import * as THREE from 'three';
import { assets } from './assets';
import { WEAPONS } from './config';

/**
 * Per-weapon grip tweaks. The grip is derived from geometry (bottom of the weapon's long axis),
 * then the blade is aimed along the fist axis (hand-local +Z = forward when the arm hangs),
 * pushed a little outward from the body (hand-local +Y) and tilted up toward the forearm (+X),
 * so blades do not cut through the helmet or the torso.
 */
export const WEAPON_GRIPS: Record<string, {
  tilt?: number; out?: number; grip?: number; scale?: number; roll?: number; face?: number;
  /** Clips that swing it with the left hand: Character moves it there when one starts and back when it ends. */
  left?: string[];
}> = {
  sword_human_knight: { scale: 0.6, grip: 0.1 },
  sword_soldier: { scale: 0.7, grip: 0.12 },
  sword_orc_warrior: { scale: 0.68, grip: 0.12 },
  sword_undead_king: { scale: 0.75, grip: 0.12 },
  // axes: `roll` turns the blade to face forward-down when the arm hangs (the way the chop lands), measured in
  // viewer.html; π had every axe edge pointing back over the shoulder
  axe_orc_grunt: { scale: 0.7, grip: 0.16, roll: -0.92 },
  axe_orc_chieftain: { scale: 0.78, grip: 0.16, roll: -0.62 },
  axe_orc_peon: { scale: 0.78, grip: 0.18, roll: -0.86 },
  axe: { scale: 0.78, grip: 0.18, roll: -0.86 }, // also the per-quality GLB axes (axe_<quality>)
  hammer_human_paladin: { scale: 0.75, grip: 0.16 },
  dagger: { scale: 1.15, grip: 0.15 },
  reaper: { scale: 1.05, grip: 0.3, tilt: 0.1, out: 0.2, left: ['SlashAdvance'] },
  // Death's own copy of reaper.fbx: keeps its look whatever happens to the hero's reaper
  death_scythe: { scale: 1.05, grip: 0.3, tilt: 0.1, out: 0.2, left: ['SlashAdvance'] },
  nagamaki: { scale: 1.0, grip: 0.22, tilt: 0.15, out: 0.3 },
  scythe: { scale: 1.0, grip: 0.42 },
  // `face`: lay the disc across the fist axis (its face looks forward), grip at its back
  shield: { scale: 0.9, grip: 0.02, tilt: 0, out: 0.2, face: Math.PI / 2 },
  pan: { scale: 1.0, grip: 0.1 },
  hidden_blade: { scale: 1.6, grip: 0.1, tilt: 0, out: 0.1 },
  sickle: { scale: 1.5, grip: 0.12 },
  kitchen_knife: { scale: 1.6, grip: 0.12 },
  spear_undead_warrior: { scale: 0.7, grip: 0.4, tilt: 0.1, out: 0.15 },
  // held by the middle, the limbs along the fist axis: upright when the arm is raised forward
  // (also the hunter sets' bows, models/archers/bow_*)
  bow_human_archer: { scale: 0.75, grip: 0.5, tilt: 0, out: 0 },
  bow_orc_archer: { scale: 0.6, grip: 0.5, tilt: 0, out: 0 },
  // per-quality models (tools/blender/rarity_gear.py, `<kind>_<quality>`): the kind's grip
  sword: { scale: 0.6, grip: 0.1 },
  hammer: { scale: 0.75, grip: 0.16 },
  polearm: { scale: 1.0, grip: 0.22, tilt: 0.15, out: 0.3 },
};

/** Shields (`shield_<type>_<quality>`): authored with the grip at the origin, face toward +Z, up +Y (cm). */
export const SHIELD_GRIP = {
  scale: 0.72,
  /** The grip bar's centre behind the plate (shield space, cm): it goes into the palm. */
  handle: new THREE.Vector3(0, 0, -3),
  /** Tilt of the shield's up axis from the forearm (hand +X) toward the fist axis (hand +Z), radians. */
  lean: 0.6,
  /** Push from the palm out of the body (hand +Y, cm): the big cartoon fist stays behind the plate. */
  at: new THREE.Vector3(0, 9, 0),
};

const QUALITY = /_(common|uncommon|rare|epic|legendary|mythic)$/;

/** Mage staves: shortened and held at the bottom of the shaft wrap (45-55% of the height), whatever staff model a staff def uses. */
const STAFF_GRIP = { grip: 0.46, scale: 0.75 };
const staffModels = new Set(Object.values(WEAPONS).filter((w) => w.staff).flatMap((w) => [...Object.values(w.model), ...(w.tiers ?? [])]));

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
  const kind = weapon.replace(QUALITY, '');
  if (kind.startsWith('shield_')) return attachShield(hand, weapon, left);
  // staves (their quality tiers too) before the kind's grip: `staff_fire_rare` is not a warrior weapon kind
  const cfg = WEAPON_GRIPS[weapon] ?? (staffModels.has(weapon) ? STAFF_GRIP
    : WEAPON_GRIPS[kind] ?? (weapon.startsWith('archers/bow') ? WEAPON_GRIPS.bow_human_archer : {}));
  const inner = assets.clone(weapon);
  inner.scale.setScalar(1); // hand bone already lives in the 0.01-scaled character space (cm)
  inner.position.set(0, 0, 0);
  inner.rotation.set(0, 0, 0);
  // Some weapons are authored along Z instead of Y: stand them up first.
  const size = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.add(inner);
  if (cfg.face) pivot.rotation.x = cfg.face;
  else if (size.z > size.y * 1.5) pivot.rotation.x = -Math.PI / 2;
  if (size.x > size.y * 1.5) pivot.rotation.z = Math.PI / 2;
  const grip = gripPoint(weapon, pivot, cfg.grip ?? 0.15);
  const holder = new THREE.Group();
  holder.name = 'weapon';
  const offset = new THREE.Group();
  offset.position.copy(grip).negate();
  offset.add(pivot);
  holder.add(offset);
  // blade tip along the holder's +Y (cm, before scale): weapon trails sample it
  holder.updateMatrixWorld(true);
  holder.userData.tip = new THREE.Box3().setFromObject(offset).max.y;
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
 * A shield held by its grip bar in the fist: the bar sits in the palm, the face looks out from the body (hand +Y),
 * the top leans from the forearm toward the fist axis (SHIELD_GRIP.lean). Same mirroring as weapons for the left hand.
 */
function attachShield(hand: THREE.Object3D, name: string, left: boolean): THREE.Object3D {
  const g = SHIELD_GRIP;
  const inner = assets.clone(name);
  inner.position.copy(g.handle).negate();
  const holder = new THREE.Group();
  holder.name = 'weapon';
  holder.add(inner);
  // shield +Y (up) → between the forearm and the fist axis, shield +Z (face) → hand +Y (out from the body)
  const c = Math.cos(g.lean), s = Math.sin(g.lean);
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(-s, 0, c), new THREE.Vector3(c, 0, s), new THREE.Vector3(0, 1, 0));
  holder.quaternion.setFromRotationMatrix(basis);
  holder.position.copy(PALM).add(g.at);
  holder.userData.tip = new THREE.Box3().setFromObject(inner).max.y;
  if (left) mirrorX(holder);
  holder.scale.setScalar(g.scale);
  hand.add(holder);
  return holder;
}

/**
 * Armour quality pieces (tools/blender/armor_gear.py): GLB nodes `<name>__<bone>` authored in the characters' mesh
 * space (bind pose, cm). Each hangs on its bone with the bone's inverse bind matrix, so it sits where it was built
 * and follows the animation rigidly. Returns the attached pieces.
 */
export function attachTrim(character: THREE.Object3D, name: string): THREE.Object3D[] {
  let sm: THREE.SkinnedMesh | null = null;
  character.traverse((o) => { if (!sm && (o as THREE.SkinnedMesh).isSkinnedMesh) sm = o as THREE.SkinnedMesh; });
  const skin = sm as THREE.SkinnedMesh | null;
  if (!skin) return [];
  const out: THREE.Object3D[] = [];
  for (const piece of [...assets.clone(name).children]) {
    const boneName = piece.name.split('__')[1];
    const i = skin.skeleton.bones.findIndex((b) => b.name === boneName);
    if (i < 0) continue;
    const m = new THREE.Matrix4().copy(skin.skeleton.boneInverses[i]).multiply(skin.bindMatrix);
    m.decompose(piece.position, piece.quaternion, piece.scale);
    piece.name = 'trim';
    skin.skeleton.bones[i].add(piece);
    out.push(piece);
  }
  return out;
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
