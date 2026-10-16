import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import '@fontsource/rubik/800.css';
import '@fontsource/rubik/900.css';
import * as THREE from 'three';
import './grade';
import { assets } from './assets';
import { setMuted, sfx, unlockAudio } from './audio';
import { Character } from './character';
import { FACTIONS, FORGE3D, MOBS, ORBS, PETS, WEAPONS, type FactionId, type OrbKind } from './config';
import { GEAR_MODELS } from './items';
import { Game } from './game';
import { Input } from './input';
import { Inventory } from './inventory';
import { DebugPanel } from './debug';
import { Prologue, clearPrologue, prologueDone, savePrologue, type Gains } from './prologue';
import { MapView } from './mapview';
import { GachaView } from './gachaview';
import { loadSave, newSave, wipeAll, writeSave } from './save';
import { addStat } from './balance';
import { clearLog, report } from './balancelog';
import { UI } from './ui';
import { DragScroll } from './dragscroll';
import { BREAKABLES } from './world';
import { CLASSES, type HeroClass } from './party';
import { classPreview } from './looks';
import { registerMocks } from './mocks';
import { startArtWave, startLoadingFx } from './loadfx';
import { Post } from './post';

const ui = new UI();
// the loading art comes alive: its background sways, sparks fly
startArtWave(document.getElementById('loading')!, `${import.meta.env.BASE_URL}assets/ui/loading.jpg`);
startLoadingFx(document.getElementById('loading')!);
const app = ui.app;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'game';
app.prepend(renderer.domElement);
// three.js stops the loop on context loss and restarts it on restore. If the browser never gives
// the context back (GPU reset, too many contexts), the world would stay blank: save and reload.
let ctxLostTimer = 0;
renderer.domElement.addEventListener('webglcontextlost', () => {
  console.warn('WebGL context lost');
  clearTimeout(ctxLostTimer);
  ctxLostTimer = window.setTimeout(() => { game?.persist(); location.reload(); }, 3000);
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  console.warn('WebGL context restored');
  clearTimeout(ctxLostTimer);
});
const input = new Input(app);
const labels = document.getElementById('labels')!;
/** Glow, grade and vignette over the game view (src/post.ts); null on low graphics. */
let post: Post | null = new Post(renderer);

function resize() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h, false);
  post?.resize();
  ui.fit();
  return { w, h };
}
addEventListener('resize', resize);
new DragScroll(app);
resize();

