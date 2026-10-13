// Roster page: faction units (rendered thumbnails) + every creature mob from MOBS with a live animation viewer.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ATTACK_HIT, MOBS, type MobDef } from './config';

const BASE = import.meta.env.BASE_URL + 'assets/';
type Faction = 'human' | 'orc' | 'undead';

interface Section {
  key: Faction;
  title: string;
  units: [name: string, file: string, web: boolean][];
  skin: Swatch;
  swatches: Swatch[];
  look: string[];
}
type Swatch = [name: string, top: string, mid: string, bottom: string];

const SECTIONS: Section[] = [
  {
    key: 'human', title: 'Humans',
    units: [['Peasant', 'peasant', true], ['Soldier', 'soldier', true], ['Archer', 'archer', false],
      ['Knight', 'human_knight', true], ['Paladin', 'paladin', true], ['Mage', 'mage', false]],
    skin: ['Skin', 'f2e2b0', 'be957f', '4f3f39'],
    swatches: [['Faction blue', '7594b4', '415684', '1b243c'], ['Iris', '94b7be', '526a93', '222d43'], ['Gold trim', 'f0d952', 'af7e3b', '48351b']],
    look: ['Tidy and ordered: teal-steel plate, gold trim (more gold = higher rank), blue tabards, brown leather.',
      'Mobs keep natural animal colors.', 'Blue cloth and gold buckles only when the mob wears gear.'],
  },
  {
    key: 'orc', title: 'Orcs',
    units: [['Peon', 'orc_peon', true], ['Grunt', 'orc_grunt', true], ['Archer', 'orc_archer', false],
      ['Warrior', 'orc_warrior', true], ['Shaman', 'orc_shaman', false], ['Chieftain', 'orc_chieftain', true]],
    skin: ['Skin', '9fdc4b', '588136', '243618'],
    swatches: [['Faction red', 'ea3d31', '962323', '3e0f10'], ['Iris', 'fbe76f', 'eda950', '624724'], ['Dark sclera', '3d5d4b', '223636', '0e1618']],
    look: ['Brutal: dark spiked shoulder plates with red trim, ivory tusks and spikes, rough straps, black topknot.',
      'No white eyes: dark sclera, yellow-orange iris.',
      'Mobs: base model in natural colors (the boar). Red cloth and ivory spikes only when the mob wears gear.'],
  },
  {
    key: 'undead', title: 'Undead',
    units: [['Worker', 'undead_worker', true], ['Warrior', 'undead_warrior', true], ['Archer', 'undead_archer', false],
      ['Assassin', 'undead_assassin', true], ['Mage', 'undead_mage', false], ['King', 'undead_king', true]],
    skin: ['Dead skin', 'a4debd', '5b8692', '253942'],
    swatches: [['Bone', 'f0e5b0', 'b19f7f', '494339'], ['Glow green', '56f2b0', '30cd7f', '145639'],
      ['Purple cloth', '63516a', '372f4c', '171422'], ['Slate cloth', '566b6d', '303e4e', '141a23']],
    look: ['Exposed ribs, spine and skull, torn rags, curled dark horns, green glowing eyes (emissive map).',
      'Mobs: blue skin with bones sticking out, e.g. the undead boar.', 'Bones are extra mesh parts that only the undead variant shows.'],
  },
];

/** Creature mobs grouped by the faction prefix of their GLB (`orc_boar` → orc). */
const MOB_LIST: { def: MobDef; model: string; faction: Faction }[] = [];
for (const def of Object.values(MOBS)) {
  if (!def.creature) continue;
  const model = def.model.human[0];
  const faction = (['human', 'orc', 'undead'] as Faction[]).find((f) => model.startsWith(f + '_')) ?? 'human';
  MOB_LIST.push({ def, model, faction });
}

const CLIP_ORDER = ['idle', 'walk', 'attack', 'death'];

// ---------- shared 3D bits ----------
const loader = new GLTFLoader();
const gltfs = new Map<string, Promise<GLTF>>();
function loadModel(name: string) {
  let p = gltfs.get(name);
  if (!p) { p = loader.loadAsync(`${BASE}models/${name}.glb`); gltfs.set(name, p); }
  return p;
}

function makeScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  return scene;
}

