import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import '@fontsource/rubik/900.css';
import * as THREE from 'three';
import { assets } from './assets';
import { setMuted, sfx, unlockAudio } from './audio';
import { Character } from './character';
import { FACTIONS, MOBS, WEAPONS, type FactionId } from './config';
import { Game } from './game';
import { Input } from './input';
import { Inventory } from './inventory';
import { MapView } from './mapview';
import { clearSave, loadSave, newSave, writeSave } from './save';
import { UI } from './ui';
import { BREAKABLES } from './world';

const ui = new UI();
const app = ui.app;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'game';
app.prepend(renderer.domElement);
const input = new Input(app);
const labels = document.getElementById('labels')!;

function resize() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h, false);
  return { w, h };
}
addEventListener('resize', resize);
resize();

// Everything the prototype can show; loaded up-front (≈20 MB of FBX).
const models = new Set<string>();
for (const f of Object.values(FACTIONS)) {
  models.add(f.hero);
  f.campBuildings.forEach((b) => models.add(b));
  f.campProps.forEach((p) => models.add(p));
  models.add(f.campfire);
}
for (const w of Object.values(WEAPONS)) Object.values(w.model).forEach((m) => models.add(m));
for (const m of Object.values(MOBS)) for (const [c, w] of Object.values(m.model)) { models.add(c); if (w) models.add(w); }
for (const b of Object.values(BREAKABLES)) if (b.model) models.add(b.model);
['orc_stone_big', 'orc_stone_mid', 'orc_stone_small', 'orc_log', 'orc_wood_pile_big', 'orc_tusk_standing', 'orc_skull',
  'undead_fence', 'undead_ruins_01', 'undead_ruins_02', 'undead_obelisk', 'undead_column_1', 'undead_big_bone',
  'undead_bones_remains', 'undead_lamp_post', 'campfire',
  // level design kit
  'palisade_pole', 'tower_human_small_1', 'orc_high_stand', 'human_house_large', 'human_house_mid', 'human_house_small',
  'smithy_building', 'barrack_Lv2', 'tower_big', 'orc_cabin', 'orc_barrack_Lv2', 'orc_tower_Lv2', 'anvil_big', 'orc_anvil',
  'practice_dummy', 'orc_practice_dummy', 'target', 'orc_practice_aim', 'elf_well', 'wood_pile_big', 'orc_wood_pile_big',
  'orc_head_lantern', 'orc_flag_red', 'orc_drum_big', 'orc_altar', 'orc_horned_skull', 'cauldron', 'box_large_2',
  'woodcutter_building', 'elf_log_pile', 'saw', 'wood_pile_small', 'bucket', 'elf_stone_big', 'mine_enterance', 'minecart',
  'mine_rail_piece', 'box_small_2', 'orc_throne', 'tower_Lv2', 'throne_Lv1', 'banner', 'elf_rock_small', 'elf_tree',
  'elf_foliage_small', 'elf_foliage_mid', 'elf_tree_root_1', 'undead_tusk_gate', 'undead_house_tower', 'undead_tower_small',
  'undead_smithy_house', 'undead_building', 'undead_tower', 'undead_wheel_of_pain', 'undead_cauldron', 'undead_flag',
  'undead_windmill', 'undead_tower_Lv2', 'undead_throne_Lv1', 'undead_throne', 'undead_floating_stone',
  'undead_floating_coffin', 'undead_column_2', 'undead_tomb_stone_5', 'undead_tomb_stone_6', 'undead_ground_bone_1',
  'undead_ground_bone_2', 'undead_ground_bone_3', 'orc_bucket', 'orc_box_large_2', 'shield', 'spear',
  'orc_wood_pile_small', 'orc_beam_pile'].forEach((m) => models.add(m));

await assets.loadAll([...models], (p) => ui.loading(p, `Загрузка моделей… ${Math.round(p * 100)}%`));
ui.loading(1, 'Готово');

let game: Game | null = null;

function applyGfx(low: boolean) {
  renderer.shadowMap.enabled = !low;
  renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 2));
  resize();
  game?.setLowGfx(low);
}
const clock = new THREE.Clock();