// Everything the prototype can show; loaded up-front (≈20 MB of FBX).
const models = new Set<string>();
for (const f of Object.values(FACTIONS)) {
  models.add(f.hero);
  f.campBuildings.forEach((b) => models.add(b));
  f.campProps.forEach((p) => models.add(p));
  models.add(f.campfire);
  f.preview.forEach((m) => models.add(m)); // the faction choice scene
}
for (const w of Object.values(WEAPONS)) {
  // (mage orbs are GLB creatures, below)
  if (!w.orb && !w.pet) Object.values(w.model).forEach((m) => models.add(m)); // pets are GLB creatures (PETS)
  if (w.shot) Object.values(w.shot.arrow).forEach((m) => models.add(m));
}
for (const c of Object.values(CLASSES)) Object.values(c.model ?? {}).forEach((m) => models.add(m));
models.add('sword_undead_king'); // the Lich King's sword: prologue and the faction choice scene
const props = new Set<string>();
for (const w of Object.values(WEAPONS)) w.tiers?.forEach((m) => props.add(m));
const creatures = new Set<string>();
for (const w of Object.values(WEAPONS)) if (w.orb) Object.values(w.model).forEach((m) => creatures.add(m));
for (const m of Object.values(MOBS)) for (const [c, w] of Object.values(m.model)) { (m.creature ? creatures : models).add(c); if (w) models.add(w); }
for (const p of Object.values(PETS)) creatures.add(p.model);
for (const b of Object.values(BREAKABLES)) if (b.model) models.add(b.model);
// gacha forge scene (src/forge3d.ts): anvil and decor are cloned from here
models.add('anvil_big');
models.add('hammer_human_paladin');
for (const [m] of FORGE3D.decor) models.add(m);
['orc_stone_big', 'orc_log', 'orc_wood_pile_big', 'orc_tusk_standing', 'orc_skull',
  'undead_fence', 'undead_ruins_01', 'undead_ruins_02', 'undead_obelisk', 'undead_column_1', 'undead_big_bone',
  'undead_bones_remains', 'undead_lamp_post', 'campfire',
  // level design kit
  'palisade_pole', 'tower_human_small_1', 'orc_high_stand', 'human_house_large', 'human_house_mid', 'human_house_small',
  'barrack_Lv2', 'tower_big', 'orc_cabin', 'orc_barrack_Lv2', 'orc_tower_Lv2',
  'practice_dummy', 'orc_practice_dummy', 'target', 'orc_practice_aim', 'elf_well', 'wood_pile_big', 'orc_wood_pile_big',
  'orc_head_lantern', 'orc_flag_red', 'orc_drum_big', 'orc_altar', 'orc_horned_skull', 'cauldron', 'box_large_2',
  'elf_log_pile', 'saw', 'wood_pile_small', 'bucket',
  'box_small_2', 'orc_throne', 'tower_Lv2', 'throne_Lv1', 'banner', 'elf_rock_small', 'elf_tree',
  'elf_foliage_small', 'elf_foliage_mid', 'elf_tree_root_1', 'elf_rock_big', 'undead_tusk_gate', 'undead_house_tower', 'undead_tower_small',
  'undead_smithy_house', 'undead_building', 'undead_tower', 'undead_wheel_of_pain', 'undead_cauldron', 'undead_flag',
  'undead_windmill', 'undead_tower_Lv2', 'undead_throne_Lv1', 'undead_throne', 'undead_floating_stone',
  'undead_floating_coffin', 'undead_column_2', 'undead_tomb_stone_5', 'undead_tomb_stone_6', 'undead_ground_bone_1',
  'undead_ground_bone_2', 'undead_ground_bone_3', 'orc_bucket', 'orc_box_large_2', 'shield', 'spear',
  'orc_wood_pile_small', 'orc_beam_pile', 'undead_wood_pile', 'undead_oracle_Lv1', 'house_Lv1', 'lantern_street', 'elf_mine_Lv1', 'elf_oracle_Lv1', 'elf_throne_Lv1', 'elf_fountain'].forEach((m) => models.add(m));

registerMocks(); // stand-in models built in code (the gun): not loaded from files
await Promise.all([
  // per-quality GLB gear (sword_common…) comes from loadGear, not as FBX
  assets.loadAll([...models].filter((m) => !assets.has(m) && !GEAR_MODELS.includes(m)), (p) => ui.loading(p, `Загрузка моделей… ${Math.round(p * 100)}%`)),
  assets.loadCreatures([...creatures]),
  assets.loadGear(GEAR_MODELS),
  assets.loadProps([...props]),
]);
ui.loading(1, 'Готово');

let game: Game | null = null;

function applyGfx(low: boolean) {
  renderer.shadowMap.enabled = !low;
  renderer.setPixelRatio(low ? 1 : Math.min(devicePixelRatio, 2));
  if (low) { post?.dispose(); post = null; } else post ??= new Post(renderer);
  resize();
  game?.setLowGfx(low);
}
const clock = new THREE.Clock();

