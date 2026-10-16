// Prologue (GDD 3.1 / 11.1): the new player wakes up as an undead spirit before the Lich King,
// gets a short lore talk and the quest "put three skeletons to rest", turns it in and is offered
// a new life with one of the living races "for services to the undead".
import * as THREE from 'three';
import { assets } from './assets';
import { sfx } from './audio';
import { Character } from './character';
import { HERO, MOBS, ORBS, fmtOrb, mobImpact, type OrbKind } from './config';
import { FloatingText, Particles, Pickups } from './fx';
import type { Input } from './input';
import { STAT_ICON, art } from './art';
import type { DialogueLine, UI } from './ui';
import { Ambient } from './ambient';
import { buildRitual } from './terrain';

/** Power orbs picked up in the prologue; they carry over to the new hero. */
export type Gains = Record<OrbKind, number>;

const KEY = 'warcry-prologue';
/** Gains of a prologue that was finished but whose faction was not picked yet (reload-safe). */
export function prologueDone(): Gains | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Gains | null; } catch { return null; }
}
export function clearPrologue() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const LICH_NAME = 'Король-лич';
const LICH_FACE = 'skull';
const HERO_FACE = 'hero';
const LICH = new THREE.Vector3(0, 0, -7);
const WAKE = new THREE.Vector3(0, 0, -2.2);
const ARENA_R = 21;
const SKELETON_SPAWNS = [new THREE.Vector3(-13, 0, 6), new THREE.Vector3(12, 0, 9), new THREE.Vector3(-2, 0, 16)];
const SKEL = { hp: 60, dmg: 6, aps: 0.7, range: 1.9, speed: 2.6, aggro: 7, leash: 13, radius: 0.5 };
const GHOST = { dmg: 24, aps: 1.15, range: 2.3, arc: 140 };
const TURN_IN_DIST = 3.6;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const turn = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);

interface Skeleton {
  ch: Character;
  hp: number;
  spawn: THREE.Vector3;
  state: 'idle' | 'chase' | 'return' | 'dead';
  atkCd: number;
  impact: number;
  wander: THREE.Vector3;
  wanderT: number;
  knock: THREE.Vector3;
  deadT: number;
  el: HTMLDivElement;
  fill: HTMLDivElement;
}

type Stage = 'intro' | 'hunt' | 'return' | 'talk' | 'end';