function startGame(faction: FactionId, fresh: boolean) {
  let save = loadSave();
  if (!save || save.faction !== faction) { save = newSave(faction); writeSave(save); }
  setMuted(save.muted);
  game = new Game(save, input, ui, labels);
  game.camera.aspect = app.clientWidth / app.clientHeight;
  game.camera.updateProjectionMatrix();
  ui.showHud(true);
  applyGfx(!!save.lowGfx);
  const inv = new Inventory(ui, game);
  ui.onCharacter = game.onOpenCharacter = () => { input.reset(); inv.openCharacter(); };
  ui.onBag = game.onOpenBag = () => { input.reset(); inv.openBag(); };
  ui.onArmor = ui.onCharacter;
  const map = new MapView(game);
  ui.onMap = game.onOpenMap = () => { if (inv.isOpen || ui.modalOpen) return; map.toggle(); };
  addEventListener('keydown', (e) => {
    if (inv.isOpen && (e.code === 'Escape' || e.code === 'KeyI' || e.code === 'KeyC' || e.code === 'KeyB')) inv.close();
  });
  ui.onSettings = () => {
    if (!game) return;
    game.paused = true;
    input.reset();
    ui.settings(save!.muted, !!save!.lowGfx, () => { save!.muted = !save!.muted; setMuted(save!.muted); game?.persist(); }, () => {
      save!.lowGfx = !save!.lowGfx;
      applyGfx(!!save!.lowGfx);
      game?.persist();
    }, () => {
      clearSave();
      location.reload();
    }, () => { if (game) game.paused = false; });
  };
  if (fresh) {
    ui.flash();
    sfx.levelUp();
    setTimeout(() => ui.toast('Тяни палец по экрану — герой бьёт врагов сам'), 1200);
    setTimeout(() => ui.toast('Бочки, ящики и кусты тоже можно рубить: из них падают сферы силы'), 6000);
  }
}

// ---------- faction select: both heroes on a small stage ----------
function factionScreen() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x585470);
  scene.fog = new THREE.Fog(0x585470, 8, 22);
  scene.add(new THREE.HemisphereLight(0xe8e4ff, 0x3a3348, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 5, 4);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(8, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6d6880 }));
  scene.add(ground);
  const cam = new THREE.PerspectiveCamera(50, app.clientWidth / app.clientHeight, 0.1, 50);
  cam.position.set(0, 3.2, 10.5);
  cam.lookAt(0, -0.4, 0);
  const heroes: Record<FactionId, Character> = {
    human: new Character(FACTIONS.human.hero, WEAPONS.sword.model.human, 1),
    orc: new Character(FACTIONS.orc.hero, WEAPONS.axe.model.orc, 1),
  };
  heroes.human.position.set(-0.95, 0, 0);
  heroes.orc.position.set(0.95, 0, 0);
  heroes.human.facing = 0.25;
  heroes.orc.facing = -0.25;
  // Grey "world of the dead" look from the prologue until the hero picks a side.
  for (const h of Object.values(heroes)) { h.setTint(0x9a9ab8, 0.85); scene.add(h.root); }
  for (const f of ['human', 'orc'] as FactionId[]) {
    const b = assets.clone(f === 'human' ? 'banner' : 'orc_banner');
    b.scale.multiplyScalar(0.45);
    b.position.set(f === 'human' ? -3 : 3, 0, -2.5);
    scene.add(b);
  }
  let picked: FactionId | null = null;
  let running = true;
  const loop = () => {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    for (const [f, h] of Object.entries(heroes) as [FactionId, Character][]) {
      const target = picked === f ? 1.12 : 1;
      h.root.scale.setScalar(THREE.MathUtils.lerp(h.root.scale.x, target, dt * 8));
      h.update(dt, false);
    }
    cam.aspect = app.clientWidth / app.clientHeight;
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  ui.hideLoading();
  loop();
  ui.factionSelect((f) => {
    unlockAudio();
    picked = f;
    for (const [k, h] of Object.entries(heroes) as [FactionId, Character][]) {
      h.setTint(k === f ? 0xffffff : 0x9a9ab8, k === f ? 1 : 0.85);
      if (k === f) h.attack(WEAPONS[FACTIONS[f].startWeapon].anim, 1, 0.4);
    }
  }, (f) => {
    running = false;
    startGame(f, true);
    run();
  });
}

function run() {
  clock.getDelta();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (!game) return;
    const { w, h } = { w: app.clientWidth, h: app.clientHeight };
    if (game.camera.aspect !== w / h) { game.camera.aspect = w / h; game.camera.updateProjectionMatrix(); resize(); }
    game.update(dt);
    renderer.render(game.scene, game.camera);
  });
}

// Pause when the tab is hidden (GDD: пауза при сворачивании).
document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) { game.paused = true; game.persist(); input.reset(); }
  else if (!ui.modalOpen) game.paused = false;
});
addEventListener('pointerdown', unlockAudio, { once: true });

const existing = loadSave();
if (existing) {
  ui.hideLoading();
  startGame(existing.faction, false);
  run();
} else {
  factionScreen();
}
Object.assign(window, { __game: () => game });
if (import.meta.env.DEV) {
  // Level-design overview: __view(x, z, height, back) / __view() to return to the game camera.
  Object.assign(window, {
    __renderer: renderer,
    __view: (x?: number, z = 0, h = 30, back = 22) => {
      if (!game) return;
      const wide = x !== undefined;
      game.camOverride = wide ? { x, z, h, back } : null;
      app.style.width = wide ? '100%' : '';
      document.getElementById('hud')!.style.display = wide ? 'none' : '';
      labels.style.display = wide ? 'none' : '';
      game.camera.aspect = app.clientWidth / app.clientHeight;
      game.camera.updateProjectionMatrix();
      resize();
    },
  });
}