function startGame(faction: FactionId, fresh: boolean, gains?: Gains) {
  let save = loadSave();
  if (!save || save.faction !== faction) {
    save = newSave(faction);
    // Orbs collected in the prologue stay with the hero.
    if (gains) for (const k of Object.keys(gains) as OrbKind[]) if (gains[k]) addStat(save, 'enemy', k, gains[k] * ORBS[k].value);
    writeSave(save);
  }
  setMuted(save.muted);
  game = new Game(save, input, ui, labels);
  game.camera.aspect = app.clientWidth / app.clientHeight;
  game.camera.updateProjectionMatrix();
  ui.showHud(true);
  applyGfx(!!save.lowGfx);
  const inv = new Inventory(ui, game);
  ui.onBag = ui.onArmor = game.onOpenCharacter = game.onOpenBag = () => { input.reset(); inv.open(); };
  ui.onClass = (c) => game?.switchClass(c);
  const debug = new DebugPanel(app, game);
  ui.onDebug = () => debug.toggle(true);
  const map = new MapView(game);
  ui.onMap = game.onOpenMap = () => { if (inv.isOpen || ui.modalOpen) return; map.toggle(); };
  const gacha = new GachaView(ui, game);
  ui.onGacha = game.onOpenGacha = () => {
    if (inv.isOpen || ui.modalOpen || map.isOpen) return;
    input.reset();
    gacha.open();
  };
  addEventListener('keydown', (e) => {
    if (gacha.isOpen && (e.code === 'Escape' || e.code === 'KeyG')) gacha.close();
    else if (inv.isOpen && (e.code === 'Escape' || e.code === 'KeyI' || e.code === 'KeyC' || e.code === 'KeyB')) inv.close();
  });
  ui.onSettings = function open() {
    if (!game) return;
    game.paused = true;
    input.reset();
    // Drop the game first: reload fires visibilitychange(hidden), whose persist() would rewrite the save.
    // `skipPrologue`: the reload opens the faction choice instead of the tutorial.
    const reset = (skipPrologue: boolean) => {
      game = null;
      wipeAll();
      clearLog();
      if (skipPrologue) savePrologue({ power: 0, hp: 0, regen: 0, speed: 0 });
      location.reload();
    };
    ui.settings(save!.muted, !!save!.lowGfx, () => { save!.muted = !save!.muted; setMuted(save!.muted); game?.persist(); }, () => {
      save!.lowGfx = !save!.lowGfx;
      applyGfx(!!save!.lowGfx);
      game?.persist();
    }, reset, () => { if (game) game.paused = false; }, () => ui.balanceLog(report(), open));
  };
  if (fresh) {
    ui.flash();
    sfx.levelUp();
    setTimeout(() => ui.toast('Тяни палец по экрану — герой бьёт врагов сам'), 1200);
    setTimeout(() => ui.toast('Бочки, ящики и кусты тоже можно рубить: из них падают сферы силы'), 6000);
  }
}

// ---------- prologue: the spirit before the Lich King (GDD 3.1) ----------
function prologue() {
  ui.hideLoading();
  const p = new Prologue(ui, input, labels, (gains) => {
    renderer.setAnimationLoop(null);
    p.dispose();
    ui.flash();
    factionScreen(gains);
  });
  p.onSettings = () => {
    p.paused = true;
    ui.prologueSettings(() => p.skip(), () => { p.paused = false; });
  };
  if (import.meta.env.DEV) Object.assign(window, { __prologue: p });
  clock.getDelta();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    p.camera.aspect = app.clientWidth / app.clientHeight;
    p.camera.updateProjectionMatrix();
    p.viewH = renderer.domElement.height;
    p.update(dt);
    if (post) post.render(p.scene, p.camera);
    else renderer.render(p.scene, p.camera);
  });
}