export class Prologue {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 9 / 16, 0.3, 90);
  private hero: Character;
  private lich: Character;
  private skeletons: Skeleton[] = [];
  private obstacles: { x: number; z: number; r: number }[] = [];
  private floaters: { obj: THREE.Object3D; y: number; ph: number }[] = [];
  private fx: FloatingText;
  private particles: Particles;
  private pickups: Pickups;
  private layer = document.createElement('div');
  private hud = document.createElement('div');
  private cine = document.createElement('div');
  private mark = document.createElement('div');
  private heroBar = document.createElement('div');
  private stage: Stage = 'intro';
  private time = 0;
  private kills = 0;
  readonly gains: Gains = { power: 0, hp: 0, regen: 0, speed: 0 };
  private hp: number = HERO.hp;
  private atkCd = 0;
  private impact = -1;
  private target: Skeleton | null = null;
  private ghostT = -1; // >= 0 while the spirit is dissolved and re-forming at the Lich
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shake = 0;
  private hintT = 0;
  private sun: THREE.DirectionalLight;
  /** Soul wisps in the air (src/ambient.ts), the ritual circle's clock. */
  private ambient = new Ambient();
  private timeU = { value: 0 };
  /** Drawing-buffer height (set by main.ts: wisp sizes). */
  viewH = 1600;

  constructor(private ui: UI, private input: Input, labels: HTMLElement, private onChoose: (gains: Gains) => void) {
    // Grey, cold world of the dead (GDD 7.1: «обесцвеченная поляна»).
    const sky = new THREE.Color(0x5e58a4);
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(0x5e58a4, 0.022);
    this.scene.add(new THREE.HemisphereLight(0xe0dcff, 0x40396e, 2.3));
    this.sun = new THREE.DirectionalLight(0xe6ecff, 2.1);
    this.sun.position.set(-8, 20, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.buildArena();
    this.ambient.fixed = 'cemetery';
    this.scene.add(this.ambient.points, buildRitual(LICH.x, LICH.z, 6.5, this.timeU));

    this.lich = new Character('undead_king', 'sword_undead_king', 1.9);
    this.lich.position.copy(LICH);
    this.lich.facing = 0;
    this.scene.add(this.lich.root);
    this.obstacles.push({ x: LICH.x, z: LICH.z, r: 1.1 });
    // Cold glow of the Lich King
    const glow = new THREE.PointLight(0x7fc8ff, 6, 9, 1.6);
    glow.position.set(LICH.x, 3, LICH.z + 1.2);
    this.scene.add(glow);

    // The player: a hooded undead spirit, bright and outlined like the hero in the main game.
    this.hero = new Character('undead_assassin', 'sword_undead_king', 1);
    this.hero.setHighlight(true);
    this.hero.setTint(0xc4ecff);
    this.hero.position.copy(WAKE);
    this.hero.facing = Math.PI;
    const aura = new THREE.PointLight(0x8fe0ff, 3, 6, 1.8);
    aura.position.y = 1.6;
    this.hero.root.add(aura);
    this.scene.add(this.hero.root);

    for (const s of SKELETON_SPAWNS) this.addSkeleton(s);

    labels.appendChild(this.layer);
    this.fx = new FloatingText(this.layer, this.camera);
    this.particles = new Particles(this.scene);
    this.pickups = new Pickups(this.scene);
    this.pickups.onCollect = (k) => this.collect(k as OrbKind);
    this.mark.className = 'qmark';
    this.heroBar.className = 'herohp';
    this.heroBar.innerHTML = '<div class="fill"></div><span></span>';
    this.layer.append(this.mark, this.heroBar);

    this.hud.id = 'pro-hud';
    this.hud.innerHTML = `<div id="pro-stats"></div><div id="pro-quest"></div><div id="pro-hint"></div><div class="pro-arrow">➤</div>`;
    this.cine.id = 'cine';
    ui.app.append(this.cine, this.hud);
    this.renderStats();

    // Opening shot: high above the Lich, then the camera dollies in to the waking spirit.
    this.camPos.set(0, 22, 18);
    this.camLook.copy(LICH).setY(1);
    this.input.enabled = false;
    this.cine.classList.add('on');
    sfx.telegraph();
    setTimeout(() => this.introTalk(), 2000);
  }

  // ---------- level ----------
  private place(name: string, x: number, z: number, scale: number, rot = 0, collide = 0, tint = 0) {
    if (!assets.has(name)) return null;
    const m = assets.clone(name);
    m.scale.multiplyScalar(scale);
    m.position.set(x, 0, z);
    m.rotation.y = rot;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.receiveShadow = true;
      if (tint) {
        // Faction banners in the distance: drained of colour until a side is chosen.
        mesh.material = (mesh.material as THREE.MeshLambertMaterial).clone();
        (mesh.material as THREE.MeshLambertMaterial).color.setHex(tint);
      }
    });
    this.scene.add(m);
    if (collide > 0) this.obstacles.push({ x, z, r: collide });
    return m;
  }

  private buildArena() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x6c68a0 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
    // Painted patch over the arena: soft blotches and a worn spot around the throne, fading to the plain
    // ground colour at its edges (no hard seams).
    const SIZE = 80;
    const PX = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = PX;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#6c68a0';
    g.fillRect(0, 0, PX, PX);
    const toPx = (v: number) => ((v + SIZE / 2) / SIZE) * PX;
    const blot = (x: number, z: number, r: number, rgb: string, a: number) => {
      const gr = g.createRadialGradient(toPx(x), toPx(z), 0, toPx(x), toPx(z), (r / SIZE) * PX);
      gr.addColorStop(0, `rgba(${rgb},${a})`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, PX, PX);
    };
    const rn = (() => { let s = 11; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 70; i++) {
      const a = rn() * Math.PI * 2;
      const d = Math.sqrt(rn()) * 30;
      blot(Math.sin(a) * d, Math.cos(a) * d, 2 + rn() * 5, rn() < 0.5 ? '84,80,140' : '128,124,184', 0.25 * (1 - d / 34));
    }
    blot(LICH.x, LICH.z + 1, 9, '80,74,134', 0.85);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    patch.receiveShadow = true;
    this.scene.add(patch);

    this.place('undead_throne', LICH.x, LICH.z - 3.2, 1.1, 0, 1.8);
    this.place('undead_throne_Lv1', 0, LICH.z - 13, 0.55, 0, 4);
    this.place('undead_obelisk', -4.5, LICH.z + 1, 0.7, 0.3, 0.7);
    this.place('undead_obelisk', 4.5, LICH.z + 1, 0.7, -0.3, 0.7);
    for (const sx of [-1, 1]) {
      const st = this.place('undead_floating_stone', sx * 7.5, LICH.z - 2, 0.5, sx);
      const cf = this.place('undead_floating_coffin', sx * 9, LICH.z + 3.5, 0.42, sx * 0.6);
      for (const o of [st, cf]) if (o) this.floaters.push({ obj: o, y: o.position.y, ph: Math.random() * 6 });
    }
    // Ring of columns marks the edge of the Edge.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      const r = ARENA_R + 2.5;
      this.place(i % 2 ? 'undead_column_1' : 'undead_column_2', Math.sin(a) * r, Math.cos(a) * r, 0.5, a, 0.8);
    }
    // Graves, bones and lamps the skeletons wander among
    const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 8 + rnd() * (ARENA_R - 9);
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (Math.hypot(x - LICH.x, z - LICH.z) < 9 || SKELETON_SPAWNS.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) continue;
      const kind = ['undead_tomb_stone_1', 'undead_tomb_stone_2', 'undead_tomb_stone_3', 'undead_tomb_stone_4', 'undead_tomb_stone_5'][i % 5];
      this.place(kind, x, z, 0.7, rnd() * 0.6 - 0.3 + (z < 0 ? 0 : Math.PI), 0.5);
    }
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 5 + rnd() * (ARENA_R - 4);
      this.place(['undead_ground_bone_1', 'undead_ground_bone_2', 'undead_ground_bone_3'][i % 3], Math.sin(a) * r, Math.cos(a) * r, 0.8, rnd() * 6);
    }
    this.place('undead_big_bone', -15, -8, 0.6, 0.8, 1);
    this.place('undead_bones_remains', 14, -4, 0.7, 2.2);
    this.place('undead_ruins_01', -17, 12, 0.4, 0.6, 2.2);
    this.place('undead_ruins_02', 17, 15, 0.4, -0.8, 2.2);
    for (const [x, z] of [[-6, 3], [6, 3], [-9, 12], [9, 13]]) this.place('undead_lamp_post', x, z, 0.6, 0, 0.3);
    // GDD 7.1: the banners of both factions are visible in the distance — a teaser of the choice.
    this.place('banner', -16, -15, 0.5, 0.5, 0.5, 0x9a98ac);
    this.place('orc_banner', 16, -15, 0.5, -0.5, 0.5, 0x9a98ac);
  }

  private addSkeleton(at: THREE.Vector3) {
    const [model, weapon] = MOBS.skeleton_warrior.model.human;
    const ch = new Character(model, weapon, 1.05);
    ch.position.copy(at);
    ch.facing = Math.random() * Math.PI * 2;
    this.scene.add(ch.root);
    const el = document.createElement('div');
    el.className = 'mobui';
    el.innerHTML = '<div class="mobhp"><div></div></div>';
    this.layer.appendChild(el);
    this.skeletons.push({
      ch, hp: SKEL.hp, spawn: at.clone(), state: 'idle', atkCd: 0.6, impact: -1, wander: at.clone(),
      wanderT: Math.random() * 2, knock: new THREE.Vector3(), deadT: 0, el, fill: el.querySelector('.mobhp > div')!,
    });
  }

  // ---------- story beats ----------
  private introTalk() {
    const lines: DialogueLine[] = [
      { who: LICH_NAME, portrait: LICH_FACE, text: 'Очнись, мертвец. Ты на Грани — там, где кончается мир живых и начинается моё царство.' },
      {
        who: LICH_NAME, portrait: LICH_FACE, text: 'Ты пал в войне людей и орков. Теперь ты принадлежишь мне.',
        choices: [
          {
            text: 'Где я? Что это за место?',
            then: [{ who: LICH_NAME, portrait: LICH_FACE, text: 'Грань. Сюда приходят все павшие. Живые веками режут друг друга, и с каждой битвой мёртвых здесь становится больше.' }],
          },
          { text: 'Чего ты хочешь от меня?' },
        ],
      },
      { who: LICH_NAME, portrait: LICH_FACE, text: 'Не все души находят покой. Скелеты бродят по Грани, гремят костями и не помнят даже своих имён.' },
      { who: LICH_NAME, portrait: LICH_FACE, text: 'Упокой троих. Разбей их кости, и души уйдут. Сделай это, и я тебя вознагражу.' },
      { who: 'Ты', portrait: HERO_FACE, text: 'Будет сделано, повелитель.' },
    ];
    this.ui.dialogue(lines, () => this.startHunt());
  }

  private startHunt() {
    this.stage = 'hunt';
    this.cine.classList.remove('on');
    this.input.enabled = true;
    this.input.reset();
    sfx.levelUp();
    document.getElementById('pro-stats')!.classList.add('show');
    this.renderQuest();
    this.hint('Тяни палец по экрану (или WASD), чтобы идти', 4000);
    setTimeout(() => this.stage === 'hunt' && this.kills === 0 && this.hint('Подойди к скелету — ты атакуешь сам', 4000), 4500);
  }

  private questDone() {
    this.stage = 'return';
    sfx.barrier();
    this.renderQuest();
    this.hint('Души упокоены. Вернись к Королю-личу', 3500);
  }

  private turnInTalk() {
    this.stage = 'talk';
    this.input.enabled = false;
    this.input.reset();
    this.cine.classList.add('on');
    this.mark.classList.remove('show');
    try { localStorage.setItem(KEY, JSON.stringify(this.gains)); } catch { /* private mode */ }
    const lines: DialogueLine[] = [
      { who: LICH_NAME, portrait: LICH_FACE, text: 'Я слышал, как они уходят. Три души обрели покой, и это сделал ты.' },
      { who: LICH_NAME, portrait: LICH_FACE, text: 'За заслуги перед нежитью я дам тебе то, чего не получал никто из мёртвых: вторую жизнь.' },
      {
        who: LICH_NAME, portrait: LICH_FACE, text: 'Но мир живых расколот. Люди и орки зовут тебя к себе. Выбирай, под чьим знаменем вернёшься.',
        choices: [
          {
            text: 'Почему ты отпускаешь меня?',
            then: [
              { who: LICH_NAME, portrait: LICH_FACE, text: 'Живой слуга полезнее мёртвого. Однажды я позову тебя, и ты вспомнишь, кто дал тебе жизнь.' },
              { who: LICH_NAME, portrait: LICH_FACE, text: 'А теперь выбирай.' },
            ],
          },
          { text: 'Я готов выбрать.' },
        ],
      },
    ];
    this.ui.dialogue(lines, () => this.finish());
  }

  private finish() {
    this.stage = 'end';
    sfx.levelUp();
    this.onChoose({ ...this.gains });
  }

  dispose() {
    this.layer.remove();
    this.hud.remove();
    this.cine.remove();
    this.input.enabled = true;
  }

  // ---------- HUD ----------
  private hint(text: string, ms: number) {
    const el = document.getElementById('pro-hint');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.hintT);
    this.hintT = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  private renderQuest() {
    const el = document.getElementById('pro-quest')!;
    el.classList.add('show');
    el.classList.toggle('done', this.stage === 'return');
    el.innerHTML = this.stage === 'return'
      ? '<small>Упокоить кости</small>Вернись к <b>Личу</b>'
      : `<small>Упокоить кости</small>Скелеты: <b>${this.kills} / ${SKELETON_SPAWNS.length}</b>`;
  }

  private stat(k: OrbKind) {
    const base = { power: HERO.power, hp: HERO.hp, regen: HERO.regen, speed: HERO.speed }[k];
    return base + this.gains[k] * ORBS[k].value;
  }
  private get maxHp() { return this.stat('hp'); }
  private get power() { return this.stat('power'); }

  private renderStats(pop?: OrbKind) {
    // Same look as the main HUD stats (#stats): coloured icon + number.
    const fmt = (k: OrbKind) => {
      const v = this.stat(k);
      return String(Math.round(v));
    };
    const el = document.getElementById('pro-stats')!;
    el.innerHTML = (['power', 'hp', 'regen', 'speed'] as OrbKind[])
      .map((k) => `<div class="st" data-k="${k}">${art(STAT_ICON[k], 38)}<span>${fmt(k)}</span></div>`)
      .join('');
    if (pop) {
      const d = el.querySelector<HTMLElement>(`[data-k="${pop}"]`)!;
      d.classList.add('pop');
      setTimeout(() => d.classList.remove('pop'), 150);
    }
  }

  private collect(k: OrbKind) {
    this.gains[k]++;
    if (k === 'hp') this.hp = Math.min(this.maxHp, this.hp + ORBS.hp.value);
    sfx.orb();
    this.fx.spawn(v1.copy(this.hero.position).setY(2.1), `${fmtOrb(k)} ${ORBS[k].label}`, 'orb', 0.7, { color: ORBS[k].css });
    this.renderStats(k);
  }

  // ---------- loop ----------
  update(dt: number) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.updateHero(dt);
    this.updateSkeletons(dt);
    this.lich.facing = turn(this.lich.facing, Math.atan2(this.hero.position.x - LICH.x, this.hero.position.z - LICH.z), dt * 2);
    this.lich.update(dt, false);
    for (const f of this.floaters) f.obj.position.y = f.y + 0.6 + Math.sin(this.time * 1.2 + f.ph) * 0.35;
    this.particles.update(dt);
    this.pickups.update(dt, this.hero.position);
    this.timeU.value = this.time;
    this.ambient.update(this.time, this.hero.position, this.viewH);
    if (this.stage === 'return' && this.ghostT < 0 && this.hero.position.distanceTo(LICH) < TURN_IN_DIST) this.turnInTalk();
    this.updateCamera(dt);
    this.updateLabels(dt);
  }

  private updateCamera(dt: number) {
    const h = this.hero.position;
    const talking = this.stage === 'intro' || this.stage === 'talk';
    // Dialogue framing: from the side, the Lich towering over the spirit.
    if (talking) {
      v2.set((h.x + LICH.x) / 2, 1.7, (h.z + LICH.z) / 2);
      v1.set(v2.x + 5, 5.2, v2.z + 10.5);
    } else {
      v1.set(h.x, 15, h.z + 10);
      v2.set(h.x, 0.6, h.z - 1);
    }
    const k = 1 - Math.exp(-dt * (talking ? 1.8 : 7));
    this.camPos.lerp(v1, k);
    this.camLook.lerp(v2, k);
    const sh = this.shake;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * sh, this.camPos.y, this.camPos.z + (Math.random() - 0.5) * sh);
    this.camera.lookAt(this.camLook);
    this.sun.target.position.set(h.x, 0, h.z - 3);
    this.sun.position.set(h.x - 8, 20, h.z + 10);
  }

  private updateHero(dt: number) {
    const ch = this.hero;
    const p = ch.position;
    if (this.ghostT >= 0) {
      // The spirit cannot die (GDD 10.7): it scatters and re-forms at the Lich King.
      this.ghostT += dt;
      ch.update(dt, false);
      if (this.ghostT > 1.4) {
        this.ghostT = -1;
        p.copy(WAKE);
        this.hp = this.maxHp;
        ch.revive();
        ch.root.visible = true;
        this.particles.burst(v1.copy(p).setY(1), 0x9fe8ff, 18, 0.12, 4, 0.9);
        this.hint('Мёртвого не убить: ты снова у Короля-лича', 3000);
      }
      return;
    }
    const [ix, iy] = this.input.vector;
    const moving = Math.hypot(ix, iy) > 0.05;
    const speed = this.stat('speed') / HERO.speedPerMs;
    if (moving) {
      p.x += ix * speed * dt;
      p.z += iy * speed * dt;
      ch.walkRate = Math.min(2.4, (speed * Math.hypot(ix, iy)) / 2.1);
    }
    this.collide(p, HERO.radius);

    // auto-attack: keep the current target while it lives and stays near (GDD 6.2)
    const reach = GHOST.range + HERO.acquireExtra;
    if (this.target && (this.target.state === 'dead' || this.target.ch.position.distanceTo(p) > reach + 1.5)) this.target = null;
    if (!this.target) {
      let bd = Infinity;
      for (const s of this.skeletons) {
        if (s.state === 'dead') continue;
        const d = s.ch.position.distanceTo(p) - SKEL.radius;
        if (d < reach && d < bd) { bd = d; this.target = s; }
      }
    }
    let want = ch.facing;
    if (this.target) want = Math.atan2(this.target.ch.position.x - p.x, this.target.ch.position.z - p.z);
    else if (moving) want = Math.atan2(ix, iy);
    ch.facing = turn(ch.facing, want, dt * 16);
    this.atkCd -= dt;
    const period = 1 / GHOST.aps;
    if (this.target && this.atkCd <= 0) {
      const impactAt = Math.min(0.42, period * 0.4);
      ch.attack('SwordAttack', period, impactAt);
      this.impact = impactAt;
      this.atkCd = period;
    }
    if (this.impact >= 0) {
      this.impact -= dt;
      if (this.impact < 0) this.strike();
    }
    const rate = this.stat('regen'); // HP per second
    this.hp = Math.min(this.maxHp, this.hp + rate * dt);
    ch.update(dt, moving);
  }

  private strike() {
    sfx.swing();
    const p = this.hero.position;
    for (const s of this.skeletons) {
      if (s.state === 'dead') continue;
      const dx = s.ch.position.x - p.x;
      const dz = s.ch.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d - SKEL.radius > GHOST.range + 0.35) continue;
      const a = Math.atan2(Math.sin(Math.atan2(dx, dz) - this.hero.facing), Math.cos(Math.atan2(dx, dz) - this.hero.facing));
      if (d > 0.6 && Math.abs(a) > THREE.MathUtils.degToRad(GHOST.arc / 2) + Math.atan2(SKEL.radius, d)) continue;
      const dmg = Math.round((GHOST.dmg + this.power) * (0.9 + Math.random() * 0.2));
      s.hp -= dmg;
      s.ch.hit();
      if (s.state !== 'return') s.state = 'chase';
      s.knock.set(dx, 0, dz).normalize().multiplyScalar(3.5);
      this.fx.spawn(v1.copy(s.ch.position).setY(2), String(dmg), 'dmg');
      sfx.hit();
      this.particles.burst(v2.copy(s.ch.position).setY(1.1), 0xd8d4c8, 4, 0.08, 4, 0.45);
      if (s.hp <= 0) this.killSkeleton(s);
    }
  }

  private killSkeleton(s: Skeleton) {
    s.state = 'dead';
    s.hp = 0;
    s.deadT = 0;
    s.ch.die();
    s.el.classList.remove('show');
    if (this.target === s) this.target = null;
    const at = s.ch.position;
    for (const [k, n] of Object.entries(MOBS.skeleton_warrior.reward) as [OrbKind, number][]) for (let i = 0; i < n; i++) this.pickups.spawn(at, k);
    // The freed soul rises
    this.particles.burst(v1.copy(at).setY(1.2), 0x9fe8ff, 16, 0.1, 5, 1.2);
    this.fx.spawn(v1.copy(at).setY(2.6), 'Душа упокоена', 'soul', 1.6);
    this.shake = 0.2;
    if (this.stage !== 'hunt') return;
    this.kills++;
    this.renderQuest();
    if (this.kills >= SKELETON_SPAWNS.length) setTimeout(() => this.questDone(), 900);
  }

  private hurtHero(dmg: number) {
    if (this.ghostT >= 0 || this.stage !== 'hunt' && this.stage !== 'return') return;
    dmg = Math.max(1, Math.round(dmg * (0.9 + Math.random() * 0.2)));
    this.hp -= dmg;
    this.hero.hit();
    sfx.hurt();
    this.ui.hurtFlash();
    this.fx.spawn(v1.copy(this.hero.position).setY(2), `-${dmg}`, 'hurt', 0.7);
    if (this.hp > 0) return;
    this.hp = 0;
    this.ghostT = 0;
    this.target = null;
    this.hero.root.visible = false;
    this.particles.burst(v1.copy(this.hero.position).setY(1), 0x9fe8ff, 22, 0.12, 6, 1);
    sfx.die();
    for (const s of this.skeletons) if (s.state === 'chase') s.state = 'return';
  }

  private updateSkeletons(dt: number) {
    const hp = this.hero.position;
    const hunting = (this.stage === 'hunt' || this.stage === 'return') && this.ghostT < 0;
    for (const s of this.skeletons) {
      const pos = s.ch.position;
      if (s.state === 'dead') {
        s.deadT += dt;
        s.ch.update(dt, false, s.deadT < 3);
        if (s.deadT > 2.2) pos.y = -(s.deadT - 2.2) * 0.8;
        if (s.deadT > 4) s.ch.root.visible = false;
        continue;
      }
      let moving = false;
      const dHero = pos.distanceTo(hp);
      if (s.state === 'idle') {
        if (hunting && dHero < SKEL.aggro) s.state = 'chase';
        else {
          s.wanderT -= dt;
          if (s.wanderT <= 0) {
            s.wanderT = 2 + Math.random() * 3;
            s.wander.set(s.spawn.x + (Math.random() - 0.5) * 6, 0, s.spawn.z + (Math.random() - 0.5) * 6);
          }
          if (s.wander.distanceTo(pos) > 0.4) moving = this.stepTo(s, s.wander, SKEL.speed * 0.35, dt);
        }
      } else if (s.state === 'chase') {
        if (!hunting || pos.distanceTo(s.spawn) > SKEL.leash) s.state = 'return';
        else {
          const reach = SKEL.range + HERO.radius;
          if (dHero > reach * 0.85) moving = this.stepTo(s, hp, SKEL.speed, dt);
          s.ch.facing = turn(s.ch.facing, Math.atan2(hp.x - pos.x, hp.z - pos.z), dt * 8);
          s.atkCd -= dt;
          if (dHero < reach && s.atkCd <= 0 && s.impact < 0) {
            const period = 1 / SKEL.aps;
            const impactAt = mobImpact(s.ch.hitTime('SwordAttack'), period);
            s.ch.attack('SwordAttack', period, impactAt);
            s.impact = impactAt;
            s.atkCd = period;
          }
        }
      } else {
        moving = this.stepTo(s, s.spawn, SKEL.speed * 1.4, dt);
        s.hp = Math.min(SKEL.hp, s.hp + SKEL.hp * dt * 0.5);
        if (pos.distanceTo(s.spawn) < 0.6) { s.state = 'idle'; s.hp = SKEL.hp; }
      }
      if (s.impact >= 0) {
        s.impact -= dt;
        if (s.impact < 0 && pos.distanceTo(hp) < SKEL.range + HERO.radius + 0.5) this.hurtHero(SKEL.dmg);
      }
      if (s.knock.lengthSq() > 0.001) {
        pos.addScaledVector(s.knock, dt);
        s.knock.multiplyScalar(Math.max(0, 1 - dt * 9));
      }
      // soft push between hero and skeleton
      const dx = hp.x - pos.x;
      const dz = hp.z - pos.z;
      const rr = SKEL.radius + HERO.radius;
      const d2 = dx * dx + dz * dz;
      if (this.ghostT < 0 && d2 < rr * rr && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        hp.x += (dx / d) * (rr - d) * 0.5;
        hp.z += (dz / d) * (rr - d) * 0.5;
      }
      this.collide(pos, SKEL.radius);
      s.ch.update(dt, moving);
    }
  }

  private stepTo(s: Skeleton, to: THREE.Vector3, speed: number, dt: number) {
    v1.set(to.x - s.ch.position.x, 0, to.z - s.ch.position.z);
    const d = v1.length();
    if (d < 0.05) return false;
    v1.multiplyScalar(Math.min(d, speed * dt) / d);
    s.ch.position.add(v1);
    s.ch.facing = turn(s.ch.facing, Math.atan2(v1.x, v1.z), dt * 8);
    s.ch.walkRate = speed / 2.1;
    return true;
  }

  private collide(p: THREE.Vector3, r: number) {
    for (const o of this.obstacles) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const rr = o.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = o.x + (dx / d) * rr;
        p.z = o.z + (dz / d) * rr;
      }
    }
    const d = Math.hypot(p.x, p.z);
    if (d > ARENA_R) { p.x *= ARENA_R / d; p.z *= ARENA_R / d; }
  }

  private updateLabels(dt: number) {
    const w = this.ui.app.clientWidth;
    const h = this.ui.app.clientHeight;
    const screen = (v: THREE.Vector3) => `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    this.fx.update(dt, w, h);
    const fighting = this.stage === 'hunt' || this.stage === 'return';
    // HP over the spirit
    const showBar = fighting && this.ghostT < 0;
    this.heroBar.style.display = showBar ? '' : 'none';
    if (showBar) {
      v1.copy(this.hero.position).setY(2.3).project(this.camera);
      this.heroBar.style.transform = `${screen(v1)} translate(-50%, -100%)`;
      (this.heroBar.firstChild as HTMLElement).style.width = `${(this.hp / this.maxHp) * 100}%`;
      (this.heroBar.lastChild as HTMLElement).textContent = String(Math.ceil(this.hp));
      this.heroBar.classList.toggle('low', this.hp < this.maxHp * 0.3);
    }
    for (const s of this.skeletons) {
      const show = fighting && s.state !== 'dead' && s.ch.position.distanceTo(this.hero.position) < 16;
      s.el.classList.toggle('show', show);
      if (!show) continue;
      v1.copy(s.ch.position).setY(2.3).project(this.camera);
      s.el.style.transform = `${screen(v1)} translate(-50%, -100%)`;
      s.el.classList.toggle('hurt', s.hp < SKEL.hp);
      s.fill.style.width = `${(s.hp / SKEL.hp) * 100}%`;
    }
    // "?" over the Lich once the quest can be turned in (GDD 4.1)
    const showMark = this.stage === 'return';
    this.mark.classList.toggle('show', showMark);
    if (showMark) {
      this.mark.textContent = '?';
      v1.copy(LICH).setY(4.6 + Math.sin(this.time * 4) * 0.12).project(this.camera);
      this.mark.style.transform = `${screen(v1)} translate(-50%, -100%)`;
    }
    // Arrow at the screen edge toward the current goal
    const arrow = this.hud.querySelector<HTMLElement>('.pro-arrow')!;
    let goal: THREE.Vector3 | null = null;
    if (this.stage === 'return') goal = LICH;
    else if (this.stage === 'hunt') {
      let bd = Infinity;
      for (const s of this.skeletons) {
        const d = s.state === 'dead' ? Infinity : s.ch.position.distanceTo(this.hero.position);
        if (d < bd) { bd = d; goal = s.ch.position; }
      }
    }
    if (!goal) { arrow.style.display = 'none'; return; }
    v1.copy(goal).setY(1).project(this.camera);
    if (Math.abs(v1.x) < 0.9 && Math.abs(v1.y) < 0.9 && v1.z < 1) { arrow.style.display = 'none'; return; }
    let x = v1.x;
    let y = v1.y;
    if (v1.z > 1) { x = -x; y = -y; }
    const m = Math.max(Math.abs(x) / 0.85, Math.abs(y) / 0.8);
    x /= m;
    y /= m;
    arrow.style.display = 'block';
    const p = this.ui.toHud((x * 0.5 + 0.5) * w, (-y * 0.5 + 0.5) * h); // #pro-hud is the scaled HUD rectangle
    arrow.style.transform = `translate(${p.x - 13}px, ${p.y - 13}px) rotate(${Math.atan2(-y, x)}rad)`;
  }
}
