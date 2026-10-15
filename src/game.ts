import * as THREE from 'three';
import { Character } from './character';
import { Trail } from './swing';
import { Creature } from './creature';
import { StaticBody } from './staticbody';
import {
  COMBOS, FACTIONS, GACHA, ZONE_TIER, HERO, HIT_FREEZE, KILL_FX, LEASH, MOB_REGEN_DELAY, MOBS, ORBS, depthMul, mobImpact, RARITY, RESIST_MULT, WEAPONS,
  mobRank, type DamageType, type ResistTier, type MobDef, type OrbKind, type StatId, type ZoneDef, isPctStat,
} from './config';
import { FloatingText, Particles, Pickups, Shockwaves, Telegraphs, type PickupKind } from './fx';
import {
  ARMOR, BAG_SIZE, armorTrim, copyGain, dropIconId, dropItem, itemModel, itemName, sameItem, weaponDamage,
  type ArmorSlot, type Item, type VisualPart,
} from './items';
import { Input } from './input';
import { sfx } from './audio';
import { writeSave, type SaveData } from './save';
import { CLASSES, CLASS_IDS, SWITCH_COOLDOWN, kitOf, classSlot, type HeroClass } from './party';
import { GATE, SPAWN, inCamp, pathAt, progressAt } from './island';
import { BREAKABLES, World, makeBreakable, type BreakableDef, type SpawnPoint } from './world';
import { UI, type MapMark } from './ui';
import { fmtK, lootHtml, resistIcons } from './icons';
import { heroDeaths, logFight, logSnap } from './balancelog';
import { addPct, addStat, armorMul, critAvg, critChance, critMul, dodgeChance, gearOf, guardMul, heroDps, heroStats } from './balance';

/** Debris colour of hits and kills: bone dust for skeletons and spirits, blood for the rest. */
const bloodColor = (m: Mob) => m.def.id.startsWith('skel') || m.def.id === 'ghost' || m.def.id === 'death' ? 0xd8d4c8 : 0xc0392b;
/** White-yellow sparks of a non-lethal hit (blood is for the kill). */
const HIT_SPARK = 0xfff3a8;

/** Running counters of one fight with a mob (balance log). */
interface FightStat { t0: number; dealt: number; taken: number; hits: number; combos: number; slams: number; slamHits: number; hpStart: number }

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
/** Slack over the weapon's range for a hit to land (unit edge to hero centre); targeting and swings use the same. */
const STRIKE_PAD = 0.35;

/** Respawn timer text: 45s, 4m05s, or 11h45m from an hour up (no seconds). */
function fmtRespawn(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  const p2 = (n: number) => String(n).padStart(2, '0');
  const u = (n: number | string, unit: string) => `${n}<small>${unit}</small>`; // smaller unit letters keep it inside the ring
  return s >= 3600 ? u(Math.floor(s / 3600), 'ч') + u(p2(Math.floor(s / 60) % 60), 'м')
    : s >= 60 ? u(Math.floor(s / 60), 'м') + u(p2(s % 60), 'с') : u(s, 'с');
}

/** Respawn loader at a spawn point: progress ring, timer and one bar per spawner charge. */
function respawnLoader(layer: HTMLElement, cls: string) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = '<div class="ring"></div><span></span><div class="charges"></div>';
  layer.appendChild(el);
  return el;
}

/** Charge bars (green = used in the current cycle, dark = still available). */
function setChargeBars(el: HTMLElement, used: number, total: number) {
  const key = `${used}/${total}`;
  const bars = el.lastChild as HTMLElement;
  if (bars.dataset.k === key) return;
  bars.dataset.k = key;
  bars.innerHTML = total > 1 ? Array.from({ length: total }, (_, i) => `<i${i < used ? ' class="used"' : ''}></i>`).join('') : '';
}

/**
 * Anything that stands at a spawn point and can be destroyed: a mob or a breakable prop. Both are one type and live
 * in one list (Game.units): targeting, hits, death rewards, spawner charges, respawn, the HP bar, the respawn loader
 * and the minimap treat them alike; only the body (animated character / static model) differs.
 */
abstract class Unit {
  abstract readonly kind: 'mob' | 'prop';
  hp = 0;
  maxHp = 0;
  respawnAt = 0;
  respawnTotal = 0;
  /** The fixed spawner (config SPAWNERS / PROP_SPAWNERS); null for bosses and mobs risen from graves. */
  spawner: SpawnPoint | null = null;
  /** Charges of the spawner used in the current cycle. */
  chargesUsed = 0;
  /** Dropped on death. */
  reward: Partial<Record<OrbKind, number>> = {};
  /** Above the unit: reward chips, weakness/resistance icons, HP bar. */
  uiEl: HTMLDivElement;
  hpFill: HTMLDivElement;
  /** HP number on the bar (mobs; props have none). */
  hpText: HTMLSpanElement | null;
  /** Shown at the spawn point while the unit is dead. */
  respawnEl: HTMLDivElement;
  private lastSec = -1;
  constructor(public spawn: THREE.Vector3, layer: HTMLElement, uiCls: string, uiHtml: string, loaderCls: string) {
    this.uiEl = document.createElement('div');
    this.uiEl.className = uiCls;
    this.uiEl.innerHTML = uiHtml;
    this.hpFill = this.uiEl.querySelector('.mobhp > div')!;
    this.hpText = this.uiEl.querySelector('.mobhp span');
    layer.appendChild(this.uiEl);
    this.respawnEl = respawnLoader(layer, loaderCls);
  }
  abstract get alive(): boolean;
  abstract get pos(): THREE.Vector3;
  abstract readonly radius: number;
  abstract get visible(): boolean;
  /** Special units get their own map mark instead of a red dot (see Game.mapMarks). */
  get mark(): 'boss' | 'mini' | 'elite' | null { return null; }
  /** Can be targeted and hit right now. */
  get hittable() { return this.alive; }
  /** HP bar: height above the ground and how near the hero must be to see it. */
  abstract get barY(): number;
  abstract get barRange(): number;
  /** Never fights back (props, static units): the hero turns to it only when no enemy is in reach. */
  get passive() { return true; }
  /** The respawn loader may show (a mob's corpse has to sink first). */
  get loaderReady() { return true; }
  /** Back at the spawn point, full HP. */
  abstract respawn(): void;
  /** Dead and hidden at once (a cooldown restored from the save). */
  abstract vanish(): void;
  setRespawnText(sec: number) {
    const s = Math.max(0, Math.ceil(sec));
    if (s === this.lastSec) return;
    this.lastSec = s;
    (this.respawnEl.children[1] as HTMLElement).innerHTML = fmtRespawn(s);
  }
}

class Mob extends Unit {
  readonly kind = 'mob';
  ch: Character | Creature | StaticBody;
  state: 'idle' | 'chase' | 'return' | 'dead' = 'idle';
  atkCd = 0;
  impact = -1;
  stun = 0;
  deadT = 0;
  wanderT = Math.random() * 3;
  wander = new THREE.Vector3();
  knock = new THREE.Vector3();
  /** The death clip is still playing (the corpse sinks once it is over). */
  dying = false;
  loot: Item[] = [];
  /** deadT when the death clip ended; the corpse sinks after that. */
  paidAt = 0;
  radius: number;
  /** Spawned by a prop (grave): no respawn, removed after death. */
  temp = false;
  removed = false;
  /** Seconds left of the "crawling out of the ground" intro; untargetable meanwhile. */
  rise = 0;
  // boss
  special = 4;
  /** Game time of the last hit taken (regen waits MOB_REGEN_DELAY after it). */
  hurtAt = -99;
  fight: FightStat | null = null;
  casting = 0;
  phase2 = false;
  /** Boss: reinforcement waves already called, and which step of its attack cycle comes next. */
  adds = 0;
  cycle = 0;
  /** Reinforcement of this boss: removed when the fight resets, pays no gacha pull. */
  owner: Mob | null = null;
  awake = true;
  /** Depth-scaled stats (DEPTH in config): use these instead of def.dmg / def.reward. */
  dmg: number;
  constructor(public def: MobDef, spawn: THREE.Vector3, faction: 'human' | 'orc', layer: HTMLElement,
    mul = { hp: 1, dmg: 1, reward: 1, scale: 1 }) {
    // Bosses, micro-bosses and elites get a bigger HP bar with their name: a boss's is coloured by difficulty,
    // a micro-boss's is orange, an elite's has its drop's quality colour. Over the bar: the loot (lootHtml);
    // right of it: weaknesses and resistances.
    const reward: Partial<Record<OrbKind, number>> = {};
    for (const [k, n] of Object.entries(def.reward) as [OrbKind, number][]) reward[k] = Math.round(n * mul.reward);
    const named = !!(def.boss || def.rank);
    const title = def.boss ? `<div class="bname">${def.boss.titles[faction]}</div>`
      : def.rank === 'mini' ? `<div class="bname" style="color:${MARK_COLOR.mini}">${def.name}</div>`
      : def.drop ? `<div class="bname" style="color:${RARITY[def.drop.rarity].color}">${def.name}</div>`
      : '';
    // an item drop shows only the item; a micro-boss its permanent bonus (+500 HP) instead of its orbs
    const item = def.drop ? { icon: dropIconId(def.drop), color: RARITY[def.drop.rarity].color } : null;
    const loot = def.bonus ? lootHtml(def.bonus, null, true) : lootHtml(reward, item);
    super(spawn, layer, named ? 'mobui boss' : 'mobui', title + unitBar(loot, resistIcons(def, named ? 27 : 24)),
      'respawn' + (named ? ' boss' : ''));
    this.reward = reward;
    const [model, weapon] = def.model[faction];
    const scale = def.scale * mul.scale;
    this.ch = def.static ? new StaticBody(model, scale)
      : def.creature ? new Creature(model, scale) : new Character(model, weapon, scale, def.skin);
    this.dmg = def.dmg * mul.dmg;
    this.ch.position.copy(spawn);
    this.ch.facing = Math.random() * Math.PI * 2;
    this.maxHp = this.hp = Math.round(def.hp * mul.hp);
    this.radius = def.static ? 0.8 : (def.creature ? 0.7 : 0.45) * scale;
    this.wander.copy(spawn);
  }
  /** Stands on its spawn point: no AI, no knockback (MobDef.static). */
  get passive() { return !!this.def.static; }
  get alive() { return this.state !== 'dead'; }
  get pos() { return this.ch.position; }
  get visible() { return this.ch.root.visible; }
  get boss() { return !!this.def.boss; }
  get mark() { return this.def.boss ? 'boss' as const : this.def.rank ?? null; }
  get hittable() { return this.alive && this.awake && this.rise <= 0; }
  get barY() { return (this.ch instanceof StaticBody ? this.ch.height + 0.3 : 2.15 * this.def.scale) * this.ch.root.scale.x; }
  get barRange() { return this.def.boss || this.def.rank ? 24 : 16; }
  get loaderReady() { return !this.temp && ((!this.dying && this.deadT - this.paidAt > 2.2) || this.boss); }
  respawn() {
    this.fight = null;
    this.dying = false;
    this.loot = [];
    this.knock.set(0, 0, 0);
    this.state = 'idle';
    this.hp = this.maxHp;
    this.phase2 = false;
    this.adds = 0;
    this.cycle = 0;
    this.special = 4;
    this.casting = 0;
    this.impact = -1;
    this.pos.copy(this.spawn);
    this.ch.revive();
    this.ch.root.visible = true;
  }
  vanish() {
    this.state = 'dead';
    this.ch.root.visible = false;
    this.deadT = 99;
    this.dying = false;
  }
}

