// Dev page (grips.html): every item a hero can hold, in its hand, one row per kind × six qualities, on the class's own
// hero model, through the game's Character (src/character.ts) and grips (src/rig.ts). `?row=N` shows one row up close;
// `?orc` — the orc heroes; keys: A — the ranged aim pose (bow and gun arm raised, like a shot), M — the staff cast clip, I — idle.
import * as THREE from 'three';
import './grade';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assets } from './assets';
import { Character } from './character';
import { RARITY_IDS, WEAPONS } from './config';
import { GEAR_MODELS } from './items';
import { archerBow } from './party';
import { WEAPON_GRIPS, SHIELD_GRIP } from './rig';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x667788);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(3, 6, 4);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);

/** One row: hero model, [right hand, left hand] per item, `mainLeft` for the staff, `ranged` for the aim pose. */
interface Row { label: string; hero: string; items: [string | null, string | null][]; mainLeft?: boolean; ranged?: boolean }
const q = (kind: string) => RARITY_IDS.map((r) => `${kind}_${r}`);
const staff = (el: string) => WEAPONS[`staff_${el}`].tiers!;
const ROWS: Row[] = [
  { label: 'меч', hero: 'peasant', items: q('sword').map((m) => [m, null]) },
  { label: 'топор', hero: 'peasant', items: q('axe').map((m) => [m, null]) },
  { label: 'молот', hero: 'peasant', items: q('hammer').map((m) => [m, null]) },
  // the only shield the warrior can wear (CLASSES.warrior.off)
  { label: 'шипастый щит', hero: 'peasant', items: q('shield_spiked').map((m) => ['sword_common', m]) },
  // the hunter: bows and the gun in the left hand (Game.heldModels), the polearm in the right
  { label: 'лук (FBX людей / орков) и луки сетов', hero: 'human_archer', ranged: true,
    items: [[null, 'bow_human_archer'], [null, 'bow_orc_archer'], [null, archerBow(0, false)], [null, archerBow(1, true)], [null, archerBow(3, true)], [null, archerBow(5, true)]] },
  { label: 'луки сетов (второй вариант)', hero: 'human_archer', ranged: true, items: [1, 2, 3, 4, 5].map((r) => [null, archerBow(r, false)] as [null, string]) },
  { label: 'ружьё', hero: 'human_archer', ranged: true, items: q('gun').map((m) => [null, m]) },
  { label: 'древковое', hero: 'human_archer', items: q('polearm').map((m) => [m, null]) },
  { label: 'посох огня', hero: 'mage', mainLeft: true, items: staff('fire').map((m) => [m, null]) },
  { label: 'посох льда', hero: 'mage', mainLeft: true, items: staff('ice').map((m) => [m, null]) },
  { label: 'посох ветра', hero: 'mage', mainLeft: true, items: staff('wind').map((m) => [m, null]) },
];

const params = new URLSearchParams(location.search);
const only = params.get('row');
// `?orc`: the orc heroes (CLASSES model, FACTIONS.orc.hero) instead of the human ones
const ORC: Record<string, string> = { peasant: 'orc_peon', human_archer: 'orc_archer', mage: 'orc_shaman' };
if (params.has('orc')) for (const r of ROWS) r.hero = ORC[r.hero] ?? r.hero;
const rows = ROWS.map((r, i) => ({ r, i })).filter(({ i }) => only === null || +only === i);
const used = new Set<string>();
for (const { r } of rows) { used.add(r.hero); for (const [a, b] of r.items) { if (a) used.add(a); if (b) used.add(b); } }
const gear = [...used].filter((n) => GEAR_MODELS.includes(n));
const props = [...used].filter((n) => Object.values(WEAPONS).some((w) => w.tiers?.includes(n)));
const fbx = [...used].filter((n) => !gear.includes(n) && !props.includes(n));
await Promise.all([assets.loadAll(fbx, () => {}), assets.loadGear(gear), assets.loadProps(props)]);

const chars: { ch: Character; row: Row }[] = [];
const labels = document.getElementById('labels')!;
rows.forEach(({ r, i }, k) => {
  const z = -k * 2.4;
  r.items.forEach(([right, left], j) => {
    const ch = new Character(r.hero, null, 1);
    ch.setWeapon(right, left, !!r.mainLeft);
    ch.position.set(j * 1.5 - (r.items.length - 1) * 0.75, 0, z);
    ch.facing = 0.35; // a little toward the camera's right, so the weapon hand shows
    scene.add(ch.root);
    chars.push({ ch, row: r });
  });
  const el = document.createElement('div');
  el.textContent = `${i}: ${r.label}`;
  labels.append(el);
});
const n = rows.length;
// the widest row fits the view
const width = Math.max(...rows.map(({ r }) => r.items.length)) * 1.5;
const dist = width / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect) + 2 + n * 2;
camera.position.set(0, 1.4 + n * 0.6, dist);
controls.target.set(0, 0.9, -(n - 1) * 1.2);
controls.update();

let mode: 'idle' | 'aim' | 'cast' = (params.get('pose') as 'aim') ?? 'idle';
addEventListener('keydown', (e) => {
  if (e.key === 'a') mode = 'aim';
  if (e.key === 'm') mode = 'cast';
  if (e.key === 'i') mode = 'idle';
});
let t = 0;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  t -= dt;
  if (t <= 0) {
    t = 1.2;
    for (const { ch, row } of chars) {
      if (mode === 'aim' && row.ranged) { ch.swing('aim', 1, 1.2, 0.5); ch.swing('draw', 0, 1.2, 0.5); }
      if (mode === 'cast' && row.mainLeft) ch.attack('MagicAttack', 1.2, 0.5);
    }
  }
  for (const { ch } of chars) ch.update(dt, false);
  controls.update();
  renderer.render(scene, camera);
});
/** Re-attach every row's items (after editing WEAPON_GRIPS from the console). */
function reattach() {
  const at = new Map<Row, number>();
  for (const { ch, row } of chars) {
    const j = at.get(row) ?? 0;
    at.set(row, j + 1);
    ch.setWeapon(row.items[j][0], row.items[j][1], !!row.mainLeft);
  }
}
/** Console: `regrip('hammer', { roll: 1.2 })` — patch a grip and re-attach. */
function regrip(kind: string, patch: (typeof WEAPON_GRIPS)[string]) {
  WEAPON_GRIPS[kind] = { ...WEAPON_GRIPS[kind], ...patch };
  reattach();
}
/** Console: every hero turned to `facing`, seen from the game camera's angle (19 up, 12.5 back) at distance `d`. */
function gameView(facing: number, d = 8.5) {
  for (const { ch } of chars) ch.facing = facing;
  const k = d / Math.hypot(19, 12.5);
  camera.position.set(0, 0.6 + 19 * k, -(n - 1) * 1.2 + 12.5 * k);
  controls.target.set(0, 0.6, -(n - 1) * 1.2);
}
Object.assign(window, { camera, controls, scene, chars, WEAPON_GRIPS, SHIELD_GRIP, regrip, gameView, setMode: (m: typeof mode) => { mode = m; } });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
