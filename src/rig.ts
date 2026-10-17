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
  /**
   * Hold out of a fight (bows, the gun, polearms, staves): set in the character's space, not the hand's, which swings
   * with the clips. `lean` tips its top forward, `yaw` turns its face, `roll` turns it about its own long axis first
   * (radians); `drop`: the fist slides up a long shaft so its bottom is that many cm below the palm (off the ground).
   * The holder turns into the main hold as a swing or an attack clip starts (Swinger.raise, Character.atkW, aimBlend).
   */
  rest?: { lean?: number; yaw?: number; roll?: number; drop?: number };
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
  // `rest`: with the arm down the bow stands upright at the side, its top tipped a little forward
  bow_human_archer: { scale: 0.75, grip: 0.5, tilt: 0, out: 0, rest: { lean: 0.25, yaw: 0 } },
  bow_undead_archer: { scale: 0.75, grip: 0.5, tilt: 0, out: 0, rest: { lean: 0.25, yaw: 0 } },
  bow_orc_archer: { scale: 0.6, grip: 0.5, tilt: 0, out: 0, rest: { lean: 0.25, yaw: 0 } },
  // per-quality models (tools/blender/rarity_gear.py, `<kind>_<quality>`): the kind's grip
  sword: { scale: 0.6, grip: 0.1 },
  // the head turned a quarter about the haft: its faces look forward / back (the way the blow lands), not sideways
  hammer: { scale: 0.75, grip: 0.16, roll: Math.PI / 2 },
  // at rest upright beside the body, butt by the feet (held in the fist it crossed the face); swings use the hold
  polearm: { scale: 1.0, grip: 0.22, tilt: 0.15, out: 0.3, rest: { lean: 0.1 } },
  // the gun (gun_<quality>, 142 cm, wrist at 26% of its length), held in the bow hand: the barrel along the forearm,
  // pointing where the arm aims; at rest it lies at the hip, the barrel forward and a little down, sights up (`roll` π:
  // the sight side, glTF +Z, would face the ground otherwise)
  gun: { scale: 0.5, grip: 0.26, tilt: -Math.PI / 2, out: 0, rest: { lean: Math.PI / 2 + 0.2, roll: Math.PI } },
};

/** Shields (`shield_<type>_<quality>`): authored with the grip at the origin, face toward +Z, up +Y (cm). */
export const SHIELD_GRIP = {
  scale: 0.72,
  /** The grip bar's centre behind the plate (shield space, cm): it goes into the palm. */
  handle: new THREE.Vector3(0, 0, -3),
  /**
   * The shield's turn in hand_r space (the left hand mirrors it, mirrorX), measured in grips.html on the Idle pose: it
   * stands upright with the top 10° forward, the face out from the body and turned 35° forward. (Laid along the forearm
   * it leaned 17° into the body.)
   */
  hold: new THREE.Quaternion(-0.0288, -0.4291, -0.5603, 0.7079),
  /** Push from the palm along the face (cm): the big cartoon fist stays behind the plate. */
  push: 14,
};

const QUALITY = /_(common|uncommon|rare|epic|legendary|mythic)$/;

/**
 * Mage staves: shortened and held at the bottom of the shaft wrap (45-55% of the height), whatever staff model a staff
 * def uses. At rest upright beside the body, the fist higher up the shaft (held in the fist it lay level, head forward).
 */
const STAFF_GRIP = { grip: 0.46, scale: 0.75, rest: { lean: 0.1, drop: 55 } };
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
  holder.quaternion.copy(gripQuat(cfg.tilt ?? 0.22, cfg.out ?? 0.4, cfg.roll ?? 0));
  holder.position.copy(PALM);
  if (left) mirrorX(holder);
  if (cfg.rest) {
    holder.userData.qAim = holder.quaternion.clone();
    holder.userData.qRest = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cfg.rest.yaw ?? 0)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), cfg.rest.lean ?? 0))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cfg.rest.roll ?? 0));
    // a long shaft slides up through the fist at rest: its bottom `drop` cm below the palm, off the ground
    if (cfg.rest.drop) {
      const lo = gripPoint(weapon, pivot, 0).y, hi = gripPoint(weapon, pivot, 1).y;
      const y = Math.min(grip.y, lo + cfg.rest.drop / (cfg.scale ?? 1));
      offset.userData.pAim = offset.position.clone();
      offset.userData.pRest = gripPoint(weapon, pivot, (y - lo) / (hi - lo)).clone().negate();
    }
  }
  holder.scale.setScalar(cfg.scale ?? 1);
  hand.add(holder);
  return holder;
}

/**
 * A shield held by its grip bar in the fist: the bar sits in the palm, the plate stands upright beside the body with
 * its face out (SHIELD_GRIP.hold). Same mirroring as weapons for the left hand.
 */
function attachShield(hand: THREE.Object3D, name: string, left: boolean): THREE.Object3D {
  const g = SHIELD_GRIP;
  const inner = assets.clone(name);
  inner.position.copy(g.handle).negate();
  const holder = new THREE.Group();
  holder.name = 'weapon';
  holder.add(inner);
  holder.quaternion.copy(g.hold);
  holder.position.set(0, 0, g.push).applyQuaternion(g.hold).add(PALM);
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
/** Hold of a weapon in the hand: its +Y toward the fist axis tilted by `tilt` to the forearm, `out` from the body, turned by `roll` about itself. */
function gripQuat(tilt: number, out: number, roll: number) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(tilt), out, Math.cos(tilt)).normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
  return q;
}

const qHand = new THREE.Quaternion();
const qModel = new THREE.Quaternion();
const qRestLocal = new THREE.Quaternion();
/**
 * A weapon with a rest hold (WEAPON_GRIPS rest): between upright beside `model` (k 0) and its hold in the hand
 * (k 1, the aim pose). Call after the pose is set (the clips and the swings) each frame.
 */
export function aimBlend(holder: THREE.Object3D | null, k: number, model: THREE.Object3D) {
  const a = holder?.userData.qAim as THREE.Quaternion | undefined;
  if (!holder || !a || !holder.parent) return;
  // the rest hold is in the character's space: hand⁻¹ · model · rest
  holder.parent.updateWorldMatrix(true, false);
  holder.parent.getWorldQuaternion(qHand);
  model.getWorldQuaternion(qModel);
  qRestLocal.copy(qHand).invert().multiply(qModel).multiply(holder.userData.qRest as THREE.Quaternion);
  holder.quaternion.slerpQuaternions(qRestLocal, a, k);
  const offset = holder.children[0];
  const pRest = offset.userData.pRest as THREE.Vector3 | undefined;
  if (pRest) offset.position.lerpVectors(pRest, offset.userData.pAim as THREE.Vector3, k);
}

const LEFT_FIX = new THREE.Quaternion(-0.375, 0.35, -0.123, 0.849).normalize();
function mirrorX(o: THREE.Object3D) {
  const q = o.quaternion;
  q.set(q.x, -q.y, -q.z, q.w).premultiply(LEFT_FIX);
  o.position.x = -o.position.x;
  o.position.applyQuaternion(LEFT_FIX);
}