class Prop extends Unit {
  readonly kind = 'prop';
  obj: THREE.Object3D;
  broken = false;
  shake = 0;
  def: BreakableDef;
  mats: THREE.MeshLambertMaterial[] = [];
  flash = 0;
  /** Turret: seconds until the next shot. */
  shootCd = 1.5;
  constructor(spot: SpawnPoint, layer: HTMLElement) {
    const def = BREAKABLES[spot.kind];
    super(new THREE.Vector3(spot.x, 0, spot.z), layer, 'mobui prop', unitBar(lootHtml(def.reward), resistIcons(def, 24)), 'respawn prop');
    this.def = def;
    this.reward = def.reward;
    this.obj = makeBreakable(spot.kind);
    this.obj.position.set(spot.x, 0, spot.z);
    this.obj.rotation.y = spot.rot;
    this.maxHp = this.hp = def.hits;
    this.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m && (m as THREE.MeshLambertMaterial).isMeshLambertMaterial && !this.mats.includes(m)) this.mats.push(m);
    });
  }
  get alive() { return !this.broken; }
  get pos() { return this.obj.position; }
  get radius() { return this.def.r; }
  get visible() { return this.obj.visible; }
  get barY() { return 1.25 * this.def.scale + 0.3; }
  get barRange() { return 9; }
  respawn() {
    this.broken = false;
    this.hp = this.maxHp;
    this.shootCd = 1.5;
    this.obj.visible = true;
  }
  vanish() {
    this.broken = true;
    this.obj.visible = false;
  }
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  world: World;
  hero: Character;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private env = { sky: new THREE.Color(), fog: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), density: 0.015 };
  /** Every mob and breakable prop (one type); `mobs` / `props` are views of it by kind. */
  private units: Unit[] = [];
  private mobs: Mob[] = [];
  private props: Prop[] = [];
  private fx: FloatingText;
  private particles: Particles;
  private telegraphs: Telegraphs;
  private pickups: Pickups;
  private waves: Shockwaves;
  /** Attack state per hand (save.weapons[0] right, [1] left). */
  private hands: [Hand, Hand] = [newHand(0), newHand(1)];
  private comboShown = -1;
  private trails: [Trail, Trail] = [new Trail(), new Trail()];
  /** Hit-stop / slow motion: game time runs at `slowK` for `slowT` more real seconds. */
  private slowT = 0;
  private slowK = 1;
  /** Camera push-in 0..1 (assassin strike), eases back by itself. */
  private zoom = 0;
  /** Shove from mob hits (MobDef.push), decays like mob knockback. */
  private heroKnock = new THREE.Vector3();
  newItems = 0;
  onOpenCharacter: () => void = () => {};
  onOpenBag: () => void = () => {};
  onOpenMap: () => void = () => {};
  onOpenGacha: () => void = () => {};
  /** After the party member on the field changes (src/party.ts): the classes hook in here later. */
  onClassChange: (c: HeroClass) => void = () => {};
  /** Game time of the last class switch (SWITCH_COOLDOWN). */
  private classT = -Infinity;
  private time = 0;
  private hp: number;
  private target: Unit | null = null;
  private dead = false;
  private deadT = 0;
  private zone: ZoneDef | null = null;
  private shake = 0;
  private camPos = new THREE.Vector3();
  private saveT = 0;
  private hudT = 0;
  paused = false;
  /** A full-screen window covers the world: main.ts skips rendering it. */
  offscreen = false;
  private moveDir = new THREE.Vector3();
  /** Player HP floating above the hero's head. */
  private heroBar!: { el: HTMLDivElement; fill: HTMLDivElement; text: HTMLSpanElement };

  private labels: HTMLElement;

  constructor(public save: SaveData, private input: Input, public ui: UI, labels: HTMLElement) {
    this.labels = labels;
    const f = FACTIONS[save.faction];
    this.camera = new THREE.PerspectiveCamera(54, 9 / 16, 0.5, 90);
    this.scene.fog = new THREE.FogExp2(0xbfe0f5, 0.015);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 2.0);
    this.sun = new THREE.DirectionalLight(0xfff2d0, 2.6);
    this.sun.position.set(-6, 12, 5);
    // Real-time shadows in a box that follows the camera.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 32; sc.bottom = -26; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.world = new World(save.faction);
    this.scene.add(this.world.group);
    for (const id of save.gates ?? []) this.world.openGate(id, true);
    if (save.gatesOpen) this.world.openAllGates(true);
    this.world.fog.load(save.fog); // a new hero knows only the camp

    this.hero = new Character(f.hero, null, 1);
    this.equipVisual();
    this.hero.setOutfit(this.outfit());
    this.hero.setTrims(this.trims());
    this.hero.setHighlight(true);
    this.hero.position.set(SPAWN.x, 0, SPAWN.z);
    this.hero.facing = Math.PI;
    this.scene.add(this.hero.root);
    for (const t of this.trails) this.scene.add(t.mesh);
    this.hp = this.maxHp;

    for (const s of this.world.spawns) {
      const u = s.unit === 'mob' ? this.addMob(MOBS[s.kind], new THREE.Vector3(s.x, 0, s.z), labels, s.depth) : this.addProp(s, labels);
      if (u instanceof Mob && u.passive) u.ch.facing = s.rot;
      u.spawner = s;
      // a cooldown still running from an earlier session
      const rec = save.spawners?.[s.id];
      if (rec && rec.until > Date.now()) {
        const left = (rec.until - Date.now()) / 1000;
        u.vanish();
        u.respawnAt = this.time + left;
        u.respawnTotal = s.charges[(rec.n + s.charges.length - 1) % s.charges.length] || left;
        u.chargesUsed = rec.n || s.charges.length;
      }
    }
    for (const b of this.world.bosses) {
      const m = this.addMob(MOBS[b.mob], new THREE.Vector3(b.x, 0, b.z), labels);
      const rec = save.bosses[b.mob];
      if (rec && rec.deadUntil > Date.now()) {
        m.vanish();
        m.respawnAt = this.time + (rec.deadUntil - Date.now()) / 1000;
        m.respawnTotal = m.def.respawn;
      }
    }

    this.fx = new FloatingText(labels, this.camera);
    const hb = document.createElement('div');
    hb.className = 'herohp';
    hb.innerHTML = '<div class="fill"></div><span></span>';
    labels.appendChild(hb);
    this.heroBar = { el: hb, fill: hb.querySelector('.fill')!, text: hb.querySelector('span')! };
    this.particles = new Particles(this.scene);
    this.telegraphs = new Telegraphs(this.scene);
    this.pickups = new Pickups(this.scene);
    this.pickups.onCollect = (k, it) => this.collect(k, it);
    this.waves = new Shockwaves(this.scene);
    // (no camp NPC by the gate for now: src/npc.ts CampNpc is kept for later)
    this.camPos.copy(this.hero.position);
    this.refreshHud(true);
  }

  private addMob(def: MobDef, at: THREE.Vector3, labels: HTMLElement, depth = 0) {
    const zone = this.world.zoneAt(at.x, at.z).id;
    const mul = def.boss || def.rank ? { hp: 1, dmg: 1, reward: 1, scale: 1 } : depthMul(zone, depth);
    const tier = ZONE_TIER[zone] ?? 1;
    const m = new Mob(def, at, this.save.faction, labels, { ...mul, hp: mul.hp * tier, dmg: mul.dmg * tier });
    m.ch.root.scale.setScalar(this.mobScale);
    this.addUnit(m);
    return m;
  }

  private addProp(s: SpawnPoint, labels: HTMLElement) {
    const b = new Prop(s, labels);
    this.addUnit(b);
    return b;
  }

  private addUnit(u: Unit) {
    this.units.push(u);
    if (u instanceof Mob) { this.mobs.push(u); this.scene.add(u.ch.root); }
    else if (u instanceof Prop) { this.props.push(u); this.scene.add(u.obj); }
  }

  // ---------- hero stats ----------
  get faction() { return this.save.faction; }
  /** The party member on the field. */
  get heroClass(): HeroClass { return this.save.cls ?? 'warrior'; }

  /** Puts another party member on the field; false while the switch cooldown runs or if it is already there. */
  switchClass(c: HeroClass) {
    if (c === this.heroClass || this.dead || this.time - this.classT < SWITCH_COOLDOWN) return false;
    this.classT = this.time;
    this.save.cls = c;
    sfx.click();
    this.particles.burst(this.hero.position.clone().setY(1), new THREE.Color(CLASSES[c].color[0]).getHex(), 18, 0.14, 4, 0.6);
    this.ui.party(c);
    this.ui.toast(CLASSES[c].name, 1200);
    this.onClassChange(c);
    this.persist();
    return true;
  }
  /** Totals from equipped armour and jewellery. */
  gear() { return gearOf(this.save.equip); }
  /** Final stats (base points + gear), see heroStats. */
  get stats() { return heroStats(this.save); }
  get power() { return this.stats.power; }
  get defense() { return this.stats.defense; }
  get maxHp() { return this.stats.maxHp; }
  get regen() { return this.stats.regen; }
  /** Speed stat in whole points (100 = HERO.baseSpeed). */
  get speedStat() { return this.stats.speedStat; }
  /** Running speed, m/s. */
  get speed() { return this.stats.speed; }
  /** Main weapon: the right hand, or the left one when the right is empty (stats, balance log). */
  get weaponItem(): Item { return this.save.weapons[0] ?? this.save.weapons[1]!; }
  get weapon() { return WEAPONS[this.weaponItem.def]; }
  /** Damage of one plain blow of `it` with the hero's power and damage percents (no crit, no hand multiplier). */
  itemDamage(it: Item) { const s = this.stats; return weaponDamage(it, s.power, s.powerMul); }
  /** Both hands together, crits on average; `resist` applies each hand's own damage type. */
  heroDps(resist?: Partial<Record<DamageType, ResistTier>>) {
    const s = this.stats;
    return heroDps(this.save.weapons, s.power, s.powerMul, critAvg(s.critPts, s.critDmgPts), resist);
  }

  /** Model names of the right / left hand weapons. */
  handModels(): [string | null, string | null] {
    const m = (it: Item | null) => (it ? itemModel(it, this.faction) : null);
    return [m(this.save.weapons[0]), m(this.save.weapons[1])];
  }

  private equipVisual() {
    this.hero.setWeapon(...this.handModels());
  }

  /** Body parts borrowed from other characters for the equipped armour. */
  outfit(): Partial<Record<VisualPart, string>> {
    const o: Partial<Record<VisualPart, string>> = {};
    for (const part of ['head', 'chest', 'arms', 'legs'] as VisualPart[]) {
      const it = this.save.equip[part];
      const src = it ? ARMOR[it.def].source?.[this.faction] : undefined;
      if (src) o[part] = src;
    }
    return o;
  }

  /** Quality pieces of the equipped armour (armorTrim). */
  trims(): string[] {
    const out: string[] = [];
    for (const s of ['head', 'chest', 'arms', 'legs', 'ring', 'amulet'] as ArmorSlot[]) {
      const it = this.save.equip[s];
      const n = it ? armorTrim(it, this.faction) : null;
      if (n) out.push(n);
    }
    return out;
  }

  // ---------- main loop ----------
  update(dt: number) {
    if (this.paused) { this.render(0); return; }
    dt = Math.min(dt, 1 / 20);
    if (this.slowT > 0) { this.slowT -= dt; dt *= this.slowK; }
    this.time += dt;
    const played = this.save.playTime ?? 0;
    this.save.playTime = played + dt;
    if (Math.floor(this.save.playTime / 60) > Math.floor(played / 60)) this.snapshot();
    if (this.input.pressed('KeyI') || this.input.pressed('KeyC')) { this.onOpenCharacter(); return; }
    if (this.input.pressed('KeyB')) { this.onOpenBag(); return; }
    if (this.input.pressed('KeyM')) { this.onOpenMap(); return; }
    if (this.input.pressed('KeyG')) { this.onOpenGacha(); return; }
    for (const c of CLASS_IDS) if (this.input.pressed(CLASSES[c].key)) this.switchClass(c);
    this.updateHero(dt);
    this.updateMobs(dt);
    this.updateProps(dt);
    this.updateRespawns();
    this.telegraphs.update(dt);
    this.particles.update(dt);
    this.pickups.update(dt, this.hero.position);
    this.waves.update(dt);
    this.world.update(dt, this.time, this.hero.position);
    this.render(dt);
    this.saveT += dt;
    if (this.saveT > 5) { this.saveT = 0; this.persist(); }
  }

  /** Dev: free overview camera (set from the console via window.__view). */
  camOverride: { x: number; z: number; h: number; back: number } | null = null;

  private render(dt: number) {
    const hp = this.hero.position;
    if (this.camOverride) {
      const o = this.camOverride;
      this.camPos.set(o.x, 0, o.z);
      this.camera.position.set(o.x, o.h, o.z + o.back);
      this.camera.lookAt(o.x, 0, o.z);
      this.world.envAt(o.x, o.z, this.env);
      const fog = this.scene.fog as THREE.FogExp2;
      fog.color.copy(this.env.fog);
      fog.density = this.env.density * 0.5;
      this.scene.background = this.env.sky;
      this.sun.target.position.set(o.x, 0, o.z);
      this.sun.position.set(o.x - 16, 30, o.z + 8);
      this.world.update(dt, this.time, this.camPos);
      return;
    }
    // Camera is pinned to the hero's feet (no follow lag).
    this.camPos.copy(hp);
    this.world.fog.reveal(hp.x, hp.z);
    const sh = this.shake > 0 ? this.shake : 0;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.zoom = Math.max(0, this.zoom - dt * 1.6);
    const zk = 1 - 0.38 * this.zoom * this.zoom * (3 - 2 * this.zoom);
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * sh,
      this.camPos.y + 19 * zk,
      this.camPos.z + 1.2 + 11.3 * zk + (Math.random() - 0.5) * sh,
    );
    // Look slightly in front of (below on screen) the hero, so the hero sits above centre, clear of the bottom UI.
    this.camera.lookAt(this.camPos.x, 0.6, this.camPos.z + 1.2);
    this.world.envAt(hp.x, hp.z, this.env);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.env.fog);
    fog.density = this.env.density;
    this.sun.target.position.set(this.camPos.x, 0, this.camPos.z - 3);
    this.sun.position.set(this.camPos.x - 16, 30, this.camPos.z + 8);
    this.scene.background = this.env.sky;
    this.hemi.color.copy(this.env.hemiSky);
    this.hemi.groundColor.copy(this.env.hemiGround);
    const { w, h } = this.ui.size();
    this.fx.update(dt, w, h);
    // hero HP bar above the head
    v1.copy(hp).setY(2.45 * this.heroScale).project(this.camera);
    const hb = this.heroBar;
    hb.el.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    hb.el.classList.toggle('dead', this.dead);
    hb.fill.style.width = `${(this.hp / this.maxHp) * 100}%`;
    hb.text.textContent = fmtK(Math.ceil(this.hp));
    hb.el.classList.toggle('low', this.hp < this.maxHp * 0.3);
    this.updateMobBars(w, h);
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.refreshHud(false); }
  }

  private updateHero(dt: number) {
    const ch = this.hero;
    if (this.dead) {
      this.deadT += dt;
      ch.update(dt, false);
      // no death window: once the death clip has played, straight back to the camp
      if (this.deadT > 1.6) this.respawnInCamp();
      return;
    }
    const [ix, iy] = this.input.vector;
    const moving = Math.hypot(ix, iy) > 0.05;
    this.moveDir.set(ix, 0, iy);
    const p = ch.position;
    if (moving) {
      p.addScaledVector(this.moveDir, this.speed * dt);
      ch.walkRate = Math.min(2.4, (this.speed * this.moveDir.length()) / 2.1);
    }
    if (this.heroKnock.lengthSq() > 0.001) {
      p.addScaledVector(this.heroKnock, dt);
      this.heroKnock.multiplyScalar(Math.max(0, 1 - dt * 9));
    }
    // soft push from living mobs
    for (const m of this.mobs) {
      if (!m.alive || !m.awake || m.rise > 0) continue;
      const dx = p.x - m.pos.x;
      const dz = p.z - m.pos.z;
      const rr = m.radius + HERO.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.5;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
    }
    this.world.collide(p, HERO.radius);

    // targeting (GDD 6.2): keep the current target while it can be struck; once it is out of the strike
    // distance (or it is a prop and a mob came in) switch to the best unit that can. With nothing else to
    // strike the old target is kept a bit further, only for facing. Strike distance: the longer hand.
    const strike = this.reach();
    const reach = strike + HERO.acquireExtra;
    if (this.target) {
      const t = this.target;
      if (!t.hittable || t.pos.distanceTo(p) > reach + t.radius + 1) this.target = null;
    }
    const cur = this.target;
    if (!cur || cur.passive || !this.inStrike(cur, strike)) {
      // the nearest unit in strike distance; any fighting mob goes before props and static units
      let best: Unit | null = null;
      let bd = Infinity;
      for (const u of this.units) {
        if (!u.hittable || !this.inStrike(u, strike)) continue;
        const score = u.pos.distanceTo(p) - u.radius + (u.passive ? 1000 : 0);
        if (score < bd) { bd = score; best = u; }
      }
      // a passive unit being struck stays the target unless a fighting mob came in
      if (best && !(cur && cur.passive && best.passive && this.inStrike(cur, strike))) this.target = best;
    }

    // facing
    let want = ch.facing;
    if (this.target) want = Math.atan2(this.target.pos.x - p.x, this.target.pos.z - p.z);
    else if (moving) want = Math.atan2(ix, iy);
    let diff = want - ch.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    ch.facing += diff * Math.min(1, dt * 16);

    // auto attack while moving: every hand on its own timer
    for (const h of this.hands) this.updateHand(h, dt);
    const shown = this.hands[this.save.weapons[0] ? 0 : 1];
    if (this.comboShown !== shown.combo) {
      this.comboShown = shown.combo;
      this.ui.combo(shown.combo, COMBOS[this.weaponItem.def].hits);
    }

    // regen; much faster in the camp
    let rate = this.regen; // HP per second
    if (inCamp(p.x, p.z)) rate += (HERO.campRegen / 100) * this.maxHp;
    this.hp = Math.min(this.maxHp, this.hp + rate * dt);

    // zone + interactions
    const zone = this.world.zoneAt(p.x, p.z);
    if (zone !== this.zone) {
      this.zone = zone;
      this.ui.zoneBanner(zone);
    }

    ch.update(dt, moving);
    // blade trails from a bit before the blow to a bit after it
    for (const h of this.hands) {
      const it = this.save.weapons[h.i];
      const since = this.time - h.lastSwing;
      const on = !!it && !WEAPONS[it.def].guard && since > h.impactAt * 0.45 && since < h.impactAt * 1.5;
      this.trails[h.i].update(dt, h.i ? ch.weaponL : ch.weapon, on, (it && COMBOS[it.def]?.color) ?? 0xffffff);
    }
  }

  /** Freeze-frame / slow motion for `real` seconds at `k` × speed, plus an optional camera push-in. */
  private slowMo(real: number, k: number, zoom = 0) {
    this.slowK = this.slowT > 0 ? Math.min(this.slowK, k) : k;
    this.slowT = Math.max(this.slowT, real);
    this.zoom = Math.max(this.zoom, zoom);
  }

  /** Longest reach of the two hands. */
  private reach() {
    let r = 0;
    for (const it of this.save.weapons) if (it) r = Math.max(r, WEAPONS[it.def].range);
    return r;
  }

  /** One hand's swing timer and combo chain; the blow lands `impact` s after the swing starts. */
  private updateHand(h: Hand, dt: number) {
    const it = this.save.weapons[h.i];
    if (!it) { h.combo = 0; h.impact = -1; return; }
    const w = WEAPONS[it.def];
    // the shield never swings, it only answers blows (shieldAnswer)
    if (w.guard) { h.combo = 0; return; }
    h.atkCd -= dt;
    const period = 1 / w.aps;
    const combo = COMBOS[it.def];
    // A pause or a whiff breaks the chain (GDD: combo = N uninterrupted attacks); the polearm's series never breaks.
    if (!w.cycle && h.combo > 0 && h.impact < 0 && this.time - h.lastSwing > period + combo.window) h.combo = 0;
    // Swing only when the target is inside the strike shape (inShape's range + 0.35): the target is kept
    // up to 1 m further for facing, and swinging there was a whiff into thin air.
    const t = this.target;
    const inReach = !!t && this.inStrike(t, w.range);
    if (inReach && h.atkCd <= 0) {
      const chained = w.cycle || (h.lastSwingHit && this.time - h.lastSwing <= period + combo.window);
      h.combo = chained ? h.combo + 1 : 1;
      h.finisher = h.combo >= combo.hits;
      h.lastSwing = this.time;
      const impactAt = Math.min(0.42, period * 0.4);
      h.impactAt = impactAt;
      if (w.swing) this.hero.swing(w.swing[(h.combo - 1) % w.swing.length], h.i, period, impactAt);
      else this.hero.attack(w.anim, period, impactAt);
      h.impact = impactAt;
      h.atkCd = period;
    }
    if (h.impact >= 0) {
      h.impact -= dt;
      if (h.impact < 0) this.heroStrike(h);
    }
  }

  /** A blow on mob `def`: it may dodge (dmg 0, `fx` 'miss') or take a crit (`fx` 'crit'). */
  private damageFor(it: Item, def: MobDef, mult = 1) {
    const tier = def.resist[WEAPONS[it.def].type] ?? 'normal';
    if (Math.random() < dodgeChance(def.dodge)) return { dmg: 0, tier, fx: 'miss' as HitFx };
    const s = this.stats;
    const crit = Math.random() < s.crit;
    const dmg = this.itemDamage(it) * RESIST_MULT[tier] * mult * (crit ? s.critMul : 1) * (0.9 + Math.random() * 0.2);
    return { dmg: Math.max(1, Math.round(dmg)), tier, fx: (crit ? 'crit' : '') as HitFx };
  }

  /** The unit's edge is within the strike distance (any direction). */
  private inStrike(u: Unit, range: number) {
    const p = this.hero.position;
    return Math.hypot(u.pos.x - p.x, u.pos.z - p.z) - u.radius <= range + STRIKE_PAD;
  }

  /** `ahead`: the shape is centred that far in front of the hero; `yaw`: strike direction (default: facing). */
  private inShape(pos: THREE.Vector3, radius: number, shape: 'arc' | 'circle', arc: number, range: number, ahead = 0, yaw = this.hero.facing) {
    const p = this.hero.position;
    const dx = pos.x - p.x - Math.sin(yaw) * ahead;
    const dz = pos.z - p.z - Math.cos(yaw) * ahead;
    const d = Math.hypot(dx, dz);
    if (d - radius > range + STRIKE_PAD) return false;
    if (shape === 'circle' || d < 0.6) return true;
    let a = Math.atan2(dx, dz) - yaw;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(a) <= THREE.MathUtils.degToRad(arc / 2) + Math.atan2(radius, d);
  }

  /**
   * The blow of one hand lands. `yaw`: strike direction (shield counters strike back at the attacker, see
   * counterStrike); returns the number of units hit.
   */
  private heroStrike(h: Hand, yaw = this.hero.facing, focus: Unit | null = this.target) {
    const it = this.save.weapons[h.i];
    if (!it) return 0;
    const w = WEAPONS[it.def];
    const fin = h.finisher ? COMBOS[it.def] : null;
    const shape = fin ? fin.shape : w.shape;
    const arc = fin ? fin.arc : w.arc;
    const range = w.range + (fin ? fin.rangeAdd : 0);
    let hits = 0;
    const only = !fin && w.single ? focus : null;
    sfx.swing();
    for (const u of this.units) {
      if (only && u !== only) continue;
      if (!u.hittable || !this.inShape(u.pos, u.radius, shape, arc, range, 0, yaw)) continue;
      hits++;
      if (u instanceof Prop) {
        const tier = u.def.resist[w.type] ?? 'normal';
        this.hitProp(u, (fin ? 3 : 1) * RESIST_MULT[tier], tier);
        continue;
      }
      const m = u as Mob;
      const { dmg, tier, fx } = this.damageFor(it, m.def, fin ? fin.mult : 1);
      const f = this.fightOf(m);
      f.hits++;
      if (fin) f.combos++;
      this.damageMob(m, dmg, tier, fin ? fin.knock : 3.5, fx);
      if (m.alive && !m.def.boss) {
        if (fin?.stun) m.stun = Math.max(m.stun, fin.stun);
        else if (w.stun && Math.random() < w.stun) m.stun = 0.9;
      }
    }
    if (w.shape === 'circle' && hits) {
      this.shake = Math.max(this.shake, 0.18);
      this.particles.burst(v1.copy(this.hero.position).setY(0.2), 0x9a8a70, 8, 0.12, 5, 0.5);
    }
    if (fin) {
      h.finisher = false;
      h.combo = 0;
      if (shape === 'circle') this.waves.add(this.hero.position, range + 0.5, fin.color);
      if (fin.spin) this.hero.spin(0.35);
      if (hits) this.slowMo(0.07, 0.08);
      this.shake = Math.max(this.shake, 0.35);
      sfx.combo();
    }
    h.lastSwingHit = hits > 0;
    if (!hits && !w.cycle) h.combo = 0;
    return hits;
  }

  /** `fx`: 'crit' shows a bigger number, 'miss' (or no damage at all) — the mob dodged. */
  private damageMob(m: Mob, dmg: number, tier: string, knock = 3.5, fx: HitFx = '') {
    if (fx === 'miss' || dmg <= 0) {
      m.state = m.state === 'return' ? 'return' : 'chase';
      this.fx.spawn(this.unitTextAt(m), 'Промах', 'dmg resist', 0.7, { lift: m.uiEl.offsetHeight });
      return;
    }
    this.fightOf(m).dealt += Math.min(dmg, m.hp);
    m.hp -= dmg;
    m.hurtAt = this.time;
    m.ch.hit();
    m.state = m.state === 'return' ? 'return' : 'chase';
    if (!m.def.boss && !m.passive) m.knock.set(m.pos.x - this.hero.position.x, 0, m.pos.z - this.hero.position.z).normalize().multiplyScalar(knock);
    const head = this.unitTextAt(m);
    const lift = m.uiEl.offsetHeight;
    const text = fx === 'crit' ? `-${fmtK(dmg)}!` : `-${fmtK(dmg)}`;
    const crit = fx === 'crit' ? ' crit' : '';
    if (tier === 'weak') { this.fx.spawn(head, text, 'dmg weak' + crit, 0.8, { lift }); sfx.hit(true); }
    else if (tier === 'resist' || tier === 'immune') { this.fx.spawn(head, text, 'dmg resist' + crit, 0.8, { lift }); sfx.resist(); }
    else { this.fx.spawn(head, text, 'dmg' + crit, 0.8, { lift }); sfx.hit(!!crit); }
    this.particles.burst(v2.copy(m.pos).setY(1.1 * m.def.scale), HIT_SPARK, 2, 0.06, 5, 0.3);
    if (m.hp <= 0) this.killMob(m);
  }

  /** World point the over-head block (HP bar + chips) is anchored to; damage numbers start there plus its height. */
  private unitTextAt(u: Unit, out = v1) { return out.copy(u.pos).setY(u.barY); }

  /** Lethal hit: death clip, blood, shake, the knockback and the loot (grantKillRewards) at once. */

  private killMob(m: Mob) {
    m.state = 'dead';
    m.hp = 0;
    m.deadT = 0;
    m.ch.die();
    m.knock.multiplyScalar(KILL_FX.knockMul).clampLength(0, KILL_FX.maxKnock);
    this.shake = Math.max(this.shake, KILL_FX.shake);
    this.particles.burst(v2.copy(m.pos).setY(1.1 * m.def.scale), bloodColor(m), KILL_FX.blood, 0.12, 6, 0.7);
    this.save.kills++;
    this.endFight(m, 'kill');
    const d = m.def;
    m.loot = [];
    m.dying = true;
    this.unitDied(m, false);
    if (d.boss) this.killBoss(m);
    else {
      // elites: their own item on every kill (spawner charges limit the farming)
      if (d.drop) m.loot.push(dropItem(d.drop));
      if (m.temp) m.respawnAt = Infinity;
    }
    this.grantKillRewards(m);
  }

  /** Right on the kill: stat orbs, items, a micro-boss's bonus, the gacha pull. */
  private grantKillRewards(m: Mob) {
    this.payRewards(m);
    for (const it of m.loot) this.pickups.spawnItem(m.pos, it);
    m.loot = [];
    if (m.def.bonus) this.grantBonus(m);
    if (!m.owner && Math.random() < GACHA.token[mobRank(m.def)]) this.grantPull(m);
    if (m.def.boss) this.persist();
  }

  /** A kill dropped a gacha pull. */
  private grantPull(m: Mob) {
    this.save.pulls = (this.save.pulls ?? 0) + 1;
    this.fx.spawn(v1.copy(m.pos).setY(2.6), '+1 крутка', 'loot', 1.6, { color: '#ffb347' });
    this.ui.gachaBadge(this.save.pulls);
    sfx.levelUp();
    this.persist();
  }

  /** Micro-boss kill: permanent stats straight onto the hero. */
  private grantBonus(m: Mob) {
    const b = m.def.bonus!;
    for (const [k, v] of Object.entries(b) as [OrbKind, number][]) {
      addStat(this.save, 'mini', k, v);
      if (k === 'hp') this.hp = Math.min(this.maxHp, this.hp + v);
      this.ui.popStat(k);
    }
    const text = bonusText(b);
    this.fx.spawn(v1.copy(this.hero.position).setY(2.8), text, 'loot', 2, { color: MARK_COLOR.mini });
    this.ui.toast(`${m.def.name} повержен: ${text}`);
    sfx.levelUp();
    this.persist();
  }

  /**
   * Common death of a unit (mob killed / prop broken): rewards and the spawner's next charge.
   * Bosses and grave-risen mobs have no spawner: their respawn is set by the caller.
   */
  private unitDied(u: Unit, pay = true) {
    u.uiEl.classList.remove('show');
    if (this.target === u) this.target = null;
    if (pay) this.payRewards(u);
    if (!u.spawner) return;
    [u.respawnTotal, u.chargesUsed] = this.useCharge(u.spawner);
    u.respawnAt = this.time + u.respawnTotal;
  }

  /** Stat orbs of a dead unit. */
  private payRewards(u: Unit) {
    for (const [k, n] of Object.entries(u.reward) as [OrbKind, number][]) for (let i = 0; i < n; i++) this.pickups.spawn(u.pos, k);
  }

  /** Spawners: a dead unit comes back when its charge's cooldown ends (the hero's position does not matter). */
  private updateRespawns() {
    for (const u of this.units) if (!u.alive && this.time >= u.respawnAt) u.respawn();
  }

  /**
   * A kill uses the spawner's next charge: returns [that charge's cooldown in s, charges used in this cycle]
   * and saves the state (the cycle restarts after the last charge).
   */
  private useCharge(sp: { id: string; charges: number[] }): [number, number] {
    const all = (this.save.spawners ??= {});
    const rec = (all[sp.id] ??= { n: 0, until: 0 });
    const i = rec.n % sp.charges.length;
    const cd = sp.charges[i];
    rec.n = (i + 1) % sp.charges.length;
    rec.until = Date.now() + cd * 1000;
    return [cd, i + 1];
  }

  private killBoss(m: Mob) {
    const d = m.def;
    const rec = (this.save.bosses[d.id] ??= { firstKill: false, deadUntil: 0 });
    rec.deadUntil = Date.now() + d.respawn * 1000;
    m.respawnAt = this.time + d.respawn;
    m.respawnTotal = d.respawn;
    this.telegraphs.clear();
    this.despawnMinions(m);
    this.shake = 0.6;
    sfx.levelUp();
    // its own item on every kill (copies level it up)
    if (d.drop) m.loot.push(dropItem(d.drop));
    if (!rec.firstKill) {
      rec.firstKill = true;
      // The main boss opens the way into the next location(s).
      const opened = d.boss!.unlocks.filter((id) => this.openGate(id));
      if (opened.length) {
        const names = [...new Set(opened.map((id) => this.world.gateTarget(id)))].join(', ');
        setTimeout(() => { sfx.barrier(); this.ui.toast(`Ворота открыты! Путь: ${names}`); }, 1200);
      }
    }
    this.persist();
  }

  /** Opens a passage for good (saved). False if it was open already. */
  private openGate(id: string, instant = false) {
    const gates = (this.save.gates ??= []);
    if (gates.includes(id)) return false;
    gates.push(id);
    this.world.openGate(id, instant);
    return true;
  }

  private collect(kind: PickupKind, item?: Item) {
    if (kind === 'item' && item) {
      this.lootItem(item);
      return;
    }
    sfx.orb();
    const k = kind as OrbKind;
    addStat(this.save, 'enemy', k, ORBS[k].value);
    if (k === 'hp') this.hp = Math.min(this.maxHp, this.hp + ORBS.hp.value);
    this.ui.gain(kind as OrbKind, this.time);
    this.ui.popStat(kind as OrbKind);
  }

  // ---------- mobs ----------
  private updateMobs(dt: number) {
    const hp = this.hero.position;
    const heroInCamp = inCamp(hp.x, hp.z);
    let removed = false;
    for (const m of this.mobs) {
      if (m.removed) { removed = true; continue; }
      const dHero = m.pos.distanceTo(hp);
      if (m.rise > 0 && m.state !== 'dead') {
        // crawling out of the grave
        m.rise -= dt;
        m.pos.y = -1.9 * Math.max(0, m.rise) / 1.3;
        m.ch.facing = Math.atan2(hp.x - m.pos.x, hp.z - m.pos.z);
        m.ch.update(dt, false);
        if (m.rise <= 0) m.pos.y = 0;
        continue;
      }
      // Sleep far away mobs (GDD 5: "мобы дальше радиуса активности спят").
      m.awake = dHero < 40;
      m.ch.root.visible = m.state !== 'dead' ? dHero < 34 : m.ch.root.visible && dHero < 34;
      if (m.state === 'dead') {
        m.deadT += dt;
        m.ch.update(dt, false, m.dying && dHero < 34);
        if (m.knock.lengthSq() > 0.001) {
          m.pos.addScaledVector(m.knock, dt);
          m.knock.multiplyScalar(Math.max(0, 1 - dt * 9));
        }
        // Off-screen corpses do not animate, so their clip never finishes: end it right after the freeze.
        if (m.dying && (m.ch.deathDone || dHero >= 34)) { m.dying = false; m.paidAt = m.deadT; }
        const gone = m.dying ? 0 : m.deadT - m.paidAt;
        if (gone > 0.4) m.ch.position.y = -(gone - 0.4) * 0.8;
        if (gone > 2.2) m.ch.root.visible = false;
        if (m.temp && gone > 2.7) { this.removeMob(m); removed = true; }
        continue;
      }
      if (!m.awake) continue;
      const def = m.def;
      let moving = false;
      if (m.hp < m.maxHp && this.time - m.hurtAt > MOB_REGEN_DELAY) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * def.regen * dt);
      // a static unit only stands: no chasing, no blows, no wandering
      if (m.passive) { m.ch.update(dt, false); continue; }
      if (m.stun > 0) {
        m.stun -= dt;
      } else if (m.casting > 0) {
        m.casting -= dt;
      } else {
        const dSpawn = m.pos.distanceTo(m.spawn);
        const leash = def.boss ? 16 : LEASH;
        if (m.state === 'idle') {
          if (!this.dead && !heroInCamp && dHero < def.aggro) m.state = 'chase';
          else {
            m.wanderT -= dt;
            if (m.wanderT <= 0) {
              m.wanderT = 2 + Math.random() * 4;
              m.wander.set(m.spawn.x + (Math.random() - 0.5) * 5, 0, m.spawn.z + (Math.random() - 0.5) * 5);
            }
            const d = m.wander.distanceTo(m.pos);
            if (d > 0.4 && !def.boss) {
              moving = this.stepTo(m, m.wander, def.speed * 0.35, dt);
            }
          }
        } else if (m.state === 'chase') {
          if (this.dead || heroInCamp || dSpawn > leash || hp.distanceTo(m.spawn) > leash + 4) {
            m.state = 'return';
            this.endFight(m, 'reset');
            if (def.boss) { m.adds = 0; this.despawnMinions(m); }
          } else {
            const reach = def.range + m.radius * 0.5 + HERO.radius;
            if (def.boss) {
              // A boss on your tail keeps you in combat: no out-of-combat regen while kiting.
              this.bossLogic(m, dt, dHero);
            }
            if (m.casting <= 0) {
              const back = m.ch instanceof Creature ? m.ch.backstep() : 0;
              if (back > 0) {
                m.pos.x -= Math.sin(m.ch.facing) * back;
                m.pos.z -= Math.cos(m.ch.facing) * back;
              } else if (dHero > reach * 0.85) moving = this.stepTo(m, hp, def.speed, dt);
              m.ch.facing = turn(m.ch.facing, Math.atan2(hp.x - m.pos.x, hp.z - m.pos.z), dt * 8);
              m.atkCd -= dt;
              if (dHero < reach && m.atkCd <= 0 && m.impact < 0) {
                const period = 1 / def.aps;
                const impactAt = mobImpact(m.ch.hitTime(def.anim), period);
                m.ch.attack(def.anim, period, impactAt);
                m.impact = impactAt;
                m.atkCd = period;
              }
            }
          }
        } else if (m.state === 'return') {
          // Walks home at chase speed, no heal; re-aggros if the hero comes close again inside the leash
          // (a hit is within aggro range too). Hero outside the leash is ignored, or it would flip every frame.
          if (!this.dead && !heroInCamp && dHero < def.aggro && hp.distanceTo(m.spawn) < leash) m.state = 'chase';
          else {
            moving = this.stepTo(m, m.spawn, def.speed, dt);
            if (dSpawn < 0.6) m.state = 'idle';
          }
        }
      }
      if (m.impact >= 0) {
        m.impact -= dt;
        if (m.impact < 0 && !this.dead && m.stun <= 0) {
          const reach = def.range + m.radius * 0.5 + HERO.radius + 0.5;
          if (m.pos.distanceTo(hp) < reach) {
            this.hurtHero(m.dmg * (m.phase2 ? def.boss!.phase2Dmg : 1), m.pos, m);
            if (def.push) {
              this.heroKnock.set(hp.x - m.pos.x, 0, hp.z - m.pos.z).normalize().multiplyScalar(def.push);
              this.shake = Math.max(this.shake, 0.25);
            }
          }
        }
      }
      // knockback
      if (m.knock.lengthSq() > 0.001) {
        m.pos.addScaledVector(m.knock, dt);
        m.knock.multiplyScalar(Math.max(0, 1 - dt * 9));
      }
      // separation between mobs
      for (const o of this.mobs) {
        if (o === m || !o.alive || !o.awake) continue;
        const dx = m.pos.x - o.pos.x;
        const dz = m.pos.z - o.pos.z;
        const rr = m.radius + o.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-5) {
          const d = Math.sqrt(d2);
          const k = ((rr - d) / d) * 0.5;
          m.pos.x += dx * k;
          m.pos.z += dz * k;
        }
      }
      this.world.collide(m.pos, m.radius);
      // mobs never enter the camp
      if (m.pos.z > -20) m.pos.z = -20;
      m.ch.update(dt, moving, dHero < 34 && this.time - m.hurtAt >= HIT_FREEZE);
    }
    if (removed) {
      this.mobs = this.mobs.filter((m) => !m.removed);
      this.units = this.units.filter((u) => !(u instanceof Mob && u.removed));
    }
  }

  private removeMob(m: Mob) {
    this.scene.remove(m.ch.root);
    m.uiEl.remove();
    m.respawnEl.remove();
    m.state = 'dead';
    m.removed = true;
  }

  /** Data-driven prop events (BREAKABLES[kind].onBreak). */
  private runBreakEvents(b: Prop) {
    for (const ev of b.def.onBreak ?? []) {
      if (Math.random() >= ev.chance) continue;
      if (ev.type === 'spawnMob') {
        const live = this.mobs.filter((m) => m.temp && m.alive).length;
        const n = Math.min(ev.count ?? 1, 8 - live);
        for (let i = 0; i < n; i++) {
          const at = new THREE.Vector3(b.pos.x + (Math.random() - 0.5) * 0.8, 0, b.pos.z + (Math.random() - 0.5) * 0.8);
          const m = new Mob(MOBS[ev.mob], at, this.save.faction, this.labels);
          m.temp = true;
          m.rise = 1.3;
          m.state = 'chase';
          m.atkCd = 0.8;
          m.pos.y = -1.9;
          this.addUnit(m);
        }
        if (n > 0) {
          this.particles.burst(v1.copy(b.pos).setY(0.2), 0x5a4a3a, 14, 0.16, 5, 0.9);
          this.shake = Math.max(this.shake, 0.2);
          sfx.telegraph();
          if (ev.bark) this.fx.spawn(v2.copy(b.pos).setY(2.6), ev.bark, 'bark', 1.8);
        }
      }
    }
  }

  private stepTo(m: Mob, to: THREE.Vector3, speed: number, dt: number) {
    v1.set(to.x - m.pos.x, 0, to.z - m.pos.z);
    const d = v1.length();
    if (d < 0.05) return false;
    v1.multiplyScalar(Math.min(d, speed * dt) / d);
    m.pos.add(v1);
    m.ch.facing = turn(m.ch.facing, Math.atan2(v1.x, v1.z), dt * 8);
    m.ch.walkRate = speed / m.ch.stride;
    return true;
  }

  private bossColor(m: Mob) {
    // Time-to-kill against the hero's current weapon decides the name colour (GDD 6.4).
    const ttk = m.maxHp / Math.max(1, this.heroDps(m.def.resist));
    return ttk < 35 ? '#6cff7a' : ttk < 80 ? '#ffd84d' : '#ff5a5a';
  }

  private bossLogic(m: Mob, dt: number, dHero: number) {
    const b = m.def.boss!;
    if (!m.phase2 && m.hp < m.maxHp * b.phase2At) {
      m.phase2 = true;
      this.fx.spawn(v1.copy(m.pos).setY(4.5), m.def.id === 'death' ? 'Твоё время вышло!' : 'Ты меня разозлил!', 'bark', 2);
      sfx.telegraph();
    }
    if (b.reinforce && m.adds < b.reinforce.at.length && m.hp < m.maxHp * b.reinforce.at[m.adds]) {
      while (m.adds < b.reinforce.at.length && m.hp < m.maxHp * b.reinforce.at[m.adds]) m.adds++;
      this.callReinforcements(m, b.reinforce.pool);
    }
    m.special -= dt;
    if (m.special > 0 || m.impact >= 0) return;
    // Specials wait until the hero is in reach: no slams into thin air while the hero runs off.
    const chase = m.phase2 && dHero < b.chaseRange && Math.random() < b.chance;
    // cycle step 0 = the slam around the boss, 1.. = the cones in order
    const step = b.cones ? m.cycle % (b.cones.length + 1) : 0;
    const cone = step > 0 ? b.cones![step - 1] : null;
    if (!chase && dHero > (cone ? cone.len * 0.75 : b.slamRadius) + HERO.radius) return;
    m.special = m.phase2 ? b.cdPhase2 : b.cd;
    if (!chase) m.cycle++;
    const slam = (at: THREE.Vector3, radius: number, dmgMul: number, delay: number) => {
      this.telegraphs.add(at, radius, delay, () => {
        if (m.state === 'dead') return;
        sfx.slam();
        this.shake = Math.max(this.shake, 0.45);
        this.particles.burst(v2.copy(at).setY(0.2), 0x8a7a6a, 14, 0.18, 7, 0.7);
        const f = this.fightOf(m);
        f.slams++;
        if (!this.dead && this.hero.position.distanceTo(at) < radius + HERO.radius) {
          f.slamHits++;
          this.hurtHero(m.dmg * dmgMul, at, m);
        }
      });
    };
    sfx.telegraph();
    if (chase) {
      // three blasts that chase the hero's position
      m.casting = 1.6;
      for (let i = 0; i < b.chaseCount; i++) {
        setTimeout(() => {
          if (m.state !== 'dead' && !this.paused) slam(this.hero.position.clone(), b.chaseRadius, b.chaseMul, b.chaseDelay);
        }, i * b.chaseGap * 1000);
      }
    } else if (cone) {
      m.casting = 1.35;
      m.ch.attack('AxeAttack', 1.35, 1.25);
      const yaw = Math.atan2(this.hero.position.x - m.pos.x, this.hero.position.z - m.pos.z);
      m.ch.facing = yaw;
      for (const off of cone.yaws) {
        const tag: ConeTag = { boss: m, at: m.pos.clone(), yaw: yaw + off, half: cone.half, len: cone.len, mul: cone.mul };
        this.telegraphs.addCone(tag.at, tag.yaw, cone.half, cone.len, b.slamDelay, this.coneHit, tag);
      }
    } else {
      m.casting = 1.35;
      m.ch.attack('AxeAttack', 1.35, 1.25);
      slam(m.pos.clone(), b.slamRadius, b.slamMul, b.slamDelay);
    }
  }

  private coneHit = (tag?: unknown) => {
    const c = tag as ConeTag;
    if (c.boss.state === 'dead') return;
    sfx.slam();
    this.shake = Math.max(this.shake, 0.35);
    this.particles.burst(v2.set(c.at.x + Math.sin(c.yaw) * c.len * 0.5, 0.2, c.at.z + Math.cos(c.yaw) * c.len * 0.5), 0x8a7a6a, 10, 0.18, 7, 0.7);
    const f = this.fightOf(c.boss);
    f.slams++;
    if (this.dead) return;
    const dx = this.hero.position.x - c.at.x;
    const dz = this.hero.position.z - c.at.z;
    const d = Math.hypot(dx, dz);
    if (d > c.len + HERO.radius) return;
    const a = Math.atan2(dx, dz) - c.yaw;
    const off = Math.atan2(Math.sin(a), Math.cos(a));
    // the hero's body widens the cone a little
    if (Math.abs(off) > c.half + Math.asin(Math.min(1, HERO.radius / Math.max(d, HERO.radius)))) return;
    f.slamHits++;
    this.hurtHero(c.boss.dmg * c.mul, c.at, c.boss);
  };

  /** 3–4 mobs of different kinds run in from the fort entrance and go for the hero. */
  private callReinforcements(boss: Mob, pool: string[]) {
    const e = this.world.fortExit;
    const kinds = pool.slice().sort(rndSort).slice(0, 3 + Math.floor(Math.random() * 2));
    this.fx.spawn(v1.copy(boss.pos).setY(5.6), 'Ко мне, ребята!', 'bark', 2);
    sfx.telegraph();
    for (let i = 0; i < kinds.length; i++) {
      const side = (i - (kinds.length - 1) / 2) * 1.5;
      const m = this.addMob(MOBS[kinds[i]], new THREE.Vector3(e.x + e.tz * side, 0, e.z - e.tx * side), this.labels);
      m.temp = true;
      m.owner = boss;
      m.state = 'chase';
      m.atkCd = 0.6;
    }
  }

  private despawnMinions(boss: Mob) {
    for (const m of this.mobs) {
      if (m.owner !== boss || m.removed) continue;
      if (this.target === m) this.target = null;
      this.removeMob(m);
    }
  }

  /** The fort tower lobs a shot at the hero's position: a red circle on the ground, damage on landing. */
  private towerFire(b: Prop, dt: number) {
    const s = b.def.shoot!;
    const hp = this.hero.position;
    b.shootCd -= dt;
    if (b.shootCd > 0) return;
    if (this.dead || inCamp(hp.x, hp.z) || b.pos.distanceTo(hp) > s.range) { b.shootCd = 0.5; return; }
    b.shootCd = s.cd;
    sfx.telegraph();
    const tag: ShotTag = { at: hp.clone().setY(0), dmg: s.dmg, r: s.r };
    this.telegraphs.add(tag.at, s.r, s.delay, this.towerHit, tag, v1.copy(b.pos).setY(s.height));
  }

  private towerHit = (tag?: unknown) => {
    const t = tag as ShotTag;
    sfx.slam();
    this.shake = Math.max(this.shake, 0.2);
    this.particles.burst(v2.copy(t.at).setY(0.2), 0x8a7a6a, 8, 0.14, 5, 0.6);
    if (!this.dead && this.hero.position.distanceTo(t.at) < t.r + HERO.radius) this.hurtHero(t.dmg, t.at);
  };

  private hurtHero(raw: number, from: THREE.Vector3, src?: Mob) {
    if (this.dead) return;
    const s = this.stats;
    const barY = 2.45 * this.heroScale;
    const lift = this.heroBar.el.offsetHeight + 14;
    // dodge: any blow, boss specials too
    if (Math.random() < s.dodge) {
      this.fx.spawn(v1.copy(this.hero.position).setY(barY), 'Уклон', 'hurt', 0.6, { color: '#9fe8ff', lift });
      return;
    }
    const crit = !!src && Math.random() < critChance(src.def.crit);
    // GDD 10.5: reduction = defense / (defense + 100).
    const dmg = Math.max(1, Math.round(raw * (crit ? critMul(src!.def.critDmg) : 1) * armorMul(s.defense) * this.guardMul() * (0.9 + Math.random() * 0.2)));
    if (src) this.shieldAnswer(src, dmg);
    if (src) this.fightOf(src).taken += Math.min(dmg, this.hp);
    this.hp -= dmg;
    this.hero.hit();
    sfx.hurt();
    this.fx.spawn(v1.copy(this.hero.position).setY(barY), crit ? `-${fmtK(dmg)}!` : `-${fmtK(dmg)}`, crit ? 'hurt crit' : 'hurt', 0.7, { lift });
    void from;
    this.ui.hurtFlash();
    if (this.hp <= 0 && this.god) this.hp = 1; // debug
    if (this.hp <= 0) {
      this.hp = 0;
      for (const m of this.mobs) this.endFight(m, 'death');
      this.dead = true;
      this.deadT = 0;
      this.target = null;
      this.hero.die();
      this.telegraphs.clear();
      sfx.die();
      this.input.reset();
    }
  }

  /** Incoming damage multiplier from the shields in hand. */
  private guardMul() { return guardMul(this.save.weapons); }

  private lastCounter = -99;
  private counterHand = newHand(0);

  /** The class slot's shield: reflects a share of the blow, may counter-strike with the weapon. */
  private shieldAnswer(m: Mob, dmg: number) {
    const sh = this.save.weapons[1];
    const g = sh && WEAPONS[sh.def].guard;
    if (!g || !m.alive || this.dead) return;
    if (g.reflect) {
      const back = Math.max(1, Math.round(dmg * g.reflect));
      this.damageMob(m, back, 'normal', 0);
      this.particles.burst(v1.copy(m.pos).setY(1.1 * m.def.scale), 0xff6060, 6, 0.08, 4, 0.35);
    }
    const weapon = this.save.weapons[0];
    if (!weapon || !m.alive || this.time - this.lastCounter < g.cd || Math.random() >= g.counter[mobRank(m.def)]) return;
    this.lastCounter = this.time;
    const w = WEAPONS[weapon.def];
    const yaw = Math.atan2(m.pos.x - this.hero.position.x, m.pos.z - this.hero.position.z);
    this.hero.facing = yaw;
    this.hero.swing('bash', 1, 0.5, 0.12);
    this.hero.swing(w.swing?.[0] ?? 'slashRL', 0, 0.6, 0.15);
    // a throwaway hand state: a counter neither spends nor builds the combo chain
    const h = Object.assign(this.counterHand, newHand(0));
    const hits = this.heroStrike(h, yaw, m);
    const at = v1.copy(this.hero.position).setY(1.2);
    this.particles.burst(at, 0x9fd0ff, 10, 0.1, 6, 0.4);
    this.fx.spawn(at.setY(2.9), hits ? 'Контратака!' : 'Блок', 'dmg weak', 0.7, { color: '#9fd0ff' });
  }

  /** After a death: in the camp with HERO.respawnHp of the HP (the camp regen fills the rest fast). */
  private respawnInCamp() {
    this.hero.position.set(SPAWN.x, 0, SPAWN.z);
    this.camPos.copy(this.hero.position);
    this.revive();
  }

  private revive() {
    this.dead = false;
    this.hp = Math.max(1, Math.round(this.maxHp * HERO.respawnHp));
    this.hero.revive();
    this.ui.flash();
    this.persist();
  }

  // ---------- breakables ----------
  private hitProp(b: Prop, dmg: number, tier: string) {
    b.hp = +(b.hp - dmg).toFixed(2);
    b.shake = 0.2;
    b.flash = 0.1;
    sfx.hit();
    // hits count in whole blows: -1, -0.5 against stone, -3 for a finisher
    const cls = tier === 'weak' ? 'dmg weak' : tier === 'resist' || tier === 'immune' ? 'dmg resist' : 'dmg';
    this.fx.spawn(this.unitTextAt(b), `-${fmtK(dmg)}`, cls, 0.8, { lift: b.uiEl.offsetHeight });
    this.particles.burst(v1.copy(b.pos).setY(0.7), b.def.color, 3, 0.1, 3, 0.4);
    if (b.hp > 0) return;
    b.broken = true;
    b.obj.visible = false;
    sfx.break();
    this.particles.burst(v1.copy(b.pos).setY(0.6), b.def.color, 10, 0.22, 6, 1.1);
    this.unitDied(b);
    this.runBreakEvents(b);
  }

  private updateProps(dt: number) {
    const hp = this.hero.position;
    for (const b of this.props) {
      if (!b.alive) continue;
      b.obj.visible = b.pos.distanceTo(hp) < 36;
      if (b.def.shoot) this.towerFire(b, dt);
      if (b.shake > 0) {
        b.shake -= dt;
        const s = Math.max(0, b.shake) * 0.6;
        b.obj.rotation.z = Math.sin(this.time * 60) * s;
        b.obj.scale.setScalar(1 + s * 0.5);
      }
      if (b.flash > 0) {
        b.flash -= dt;
        for (const m of b.mats) m.emissive.setScalar(b.flash > 0 ? 0.6 : 0);
      }
    }
  }

  private updateMobBars(w: number, h: number) {
    const hp = this.hero.position;
    const explored = (p: THREE.Vector3) => this.world.fog.isExplored(p.x, p.z);
    for (const u of this.units) {
      // HP bar + weakness icons + reward over living units near the hero.
      const show = u.alive && u.visible && u.pos.distanceTo(hp) < u.barRange && explored(u.pos);
      if (!show) { if (u.uiEl.classList.contains('show')) u.uiEl.classList.remove('show'); }
      else {
        v1.copy(u.pos).setY(u.barY).project(this.camera);
        u.uiEl.classList.add('show');
        u.uiEl.classList.toggle('hurt', u.hp < u.maxHp);
        u.uiEl.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
        u.hpFill.style.width = `${Math.max(0, u.hp / u.maxHp) * 100}%`;
        if (u.hpText) {
          // every unit has the same bar: current HP only
          const t = fmtK(Math.ceil(u.hp));
          if (u.hpText.textContent !== t) u.hpText.textContent = t;
        }
        if (u instanceof Mob && u.def.boss) (u.uiEl.querySelector('.bname') as HTMLElement).style.color = this.bossColor(u);
      }
      // Respawn loader at the spawn point (for a mob, once the corpse has gone).
      const dead = !u.alive && u.loaderReady && u.spawn.distanceTo(hp) < 30 && explored(u.spawn);
      if (!dead) { if (u.respawnEl.classList.contains('show')) u.respawnEl.classList.remove('show'); continue; }
      v1.copy(u.spawn).setY(0.5).project(this.camera);
      if (Math.abs(v1.x) > 1.1 || Math.abs(v1.y) > 1.1) { u.respawnEl.classList.remove('show'); continue; }
      const left = u.respawnAt - this.time;
      u.respawnEl.classList.add('show');
      u.respawnEl.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      u.respawnEl.style.setProperty('--p', `${Math.min(1, Math.max(0, 1 - left / (u.respawnTotal || 1))) * 360}deg`);
      u.setRespawnText(left);
      if (u.spawner) setChargeBars(u.respawnEl, u.chargesUsed, u.spawner.charges.length);
    }
  }

  // ---------- items / inventory ----------
  /** Gives an item to the hero; returns where it went (text for the gacha result). */
  lootItem(item: Item) {
    const color = RARITY[item.rarity].color;
    const name = itemName(item, this.faction);
    const head = v1.copy(this.hero.position).setY(2.4);
    sfx.levelUp();
    let where = '';
    // A copy of an item the hero already has levels that item up instead.
    const own = [...this.save.weapons, ...Object.values(this.save.equip), ...this.save.bag].find((x) => x && sameItem(x, item));
    if (own) {
      own.lvl += item.lvl;
      const gain = copyGain(item) * item.lvl;
      const text = `${name}: ур. ${own.lvl}${gain ? ` · +${gain} урона` : ''}`;
      this.fx.spawn(head, text, 'loot', 1.6, { color });
      this.ui.toast(`Копия! ${text}`);
      this.afterGearChange();
      this.persist();
      return `Копия: ${text}`;
    }
    // A class item goes straight into its empty slot.
    const slot = item.kind === 'weapon' ? classSlot(this.heroClass, item.def) : null;
    if (slot !== null && !this.save.weapons[slot]) {
      this.save.weapons[slot] = item;
      this.afterGearChange();
      this.fx.spawn(head, `${name} → ${this.slotName(slot)}`, 'loot', 1.4, { color });
      where = `Надето: ${this.slotName(slot)}`;
    } else if (this.save.bag.length < BAG_SIZE) {
      this.save.bag.push(item);
      this.newItems++;
      this.fx.spawn(head, `+ ${name}`, 'loot', 1.4, { color });
      where = 'Положено в сумку';
    } else {
      this.fx.spawn(head, `Сумка полна: ${name} потерян`, 'loot', 1.6, { color });
      this.ui.toast(`Сумка полна — ${name} не поместился`);
      where = 'Сумка полна: предмет потерян';
    }
    this.refreshHud(true);
    this.persist();
    return where;
  }

  /** Slot caption: "Оружие" or the class item's name. */
  slotName(slot: 0 | 1) { return slot ? kitOf(this.heroClass).offName : 'Оружие'; }

  /** Equip an item from the bag; whatever was in that slot goes back into the bag. False: not for this class. */
  equipFromBag(index: number) {
    const it = this.save.bag[index];
    if (!it) return false;
    const slot = it.kind === 'weapon' ? classSlot(this.heroClass, it.def) : null;
    if (it.kind === 'weapon' && slot === null) {
      this.ui.toast(`${itemName(it, this.faction)} — не для класса «${CLASSES[this.heroClass].name}»`);
      return false;
    }
    this.save.bag.splice(index, 1);
    if (slot !== null) {
      const old = this.save.weapons[slot];
      this.save.weapons[slot] = it;
      if (old) this.save.bag.splice(index, 0, old);
    } else {
      const aslot = ARMOR[it.def].slot;
      const old = this.save.equip[aslot];
      this.save.equip[aslot] = it;
      if (old) this.save.bag.splice(index, 0, old);
    }
    this.afterGearChange();
    return true;
  }

  unequipArmor(slot: ArmorSlot) {
    const it = this.save.equip[slot];
    if (!it || this.save.bag.length >= BAG_SIZE) return false;
    delete this.save.equip[slot];
    this.save.bag.push(it);
    this.afterGearChange();
    return true;
  }

  /** Only the class item comes off: the weapon slot is never empty, it is only swapped. */
  unequipWeapon(slot: 0 | 1) {
    const it = this.save.weapons[slot];
    if (slot === 0 || !it || this.save.bag.length >= BAG_SIZE) return false;
    this.save.weapons[slot] = null;
    this.save.bag.push(it);
    this.afterGearChange();
    return true;
  }

  /** Throws an item out of the bag for good. */
  discardFromBag(index: number) {
    const it = this.save.bag[index];
    if (!it) return;
    this.save.bag.splice(index, 1);
    sfx.break();
    this.persist();
    this.refreshHud(true);
  }

  /** Fresh chains. */
  private resetHands() {
    for (const h of this.hands) Object.assign(h, newHand(h.i));
  }

  private afterGearChange() {
    const hpFrac = this.hp / this.maxHp;
    this.equipVisual();
    this.hero.setOutfit(this.outfit());
    this.hero.setTrims(this.trims());
    this.hp = Math.min(this.maxHp, Math.max(1, hpFrac * this.maxHp));
    this.resetHands();
    sfx.click();
    this.persist();
    this.refreshHud(true);
  }

  // ---------- HUD / save ----------
  // No goal hints (text, edge arrow, map line): the player finds the way himself.

  /** Map red dots: every living unit (mobs and props alike) in explored land, bosses excluded (they get a skull). */
  private mapDots(near = Infinity) {
    const hp = this.hero.position;
    return this.units.filter((u) => u.alive && !u.mark && u.pos.distanceTo(hp) < near && this.world.fog.isExplored(u.pos.x, u.pos.z)).map((u) => u.pos);
  }

  /**
   * Special map marks, drawn where the unit is right now (they move with it): the main boss — big red skull
   * (dead: hourglass at its spawn point), a micro-boss — smaller orange skull, an elite — its drop's icon
   * in a frame of the drop's quality colour. Dead micro-bosses and elites are not shown.
   */
  private mapMarks(near = Infinity): MapMark[] {
    const hp = this.hero.position;
    const out: MapMark[] = [];
    for (const m of this.mobs) {
      const kind = m.mark;
      if (!kind || (!m.alive && kind !== 'boss')) continue;
      const pos = m.alive ? m.pos : m.spawn;
      if (pos.distanceTo(hp) > near || !this.world.fog.isExplored(pos.x, pos.z)) continue;
      const d = m.def;
      out.push({
        x: pos.x, z: pos.z, kind, alive: m.alive,
        color: kind === 'elite' && d.drop ? RARITY[d.drop.rarity].color : MARK_COLOR[kind],
        icon: kind === 'elite' && d.drop ? dropIconId(d.drop) : 'skull',
        name: d.boss ? d.boss.titles[this.faction] : d.name,
        respawnIn: m.alive ? 0 : Math.max(0, m.respawnAt - this.time),
        drop: (kind === 'boss' || kind === 'mini') && d.drop ? { icon: dropIconId(d.drop), color: RARITY[d.drop.rarity].color } : undefined,
      });
    }
    return out;
  }

  /** Snapshot for the full-screen world map. */
  mapInfo() {
    return {
      hero: { x: this.hero.position.x, z: this.hero.position.z, facing: this.hero.facing },
      units: this.mapDots().map((p) => ({ x: p.x, z: p.z })),
      marks: this.mapMarks(),
    };
  }

  refreshHud(full: boolean) {
    this.ui.hud({
      hp: this.hp, maxHp: this.maxHp,
      stats: { power: Math.round(this.power), hp: this.maxHp, regen: this.regen, speed: this.speedStat },
      buffs: [
        inCamp(this.hero.position.x, this.hero.position.z) && this.hp < this.maxHp ? '🏠 Лагерь: быстрое восстановление' : '',
      ].filter(Boolean),
      bosses: this.mobs.filter((m) => m.def.boss).map((m) => ({
        name: m.def.boss!.titles[this.faction],
        left: m.alive ? 0 : Math.max(1, Math.ceil(m.respawnAt - this.time)),
      })),
    });
    this.ui.tickGains(this.time);
    if (full) {
      this.ui.weapons(this.save.weapons, (it) => this.itemDamage(it), this.save.equip);
      this.ui.bagBadge(this.newItems, this.save.bag.length >= BAG_SIZE);
      this.ui.gachaBadge(this.save.pulls ?? 0);
      this.ui.party(this.heroClass);
    }
    this.ui.minimap(this.hero.position, this.hero.facing, this.mapDots(45), this.world, this.mapMarks(45));
  }

  /** Quality preset: shadows, mist and grass are the expensive parts on phones. */
  setLowGfx(low: boolean) {
    this.sun.castShadow = !low;
    this.world.setLowDetail(low);
  }

  // ---------- debug menu (src/debug.ts) ----------
  /** Debug: the hero cannot die (HP stops at 1). */
  god = false;

  /** Debug: a rare weapon of this type straight into a hand; the old one goes to the bag if it fits. */
  debugAddPulls(n: number) {
    this.save.pulls = (this.save.pulls ?? 0) + n;
    this.refreshHud(true);
    this.persist();
  }

  /** Adds `n` points of stat `k` (source "Дебаг"); `pct`: `n` percent instead (hp / regen / power). */
  debugAddStat(k: StatId, n: number, pct = false) {
    const hpFrac = this.hp / this.maxHp;
    if (pct && isPctStat(k)) addPct(this.save, 'debug', k, n);
    else addStat(this.save, 'debug', k, n);
    this.hp = hpFrac * this.maxHp;
    this.refreshHud(true);
    this.persist();
  }

  /** Removes every debug stat point and percent. */
  debugClearStats() {
    delete this.save.src.debug;
    delete this.save.pct.debug;
    this.hp = Math.min(this.hp, this.maxHp);
    this.refreshHud(true);
    this.persist();
  }

  debugGiveWeapon(def: string, slot: 0 | 1 = 0) {
    const old = this.save.weapons[slot];
    this.save.weapons[slot] = dropItem({ kind: 'weapon', def, rarity: 2 });
    if (old && this.save.bag.length < BAG_SIZE) this.save.bag.push(old);
    this.afterGearChange();
  }

  /**
   * Debug: every weapon, shield and armour piece at every quality into the bag (ones already owned are skipped).
   * Ignores the bag limit, so the bag may end up over 128 until something is thrown away.
   */
  debugGiveAll() {
    const own = [...this.save.weapons, ...Object.values(this.save.equip), ...this.save.bag].filter((x): x is Item => !!x);
    let n = 0;
    for (const [kind, defs] of [['weapon', Object.keys(WEAPONS)], ['armor', Object.keys(ARMOR)]] as const) {
      for (const def of defs) {
        for (let rarity = 0; rarity < 6; rarity++) {
          const it = dropItem({ kind, def, rarity });
          if (own.some((x) => sameItem(x, it))) continue;
          this.save.bag.push(it);
          n++;
        }
      }
    }
    this.newItems += n;
    this.ui.toast(`Выдано предметов: ${n}`);
    this.refreshHud(true);
    this.persist();
  }

  /** Debug: a whole armour set with a ring and an amulet; the same set again is one quality higher. */
  debugGiveArmor(set: string) {
    const head = this.save.equip.head;
    const rarity = head?.def === `${set}_head` ? (head.rarity + 1) % 6 : 1;
    const defs: [ArmorSlot, string][] = [
      ['head', `${set}_head`], ['chest', `${set}_chest`], ['arms', `${set}_arms`], ['legs', `${set}_legs`],
      ['ring', 'ring_power'], ['amulet', 'amulet_life'],
    ];
    for (const [slot, def] of defs) this.save.equip[slot] = dropItem({ kind: 'armor', def, rarity });
    this.fx.spawn(v1.copy(this.hero.position).setY(2.6), `${set} · ${rarity}`, 'dmg weak', 1);
    this.afterGearChange();
  }

  /** Debug: the class item to the bag (or just gone if the bag is full). */
  debugClearLeft() {
    const it = this.save.weapons[1];
    if (!it || !this.save.weapons[0]) return;
    this.save.weapons[1] = null;
    if (this.save.bag.length < BAG_SIZE) this.save.bag.push(it);
    this.afterGearChange();
  }

  debugSetHp(frac: number) {
    this.hp = Math.max(1, this.maxHp * frac);
  }

  /** Visual size of the hero (debug tuning; collisions and range stay the same). */
  heroScale = 1;
  debugSetHeroScale(s: number) {
    this.heroScale = THREE.MathUtils.clamp(Math.round(s * 100) / 100, 0.5, 3);
    this.hero.root.scale.setScalar(this.heroScale);
  }

  debugSetFov(fov: number) {
    this.camera.fov = THREE.MathUtils.clamp(Math.round(fov), 30, 90);
    this.camera.updateProjectionMatrix();
  }

  /** Visual size of all enemies, bosses included (debug tuning; hitboxes stay the same). */
  mobScale = 1;
  debugSetMobScale(s: number) {
    this.mobScale = THREE.MathUtils.clamp(Math.round(s * 100) / 100, 0.5, 3);
    for (const m of this.mobs) m.ch.root.scale.setScalar(this.mobScale);
  }

  /** Debug: every mob and prop dies at once, silently (no loot); spawners spend their next charge as usual. */
  debugKillAll() {
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u instanceof Mob) {
        this.endFight(u, 'reset');
        if (u.temp) { this.removeMob(u); continue; }
      }
      u.vanish();
      if (u.spawner) {
        [u.respawnTotal, u.chargesUsed] = this.useCharge(u.spawner);
        u.respawnAt = this.time + u.respawnTotal;
      } else if (u instanceof Mob && u.boss) {
        (this.save.bosses[u.def.id] ??= { firstKill: false, deadUntil: 0 }).deadUntil = Date.now() + u.def.respawn * 1000;
        u.respawnAt = this.time + u.def.respawn;
        u.respawnTotal = u.def.respawn;
      }
    }
    this.mobs = this.mobs.filter((m) => !m.removed);
    this.units = this.units.filter((u) => !(u instanceof Mob && u.removed));
    this.target = null;
    this.telegraphs.clear();
    this.ui.toast('Все мобы и пропсы уничтожены');
    this.persist();
  }

  /** Debug: all respawn timers and charge cycles start over — the dead come back now, every spawner from its 1st charge. */
  debugResetTimers() {
    this.save.spawners = {};
    for (const rec of Object.values(this.save.bosses)) rec.deadUntil = 0;
    for (const u of this.units) {
      u.chargesUsed = 0;
      if (!u.alive) u.respawnAt = this.time;
    }
    this.ui.toast('Таймеры спавнеров сброшены');
    this.persist();
  }

  /** Debug: every unit back at its spawn point with full HP; running cooldowns end (charge counters are kept). */
  debugRestoreAll() {
    for (const rec of Object.values(this.save.spawners ?? {})) rec.until = 0;
    for (const rec of Object.values(this.save.bosses)) rec.deadUntil = 0;
    for (const u of this.units) {
      if (u instanceof Mob) {
        if (u.temp) continue;
        this.endFight(u, 'reset');
      }
      u.respawn();
    }
    this.target = null;
    this.telegraphs.clear();
    this.ui.toast('Все мобы и пропсы восстановлены');
    this.persist();
  }

  debugKillNearby(radius = 14) {
    for (const m of this.mobs) if (m.alive && m.rise <= 0 && m.pos.distanceTo(this.hero.position) < radius) this.killMob(m);
  }

  /** 'camp' | 'forest' | 'boss1' | 'cemetery' | 'boss2'. Opens the barrier for the cemetery. */
  debugTeleport(where: string) {
    const b = this.world.bosses;
    const trail = (s: number) => { const p = pathAt(s); return near(p.x, p.z, 0); };
    const near = (x: number, z: number, d: number) => {
      const p = new THREE.Vector3(x + d, 0, z + d);
      this.world.collide(p, HERO.radius);
      return [p.x, p.z] as [number, number];
    };
    const spots: Record<string, [number, number]> = {
      camp: [SPAWN.x, SPAWN.z], forest: trail(progressAt(-38, -50)), boss1: near(b[0].x, b[0].z, 5),
      cemetery: trail(GATE.s + 7), boss2: near(b[1].x, b[1].z, 6),
    };
    const at = spots[where];
    if (!at) return;
    if (where === 'cemetery' || where === 'boss2') this.openGate('forest-cemetery', true);
    this.hero.position.set(at[0], 0, at[1]);
    this.camPos.copy(this.hero.position);
    this.target = null;
  }

  /** Debug: put the hero at (x, z) pushed out of obstacles; `gateId` is opened first so it can't block the spot. */
  debugTeleportTo(x: number, z: number, gateId?: string) {
    if (gateId) this.openGate(gateId, true);
    const p = new THREE.Vector3(x, 0, z);
    this.world.collide(p, HERO.radius);
    this.hero.position.set(p.x, 0, p.z);
    this.camPos.copy(this.hero.position);
    this.target = null;
  }

  /** Live numbers for the debug panel. */
  debugInfo() {
    const s = this.stats;
    return {
      hp: Math.ceil(this.hp), maxHp: this.maxHp, god: this.god, heroScale: this.heroScale, mobScale: this.mobScale, fov: this.camera.fov,
      crit: s.crit, critMul: s.critMul, dodge: s.dodge, speed: s.speed,
    };
  }

  persist() {
    if (this.world.fog.dirty) this.save.fog = this.world.fog.serialize();
    writeSave(this.save);
  }

  /** Debug: drop every barrier between locations. */
  debugOpenGates() {
    this.save.gatesOpen = true;
    this.world.openAllGates();
    sfx.barrier();
    this.ui.toast('Все ворота открыты');
    this.persist();
  }

  /** Debug: clear the whole fog of war, or bring it back (only the hero's current location stays open). */
  debugFog(clear: boolean) {
    if (clear) this.world.fog.revealAll();
    else { this.world.fog.reset([]); this.world.fog.reveal(this.hero.position.x, this.hero.position.z); }
    this.persist();
  }

  // ---------- balance log ----------
  private fightOf(m: Mob) {
    return (m.fight ??= { t0: this.time, dealt: 0, taken: 0, hits: 0, combos: 0, slams: 0, slamHits: 0, hpStart: this.hp });
  }

  private endFight(m: Mob, result: 'kill' | 'reset' | 'death') {
    const f = m.fight;
    if (!f) return;
    m.fight = null;
    logFight({
      // Depth-scaled mobs are logged as e.g. bandit_thug×1.5 (HP multiplier rounded to 0.5).
      t: this.save.playTime ?? 0, mob: m.maxHp > m.def.hp ? `${m.def.id}×${Math.round((m.maxHp / m.def.hp) * 2) / 2}` : m.def.id, boss: !!m.def.boss, result, dur: +(this.time - f.t0).toFixed(1),
      dealt: Math.round(f.dealt), taken: Math.round(f.taken), hits: f.hits, combos: f.combos, slams: f.slams, slamHits: f.slamHits,
      hpStart: Math.round(f.hpStart), hpEnd: Math.round(this.hp), maxHp: this.maxHp, power: Math.round(this.power),
    });
  }

  private snapshot() {
    const ttk: Record<string, number> = {};
    for (const d of Object.values(MOBS)) if (d.boss) ttk[d.id] = d.hp / Math.max(1, this.heroDps(d.resist));
    logSnap({
      t: Math.round(this.save.playTime ?? 0), zone: this.zone?.id ?? '?', power: this.power, maxHp: this.maxHp, regen: this.regen,
      kills: this.save.kills, deaths: heroDeaths(),
      weapon: this.save.weapons.filter((x): x is Item => !!x).map((x) => `${x.def} r${x.rarity} lv${x.lvl}${x.sharpen ? ` +${x.sharpen}` : ''}`).join(' + '), ttk,
    });
  }
}

