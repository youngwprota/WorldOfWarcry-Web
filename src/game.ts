import * as THREE from 'three';
import { Character } from './character';
import { Trail } from './swing';
import { Creature } from './creature';
import { BOSS_KITS, BOSS_PARTNERS } from './bosses';
import type { BossHost, BossKit } from './bosses/kit';
import {
  ATTACK_HIT, FACTIONS, PETS, tokenChance, START_PET, type PetDef, ZONE_TIER, HERO, VIEW, HIT_FREEZE, KILL_FX, LEASH, MOB_REGEN_DELAY, MOBS, ORBS, depthMul, mobImpact, RARITY, RESIST_MULT, STAFF_BOLT_SPEED, STAVES, WEAPONS,
  mobRank, zoneResist, ZONE_FOES, type DamageType, type ResistTier, type MobDef, type OrbKind, type StaffElement, type BossAnim, type BossDef, type SoulsDef, type StatId, type WeaponDef, type ZoneDef, type ZoneId, isPctStat,
} from './config';
import { ArenaFog, FloatingText, FogPuffs, Particles, Shockwaves, Spells, Telegraphs, type Bolt } from './fx';
import {
  ARMOR, BAG_SIZE, CLASS_SET, armorTrim, copyGain, dropIconId, dropItem, fixedRarity, itemClass, itemIcon, itemModel, itemName, sameItem, weaponDamage,
  type ArmorSlot, type Item, type VisualPart,
} from './items';
import { Input } from './input';
import { sfx } from './audio';
import { classKit, writeSave, type SaveData } from './save';
import { CLASSES, CLASS_IDS, SWITCH_COOLDOWN, archerBow, classSlot, kitOf, weaponClass, type HeroClass } from './party';
import { BODY_PARTS, CLASS_LOOK, debugSetTrims, type Wearer } from './looks';
import { assets } from './assets';
import { Arrows, type ArrowTarget } from './arrows';
import { PET_SEEK, Pet } from './pet';
import { GATE, GATES, ISLAND, SPAWN, inCamp, pathAt, progressAt } from './island';
import { BREAKABLES, World, makeBreakable, type BreakableDef, type SpawnGroup, type SpawnPoint } from './world';
import { MARK_COLOR, Unit, setChargeBars, unitBar } from './mobs/unit';
import { Mob } from './mobs/mob';
import { Spawn } from './mobs/spawn';
import { combatGoal } from './mobs/behavior';
import { Ambient } from './ambient';
import { UI, type FlyEl, type MapMark } from './ui';
import { art } from './art';
import { fmtK, lootHtml, resistIcons } from './icons';
import { heroDeaths, logFight, logSnap } from './balancelog';
import { addPct, addStat, armorMul, critAvg, critChance, critMul, dodgeChance, gearOf, guardMul, heroDps, heroStats, statBreakdown } from './balance';

/** Death's effects (souls, the ritual, the reap, its blows), teal like its skin, and the fog around them. */
const SOUL_GREEN = 0x4fe3c4;
const SOUL_FOG = 0x3fb89a;
/** Assassins' smoke bomb (MobDef.twin). */
const SMOKE = 0x3a3d48;
const SOUL_BARKS = ['Восстаньте, души!', 'Служите мне вечно!', 'Ваши кости — мои!'];
const releaseHold = (m: Mob, anim: BossAnim, impactIn: number) => { if (m.ch instanceof Character) m.ch.release(anim, impactIn); };
/** Debris colour of hits and kills: bone dust for skeletons and spirits, blood for the rest. */
const bloodColor = (m: Mob) => m.def.id.startsWith('skel') || m.def.id === 'ghost' || m.def.id === 'death' ? 0xd8d4c8 : 0xc0392b;
/** Screen px between the icons of one kill's drops, before the HUD scale. */
const DROP_GAP = 56;
/** White-yellow sparks of a non-lethal hit (blood is for the kill). */
const HIT_SPARK = 0xfff3a8;


