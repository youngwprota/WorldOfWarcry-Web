// Dev page: checks models, textures, animations and weapon grips.
import * as THREE from 'three';
import './grade';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assets, ANIMS } from './assets';
import { attachWeapon } from './rig';

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
Object.assign(window, { camera, controls, scene });

const pairs: [string, string][] = [
  ['human_knight', 'sword_human_knight'], ['orc_grunt', 'axe_orc_grunt'], ['paladin', 'hammer_human_paladin'],
  ['peasant', 'axe'], ['soldier', 'sword_soldier'], ['orc_peon', 'axe_orc_peon'], ['orc_warrior', 'sword_orc_warrior'],
  ['orc_chieftain', 'axe_orc_chieftain'], ['undead_worker', ''], ['undead_warrior', 'spear_undead_warrior'],
  ['undead_assassin', ''], ['undead_king', 'sword_undead_king'], ['peasant', 'dagger'], ['orc_peon', 'reaper'],
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
const names = gallery ? [] : [...new Set([...pairs.flat().filter(Boolean), ...props])];
if (!gallery) await assets.loadAll(names, () => {});

const mixers: THREE.AnimationMixer[] = [];
const solo = new URLSearchParams(location.search).get('solo');
pairs.forEach(([c, w], i) => {
  if (gallery || (solo !== null && +solo !== i)) return;
  const g = assets.clone(c);
  if (solo === null) g.position.set((i % 6) * 1.6 - 4, 0, -Math.floor(i / 6) * 2.5);
  scene.add(g);
  if (w) attachWeapon(g, w);
  const m = new THREE.AnimationMixer(g);
  m.clipAction(assets.clips.full.Idle).play();
  mixers.push(m);
});
if (solo === null && !gallery) props.forEach((p, i) => {
  const g = assets.clone(p);
  g.position.set(i * 2.5 - 8, 0, 4);
  scene.add(g);
});

const ui = document.getElementById('ui')!;
const sel = document.createElement('select');
ANIMS.forEach((a) => sel.add(new Option(a, a)));
sel.onchange = () => mixers.forEach((m) => { m.stopAllAction(); m.clipAction(assets.clips.full[sel.value as 'Idle']).play(); });
ui.append(sel);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  mixers.forEach((m) => m.update(dt));
  controls.update();
  renderer.render(scene, camera);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