/** A boss cone in flight (Telegraphs tag). */
interface ConeTag { boss: Mob; at: THREE.Vector3; yaw: number; half: number; len: number; mul: number }
/** A tower shot in flight (Telegraphs tag). */
interface ShotTag { at: THREE.Vector3; dmg: number; r: number }

const rndSort = () => Math.random() - 0.5;

/** Map / name colours of special mobs (an elite uses its drop's quality colour). */
const MARK_COLOR = { boss: '#ff3b3b', mini: '#ff9a2e', elite: '#ffffff' };

/** The block over a unit: loot on top, the HP bar under it, weakness / resistance icons right of the bar. */
function unitBar(loot: string, resist: string) {
  return `<div class="mloot">${loot}</div><div class="mrow"><div class="mobhp"><div></div><span></span></div><div class="ris">${resist}</div></div>`;
}

/** "+500 хп · +25 хп/с" */
function bonusText(b: Partial<Record<OrbKind, number>> | undefined) {
  const unit: Record<OrbKind, string> = { hp: 'хп', regen: 'хп/с', power: 'урон', speed: 'бег' };
  return Object.entries(b ?? {}).map(([k, v]) => `+${v} ${unit[k as OrbKind]}`).join(' · ');
}


function turn(cur: number, want: number, k: number) {
  const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  return cur + d * Math.min(1, k);
}


/** Swing timer and combo chain of one hand. */
interface Hand {
  i: 0 | 1; atkCd: number; impact: number; impactAt: number; combo: number; lastSwing: number; lastSwingHit: boolean; finisher: boolean;
}
function newHand(i: 0 | 1): Hand {
  return { i, atkCd: 0, impact: -1, impactAt: 0.3, combo: 0, lastSwing: -99, lastSwingHit: false, finisher: false };
}

/** How a blow landed: a crit, dodged, or plain (''). */
type HitFx = '' | 'crit' | 'miss';