/** Puts the camera at a 3/4 front view that fits the model's rest bounds. */
function frame(cam: THREE.PerspectiveCamera, obj: THREE.Object3D, target: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  box.getCenter(target);
  const r = Math.max(size.x, size.y, size.z);
  cam.position.set(target.x + r * 1.2, target.y + r * 0.45, target.z + r * 1.35);
  cam.lookAt(target);
}

// ---------- page ----------
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
thumbRenderer.setSize(360, 420);
const thumbCam = new THREE.PerspectiveCamera(32, 360 / 420, 0.05, 100);

async function mobThumb(model: string, img: HTMLImageElement) {
  const g = await loadModel(model);
  const scene = makeScene();
  const obj = SkeletonUtils.clone(g.scene);
  scene.add(obj);
  const mixer = new THREE.AnimationMixer(obj);
  const idle = g.animations.find((c) => c.name === 'idle');
  if (idle) { mixer.clipAction(idle).play(); mixer.update(0); }
  frame(thumbCam, obj, new THREE.Vector3());
  thumbRenderer.render(scene, thumbCam);
  img.src = thumbRenderer.domElement.toDataURL('image/png');
}

const chip = ([n, a, b, c]: Swatch) =>
  `<div class="sw"><i style="background:linear-gradient(#${a},#${b} 55%,#${c})"></i><span>${n}<br><code>#${b}</code></span></div>`;

const root = document.getElementById('root')!;
for (const s of SECTIONS) {
  const mobs = MOB_LIST.filter((m) => m.faction === s.key);
  const el = document.createElement('section');
  el.style.setProperty('--c', `var(--${s.key})`);
  el.innerHTML = `<h2>${s.title} <small>${s.units.length} units${mobs.length ? `, ${mobs.length} mob${mobs.length > 1 ? 's' : ''}` : ''}</small></h2>` +
    `<div class="rules"><div class="sws">${[s.skin, ...s.swatches].map(chip).join('')}</div><ul>${s.look.map((l) => `<li>${l}</li>`).join('')}</ul></div>` +
    `<div class="grid">` +
    s.units.map(([name, file, web]) => `<div class="card"><img src="${BASE}roster/${file}.png" alt="${s.title} ${name}">` +
      `<span class="name">${name}</span><span class="file">${file}.fbx</span><span class="tag ${web ? 'in' : ''}">${web ? 'in web' : 'Unity only'}</span></div>`).join('') +
    mobs.map((m) => `<div class="card mob" data-mob="${m.def.id}"><img alt="${m.def.name}">` +
      `<span class="name">${m.def.name}</span><span class="file">${m.model}.glb</span><span class="tag in">mob · ▶ animations</span></div>`).join('') +
    `</div>`;
  root.appendChild(el);
  for (const m of mobs) {
    const card = el.querySelector<HTMLElement>(`[data-mob="${m.def.id}"]`)!;
    mobThumb(m.model, card.querySelector('img')!);
    card.addEventListener('click', () => viewer.open(m.def.id));
  }
}

// ---------- animation viewer ----------
class Viewer {
  private el = document.getElementById('viewer')!;
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private cam = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
  private controls = new OrbitControls(this.cam, this.renderer.domElement);
  private clock = new THREE.Clock();
  private scene: THREE.Scene | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  private clips: THREE.AnimationClip[] = [];
  private model = '';
  private speed = 1;
  private playing = true;
  private loop = this.tick.bind(this);
  private raf = 0;

  constructor() {
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.setClearColor(0x16151a);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }

  async open(id: string) {
    const m = MOB_LIST.find((x) => x.def.id === id)!;
    const d = m.def;
    this.model = m.model;
    this.el.style.setProperty('--c', `var(--${m.faction})`);
    this.el.innerHTML = `<div class="vbox"><div class="vhead"><b>${d.name}</b>` +
      `<span class="stats">${m.model}.glb · HP ${d.hp} · dmg ${d.dmg} · ${d.aps}/s · speed ${d.speed} m/s · scale ${d.scale}${d.push ? ` · push ${d.push}` : ''}</span>` +
      `<button title="Close">×</button></div><div id="stage"></div>` +
      `<div class="vctl"><span id="clips"></span><button id="play">❚❚</button>` +
      `<label>Speed <input id="spd" type="range" min="0.1" max="2" step="0.05" value="1"><span id="spdv">1.00×</span></label>` +
      `<span class="time" id="time"></span><div class="tl"><input id="scrub" type="range" min="0" max="1" step="0.001" value="0"><div class="hit" hidden></div></div></div></div>`;
    this.el.classList.add('open');
    this.el.querySelector('.vhead button')!.addEventListener('click', () => this.close());
    const stage = this.el.querySelector<HTMLElement>('#stage')!;
    stage.appendChild(this.renderer.domElement);
    this.renderer.setSize(stage.clientWidth, stage.clientHeight);
    this.cam.aspect = stage.clientWidth / stage.clientHeight;
    this.cam.updateProjectionMatrix();

    const g = await loadModel(m.model);
    const scene = makeScene();
    const grid = new THREE.GridHelper(6, 12, 0x555555, 0x333333);
    scene.add(grid);
    const obj = SkeletonUtils.clone(g.scene);
    scene.add(obj);
    this.scene = scene;
    this.mixer = new THREE.AnimationMixer(obj);
    this.clips = [...g.animations].sort((a, b) => CLIP_ORDER.indexOf(a.name) - CLIP_ORDER.indexOf(b.name));
    frame(this.cam, obj, this.controls.target);
    this.controls.update();

    this.el.querySelector('#clips')!.innerHTML = this.clips.map((c) => `<button data-clip="${c.name}">${c.name}</button>`).join(' ');
    this.el.querySelectorAll<HTMLButtonElement>('[data-clip]').forEach((b) => b.addEventListener('click', () => this.play(b.dataset.clip!)));
    this.el.querySelector('#play')!.addEventListener('click', () => this.togglePause());
    const spd = this.el.querySelector<HTMLInputElement>('#spd')!;
    spd.addEventListener('input', () => {
      this.speed = +spd.value;
      this.el.querySelector('#spdv')!.textContent = this.speed.toFixed(2) + '×';
    });
    const scrub = this.el.querySelector<HTMLInputElement>('#scrub')!;
    scrub.addEventListener('input', () => {
      if (!this.action) return;
      if (this.playing) this.togglePause();
      this.action.time = +scrub.value * this.action.getClip().duration;
      this.mixer!.update(0);
    });
    this.play('idle');
    this.clock.getDelta();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  private play(name: string) {
    const clip = this.clips.find((c) => c.name === name);
    if (!clip || !this.mixer) return;
    this.mixer.stopAllAction();
    const a = this.mixer.clipAction(clip);
    // Attack and death play once and hold the last frame, like in the game
    const once = name === 'death' || name === 'attack';
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    a.reset().play();
    this.action = a;
    this.el.querySelectorAll<HTMLButtonElement>('[data-clip]').forEach((b) => b.classList.toggle('on', b.dataset.clip === name));
    const hit = this.el.querySelector<HTMLElement>('.hit')!;
    const at = name === 'attack' ? ATTACK_HIT[`${this.model}:attack`] : undefined;
    hit.hidden = at === undefined;
    if (at !== undefined) hit.style.left = `${(at / clip.duration) * 100}%`;
    if (!this.playing) this.togglePause();
  }

  private togglePause() {
    this.playing = !this.playing;
    this.el.querySelector('#play')!.textContent = this.playing ? '❚❚' : '▶';
    if (this.playing && this.action && !this.action.isRunning()) this.action.reset().play();
  }

  private tick() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.clock.getDelta();
    if (!this.scene || !this.mixer) return;
    if (this.playing) this.mixer.update(dt * this.speed);
    this.controls.update();
    this.renderer.render(this.scene, this.cam);
    if (this.action) {
      const dur = this.action.getClip().duration;
      const t = Math.min(this.action.time, dur);
      this.el.querySelector('#time')!.textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s · frame ${Math.round(t * 24)}`;
      if (this.playing) this.el.querySelector<HTMLInputElement>('#scrub')!.value = String(t / dur);
    }
  }

  close() {
    this.el.classList.remove('open');
    cancelAnimationFrame(this.raf);
    this.scene = null;
    this.mixer = null;
    this.action = null;
  }
}

const viewer = new Viewer();
