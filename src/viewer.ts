// Dev page: checks models, textures, animations and weapon grips.
import * as THREE from 'three';
import './grade';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assets, ANIMS } from './assets';
import { attachTrim, attachWeapon, SHIELD_GRIP, WEAPON_GRIPS } from './rig';
import { KEYS, Swinger, type SwingKind } from './swing';

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
scene.add(new THREE.GridHelper(20, 20));
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.5, 7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
Object.assign(window, { camera, controls, scene, SHIELD_GRIP, WEAPON_GRIPS, attachWeapon });

const pairs: [string, string, string?][] = [
  ['human_knight', 'sword_human_knight'], ['orc_grunt', 'axe_orc_grunt'], ['paladin', 'hammer_human_paladin'],
  ['peasant', 'axe'], ['soldier', 'sword_soldier'], ['orc_peon', 'axe_orc_peon'], ['orc_warrior', 'sword_orc_warrior'],
  ['orc_chieftain', 'axe_orc_chieftain'], ['undead_worker', ''], ['undead_warrior', 'spear_undead_warrior'],
  ['undead_assassin', ''], ['undead_king', 'sword_undead_king'], 
  ['human_knight', 'polearm_mythic'],
  // per-quality gear (GLB) with a shield in the left hand
  ['human_knight', 'sword_rare', 'shield_tower_rare'], ['orc_grunt', 'axe_epic', 'shield_buckler_epic'],
  ['paladin', 'hammer_legendary', 'shield_spiked_legendary'], ['soldier', 'sword_uncommon', 'shield_tower_common'],
  ['orc_warrior', 'axe_mythic', 'shield_spiked_mythic'],
];
const props = ['barrel', 'box_small_1', 'campfire', 'orc_barrel', 'undead_tomb_stone_1', 'undead_coffin', 'house_Lv1', 'orc_house_Lv1'];
// ?models=a,b,c — gallery of arbitrary models in a grid (level-design lookup).
const gallery = new URLSearchParams(location.search).get('models')?.split(',').filter(Boolean);
if (gallery) {
  await assets.loadAll(gallery, () => {});
  const cols = Math.ceil(Math.sqrt(gallery.length));
  gallery.forEach((n, i) => {
    const g = assets.clone(n);
    g.position.set((i % cols) * 11 - cols * 5.5, 0, Math.floor(i / cols) * 11);
    scene.add(g);
  });
  camera.position.set(0, cols * 9, cols * 12);
  controls.target.set(0, 0, cols * 4);
}
const leftName = new URLSearchParams(location.search).get('left');
const isGear = (n: string) => /_(common|uncommon|rare|epic|legendary|mythic)$/.test(n);
const all = [...new Set([...pairs.flat(), ...props, leftName].filter((n): n is string => !!n))];
if (!gallery) await Promise.all([assets.loadAll(all.filter((n) => !isGear(n)), () => {}), assets.loadGear(all.filter(isGear))]);

/** Armour sets of src/items.ts SETS: character → [set id, faction]. */
const TRIM_SETS: Record<string, [string, string]> = {
  soldier: ['guard', 'human'], human_knight: ['knight', 'human'], paladin: ['lord', 'human'],
  orc_warrior: ['guard', 'orc'], orc_grunt: ['knight', 'orc'], orc_chieftain: ['lord', 'orc'],
};
const mixers: THREE.AnimationMixer[] = [];
const swingers: { s: Swinger; g: THREE.Object3D }[] = [];
const solo = new URLSearchParams(location.search).get('solo');
pairs.forEach(([c, w, l], i) => {
  if (gallery || (solo !== null && +solo !== i)) return;
  const g = assets.clone(c);
  if (solo === null) g.position.set((i % 6) * 1.6 - 4, 0, -Math.floor(i / 6) * 2.5);
  scene.add(g);
  if (w) attachWeapon(g, w);
  // ?left=model — the same or another weapon in the left hand too (dual wield grip check)
  const left = new URLSearchParams(location.search).get('left');
  if (left || l) attachWeapon(g, left || l!, true);
  // ?trims=armor_guard_head_rare_human,… — armour quality pieces on the character (fit check)
  // ?trimq=rare — every armour-set character wears its own set's pieces of that quality, plus a ring and an amulet
  const q = new URLSearchParams(location.search).get('trimq');
  const set = q ? TRIM_SETS[c] : undefined;
  const auto = set ? [...['head', 'chest', 'arms', 'legs'].map((p) => `armor_${set[0]}_${p}_${q}_${set[1]}`),
    `armor_ring_${q}_${set[1]}`, `armor_amulet_${q}_${set[1]}`] : [];
  for (const t of [...auto, ...(new URLSearchParams(location.search).get('trims')?.split(',').filter(Boolean) ?? [])]) {
    assets.gear(t).then(() => attachTrim(g, t));
  }
  const m = new THREE.AnimationMixer(g);
  m.clipAction(assets.clips.full.Idle).play();
  mixers.push(m);
  swingers.push({ s: new Swinger(g), g });
});
if (solo === null && !gallery) props.forEach((p, i) => {
  const g = assets.clone(p);
  g.position.set(i * 2.5 - 8, 0, 4);
  scene.add(g);
});

const ui = document.getElementById('ui')!;
const sel = document.createElement('select');
ANIMS.forEach((a) => sel.add(new Option(a, a)));
// procedural swings (src/swing.ts) on top of Idle, repeated; `sweep` also spins the body like the polearm finisher
const SWINGS: SwingKind[] = ['thrust', 'sweep', 'slashRL', 'slashLR', 'overhead', 'uppercut', 'bash'];
SWINGS.forEach((k) => sel.add(new Option('swing: ' + k, 'swing:' + k)));
let swingKind: SwingKind | null = null;
let swingT = 0;
sel.onchange = () => {
  swingKind = sel.value.startsWith('swing:') ? (sel.value.slice(6) as SwingKind) : null;
  swingT = 0;
  mixers.forEach((m) => { m.stopAllAction(); m.clipAction(assets.clips.full[swingKind ? 'Idle' : (sel.value as 'Idle')]).play(); });
};
/** Swing timing as in the game for the polearm (1 attack/s): impact 0.4 s, swing 0.96 s, spin 0.35 s from the impact. */
const slow = +(new URLSearchParams(location.search).get('slow') ?? 1);
function updateSwings(dt: number) {
  if (swingKind) {
    if (swingT <= 0) { swingT = 1.4; swingers.forEach(({ s }) => s.start(swingKind!, 0, 0.96, 0.4)); }
    swingT -= dt;
  }
  const t = 1.4 - swingT; // time since the swing started
  const k = swingKind === 'sweep' ? Math.min(1, Math.max(0, (t - 0.4) / 0.35)) : 0;
  swingers.forEach(({ s, g }) => { s.apply(dt); g.rotation.y = (1 - (1 - k) * (1 - k)) * Math.PI * 2; });
}
Object.assign(window, { KEYS, pause: (on: boolean) => { paused = on; }, step: (dt: number) => tick(dt) });
let paused = false;
ui.append(sel);
const clock = new THREE.Clock();
function tick(dt: number) {
  mixers.forEach((m) => m.update(dt));
  updateSwings(dt);
  controls.update();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta() / slow;
  if (!paused) tick(dt);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