// ---------- faction select: each race's champion on a small stage, the Lich King behind ----------
function factionScreen(gains: Gains) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6a62b8);
  scene.fog = new THREE.Fog(0x6a62b8, 10, 26);
  scene.add(new THREE.HemisphereLight(0xf2eeff, 0x4c4680, 2.3));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(2, 5, 4);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(10, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7c74b8 }));
  scene.add(ground);
  // A step behind the champions: the squad in its mythic sets stands on it, above their heads
  const STEP = { h: 0.7, z: -3 };
  const step = new THREE.Mesh(new THREE.BoxGeometry(9, STEP.h, 3).translate(0, STEP.h / 2, STEP.z), new THREE.MeshLambertMaterial({ color: 0x8a82c4 }));
  scene.add(step);
  const cam = new THREE.PerspectiveCamera(50, app.clientWidth / app.clientHeight, 0.1, 50);
  // Cards cover the lower half of the screen: keep the champions in the upper half.
  cam.position.set(0, 3.4, 11.5);
  cam.lookAt(0, -0.3, 0);
  for (const f of ['human', 'orc'] as FactionId[]) {
    const b = assets.clone(f === 'human' ? 'banner' : 'orc_banner');
    b.scale.multiplyScalar(0.45);
    b.position.set((f === 'human' ? -1 : 1) * 3.2, 0, STEP.z + 1.9);
    scene.add(b);
  }
  // Squad preview: the class picked below, bare in front of each faction and in its mythic set behind
  // (where the Lich King stood); rebuilt on every class pick.
  const MYTHIC = 5;
  const GREY = 0x8f8ca8;
  let heroes: { f: FactionId; ch: Character }[] = [];
  let cls: HeroClass = 'warrior';
  let picked: FactionId | null = null;
  const tintOf = (f: FactionId) => (f === picked ? 0xffffff : GREY);
  const showClass = (c: HeroClass) => {
    cls = c;
    for (const h of heroes) h.ch.dispose();
    heroes = [];
    for (const f of ['human', 'orc'] as FactionId[]) {
      const sx = f === 'human' ? -1 : 1;
      for (const [rarity, x, y, z, scale] of [[null, 1.05, 0, 0.4, 1.1], [MYTHIC, 1.6, STEP.h, STEP.z, 1.5]] as const) {
        const look = classPreview(c, f, rarity);
        const ch = new Character(look.model, null, scale);
        // the set bow loads on demand: the hands stay empty until it is there
        const [r, l] = look.weapon;
        if ((!r || assets.has(r)) && (!l || assets.has(l))) ch.setWeapon(...look.weapon);
        ch.setOrb(look.orb);
        ch.setTrims(look.trims);
        ch.position.set(sx * x, y, z);
        // the front pair turns in towards the middle (as before the squad preview), the squad on the step looks right
        ch.facing = rarity === null ? -sx * 0.25 : 0.25;
        // Grey "world of the dead" look until a side is picked. Opaque tint only: a transparent
        // material without depth writes lets the armour pieces show through each other.
        ch.setTint(tintOf(f));
        scene.add(ch.root);
        heroes.push({ f, ch });
        void assets.ensure(look.load).then(() => {
          if (cls !== c || !heroes.some((h) => h.ch === ch)) return;
          ch.setWeapon(...look.weapon);
          ch.setOutfit(look.outfit, look.keep);
          ch.setTint(tintOf(f));
        });
      }
    }
  };
  showClass(cls);
  const glow = new THREE.PointLight(0x7fc8ff, 5, 7, 1.6);
  glow.position.set(0, 3, -2.4);
  scene.add(glow);

  let running = true;
  const loop = () => {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    for (const { f, ch } of heroes) {
      const target = picked === f ? 1.12 : 1;
      ch.root.scale.setScalar(THREE.MathUtils.lerp(ch.root.scale.x, target, dt * 8));
      ch.update(dt, false);
    }
    cam.aspect = app.clientWidth / app.clientHeight;
    cam.updateProjectionMatrix();
    if (post) post.render(scene, cam);
    else renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  ui.hideLoading();
  clock.getDelta();
  loop();
  ui.factionSelect((f) => {
    unlockAudio();
    picked = f;
    for (const { f: k, ch } of heroes) {
      ch.setTint(tintOf(k));
      if (k === f) ch.attack('AxeAttack', 1, 0.4);
    }
  }, (f) => {
    running = false;
    clearPrologue();
    startGame(f, true, gains);
    run();
  }, 'За заслуги перед нежитью Король-лич возвращает тебя к жизни.', () => cls, (c) => {
    sfx.click();
    showClass(c);
  });
}

function run() {
  clock.getDelta();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (!game) return;
    const { w, h } = { w: app.clientWidth, h: app.clientHeight };
    if (game.camera.aspect !== w / h) { game.camera.aspect = w / h; game.camera.updateProjectionMatrix(); resize(); }
    game.viewH = renderer.domElement.height;
    game.update(dt);
    if (game.offscreen) return;
    if (post) post.render(game.scene, game.camera);
    else renderer.render(game.scene, game.camera);
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
  // A finished prologue skips straight to the choice after a reload.
  const done = prologueDone();
  if (done) factionScreen(done);
  else prologue();
}
Object.assign(window, { __game: () => game });
if (import.meta.env.DEV) {
  // Level-design overview: __view(x, z, height, back) / __view() to return to the game camera.
  Object.assign(window, {
    __renderer: renderer,
    __post: () => post,
    /** Look-dev: drop the hero at (x, z), immortal, the fog of war cleared. */
    __goto: (x: number, z: number) => {
      if (!game) return;
      game.debugFog(true);
      game.god = true;
      game.hero.position.set(x, 0, z);
    },
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