const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
/** Slack over the weapon's range for a hit to land (unit edge to hero centre); targeting and swings use the same. */
const STRIKE_PAD = 0.35;
/** Gate cutscene timing, s: after the boss's death, camera flight each way, hold at the gate. */
const GATE_CUT = { wait: 1.4, fly: 1.6, hold: 2.8, past: 8 };


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
    this.maxHp = this.hp = def.hp;
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
  /**
   * Units that count toward clearing each location (the top bar): its spawner mobs (static ones like the forest
   * trees too), elites, mini-bosses and main boss; not grave risers or boss summons (no spawner, no boss).
   */
  private clearOf = new Map<ZoneId, Mob[]>();
  private fx: FloatingText;
  private particles: Particles;
  private arrows: Arrows;
  /** What mob projectiles fly at: the hero, unhittable while dead. */
  private heroMark: ArrowTarget;
  /** The hunter's pet while he is on the field. */
  private pet: Pet | null = null;
  private telegraphs: Telegraphs;
  private waves: Shockwaves;
  private spells: Spells;
  /** Ice staff: the mob hit in a row and the hits on it toward the freeze; wind staff: landed swings toward the orb. */
  private iceMob: Mob | null = null;
  private iceN = 0;
  private windN = 0;
  /** Wind orbs in flight (pooled: `it` null = free): where they land, seconds left, the staff that threw them. */
  private gusts: { at: THREE.Vector3; t: number; it: Item | null }[] = [];
  private puffs: FogPuffs;
  /** Pollen, wisps, snow, fireflies… in the air round the hero (src/ambient.ts). */
  private ambient = new Ambient();
  /** Drawing-buffer height in pixels (set by main.ts; ambient point sizes). */
  viewH = 1600;
  /** Fog ring around each Death-like boss's arena (BossDef.souls), shown while it fights. */
  private arenas = new Map<Mob, ArenaFog>();
  /** Attack state per hand (save.weapons[0] right, [1] left). */
  private hands: [Hand, Hand] = [newHand(0), newHand(1)];
  private trails: [Trail, Trail] = [new Trail(), new Trail()];
  /** Hit-stop / slow motion: game time runs at `slowK` for `slowT` more real seconds. */
  private slowT = 0;
  private slowK = 1;
  /** Boss kits (src/bosses), one per boss mob, made on its first fight. */
  private kits = new Map<Mob, BossKit | null>();
  /** Hero run speed multiplier set by boss kits for the next frame (BossHost.slowHero). */
  private heroSlow = 1;
  /** Short-lived obstacles from boss kits (BossHost.addBlocker). */
  private blockers: { x: number; z: number; r: number; until: number }[] = [];
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
  /** Index of the named area (World.areas) the hero is in, -1 none. */
  private area = -1;
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
    this.camera = new THREE.PerspectiveCamera(VIEW.fov, 9 / 16, 0.5, 90);
    this.scene.fog = new THREE.FogExp2(0xbfe0f5, 0.015);
    // A cool sky fill and a strong warm sun: shadows read as blue-ish shade, lit sides glow (zone colours: ZONES.hemi).
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 1.45);
    this.sun = new THREE.DirectionalLight(0xffe6c0, 3.3);
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

    this.wearKit(kitOf(this.heroClass));
    this.wearGear(this.heroClass);
    this.hero = new Character(this.heroModel(), null, 1);
    this.hero.root.scale.setScalar(this.heroScale);
    this.dressHero();
    this.hero.setHighlight(true);
    this.hero.position.set(SPAWN.x, 0, SPAWN.z);
    this.hero.facing = Math.PI;
    this.scene.add(this.hero.root);
    this.heroMark = { pos: this.hero.position, radius: HERO.radius, hittable: true };
    for (const t of this.trails) this.scene.add(t.mesh);
    this.hp = this.maxHp;

    const spawns = new Map<SpawnGroup, Spawn>();
    for (const s of this.world.spawns) {
      const u = s.unit === 'mob' ? this.addMob(MOBS[s.kind], new THREE.Vector3(s.x, 0, s.z), labels, s.depth, s.behavior) : this.addProp(s, labels);
      if (u instanceof Mob && u.passive) u.ch.facing = s.rot;
      let sp = spawns.get(s.group);
      if (!sp) spawns.set(s.group, sp = new Spawn(s.group));
      sp.units.push(u);
      u.spawner = sp;
    }
    for (const sp of spawns.values()) {
      // a cooldown still running from an earlier session
      const rec = save.spawners?.[sp.def.id];
      if (!rec || rec.until <= Date.now()) continue;
      const left = (rec.until - Date.now()) / 1000;
      const ch = sp.def.charges;
      for (const u of sp.units) {
        u.vanish();
        u.respawnAt = this.time + left;
        u.respawnTotal = ch[(rec.n + ch.length - 1) % ch.length] || left;
        u.chargesUsed = rec.n || ch.length;
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

    for (const m of this.mobs) {
      if (!m.spawner && !m.def.boss) continue;
      const zone = m.spawner?.def.zone ?? this.world.zoneAt(m.spawn.x, m.spawn.z).id;
      if (!this.clearOf.has(zone)) this.clearOf.set(zone, []);
      this.clearOf.get(zone)!.push(m);
    }

    this.fx = new FloatingText(labels, this.camera);
    const hb = document.createElement('div');
    hb.className = 'herohp';
    hb.innerHTML = '<div class="fill"></div><span></span>';
    labels.appendChild(hb);
    this.heroBar = { el: hb, fill: hb.querySelector('.fill')!, text: hb.querySelector('span')! };
    this.particles = new Particles(this.scene);
    this.arrows = new Arrows(this.scene);
    this.telegraphs = new Telegraphs(this.scene);
    this.ui.onFlyEnd = this.flyEnd;
    this.waves = new Shockwaves(this.scene);
    this.spells = new Spells(this.scene);
    this.syncPet();
    this.puffs = new FogPuffs(this.scene);
    this.scene.add(this.ambient.points);
    // (no camp NPC by the gate for now: src/npc.ts CampNpc is kept for later)
    this.camPos.copy(this.hero.position);
    this.ui.lockClasses((c) => !this.classOpen(c));
    this.refreshHud(true);
  }

  private addMob(def: MobDef, at: THREE.Vector3, labels: HTMLElement, depth = 0, behavior?: SpawnPoint['behavior']) {
    const zone = this.world.zoneAt(at.x, at.z).id;
    def = this.zoneDef(def, zone);
    const mul = def.boss || def.rank ? { hp: 1, dmg: 1, reward: 1, scale: 1 } : depthMul(zone, depth);
    const tier = ZONE_TIER[zone] ?? 1;
    const items = [this.dropBadge(def), ...(def.moreDrops ?? []).map((d) => ({ icon: dropIconId(d), color: RARITY[d.rarity].color }))];
    const m = new Mob(def, at, this.save.faction, labels, { ...mul, hp: mul.hp * tier, dmg: mul.dmg * tier }, behavior, items.filter((b) => !!b));
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
  /** The active hero: item icons show what this hero would wear. */
  get wearer(): Wearer { return { cls: this.heroClass, faction: this.faction }; }

  /** A mob def with the resistances of where it stands (ZONE_FOES): the boss its own, every other Snow Pass mob the alt one. */
  private zoneDef(def: MobDef, zone: ZoneId) {
    if (def.static) return def;
    const z = def.boss?.zone ?? zone;
    const kind = def.boss ? 'boss' as const : ZONE_FOES[z]?.alt && this.altN++ % 2 ? 'alt' as const : 'mob' as const;
    const key = `${def.id}|${z}|${kind}`;
    let out = this.zoneDefs.get(key);
    if (!out) this.zoneDefs.set(key, (out = { ...def, resist: zoneResist(z, kind) }));
    return out;
  }
  private zoneDefs = new Map<string, MobDef>();
  private altN = 0;

  /** What a mob is shown to drop: the class its boss opens (the bow over the forest boss), or its item's own icon. */
  private dropBadge(d: MobDef): DropBadge | null {
    const cls = d.boss?.unlockClass;
    if (cls) return { icon: CLASSES[cls].icon, color: CLASSES[cls].color[0] };
    return d.drop ? { icon: dropIconId(d.drop), color: RARITY[d.drop.rarity].color } : null;
  }

  /** The class can take the field: it is not closed (ClassDef.locked) or a boss has opened it. */
  classOpen(c: HeroClass) { return !CLASSES[c].locked || !!this.save.classes?.includes(c); }

  /** Opens closed class `c` for good (saved); false if it was open already. */
  private openClass(c: HeroClass) {
    if (this.classOpen(c)) return false;
    (this.save.classes ??= []).push(c);
    this.ui.lockClasses((k) => !this.classOpen(k));
    return true;
  }

  /** Puts another party member on the field; false while the switch cooldown runs, if it is already there or closed. */
  switchClass(c: HeroClass) {
    if (!this.classOpen(c)) { if (c !== this.heroClass) this.ui.toast(`«${CLASSES[c].name}» пока недоступен`, 1200); return false; }
    if (c === this.heroClass || this.dead || this.time - this.classT < SWITCH_COOLDOWN) return false;
    this.classT = this.time;
    const model = this.heroModel();
    const bag = this.save.bag.length;
    this.save.cls = c;
    this.wearKit(kitOf(c));
    this.wearGear(c);
    // a class's first time on the field may put its extra start items into the bag (classKit)
    this.newItems += this.save.bag.length - bag;
    if (this.heroModel() !== model) this.rebuildHero();
    this.syncPet();
    this.target = null;
    this.particles.burst(this.hero.position.clone().setY(1), new THREE.Color(CLASSES[c].color[0]).getHex(), 18, 0.14, 4, 0.6);
    this.ui.toast(CLASSES[c].name, 1200);
    this.onClassChange(c);
    this.afterGearChange(); // weapons in hand, stats, hands, save, HUD
    return true;
  }

  /** Hero model of the class on the field. */
  heroModel() { return CLASSES[this.heroClass].model?.[this.faction] ?? FACTIONS[this.faction].hero; }

  /** Puts kit `k`'s weapons into the hands (SaveData.kits); a kit never worn starts with its class kit (ClassDef.kit). */
  private wearKit(k: HeroClass) {
    const cur = this.save.kit ?? 'warrior';
    if (cur === k) return;
    const kits = (this.save.kits ??= {});
    kits[cur] = this.save.weapons;
    this.save.weapons = kits[k] ?? classKit(this.save, k);
    delete kits[k];
    this.save.kit = k;
  }

  /** Puts class `c`'s armour on (SaveData.gear): every party member wears his own; a new one starts bare. */
  private wearGear(c: HeroClass) {
    const cur = this.save.gearOf ?? 'warrior';
    if (cur === c) return;
    const gear = (this.save.gear ??= {});
    gear[cur] = this.save.equip;
    this.save.equip = gear[c] ?? {};
    delete gear[c];
    this.save.gearOf = c;
  }

  /** A new hero character for the class model, in the old one's place. */
  private rebuildHero() {
    const old = this.hero;
    const ch = new Character(this.heroModel(), null, 1);
    ch.position.copy(old.position);
    ch.facing = old.facing;
    ch.root.scale.setScalar(this.heroScale);
    old.dispose();
    this.hero = ch;
    ch.setHighlight(true);
    this.scene.add(ch.root);
  }

  /** The class on the field may use the item: weapons by its gear lists (a class without them borrows the warrior's), armour by items.ts itemClass. */
  canUse(it: Item) {
    if (it.kind === 'weapon') return classSlot(this.heroClass, it.def) !== null;
    const c = itemClass(it);
    return !c || c === this.heroClass;
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
    // a debug set (Game.debugSet) shows the equipped weapons at the set's quality
    const r = this.debugLooks[this.heroClass];
    const m = (it: Item | null) => (it ? itemModel(r >= 0 ? { ...it, rarity: r } : it, this.faction) : null);
    // the mage's orb is not held: it floats over the shoulder (Character.setOrb)
    const left = this.save.weapons[1];
    return [m(this.save.weapons[0]), left && WEAPONS[left.def].orb ? null : m(left)];
  }

  /** Weapon models as the hero holds them, [right hand, left hand]: the bow goes into the left hand while that one is free. */
  heldModels(): [string | null, string | null] {
    let [r, l] = this.handModels();
    const main = this.save.weapons[0];
    const bow = this.setBow();
    if (main?.def === 'bow' && bow && assets.has(bow)) r = bow;
    return main && WEAPONS[main.def].leftHand && !l ? [null, r] : [r, l];
  }

  /** The main weapon goes into the left hand: the mage's staff (MagicAttack casts with it). */
  staffInHand() { const w = this.save.weapons[0]; return !!w && !!WEAPONS[w.def].staff; }

  /** Model of the mage's orb floating over the shoulder, or null. */
  /** Bonuses of the equipped mage orb (WeaponDef.orb). */
  private get orb() { const o = this.save.weapons[1]; return o ? WEAPONS[o.def].orb : undefined; }
  orbModel() { const o = this.save.weapons[1]; return o && WEAPONS[o.def].orb ? WEAPONS[o.def].model[this.faction] : null; }

  /** The hunter in a debug set draws the set's bow. */
  private setBow() { const r = this.debugLooks.hunter; return this.heroClass === 'hunter' && r >= 0 ? archerBow(r, this.bowV1) : null; }

  /** Weapons, armour parts and quality pieces on the hero; parts still loading follow (loadOutfit). */
  private dressHero() {
    this.equipVisual();
    this.hero.setOutfit(this.outfit());
    this.hero.setTrims(this.trims());
    void this.loadOutfit();
  }

  private equipVisual() {
    this.hero.setWeapon(...this.heldModels(), this.staffInHand());
    this.hero.setOrb(this.orbModel());
  }

  /** Mage spells leave the free right hand (the staff is in the left one), or the chest without a hand bone. */
  private castPoint(out: THREE.Vector3) {
    const h = this.hero.handR;
    return h ? h.getWorldPosition(out) : out.copy(this.hero.position).setY(1.4);
  }

  /** Body parts borrowed from other characters for the equipped armour. */
  outfit(): Partial<Record<VisualPart, string>> {
    const o = this.wantedOutfit();
    for (const part of Object.keys(o) as VisualPart[]) if (!assets.has(o[part]!)) delete o[part]; // still loading
    return o;
  }

  private outfitLoad = 0;
  /** Loads the parts of the outfit that come on demand (class sets, the set bow), then dresses the hero in them. */
  private async loadOutfit() {
    const need = [...Object.values(this.wantedOutfit()), this.setBow()].filter((n): n is string => !!n && !assets.has(n));
    if (!need.length) return;
    const token = ++this.outfitLoad;
    await assets.ensure(need);
    if (token !== this.outfitLoad) return; // a later change won
    this.equipVisual();
    this.hero.setOutfit(this.outfit());
  }

  private wantedOutfit(): Partial<Record<VisualPart, string>> {
    const look = CLASS_LOOK[this.heroClass];
    const r = this.debugLooks[this.heroClass];
    if (r >= 0) return look.set(this.faction, r);
    const o: Partial<Record<VisualPart, string>> = {};
    for (const part of BODY_PARTS) {
      const it = this.save.equip[part];
      const src = it && look.part(this.faction, it, part);
      if (src) o[part] = src;
    }
    return o;
  }

  /** Quality pieces of the equipped armour (armorTrim). */
  trims(): string[] {
    if (!CLASS_LOOK[this.heroClass].trims) return [];
    const r = this.debugLooks[this.heroClass];
    if (r >= 0) return debugSetTrims(this.faction, r);
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
    if (this.cut) this.updateCut(dt);
    else {
      if (this.input.pressed('KeyI') || this.input.pressed('KeyC')) { this.onOpenCharacter(); return; }
      if (this.input.pressed('KeyB')) { this.onOpenBag(); return; }
      if (this.input.pressed('KeyM')) { this.onOpenMap(); return; }
      if (this.input.pressed('KeyG')) { this.onOpenGacha(); return; }
      for (const c of CLASS_IDS) if (this.input.pressed(CLASSES[c].key)) this.switchClass(c);
    }
    if (this.blockers.some((b) => b.until <= this.time)) this.blockers = this.blockers.filter((b) => b.until > this.time);
    this.updateHero(dt);
    this.updateMobs(dt);
    this.updatePet(dt);
    this.updateProps(dt);
    this.updateRespawns();
    this.telegraphs.update(dt);
    this.particles.update(dt);
    this.arrows.update(dt);
    this.waves.update(dt);
    this.updateGusts(dt);
    this.world.fog.update(dt);
    this.spells.update(dt);
    this.puffs.update(dt);
    for (const a of this.arenas.values()) a.update(dt, this.time);
    this.world.update(dt, this.time, this.hero.position);
    this.ambient.update(this.time, this.hero.position, this.viewH);
    this.render(dt);
    this.saveT += dt;
    if (this.saveT > 5) { this.saveT = 0; this.persist(); }
  }

  /** Gate cutscene (startGateCut): `t` from −GATE_CUT.wait; the camera looks at `cutPos` while it runs. */
  private cut: { t: number; at: THREE.Vector3; gates: string[]; opened: boolean; then: (() => void) | null } | null = null;
  private cutPos = new THREE.Vector3();

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
    // Camera is pinned to the hero's feet (no follow lag); the gate cutscene moves it.
    this.camPos.copy(this.cut && this.cut.t >= 0 ? this.cutPos : hp);
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
    // lowish afternoon sun from the front left: longer shadows give the scene depth, faces toward the camera stay lit
    this.sun.position.set(this.camPos.x - 15, 25, this.camPos.z + 9);
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
    this.ui.minimap(this.hero.position, this.hero.facing, this.mapDots(45), this.world, this.mapMarks(45));
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
    const [ix, iy] = this.cut ? [0, 0] : this.input.vector;
    const moving = Math.hypot(ix, iy) > 0.05;
    this.moveDir.set(ix, 0, iy);
    const p = ch.position;
    const speed = this.speed * this.heroSlow;
    this.heroSlow = 1;
    if (moving) {
      p.addScaledVector(this.moveDir, speed * dt);
      ch.walkRate = Math.min(2.4, (speed * this.moveDir.length()) / 2.1);
    }
    if (this.heroKnock.lengthSq() > 0.001) {
      p.addScaledVector(this.heroKnock, dt);
      this.heroKnock.multiplyScalar(Math.max(0, 1 - dt * 9));
    }
    // soft push from living mobs
    for (const m of this.mobs) {
      if (!m.alive || !m.awake || m.rise > 0 || m.ritual > 0 || m.passable) continue;
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
    this.collideBlockers(p, HERO.radius);

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
    // named areas inside a location (cemetery village, chapel…): the name on stepping in
    let area = -1;
    for (let i = 0; i < this.world.areas.length; i++) {
      const A = this.world.areas[i];
      if ((A.x - p.x) ** 2 + (A.z - p.z) ** 2 < A.r * A.r) { area = i; break; }
    }
    if (area !== this.area) {
      this.area = area;
      if (area >= 0) this.ui.toast(this.world.areas[area].name, 1800);
    }

    ch.update(dt, moving);
    // blade trails from a bit before the blow to a bit after it
    for (const h of this.hands) {
      const it = this.save.weapons[h.i];
      const since = this.time - h.lastSwing;
      // no trail for the shield and the orb (they never swing) or the bow (it shoots)
      const w = it && WEAPONS[it.def];
      const on = !!w && !w.guard && !w.orb && !w.shot && since > h.impactAt * 0.45 && since < h.impactAt * 1.5;
      this.trails[h.i].update(dt, h.i ? ch.weaponL : ch.weapon, on, 0xffffff);
    }
  }

  /** Longest reach of the two hands. */
  private reach() {
    let r = 0;
    for (const it of this.save.weapons) if (it) r = Math.max(r, WEAPONS[it.def].range);
    return r;
  }

  /** One hand's swing timer; the blow lands `impact` s after the swing starts. */
  private updateHand(h: Hand, dt: number) {
    const it = this.save.weapons[h.i];
    if (!it) { h.combo = 0; h.impact = -1; return; }
    const w = WEAPONS[it.def];
    // the shield never swings, it only answers blows (shieldAnswer); the mage's orb never swings either
    if (w.guard || w.orb) { h.combo = 0; return; }
    h.atkCd -= dt;
    const period = 1 / w.aps;
    // Swing only when the target is inside the strike shape (inShape's range + 0.35): the target is kept
    // up to 1 m further for facing, and swinging there was a whiff into thin air.
    const t = this.target;
    const inReach = !!t && this.inStrike(t, w.range);
    if (inReach && h.atkCd <= 0) {
      h.combo++;
      h.lastSwing = this.time;
      // the cast clip's release is late (1.13 s), so staves aren't capped: a cap would play it 3-5x too fast
      const impactAt = w.staff ? period * 0.4 : Math.min(0.42, period * 0.4);
      h.impactAt = impactAt;
      h.launch = -1;
      if (w.staff) {
        h.launch = impactAt;
        // capped so the hit lands before the next swing resets h.impact
        h.flight = Math.min(t!.pos.distanceTo(this.hero.position) / STAFF_BOLT_SPEED, period * 0.5);
      }
      if (w.shot) {
        // the bow arm points at the target, the other one draws the string
        this.hero.swing('aim', 1, period, impactAt);
        this.hero.swing('draw', 0, period, impactAt);
      } else if (w.swing) this.hero.swing(w.swing[(h.combo - 1) % w.swing.length], h.i, period, impactAt);
      else this.hero.attack(w.anim, period, impactAt);
      h.impact = h.launch >= 0 ? impactAt + h.flight : impactAt;
      h.atkCd = period;
    }
    if (h.launch >= 0) {
      h.launch -= dt;
      if (h.launch < 0 && w.staff && t) { h.bolt = this.spells.bolt(this.castPoint(v1), t.pos, h.flight, STAVES[w.staff].bolt); h.aim = t; }
    }
    // the mob left the staff's reach: the bolt fizzles and the hit is lost
    if (h.bolt && h.impact >= 0 && !this.inStrike(h.aim!, w.range)) {
      this.spells.drop(h.bolt);
      h.impact = -1;
    }
    if (h.impact >= 0) {
      h.impact -= dt;
      if (h.impact < 0) this.heroStrike(h);
      if (h.impact < 0) { h.bolt = null; h.aim = null; }
    }
  }

  /** A blow on mob `def`: it may dodge (dmg 0, `fx` 'miss') or take a crit (`fx` 'crit'). */
  private damageFor(it: Item, def: Pick<MobDef, 'resist' | 'dodge'>, mult = 1) {
    const tier = def.resist[WEAPONS[it.def].type] ?? 'normal';
    if (Math.random() < dodgeChance(def.dodge)) return { dmg: 0, tier, fx: 'miss' as HitFx };
    const s = this.stats;
    const crit = Math.random() < s.crit;
    const roll = this.orb?.critDmg;
    const critMul = s.critMul + (roll ? roll[0] + Math.random() * (roll[1] - roll[0]) : 0);
    const dmg = this.itemDamage(it) * RESIST_MULT[tier] * mult * (crit ? critMul : 1) * (0.9 + Math.random() * 0.2);
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
    if (w.shot) return this.shoot(it, w);
    const { shape, arc, range } = w;
    let hits = 0;
    const only = w.single ? focus : null;
    sfx.swing();
    for (const u of this.units) {
      if (only && u !== only) continue;
      if (!u.hittable || !this.inShape(u.pos, u.radius, shape, arc, range, 0, yaw)) continue;
      hits++;
      if (u instanceof Prop) {
        const { dmg, tier } = this.damageFor(it, u.def);
        this.hitProp(u, dmg, tier);
        continue;
      }
      const m = u as Mob;
      const { dmg, tier, fx } = this.damageFor(it, m.def);
      this.fightOf(m).hits++;
      this.damageMob(m, dmg, tier, w.staff ? STAVES[w.staff].knock : 3.5, fx);
      if (w.staff && fx !== 'miss') this.staffHit(m, w.staff, dmg, m === focus);
      if (m.alive && !m.def.boss && w.stun && Math.random() < w.stun) m.stun = 0.9;
    }
    if (w.staff === 'fire' && hits && focus) this.fireSplash(it, focus, shape, arc, range, yaw);
    if (w.staff === 'wind' && hits) {
      this.windN = (this.windN + 1) % STAVES.wind.orb.every;
      if (this.windN === 0) this.throwGust(it, focus?.alive ? focus.pos : v1.copy(this.hero.position).addScaledVector(v2.set(Math.sin(yaw), 0, Math.cos(yaw)), range));
      this.showCharge();
    }
    if (w.shape === 'circle' && hits) {
      this.shake = Math.max(this.shake, 0.18);
      this.particles.burst(v1.copy(this.hero.position).setY(0.2), 0x9a8a70, 8, 0.12, 5, 0.5);
    }
    return hits;
  }

  /** A staff blow landed on `m` (`primary`: the target): the element's burst and effects. */
  private staffHit(m: Mob, el: StaffElement, dmg: number, primary: boolean) {
    this.particles.burst(v2.copy(m.pos).setY(1.1 * m.def.scale), STAVES[el].color, 5, 0.08, 4, 0.4);
    if (!m.alive) return;
    if (el === 'fire') {
      const b = STAVES.fire.burn;
      if (m.burn <= 0) m.burnTick = b.tick;
      m.burn = b.time;
      m.burnDps = dmg * b.dps;
    } else if (el === 'ice') {
      m.slow = STAVES.ice.slow.time;
      if (primary) this.iceHit(m);
    }
  }

  /** Ice staff: every `freeze.every`-th hit in a row on the same mob freezes it (micro-bosses and bosses only slow). */
  private iceHit(m: Mob) {
    const f = STAVES.ice.freeze;
    if (this.iceMob !== m) { this.iceMob = m; this.iceN = 0; }
    this.iceN = (this.iceN + 1) % f.every;
    const rank = mobRank(m.def);
    if (this.iceN === 0 && rank !== 'mini' && rank !== 'boss') {
      m.frozen = f.time;
      m.stun = Math.max(m.stun, f.time);
      m.setChill(2);
      this.particles.burst(v2.copy(m.pos).setY(0.8 * m.def.scale), 0xe8fbff, 12, 0.12, 4, 0.7);
      this.fx.spawn(this.unitTextAt(m, v1).setY(m.barY + 0.4), 'Заморожен!', 'dmg small', 0.9, { color: '#9fe6ff' });
    }
    this.showCharge();
  }

  /** Fire staff: mobs around the target outside the blow's own shape take the splash (and burn). */
  private fireSplash(it: Item, focus: Unit, shape: 'arc' | 'circle', arc: number, range: number, yaw: number) {
    const sp = STAVES.fire.splash;
    this.waves.add(focus.pos, sp.radius, STAVES.fire.color, 0.3);
    for (const m of this.mobs) {
      if (m === focus || !m.hittable || m.pos.distanceTo(focus.pos) - m.radius > sp.radius) continue;
      if (this.inShape(m.pos, m.radius, shape, arc, range, 0, yaw)) continue;
      const { dmg, tier, fx } = this.damageFor(it, m.def, sp.mul);
      this.damageMob(m, dmg, tier, STAVES.fire.knock, fx);
      if (fx !== 'miss') this.staffHit(m, 'fire', dmg, false);
    }
  }

  /** Wind staff: an orb flies at `at` and bursts there when it lands (updateGusts). */
  private throwGust(it: Item, at: THREE.Vector3) {
    const o = STAVES.wind.orb;
    let g = this.gusts.find((x) => !x.it);
    if (!g) { g = { at: new THREE.Vector3(), t: 0, it: null }; this.gusts.push(g); }
    g.it = it;
    g.t = o.flight;
    g.at.set(at.x, 0, at.z);
    this.spells.bolt(this.castPoint(v2), g.at, o.flight, STAVES.wind.bolt, 0.32);
  }

  private updateGusts(dt: number) {
    const o = STAVES.wind.orb;
    for (const g of this.gusts) {
      if (!g.it) continue;
      g.t -= dt;
      if (g.t > 0) continue;
      const it = g.it;
      g.it = null;
      this.spells.swirl(g.at, o.radius, 0.7, STAVES.wind.color);
      this.waves.add(g.at, o.radius, STAVES.wind.color, 0.4);
      for (const m of this.mobs) {
        if (!m.hittable || m.passive || m.pos.distanceTo(g.at) - m.radius > o.radius) continue;
        const { dmg, tier, fx } = this.damageFor(it, m.def, o.dmg);
        this.damageMob(m, dmg, tier, 0, fx);
        if (!m.alive) continue;
        // knockback slides 1/9 of its speed (see reapPull): pulls `force` of the way to the centre, bosses too
        m.knock.set(g.at.x - m.pos.x, 0, g.at.z - m.pos.z).multiplyScalar(9 * o.force);
      }
    }
  }

  /** Burning, slowed, frozen: timers, burn ticks, flames and the ice tint. */
  private updateStatus(m: Mob, dt: number) {
    if (m.burn > 0) {
      const b = STAVES.fire.burn;
      m.burn -= dt;
      m.burnTick -= dt;
      if (m.ch.root.visible && Math.random() < dt * 10) this.spells.flame(v2.copy(m.pos).setY(0.5 * m.def.scale), STAVES.fire.color);
      if (m.burnTick <= 0) {
        m.burnTick += b.tick;
        this.burnMob(m, Math.max(1, Math.round(m.burnDps * b.tick * (1 + b.vuln))));
      }
    }
    m.slow = Math.max(0, m.slow - dt);
    m.frozen = Math.max(0, m.frozen - dt);
    m.setChill(m.frozen > 0 ? 2 : m.slow > 0 ? 1 : 0);
  }

  /** A burn tick: no flash, no knockback, a small orange number. */
  private burnMob(m: Mob, dmg: number) {
    this.fightOf(m).dealt += Math.min(dmg, m.hp);
    m.hp -= dmg;
    m.hurtAt = this.time;
    this.fx.spawn(this.unitTextAt(m), `-${fmtK(dmg)}`, 'dmg small', 0.6, { lift: m.uiEl.offsetHeight, color: '#ff9a4a' });
    if (m.hp <= 0) this.killMob(m);
  }

  /** Staff counter on the party button: ice hits toward the freeze, wind swings toward the orb. */
  private showCharge() {
    const el = this.weapon.staff;
    const n = el === 'ice' ? this.iceN : el === 'wind' ? this.windN : -1;
    this.ui.party(this.heroClass, n < 0 ? '' : String(n), el ? '#' + STAVES[el].color.toString(16).padStart(6, '0') : '');
  }

  /** Bow: looses an arrow at the target; the damage lands when it arrives (arrowHit). Returns the number of arrows. */
  private shoot(it: Item, w: WeaponDef) {
    const shot = w.shot!;
    const u = this.target && this.target.hittable && this.inStrike(this.target, w.range) ? this.target : null;
    if (!u) return 0;
    sfx.swing();
    const yaw = this.hero.facing;
    const from = v1.copy(this.hero.position).add(v2.set(Math.sin(yaw) * 0.6, 1.35, Math.cos(yaw) * 0.6));
    this.arrows.fire(shot.arrow[this.faction], from, u, shot.speed, () => this.arrowHit(u, it));
    return 1;
  }

  /** A bow arrow reaches its unit. */
  private arrowHit(u: Unit, it: Item) {
    if (u instanceof Prop) {
      const { dmg, tier } = this.damageFor(it, u.def);
      this.hitProp(u, dmg, tier);
      return;
    }
    const m = u as Mob;
    const { dmg, tier, fx } = this.damageFor(it, m.def);
    this.fightOf(m).hits++;
    this.damageMob(m, dmg, tier, 1.5, fx);
  }

  /** The pet in the class's second slot (the hunter's), or null. */
  get petDef(): PetDef | null { return CLASSES[this.heroClass].pet ? PETS[this.save.pet ?? START_PET] : null; }

  /** Puts the class's pet on the field (or takes it away). */
  private syncPet() {
    const def = this.petDef;
    if (this.pet?.def === def) return;
    this.pet?.dispose();
    this.pet = def ? new Pet(def, this.scene) : null;
    this.pet?.place(this.hero.position, this.hero.facing);
  }

  /** The pet goes for the hero's target if it is a mob, else for the nearest mob fighting near the hero. */
  private updatePet(dt: number) {
    const pet = this.pet;
    if (!pet) return;
    const hp = this.hero.position;
    pet.update(dt, hp, this.hero.facing, () => {
      if (this.dead) return null;
      if (this.target instanceof Mob && this.target.hittable) return this.target;
      let best: Mob | null = null;
      let bd = PET_SEEK;
      for (const m of this.mobs) {
        if (!m.hittable || m.passive || m.state === 'idle') continue;
        const d = m.pos.distanceTo(hp);
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    }, (foe) => {
      const m = foe as Mob;
      const it = this.weaponItem;
      const tier = m.def.resist[pet.def.type] ?? 'normal';
      const dmg = Math.max(1, Math.round(this.itemDamage(it) * pet.def.dmg * RESIST_MULT[tier] * (0.9 + Math.random() * 0.2)));
      this.fightOf(m).hits++;
      // only extra damage: mobs never turn on the pet, the bite does not wake or shove them
      this.damageMob(m, dmg, tier, 0, '', false);
    });
  }

  /** `fx`: 'crit' shows a bigger number, 'miss' (or no damage at all) — the mob dodged. */
  /** `aggro` false: plain extra damage (the pet's bites) — the mob keeps doing what it did and is not knocked back. */
  private damageMob(m: Mob, dmg: number, tier: string, knock = 3.5, fx: HitFx = '', aggro = true) {
    if (fx === 'miss' || dmg <= 0) {
      m.state = m.state === 'return' ? 'return' : 'chase';
      this.fx.spawn(this.unitTextAt(m), 'Промах', 'dmg resist', 0.7, { lift: m.uiEl.offsetHeight });
      return;
    }
    if (m.burn > 0) dmg = Math.round(dmg * (1 + STAVES.fire.burn.vuln));
    const kit = this.kitOf(BOSS_KITS[m.def.id] ? m : m.owner);
    if (kit?.damageTaken) {
      dmg = Math.round(kit.damageTaken(m, dmg, fx === 'crit'));
      // the kit shows its own text for a blocked hit
      if (dmg <= 0) { m.state = m.state === 'return' ? 'return' : 'chase'; return; }
    }
    this.fightOf(m).dealt += Math.min(dmg, m.hp);
    m.hp -= dmg;
    m.hurtAt = this.time;
    if (m.def.twin && !m.twinned && !m.twinOf && m.hp > 0 && m.hp < m.maxHp * m.def.twin) this.callTwin(m);
    m.ch.hit();
    if (aggro) m.state = m.state === 'return' ? 'return' : 'chase';
    if (aggro && (!m.def.boss || this.kitOf(m)?.knockable) && !m.passive) m.knock.set(m.pos.x - this.hero.position.x, 0, m.pos.z - this.hero.position.z).normalize().multiplyScalar(knock);
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
      const kit = this.kitOf(m);
      if (kit) { kit.died?.(); this.despawnMinions(m); }
      // elites: their own item on every kill (spawner charges limit the farming)
      if (d.drop) m.loot.push(dropItem(d.drop));
      if (m.temp) m.respawnAt = Infinity;
    }
    this.grantKillRewards(m);
  }

  /** Right on the kill: stat orbs, items, a micro-boss's bonus, the gacha pull. */
  private grantKillRewards(m: Mob) {
    this.payRewards(m);
    const chance = tokenChance(mobRank(m.def), this.world.zoneAt(m.spawn.x, m.spawn.z).id);
    const pull = !m.owner && Math.random() < 1 - (1 - chance) * (1 - (this.orb?.pull ?? 0));
    const n = m.loot.length + (pull ? 1 : 0);
    m.loot.forEach((it, i) => this.flyDrop(m.pos, i, n, itemIcon(it, 44, this.wearer), RARITY[it.rarity].color, 'btn-bag', it));
    m.loot = [];
    if (m.def.bonus) this.grantBonus(m);
    if (pull) this.grantPull(m, n - 1, n);
    if (m.def.boss) this.persist();
  }

  /** A kill dropped a gacha pull. */
  private grantPull(m: Mob, slot: number, count: number) {
    this.save.pulls = (this.save.pulls ?? 0) + 1;
    this.fx.spawn(v1.copy(m.pos).setY(2.6), '+1 крутка', 'loot', 1.6, { color: '#ffb347' });
    this.flyDrop(m.pos, slot, count, art('anvil', 44), '#ffb347', 'btn-gacha');
    sfx.levelUp();
    this.persist();
  }

  /**
   * A drop's icon flies from the unit to its HUD button; the item reaches the bag on arrival (flyEnd).
   * The `count` drops of one kill start side by side under the unit, `slot` is this one's place in the row.
   */
  private flyDrop(at: THREE.Vector3, slot: number, count: number, html: string, color: string, to: FlyEl['to'], item?: Item) {
    const { w, h } = this.ui.size();
    v1.copy(at).project(this.camera);
    const x = (v1.x * 0.5 + 0.5) * w + (slot - (count - 1) / 2) * DROP_GAP * this.ui.scale;
    this.ui.fly(html, color, x, (-v1.y * 0.5 + 0.5) * h, to, item);
  }

  private flyEnd = (el: FlyEl) => {
    if (el.item) this.lootItem(el.item);
    else this.ui.gachaBadge(this.save.pulls ?? 0);
  };

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
    if (u.spawner) this.spawnLost(u, u.spawner);
  }

  /** A spawn comes back as a whole: its next charge starts when its last unit is down, the dead wait till then. */
  private spawnLost(u: Unit, sp: Spawn) {
    if (!sp.cleared) { u.respawnAt = Infinity; return; }
    const [total, used] = this.useCharge(sp.def);
    for (const o of sp.units) {
      o.respawnTotal = total;
      o.chargesUsed = used;
      o.respawnAt = this.time + total;
    }
  }

  /** Stats of a dead unit go straight to the hero (a mob's wait for its death clip, see grantKillRewards). */
  private payRewards(u: Unit) {
    for (const [k, n] of Object.entries(u.reward) as [OrbKind, number][]) for (let i = 0; i < n; i++) this.collect(k);
  }

  /** Spawners: a dead unit comes back when its charge's cooldown ends (the hero's position does not matter). */
  private updateRespawns() {
    for (const u of this.units) if (!u.alive && this.time >= u.respawnAt && this.mayRespawn(u)) u.respawn();
  }

  private mayRespawn(u: Unit) {
    const boss = u instanceof Prop ? u.def.needsAlive : undefined;
    if (!boss) return true;
    for (const m of this.mobs) if (m.def.id === boss) return m.alive;
    return true;
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
    this.kitOf(m)?.died?.();
    this.despawnMinions(m);
    this.shake = 0.6;
    sfx.levelUp();
    // its own items on every kill (copies level them up)
    if (d.drop) m.loot.push(dropItem(d.drop));
    for (const x of d.moreDrops ?? []) m.loot.push(dropItem(x));
    let classToast: (() => void) | null = null;
    const cls = d.boss!.unlockClass;
    if (cls && this.openClass(cls)) {
      classToast = () => this.ui.toast(`Новый класс: ${CLASSES[cls].name}! Кнопка справа внизу или клавиша ${CLASS_IDS.indexOf(cls) + 1}`, 3500);
    }
    // The first kill opens the way into the next location(s): saved now, shown by the gate cutscene.
    const opened = rec.firstKill ? [] : d.boss!.unlocks.filter((id) => this.openGate(id, false, false));
    rec.firstKill = true;
    if (opened.length) this.startGateCut(opened, classToast);
    else if (classToast) setTimeout(classToast, 2600);
    this.persist();
  }

  /** Opens a passage for good (saved; `show` = the barrier goes down now). False if it was open already. */
  private openGate(id: string, instant = false, show = true) {
    const gates = (this.save.gates ??= []);
    if (gates.includes(id)) return false;
    gates.push(id);
    if (show) this.world.openGate(id, instant);
    return true;
  }

  /**
   * Gate cutscene after a main boss's first kill: the camera flies from the hero to the passage, the barrier melts
   * and the clouds lift off the location behind it, a banner names it, then the camera flies back. The hero stands
   * still and takes no damage; the HUD hides behind letterbox bars. `then` runs at the end.
   */
  private startGateCut(gates: string[], then: (() => void) | null) {
    const at = new THREE.Vector3();
    // a little past the passage, so the location behind it is in view when its clouds lift
    for (const id of gates) {
      const g = GATES.find((q) => q.id === id)!;
      at.x += (g.x + g.tx * GATE_CUT.past) / gates.length;
      at.z += (g.z + g.tz * GATE_CUT.past) / gates.length;
    }
    this.cut = { t: -GATE_CUT.wait, at, gates, opened: false, then };
  }

  private updateCut(dt: number) {
    const c = this.cut!;
    const C = GATE_CUT;
    const t0 = c.t;
    c.t += dt;
    if (t0 < 0 && c.t >= 0) { document.body.classList.add('cutscene'); this.input.reset(); }
    if (!c.opened && c.t >= C.fly) {
      c.opened = true;
      for (const id of c.gates) this.world.openGate(id);
      this.world.fog.open(c.gates.map((id) => GATES.find((q) => q.id === id)!.to));
      sfx.barrier();
      this.shake = Math.max(this.shake, 0.25);
      const names = [...new Set(c.gates.map((id) => this.world.gateTarget(id)))].join(', ');
      this.ui.banner(`Путь открыт: ${names}`);
    }
    // camera: hero → gate (ease), hold, gate → hero
    const fly = (k: number) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
    const back = C.fly + C.hold;
    const k = c.t < back ? fly(c.t / C.fly) : 1 - fly((c.t - back) / C.fly);
    this.cutPos.copy(this.hero.position).lerp(c.at, k);
    if (c.t >= back + C.fly) {
      document.body.classList.remove('cutscene');
      this.cut = null;
      c.then?.();
      this.persist();
    }
  }

  private collect(k: OrbKind) {
    sfx.orb();
    addStat(this.save, 'enemy', k, ORBS[k].value);
    if (k === 'hp') this.hp = Math.min(this.maxHp, this.hp + ORBS.hp.value);
    this.ui.gain(k, this.time);
    this.ui.popStat(k);
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
        this.arenas.get(m)?.set(false);
        m.deadT += dt;
        m.ch.update(dt, false, m.dying && dHero < 34);
        if (m.knock.lengthSq() > 0.001) {
          m.pos.addScaledVector(m.knock, dt);
          m.knock.multiplyScalar(Math.max(0, 1 - dt * 9));
        }
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
      if (m.burn > 0 || m.slow > 0 || m.frozen > 0) {
        this.updateStatus(m, dt);
        if (!m.alive) continue;
      }
      // a static unit only stands: no chasing, no blows, no wandering
      if (m.passive) { m.ch.update(dt, false); continue; }
      if (def.boss?.souls) {
        if (m.state === 'chase') this.raiseSouls(m, def.boss.souls, dt);
        let arena = this.arenas.get(m);
        if (!arena) this.arenas.set(m, arena = new ArenaFog(this.scene, this.puffs, m.spawn, 16, SOUL_FOG));
        arena.set(m.state === 'chase');
        // the boss itself smokes with soul fog
        if (m.visible && Math.random() < dt * 14) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.4 + Math.random() * 0.9;
          v1.set(m.pos.x + Math.sin(a) * r, m.pos.y + 0.4 + Math.random() * 2.6, m.pos.z + Math.cos(a) * r);
          this.puffs.spawn(v1, SOUL_FOG, 1 + Math.random() * 1.2, 1.6, 0.4);
        }
      }
      if (m.animDelay >= 0) {
        m.animDelay -= dt;
        if (m.animDelay < 0) m.ch.attack(m.animNext, ATTACK_HIT[m.animNext] + 0.5, ATTACK_HIT[m.animNext]);
      }
      if (m.stun > 0) {
        m.stun -= dt;
      } else if (m.casting > 0) {
        m.casting -= dt;
      } else {
        const b = m.behavior;
        const dSpawn = m.pos.distanceTo(m.spawn);
        // a pack is leashed to its centre, so it gives up together
        const home = m.spawner?.at ?? m.spawn;
        const leash = def.boss ? 16 : LEASH;
        const sees = b.disposition === 'hostile' && dHero < def.aggro;
        if (m.state === 'idle') {
          if (!this.dead && !heroInCamp && (sees || m.spawner?.pulls(m))) m.state = 'chase';
          else if (b.idle === 'wander') {
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
          // Death's souls have no leash: they chase the hero even after their boss gives up
          const outOfLeash = !m.passable && (m.pos.distanceTo(home) > leash || hp.distanceTo(home) > leash + 4);
          if (this.dead || heroInCamp || outOfLeash) {
            m.state = 'return';
            this.endFight(m, 'reset');
            if (def.boss) { m.adds = 0; m.soulT = 0; m.ritual = 0; m.pos.y = 0; releaseHold(m, def.boss.souls?.anim ?? 'MeleeHigh', 0.3); m.burstDue = false; m.animDelay = -1; this.despawnMinions(m, true); }
            else if (this.kitOf(m)) this.despawnMinions(m);
            if (def.twin) { this.dropTwins(m); if (m.removed) { removed = true; continue; } }
            this.kitOf(m)?.reset?.();
          } else {
            const reach = def.range + m.radius * 0.5 + HERO.radius;
            if (def.boss) {
              // A boss on your tail keeps you in combat: no out-of-combat regen while kiting.
              this.bossLogic(m, dt, dHero);
            } else this.kitOf(m)?.fight?.(dt, dHero);
            if (m.casting <= 0 && m.ritual <= 0) {
              const back = m.ch instanceof Creature ? m.ch.backstep() : 0;
              if (back > 0) {
                m.pos.x -= Math.sin(m.ch.facing) * back;
                m.pos.z -= Math.cos(m.ch.facing) * back;
              } else {
                // a kiting archer stands still while it shoots
                const sp = b.combat === 'flank' ? m.spawner : undefined;
                const goal = b.combat !== 'kite' || m.impact < 0
                  ? combatGoal(m, hp, dHero, reach, dt, v2, home, sp ? sp.fightSlot(m) : 0, sp ? sp.fightCount : 1) : null;
                if (goal) moving = this.stepTo(m, goal, def.speed, dt);
              }
              m.ch.facing = turn(m.ch.facing, Math.atan2(hp.x - m.pos.x, hp.z - m.pos.z), dt * 8);
              m.atkCd -= dt;
              if (dHero < reach && m.atkCd <= 0 && m.impact < 0) {
                const period = 1 / def.aps;
                const impactAt = mobImpact(m.ch.hitTime(def.anim), period);
                // the next swing waits for this clip to finish
                m.atkCd = m.ch.attack(def.anim, period, impactAt);
                m.impact = impactAt;
              }
            }
          }
        } else if (m.state === 'return') {
          // Walks home at chase speed, no heal; re-aggros if the hero comes close again inside the leash
          // (a hit is within aggro range too). Hero outside the leash is ignored, or it would flip every frame.
          if (!this.dead && !heroInCamp && sees && hp.distanceTo(home) < leash) m.state = 'chase';
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
          if (def.shot) this.mobShot(m, def.shot);
          else if (m.pos.distanceTo(hp) < reach) {
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
      this.collideBlockers(m.pos, m.radius);
      // mobs never enter the camp
      if (inCamp(m.pos.x, m.pos.z, m.radius)) {
        const dx = m.pos.x - ISLAND.campX;
        const dz = m.pos.z - ISLAND.campZ;
        const k = (ISLAND.campR + m.radius) / (Math.hypot(dx, dz) || 1);
        m.pos.x = ISLAND.campX + dx * k;
        m.pos.z = ISLAND.campZ + dz * k;
      }
      m.ch.update(dt, moving, dHero < 34 && this.time - m.hurtAt >= HIT_FREEZE && m.frozen <= 0);
    }
    if (removed) {
      this.mobs = this.mobs.filter((m) => !m.removed);
      this.units = this.units.filter((u) => !(u instanceof Mob && u.removed));
    }
  }

  /** A ranged mob's blow: a projectile at the hero, the damage lands when it arrives (lost if the hero died). */
  private mobShot(m: Mob, shot: NonNullable<MobDef['shot']>) {
    const dmg = m.dmg * (m.phase2 ? m.def.boss!.phase2Dmg : 1);
    v1.copy(m.pos).setY(1.3 * m.def.scale);
    this.arrows.fire(shot.arrow[this.faction], v1, this.heroMark, shot.speed, () => this.hurtHero(dmg, m.pos, m));
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
    if (m.slow > 0) speed *= STAVES.ice.slow.mul;
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
      this.callReinforcements(m, b.reinforce);
    }
    const kit = this.kitOf(m);
    kit?.fight?.(dt, dHero);
    if (kit?.ownSpecials) return;
    m.special -= dt;
    if (m.special > 0 || m.impact >= 0 || m.ritual > 0) return;
    // Specials wait until the hero is in reach: no slams into thin air while the hero runs off.
    const chase = m.phase2 && dHero < b.chaseRange && Math.random() < b.chance;
    // cycle step 0 = the slam around the boss (unless noSlam), then the cones in order, then the reap
    const cones = b.cones?.length ?? 0;
    const attacks = cones + (b.reap ? 1 : 0);
    const slam0 = b.noSlam && attacks ? 0 : 1;
    const step = m.cycle % (attacks + slam0) - slam0;
    const cone = step < 0 ? null : step < cones ? b.cones![step] : b.reap!;
    if (!chase && dHero > (cone ? cone.len * 0.75 : b.slamRadius) + HERO.radius) return;
    m.special = m.phase2 ? b.cdPhase2 : b.cd;
    if (!chase) m.cycle++;
    const slam = (at: THREE.Vector3, radius: number, dmgMul: number, delay: number) => {
      this.telegraphs.add(at, radius, delay, () => {
        if (m.state === 'dead') return;
        sfx.slam();
        this.shake = Math.max(this.shake, 0.45);
        this.particles.burst(v2.copy(at).setY(0.2), b.souls ? SOUL_GREEN : 0x8a7a6a, 14, 0.18, 7, 0.7);
        if (b.souls) this.puffs.cloud(at, radius, SOUL_FOG, 10);
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
      const delay = cone.delay ?? b.slamDelay;
      // stands still through the clip's follow-through, so the next swing does not cut it
      const follow = cone.anim && m.ch instanceof Character ? m.ch.clipLength(cone.anim) - ATTACK_HIT[cone.anim] : 0.1;
      m.casting = delay + follow;
      // a cone's own clip starts so that its hit marker lands with the telegraph
      if (cone.anim) { m.animDelay = Math.max(0, delay - ATTACK_HIT[cone.anim]); m.animNext = cone.anim; }
      else m.ch.attack('AxeAttack', 1.35, 1.25);
      const yaw = Math.atan2(this.hero.position.x - m.pos.x, this.hero.position.z - m.pos.z);
      m.ch.facing = yaw;
      for (const off of 'yaws' in cone ? cone.yaws : [0]) {
        const tag: ConeTag = { boss: m, at: m.pos.clone(), yaw: yaw + off, half: cone.half, len: cone.len, mul: cone.mul, reap: 'heal' in cone ? cone.heal : undefined };
        this.telegraphs.addCone(tag.at, tag.yaw, cone.half, cone.len, delay, this.coneHit, tag);
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
    const souls = !!c.boss.def.boss!.souls;
    v2.set(c.at.x + Math.sin(c.yaw) * c.len * 0.5, 0.2, c.at.z + Math.cos(c.yaw) * c.len * 0.5);
    this.particles.burst(v2, souls ? SOUL_GREEN : 0x8a7a6a, 10, 0.18, 7, 0.7);
    if (souls) this.puffs.cloud(v2, c.len * 0.4, SOUL_FOG, 8);
    const f = this.fightOf(c.boss);
    f.slams++;
    if (c.reap) this.reapSouls(c);
    if (this.dead || !inCone(c, this.hero.position, HERO.radius)) return;
    f.slamHits++;
    this.hurtHero(c.boss.dmg * c.mul, c.at, c.boss);
  };

  /** Scythe sweep (BossDef.reap): every soul of the boss inside the cone dies, each heals the boss by `reap` of its max HP. */
  private reapSouls(c: ConeTag) {
    let n = 0;
    for (const m of this.mobs) {
      if (m.owner !== c.boss || !m.alive || !inCone(c, m.pos, m.radius)) continue;
      this.particles.burst(v2.copy(m.pos).setY(1), SOUL_GREEN, 6, 0.1, 4, 0.5);
      this.killMob(m);
      n++;
    }
    if (!n) return;
    const b = c.boss;
    const heal = Math.min(b.maxHp - b.hp, Math.round(b.maxHp * c.reap! * n));
    b.hp += heal;
    this.fx.spawn(this.unitTextAt(b), `+${fmtK(heal)}`, 'loot', 1.2, { color: '#6cff7a', lift: b.uiEl.offsetHeight });
    this.fx.spawn(v1.copy(b.pos).setY(5.6), 'Ваша жизнь — моя!', 'bark', 1.8);
    this.waves.add(b.pos, 2.5, SOUL_GREEN, 0.5);
    this.puffs.cloud(b.pos, 2.5, SOUL_FOG, 8);
  }

  /**
   * Death's souls: one every `every` s of the fight. At each HP threshold Death flies up, hangs untargetable while a
   * green aura pulses under it, raises the burst and comes back down with a swipe.
   */
  private raiseSouls(m: Mob, s: SoulsDef, dt: number) {
    const f = s.fly;
    const total = f.up + f.hover + f.down;
    if (m.ritual <= 0 && m.adds < s.burstAt.length && m.hp < m.maxHp * s.burstAt[m.adds]) {
      while (m.adds < s.burstAt.length && m.hp < m.maxHp * s.burstAt[m.adds]) m.adds++;
      m.ritual = total;
      m.burstDue = true;
      m.impact = -1;
      this.arenas.get(m)?.flare();
      // the swipe holds on its first frame while it rises and hangs
      m.ch.attack(s.anim, total, total);
      if (m.ch instanceof Character) m.ch.holdAt(0);
      if (this.target === m) this.target = null;
      this.fx.spawn(v1.copy(m.pos).setY(5.6), SOUL_BARKS[Math.floor(Math.random() * SOUL_BARKS.length)], 'bark', 2.2);
      this.puffs.cloud(m.pos, 1.5, SOUL_FOG, 10);
      sfx.telegraph();
    }
    if (m.ritual > 0) {
      const before = m.ritual;
      m.ritual -= dt;
      const t = total - Math.max(0, m.ritual);
      m.ch.facing = turn(m.ch.facing, Math.atan2(this.hero.position.x - m.pos.x, this.hero.position.z - m.pos.z), dt * 6);
      const ease = (k: number) => k * k * (3 - 2 * k);
      // up, a slow bob while hanging, then a fast drop
      m.pos.y = t < f.up ? f.height * ease(t / f.up)
        : t < f.up + f.hover ? f.height + 0.15 * Math.sin((t - f.up) * 5)
        : f.height * (1 - Math.min(1, (t - f.up - f.hover) / f.down) ** 2);
      if (m.burstDue && t >= f.up + f.hover) {
        m.burstDue = false;
        this.shake = Math.max(this.shake, 0.35);
        for (let i = 0; i < s.burst; i++) this.raiseSoul(m, s);
        // the held swipe goes on, its blow lands with the boss
        releaseHold(m, s.anim, f.down);
      }
      // the aura pulses under the boss every 0.4 s of the flight
      if (Math.ceil(before / 0.4) !== Math.ceil(Math.max(0, m.ritual) / 0.4)) {
        this.waves.add(m.pos, s.ring[1], SOUL_GREEN, 0.7);
        this.puffs.cloud(v1.copy(m.pos).setY(0), 2, SOUL_FOG, 3);
      }
      if (m.ritual <= 0) {
        m.pos.y = 0;
        this.shake = Math.max(this.shake, 0.4);
        this.waves.add(m.pos, 3.5, SOUL_GREEN, 0.45);
        this.particles.burst(v1.copy(m.pos).setY(0.2), SOUL_GREEN, 14, 0.16, 6, 0.8);
        this.puffs.cloud(m.pos, 3, SOUL_FOG, 14);
        sfx.slam();
      }
    }
    m.soulT += dt;
    if (m.soulT >= s.every) {
      m.soulT = 0;
      this.raiseSoul(m, s);
    }
  }

  /** One soul crawls out `ring` m from the boss, anywhere but the cone behind it; HP = `hits` weakest blows of the hero. */
  private raiseSoul(boss: Mob, s: SoulsDef) {
    const a = boss.ch.facing + (Math.random() * 2 - 1) * (Math.PI - s.backHalf);
    const r = s.ring[0] + Math.random() * (s.ring[1] - s.ring[0]);
    const at = new THREE.Vector3(boss.pos.x + Math.sin(a) * r, 0, boss.pos.z + Math.cos(a) * r);
    this.world.collide(at, 0.45);
    const m = this.addMob(MOBS[s.mob], at, this.labels);
    const it = this.weaponItem;
    const blow = this.itemDamage(it) * RESIST_MULT[m.def.resist[WEAPONS[it.def].type] ?? 'normal'];
    // damageFor rolls 0.9-1.1: `hits` blows always kill, one fewer never does
    m.maxHp = m.hp = Math.max(1, Math.floor(blow * 0.9 * s.hits));
    m.temp = true;
    m.owner = boss;
    m.passable = true;
    m.state = 'chase';
    m.atkCd = 0.8;
    m.rise = 1.3;
    m.pos.y = -1.9;
    this.waves.add(at, 1.1, SOUL_GREEN, 1.3);
    this.particles.burst(v1.copy(at).setY(0.2), SOUL_GREEN, 10, 0.12, 4, 0.9);
    this.puffs.cloud(at, 1, SOUL_FOG, 4);
  }

  /** MobDef.twin: a smoke bomb bursts on the hero's far side and a second one of the same mob steps out of it. */
  private callTwin(m: Mob) {
    m.twinned = true;
    const hp = this.hero.position;
    v1.set(hp.x - m.pos.x, 0, hp.z - m.pos.z).normalize();
    const at = new THREE.Vector3(hp.x + v1.x * 2, 0, hp.z + v1.z * 2);
    this.world.collide(at, 0.45);
    this.puffs.cloud(at, 1.2, SMOKE, 14, 1.8);
    this.particles.burst(v1.copy(at).setY(0.6), SMOKE, 12, 0.14, 5, 0.6);
    sfx.break();
    const t = this.addMob(m.def, at, this.labels);
    t.temp = true;
    t.twinOf = m;
    t.state = 'chase';
    t.atkCd = 0.5;
    t.ch.facing = Math.atan2(hp.x - at.x, hp.z - at.z);
  }

  /** The fight of a twin pair reset: the twins fade back into smoke, the caster may call again next fight. */
  private dropTwins(m: Mob) {
    const caster = m.twinOf ?? m;
    caster.twinned = false;
    for (const t of this.mobs) {
      if (t.twinOf !== caster || t.removed) continue;
      this.puffs.cloud(t.pos, 1, SMOKE, 8);
      if (this.target === t) this.target = null;
      this.removeMob(t);
    }
  }

  /** Up to 3–4 mobs from the pool (a fort pack: different kinds) run in and go for the hero. */
  private callReinforcements(boss: Mob, r: NonNullable<BossDef['reinforce']>) {
    let e = this.world.fortExit;
    if (!r.fort) {
      // the far side of the arena from the hero, the pack's front across the line to the boss
      v1.set(boss.pos.x - this.hero.position.x, 0, boss.pos.z - this.hero.position.z).normalize();
      v2.set(boss.pos.x + v1.x * 9, 0, boss.pos.z + v1.z * 9);
      this.world.collide(v2, 1);
      e = { x: v2.x, z: v2.z, tx: v1.x, tz: v1.z };
    }
    const kinds = r.pool.slice().sort(rndSort).slice(0, 3 + Math.floor(Math.random() * 2));
    this.fx.spawn(v1.copy(boss.pos).setY(5.6), r.bark, 'bark', 2);
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

  /** The kit (src/bosses) of a boss or a mini-boss, made on first use; null for units without one. */
  private kitOf(boss: Mob | null) {
    if (!boss || !BOSS_KITS[boss.def.id]) return null;
    let kit = this.kits.get(boss);
    if (kit === undefined) this.kits.set(boss, kit = BOSS_KITS[boss.def.id]?.(this.bossHost, boss) ?? null);
    return kit;
  }

  private bossHost = this.makeBossHost();

  private makeBossHost(): BossHost {
    // getters: this runs before the constructor makes the effects
    const game = this;
    return {
      get scene() { return game.scene; },
      get fx() { return game.fx; },
      get particles() { return game.particles; },
      get telegraphs() { return game.telegraphs; },
      get waves() { return game.waves; },
      get puffs() { return game.puffs; },
      time: () => this.time,
      heroPos: () => this.hero.position,
      heroDead: () => this.dead,
      heroHp: () => this.hp,
      mobs: () => this.mobs,
      hurtHero: (raw, from, src, dot) => this.hurtHero(raw, from, src, dot),
      slowHero: (k) => { this.heroSlow = Math.min(this.heroSlow, k); },
      addBlocker: (x, z, r, life) => {
        const b = { x, z, r, until: this.time + life };
        this.blockers.push(b);
        return { remove: () => { b.until = 0; } };
      },
      spawnMinion: (boss, def, at) => {
        const m = this.addMob(def, at, this.labels);
        m.temp = true;
        m.owner = boss;
        m.state = 'chase';
        return m;
      },
      kill: (m) => this.killMob(m),
      bark: (m, text) => this.fx.spawn(v1.copy(m.pos).setY(m.barY + 1), text, 'bark', 2),
    };
  }

  /** Pushes `p` out of the boss kits' blockers. */
  private collideBlockers(p: THREE.Vector3, radius: number) {
    for (const b of this.blockers) {
      if (b.until <= this.time) continue;
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const rr = b.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = b.x + (dx / d) * rr;
        p.z = b.z + (dz / d) * rr;
      }
    }
  }

  /** The hero died: the boss is back to full HP and its fight starts over. */
  private resetBoss(m: Mob) {
    m.hp = m.maxHp;
    m.phase2 = false;
    m.adds = 0;
    m.cycle = 0;
    m.soulT = 0;
    m.ritual = 0;
    m.pos.y = 0;
    releaseHold(m, m.def.boss!.souls?.anim ?? 'MeleeHigh', 0.3);
    m.burstDue = false;
    m.animDelay = -1;
    this.despawnMinions(m);
    this.kitOf(m)?.reset?.();
  }

  /** `keepSouls`: the boss only lost the hero, its souls stay and keep chasing. */
  private despawnMinions(boss: Mob, keepSouls = false) {
    for (const m of this.mobs) {
      if (m.owner !== boss || m.removed || (keepSouls && m.passable)) continue;
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

  /** `dot`: a tick of damage over time — no dodge, no crit, no counter; defense still cuts it. */
  private hurtHero(raw: number, from: THREE.Vector3, src?: Mob, dot = false) {
    if (this.dead || this.cut) return;
    const s = this.stats;
    const barY = 2.45 * this.heroScale;
    const lift = this.heroBar.el.offsetHeight + 14;
    // dodge: any blow, boss specials too
    if (!dot && Math.random() < s.dodge) {
      this.fx.spawn(v1.copy(this.hero.position).setY(barY), 'Уклон', 'hurt', 0.6, { color: '#9fe8ff', lift });
      return;
    }
    const crit = !dot && !!src && Math.random() < critChance(src.def.crit);
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
      for (const m of this.mobs) {
        this.endFight(m, 'death');
        if (m.def.boss && m.alive) this.resetBoss(m);
        else if (m.alive && this.kitOf(m)) { this.despawnMinions(m); this.kitOf(m)!.reset?.(); }
      }
      this.dead = true;
      this.heroMark.hittable = false;
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
    // a throwaway hand state: a counter does not advance the swing series
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
    this.pet?.place(this.hero.position, this.hero.facing);
    this.revive();
  }

  private revive() {
    this.dead = false;
    this.heroMark.hittable = true;
    this.hp = Math.max(1, Math.round(this.maxHp * HERO.respawnHp));
    this.hero.revive();
    this.ui.flash();
    this.persist();
  }

  // ---------- breakables ----------
  private hitProp(b: Prop, dmg: number, tier: string) {
    b.hp -= dmg;
    b.shake = 0.2;
    b.flash = 0.1;
    sfx.hit();
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
      // a spawn shows one loader, at its centre, once all of it is down
      const at = u.spawner?.at ?? u.spawn;
      const dead = !u.alive && u.loaderReady && u.respawnAt < Infinity && (!u.spawner || u.spawner.leader === u)
        && at.distanceTo(hp) < 30 && explored(at);
      if (!dead) { if (u.respawnEl.classList.contains('show')) u.respawnEl.classList.remove('show'); continue; }
      v1.copy(at).setY(0.5).project(this.camera);
      if (Math.abs(v1.x) > 1.1 || Math.abs(v1.y) > 1.1) { u.respawnEl.classList.remove('show'); continue; }
      const left = u.respawnAt - this.time;
      u.respawnEl.classList.add('show');
      u.respawnEl.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      u.respawnEl.style.setProperty('--p', `${Math.min(1, Math.max(0, 1 - left / (u.respawnTotal || 1))) * 360}deg`);
      u.setRespawnText(left);
      if (u.spawner) setChargeBars(u.respawnEl, u.chargesUsed, u.spawner.def.charges.length);
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
    // (the other party members' weapons and armour count too)
    const kits = Object.values(this.save.kits ?? {}).flat();
    const worn = Object.values(this.save.gear ?? {}).flatMap((g) => Object.values(g));
    const own = [...this.save.weapons, ...kits, ...Object.values(this.save.equip), ...worn, ...this.save.bag].find((x) => x && sameItem(x, item));
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
  slotName(slot: 0 | 1) { return slot ? CLASSES[kitOf(this.heroClass)].offName : 'Оружие'; }

  /** Equip an item from the bag; whatever was in that slot goes back into the bag. False: not for this class. */
  equipFromBag(index: number) {
    const it = this.save.bag[index];
    if (!it) return false;
    if (!this.canUse(it)) {
      this.ui.toast(`${itemName(it, this.faction)} — не для класса «${CLASSES[this.heroClass].name}»`);
      return false;
    }
    const slot = it.kind === 'weapon' ? classSlot(this.heroClass, it.def) : null;
    if (slot === 1 && this.offFixed()) return false;
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

  private offFixed() { return !!CLASSES[kitOf(this.heroClass)].fixedOff; }

  /** Only the class item comes off: the weapon slot is never empty, it is only swapped. */
  unequipWeapon(slot: 0 | 1) {
    const it = this.save.weapons[slot];
    if (slot === 0 || this.offFixed() || !it || this.save.bag.length >= BAG_SIZE) return false;
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
    this.dressHero();
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
   * Special map marks, drawn where the unit is right now (they move with it): the main boss — big red skull,
   * a micro-boss — smaller orange skull, an elite — its drop's icon on a tile of the drop's quality colour.
   * A dead one stays at its spawn point, faded, with a respawn ring (none for units that never come back).
   */
  private mapMarks(near = Infinity): MapMark[] {
    const hp = this.hero.position;
    const out: MapMark[] = [];
    for (const m of this.mobs) {
      const kind = m.mark;
      if (!kind || (!m.alive && !Number.isFinite(m.respawnAt))) continue;
      const pos = m.alive ? m.pos : m.spawn;
      if (pos.distanceTo(hp) > near || !this.world.fog.isExplored(pos.x, pos.z)) continue;
      const d = m.def;
      out.push({
        x: pos.x, z: pos.z, kind, alive: m.alive,
        color: kind === 'elite' && d.drop ? RARITY[d.drop.rarity].color : MARK_COLOR[kind],
        cls: kind === 'elite' && d.drop ? dropClass(d.drop) : undefined,
        icon: kind === 'elite' && d.drop ? dropIconId(d.drop) : 'skull',
        name: d.boss ? d.boss.titles[this.faction] : d.name,
        respawnIn: m.alive ? 0 : Math.max(0, m.respawnAt - this.time),
        respawnP: m.alive ? 1 : 1 - Math.max(0, m.respawnAt - this.time) / (m.respawnTotal || 1),
        drop: (kind === 'boss' || kind === 'mini') && this.dropBadge(d)
          ? { ...this.dropBadge(d)!, cls: d.drop && !d.boss?.unlockClass ? dropClass(d.drop) : undefined } : undefined,
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
    // location clear bar: the share of its enemies lying dead right now (respawns take it down again)
    const zone = this.zone ?? this.world.zoneAt(this.hero.position.x, this.hero.position.z);
    const foes = this.clearOf.get(zone.id) ?? [];
    this.ui.clearProgress(zone.id, zone.name, foes.filter((m) => !m.alive).length, foes.length);
    if (full) {
      this.ui.weapons(this.save.weapons, (it) => this.itemDamage(it), this.save.equip, this.wearer, this.petDef);
      this.ui.bagBadge(this.newItems, this.save.bag.length >= BAG_SIZE);
      this.ui.gachaBadge(this.save.pulls ?? 0);
      this.showCharge();
    }
  }

  /** Quality preset: shadows, mist and grass are the expensive parts on phones. */
  setLowGfx(low: boolean) {
    this.sun.castShadow = !low;
    this.world.setLowDetail(low);
    this.ambient.points.visible = !low;
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

  /** The world, mobs and models are built per faction at start, so the page reloads with the flipped save. */
  debugSwitchFaction() {
    this.save.faction = this.save.faction === 'human' ? 'orc' : 'human';
    this.persist();
    location.reload();
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

  /** Sets the debug points of `k` so the stat's total becomes `total`; hp counts after the other sources' percents. */
  debugSetStat(k: 'power' | 'hp', total: number) {
    const hpFrac = this.hp / this.maxHp;
    const pts = (this.save.src.debug ??= {});
    delete this.save.pct.debug?.[k];
    pts[k] = 0;
    const b = statBreakdown(this.save, k);
    pts[k] = (k === 'hp' ? total / b.mult : total) - b.sum;
    this.hp = Math.max(1, hpFrac * this.maxHp);
    this.refreshHud(true);
    this.persist();
  }

  /**
   * Debug: sets power and max HP so the boss(es) of `zone` die in about `secs` s of real play. `uptime`: share of the
   * fight spent hitting (the rest goes to dodging); `taken`: share of the bosses' melee DPS that still lands.
   * Both are linear: DPS in power (weaponDamage), HP need in incoming DPS × time minus regen.
   */
  debugBalanceBoss(zone: ZoneId, secs = 60, uptime = 0.43, taken = 0.75) {
    const main = this.mobs.filter((m) => m.def.boss?.zone === zone && !m.removed);
    if (!main.length || !this.save.weapons.some(Boolean)) return false;
    // the partner spawns only once the fight starts: its numbers as addMob would give them (zone tier, no depth);
    // a circle swing hits both at once, so then its HP costs nothing extra
    const tier = ZONE_TIER[zone] ?? 1;
    const splash = this.save.weapons.some((it) => it && WEAPONS[it.def].shape === 'circle');
    const bosses = main.flatMap((m) => {
      const p = BOSS_PARTNERS[m.def.id];
      const own = { hp: m.maxHp, dps: m.dmg * m.def.aps, resist: m.def.resist };
      return p ? [own, { hp: splash ? 0 : p.hp * tier, dps: p.dmg * tier * p.aps, resist: p.resist }] : [own];
    });
    const s = this.stats;
    const crit = critAvg(s.critPts, s.critDmgPts);
    const hp = bosses.reduce((a, b) => a + b.hp, 0);
    const dps = (p: number) => bosses.reduce((a, b) => a + b.hp * heroDps(this.save.weapons, p, s.powerMul, crit, b.resist), 0) / hp;
    const d0 = dps(0);
    const need = hp / (secs * uptime);
    this.debugSetStat('power', Math.max(0, Math.round((need - d0) / ((dps(100) - d0) / 100))));
    const inDps = bosses.reduce((a, b) => a + b.dps, 0) * armorMul(s.defense) * this.guardMul() * (1 - s.dodge);
    this.debugSetStat('hp', Math.max(HERO.hp, Math.round((inDps * taken - s.regen) * secs)));
    this.hp = this.maxHp;
    return true;
  }

  /**
   * Debug: one weapon, the best DPS against the boss(es) of `zone`, and the class's full armour set of `rarity`;
   * the ring and the amulet only with `jewels`. Replaced items go to the bag while it has room.
   */
  debugEquipFor(zone: ZoneId, gear: { rarity: number; weapon: number; jewels: boolean }) {
    const bosses = this.mobs.filter((m) => m.def.boss?.zone === zone && !m.removed);
    const s = this.stats;
    const crit = critAvg(s.critPts, s.critDmgPts);
    let best: Item | null = null;
    let bestDps = -1;
    for (const w of Object.values(WEAPONS)) {
      if (w.guard) continue;
      const it = dropItem({ kind: 'weapon', def: w.id, rarity: gear.weapon });
      const dps = bosses.reduce((a, m) => a + heroDps([it, null], s.power, s.powerMul, crit, m.def.resist), 0);
      if (dps > bestDps) { best = it; bestDps = dps; }
    }
    const stash = (it: Item | null | undefined) => { if (it && this.save.bag.length < BAG_SIZE) this.save.bag.push(it); };
    stash(this.save.weapons[0]);
    stash(this.save.weapons[1]);
    this.save.weapons = [best, null];
    const pieces = ['head', 'chest', 'arms', 'legs'].map((p) => `${CLASS_SET[this.heroClass]}_${p}`);
    if (gear.jewels) pieces.push('ring_swift', 'amulet_spring');
    for (const def of pieces) {
      const slot = ARMOR[def].slot;
      stash(this.save.equip[slot]);
      this.save.equip[slot] = dropItem({ kind: 'armor', def, rarity: gear.rarity });
    }
    this.afterGearChange();
  }

  /** Removes every debug stat point and percent. */
  debugClearStats() {
    delete this.save.src.debug;
    delete this.save.pct.debug;
    this.hp = Math.min(this.hp, this.maxHp);
    this.refreshHud(true);
    this.persist();
  }

  /** Debug: each class's look by quality (RARITY index, −1 = the equipped armour). */
  debugLooks: Record<HeroClass, number> = { warrior: -1, hunter: -1, mage: -1 };
  /** Debug: the hunter's set bow variant (archerBow `v1`). */
  bowV1 = false;
  /** Dresses class `cls` in its set of quality `rarity`; the parts load on demand. */
  debugSet(cls: HeroClass, rarity: number, bowV1 = this.bowV1) {
    this.debugLooks[cls] = rarity;
    this.bowV1 = bowV1;
    if (this.heroClass !== cls) { this.ui.toast(`Сет виден у класса «${CLASSES[cls].name}»`, 2000); return; }
    if (rarity >= 0) this.ui.toast('Загрузка сета…', 1500);
    this.dressHero();
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
    // the other party members' weapons and armour count as owned too (like a looted copy, see the pickup above)
    const kits = Object.values(this.save.kits ?? {}).flat();
    const worn = Object.values(this.save.gear ?? {}).flatMap((g) => Object.values(g));
    const own = [...this.save.weapons, ...kits, ...Object.values(this.save.equip), ...worn, ...this.save.bag].filter((x): x is Item => !!x);
    let n = 0;
    // only what the classes use (weapons and shields out of the class lists stay in the data for old saves)
    for (const [kind, defs] of [['weapon', Object.keys(WEAPONS).filter((w) => weaponClass(w))], ['armor', Object.keys(ARMOR)]] as const) {
      for (const def of defs) {
        for (let rarity = 0; rarity < 6; rarity++) {
          if ((fixedRarity(kind, def) ?? rarity) !== rarity) continue;
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
      ['ring', 'ring_swift'], ['amulet', 'amulet_spring'],
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

  /** Visual size of the hero (VIEW.heroScale, tuned live in debug; collisions and range stay the same). */
  heroScale = VIEW.heroScale;
  debugSetHeroScale(s: number) {
    this.heroScale = THREE.MathUtils.clamp(Math.round(s * 100) / 100, 0.5, 3);
    this.hero.root.scale.setScalar(this.heroScale);
  }

  debugSetFov(fov: number) {
    this.camera.fov = THREE.MathUtils.clamp(Math.round(fov), 30, 90);
    this.camera.updateProjectionMatrix();
  }

  /** Visual size of all enemies, bosses included (VIEW.mobScale, tuned live in debug; hitboxes stay the same). */
  mobScale = VIEW.mobScale;
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
      if (u.spawner) this.spawnLost(u, u.spawner);
      else if (u instanceof Mob && u.boss) {
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
interface ConeTag { boss: Mob; at: THREE.Vector3; yaw: number; half: number; len: number; mul: number; reap?: number }
/** A body of radius `r` at `p` is inside the cone (its width widens the cone a little). */
function inCone(c: ConeTag, p: THREE.Vector3, r: number) {
  const dx = p.x - c.at.x;
  const dz = p.z - c.at.z;
  const d = Math.hypot(dx, dz);
  if (d > c.len + r) return false;
  const a = Math.atan2(dx, dz) - c.yaw;
  const off = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(off) <= c.half + Math.asin(Math.min(1, r / Math.max(d, r)));
}
/** A tower shot in flight (Telegraphs tag). */
interface ShotTag { at: THREE.Vector3; dmg: number; r: number }

const rndSort = () => Math.random() - 0.5;

/** Item badge over a unit and at its map mark: the item's icon in its quality colour. */
type DropBadge = { icon: string; color: string };
/** The class whose item a mob drops (null: anyone's, rings and amulets). */
const dropClass = (d: MobDef['drop'] & {}) => (d.kind === 'weapon' ? weaponClass(d.def) : ARMOR[d.def].cls ?? null) ?? undefined;

/** "+500 хп · +25 хп/с" */
function bonusText(b: Partial<Record<OrbKind, number>> | undefined) {
  const unit: Record<OrbKind, string> = { hp: 'хп', regen: 'хп/с', power: 'урон', speed: 'бег' };
  return Object.entries(b ?? {}).map(([k, v]) => `+${v} ${unit[k as OrbKind]}`).join(' · ');
}


function turn(cur: number, want: number, k: number) {
  const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  return cur + d * Math.min(1, k);
}


/** Swing timer and swing series of one hand. */
interface Hand {
  i: 0 | 1; atkCd: number; impact: number; impactAt: number; combo: number; lastSwing: number;
  /** Staff: seconds until the bolt leaves the staff (< 0 = none pending), and its flight time. */
  launch: number; flight: number;
  /** Staff: the bolt in flight and the mob it flies at. */
  bolt: Bolt | null; aim: Unit | null;
}
function newHand(i: 0 | 1): Hand {
  return { i, atkCd: 0, impact: -1, impactAt: 0.3, combo: 0, lastSwing: -99, launch: -1, flight: 0, bolt: null, aim: null };
}

/** How a blow landed: a crit, dodged, or plain (''). */
type HitFx = '' | 'crit' | 'miss';
