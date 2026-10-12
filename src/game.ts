import * as THREE from 'three';
import { Character } from './character';
import {
  COMBOS, FACTIONS, HERO, LEASH, MOBS, ORBS, fmtOrb, RARITY, RESIST_MULT, RESPAWN_MIN_DIST, SHARPEN, WEAPONS,
  type DamageType, type MobDef, type OrbKind, type ZoneDef,
} from './config';
import { FloatingText, Particles, Pickups, Shockwaves, Telegraphs, type PickupKind } from './fx';
import {
  ARMOR, BAG_SIZE, armorStats, itemName, makeItem, rollItem, scrapValue, weaponDamage,
  type ArmorSlot, type BonusStat, type Item, type VisualPart,
} from './items';
import { Input } from './input';
import { sfx } from './audio';
import { writeSave, type SaveData } from './save';
import { BREAKABLES, World, makeBreakable, type BreakableDef, type BreakableSpot } from './world';
import { UI } from './ui';
import { resistIcons, rewardChips } from './icons';
import { seeThrough } from './seethrough';
import { heroDeaths, logFight, logSnap } from './balancelog';

/** Running counters of one fight with a mob (balance log). */
interface FightStat { t0: number; dealt: number; taken: number; hits: number; combos: number; slams: number; slamHits: number; hpStart: number }

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

interface Target { kind: 'mob' | 'prop'; ref: Mob | Breakable; }

class Mob {
  ch: Character;
  hp: number;
  maxHp: number;
  state: 'idle' | 'chase' | 'return' | 'dead' = 'idle';
  atkCd = 0;
  impact = -1;
  stun = 0;
  deadT = 0;
  respawnAt = 0;
  wanderT = Math.random() * 3;
  wander = new THREE.Vector3();
  knock = new THREE.Vector3();
  radius: number;
  hpEl: HTMLDivElement;
  hpFill: HTMLDivElement;
  respawnEl: HTMLDivElement;
  respawnTotal = 0;
  /** Spawned by a prop (grave): no respawn, removed after death. */
  temp = false;
  removed = false;
  /** Seconds left of the "crawling out of the ground" intro; untargetable meanwhile. */
  rise = 0;
  private lastSec = -1;
  // boss
  special = 4;
  /** Game time of the last hit taken (boss regen). */
  hurtAt = -99;
  fight: FightStat | null = null;
  casting = 0;
  phase2 = false;
  awake = true;
  constructor(public def: MobDef, public spawn: THREE.Vector3, faction: 'human' | 'orc', layer: HTMLElement) {
    const [model, weapon] = def.model[faction];
    this.ch = new Character(model, weapon, def.scale);
    this.ch.position.copy(spawn);
    this.ch.facing = Math.random() * Math.PI * 2;
    this.maxHp = this.hp = def.hp;
    this.radius = 0.45 * def.scale;
    this.wander.copy(spawn);
    // Above the head: stats granted by the kill, weakness/resistance icons, HP bar.
    // Bosses get a bigger version with their name (coloured by difficulty) and HP numbers.
    this.hpEl = document.createElement('div');
    this.hpEl.className = def.boss ? 'mobui boss' : 'mobui';
    this.hpEl.innerHTML = (def.boss ? `<div class="bname">${def.boss.titles[faction]}</div>` : '') +
      `<div class="rws">${rewardChips(def)}</div><div class="ris">${resistIcons(def, def.boss ? 22 : 19)}</div>` +
      `<div class="mobhp"><div></div>${def.boss ? '<span></span>' : ''}</div>`;
    this.hpFill = this.hpEl.querySelector('.mobhp > div')!;
    layer.appendChild(this.hpEl);
    // Respawn loader shown at the (invisible) spawn point while the mob is dead.
    this.respawnEl = document.createElement('div');
    this.respawnEl.className = 'respawn' + (def.boss ? ' boss' : '');
    this.respawnEl.innerHTML = '<div class="ring"></div><span></span>';
    layer.appendChild(this.respawnEl);
  }

  setRespawnText(sec: number, waiting: boolean) {
    const s = Math.max(0, Math.ceil(sec));
    if (s === this.lastSec && !waiting) return;
    this.lastSec = s;
    const t = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}`;
    (this.respawnEl.lastChild as HTMLElement).textContent = waiting ? 'отойди' : t;
  }
  get alive() { return this.state !== 'dead'; }
  get pos() { return this.ch.position; }
}

class Breakable {
  obj: THREE.Object3D;
  hp: number;
  alive = true;
  respawnAt = 0;
  shake = 0;
  def: BreakableDef;
  mats: THREE.MeshLambertMaterial[] = [];
  flash = 0;
  uiEl: HTMLDivElement;
  hpFill: HTMLDivElement;
  respawnEl: HTMLDivElement;
  private lastSec = -1;
  constructor(public spot: BreakableSpot, layer: HTMLElement) {
    this.def = BREAKABLES[spot.kind];
    this.uiEl = document.createElement('div');
    this.uiEl.className = 'mobui prop';
    this.uiEl.innerHTML = `<div class="rws">${rewardChips(this.def)}</div><div class="ris">${resistIcons(this.def, 16)}</div><div class="mobhp"><div></div></div>`;
    this.hpFill = this.uiEl.querySelector('.mobhp > div')!;
    layer.appendChild(this.uiEl);
    // Same respawn loader as mobs, shown where the prop stood.
    this.respawnEl = document.createElement('div');
    this.respawnEl.className = 'respawn prop';
    this.respawnEl.innerHTML = '<div class="ring"></div><span></span>';
    layer.appendChild(this.respawnEl);
    this.obj = makeBreakable(spot.kind);
    this.obj.position.set(spot.x, 0, spot.z);
    this.obj.rotation.y = spot.rot;
    this.hp = this.def.hits;
    this.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m && (m as THREE.MeshLambertMaterial).isMeshLambertMaterial && !this.mats.includes(m)) this.mats.push(m);
    });
  }
  get pos() { return this.obj.position; }
  get radius() { return this.def.r; }
  setRespawnText(sec: number, waiting: boolean) {
    const s = Math.max(0, Math.ceil(sec));
    if (s === this.lastSec && !waiting) return;
    this.lastSec = s;
    (this.respawnEl.lastChild as HTMLElement).textContent = waiting ? 'отойди' : String(s);
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
  private mobs: Mob[] = [];
  private props: Breakable[] = [];
  private fx: FloatingText;
  private particles: Particles;
  private telegraphs: Telegraphs;
  private pickups: Pickups;
  private waves: Shockwaves;
  // combo: consecutive connecting swings without a pause
  private combo = 0;
  private comboShown = -1;
  private lastSwing = -99;
  private lastSwingHit = false;
  private finisher = false;
  newItems = 0;
  onOpenCharacter: () => void = () => {};
  onOpenBag: () => void = () => {};
  onOpenMap: () => void = () => {};
  private time = 0;
  private hp: number;
  private shield = 0;
  private lastHurt = -99;
  private lastFight = -99;
  private atkCd = 0;
  private impact = -1;
  private target: Target | null = null;
  private dead = false;
  private deadT = 0;
  private zone: ZoneDef | null = null;
  private shake = 0;
  private camPos = new THREE.Vector3();
  private saveT = 0;
  private hudT = 0;
  private nearSmith = false;
  private nearFire = false;
  paused = false;
  private moveDir = new THREE.Vector3();
  /** Player HP (+ human shield) floating above the hero's head. */
  private heroBar!: { el: HTMLDivElement; fill: HTMLDivElement; shield: HTMLDivElement; text: HTMLSpanElement };

  private labels: HTMLElement;

  constructor(public save: SaveData, private input: Input, public ui: UI, labels: HTMLElement) {
    this.labels = labels;
    const f = FACTIONS[save.faction];
    this.camera = new THREE.PerspectiveCamera(46, 9 / 16, 0.5, 70);
    this.scene.fog = new THREE.FogExp2(0xbfe0f5, 0.015);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556644, 1.7);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.0);
    this.sun.position.set(-6, 12, 5);
    // Real-time shadows in a box that follows the camera.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 26; sc.bottom = -22; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.world = new World(save.faction);
    this.scene.add(this.world.group);
    if (save.barrierOpen) this.world.openBarrier(true);

    this.hero = new Character(f.hero, null, 1);
    this.equipVisual();
    this.hero.setOutfit(this.outfit());
    this.hero.setHighlight(true);
    this.hero.position.set(0, 0, 3);
    this.hero.facing = Math.PI;
    this.scene.add(this.hero.root);
    this.hp = this.maxHp;
    this.shield = this.shieldMax;

    for (const s of this.world.spawns) this.addMob(MOBS[s.mob], new THREE.Vector3(s.x, 0, s.z), labels);
    for (const b of this.world.bosses) {
      const m = this.addMob(MOBS[b.mob], new THREE.Vector3(b.x, 0, b.z), labels);
      const rec = save.bosses[b.mob];
      if (rec && rec.deadUntil > Date.now()) {
        m.state = 'dead';
        m.ch.root.visible = false;
        m.respawnAt = this.time + (rec.deadUntil - Date.now()) / 1000;
        m.respawnTotal = m.def.respawn;
        m.deadT = 99;
      }
    }
    for (const s of this.world.breakables) {
      const b = new Breakable(s, labels);
      this.props.push(b);
      this.scene.add(b.obj);
    }

    this.fx = new FloatingText(labels, this.camera);
    const hb = document.createElement('div');
    hb.className = 'herohp';
    hb.innerHTML = '<div class="fill"></div><div class="shield"></div><span></span>';
    labels.appendChild(hb);
    this.heroBar = { el: hb, fill: hb.querySelector('.fill')!, shield: hb.querySelector('.shield')!, text: hb.querySelector('span')! };
    this.particles = new Particles(this.scene);
    this.telegraphs = new Telegraphs(this.scene);
    this.pickups = new Pickups(this.scene);
    this.pickups.onCollect = (k, a, p, it) => this.collect(k, a, p, it);
    this.waves = new Shockwaves(this.scene);
    this.camPos.copy(this.hero.position);
    this.ui.bindWeapons(() => this.swapWeapon());
    this.ui.onSmith = () => this.openSmith();
    this.refreshHud(true);
  }

  private addMob(def: MobDef, at: THREE.Vector3, labels: HTMLElement) {
    const m = new Mob(def, at, this.save.faction, labels);
    this.mobs.push(m);
    this.scene.add(m.ch.root);
    return m;
  }

  // ---------- hero stats ----------
  get faction() { return this.save.faction; }
  /** Totals from equipped armour and jewellery. */
  gear() {
    const g = { defense: 0, hp: 0, regen: 0, power: 0, speed: 0 } as { defense: number } & Record<BonusStat, number>;
    for (const it of Object.values(this.save.equip)) {
      if (!it) continue;
      const s = armorStats(it);
      g.defense += s.defense;
      if (s.bonus) g[s.bonus.stat] += s.bonus.value;
    }
    return g;
  }
  get power() { return this.save.stats.power + this.gear().power; }
  get defense() { return this.gear().defense; }
  get maxHp() { return Math.round((this.save.stats.hp + this.gear().hp) * (this.faction === 'human' ? 1.1 : 1)); }
  get shieldMax() { return this.faction === 'human' ? Math.round(this.maxHp * 0.15) : 0; }
  get regen() { return Math.min(HERO.regenCap, (this.save.stats.regen + this.gear().regen) * (this.faction === 'human' ? 1.1 : 1)); }
  get speed() { return Math.min(HERO.speedCap, this.save.stats.speed + this.gear().speed) * (this.faction === 'orc' ? 1.05 : 1); }
  get weaponItem(): Item { return this.save.weapons[this.save.active] ?? this.save.weapons[0]!; }
  get weapon() { return WEAPONS[this.weaponItem.def]; }
  powerMult() {
    let m = 1 + this.power / 100;
    if (this.faction === 'orc') m *= 1.1 * (1 + 0.3 * (1 - this.hp / this.maxHp));
    return m;
  }
  itemDamage(it: Item) { return weaponDamage(it); }
  heroDps(type?: DamageType, resist?: Partial<Record<DamageType, string>>) {
    const w = this.weapon;
    const r = resist && type ? RESIST_MULT[(resist[type] as 'weak') ?? 'normal'] : 1;
    return this.itemDamage(this.weaponItem) * this.powerMult() * w.aps * r;
  }

  private equipVisual() {
    const w = this.weapon;
    this.hero.setWeapon(w.model[this.faction]);
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

  swapWeapon() {
    const other = (1 - this.save.active) as 0 | 1;
    if (!this.save.weapons[other] || this.dead) return;
    this.save.active = other;
    this.equipVisual();
    this.atkCd = Math.max(this.atkCd, 0.15);
    sfx.click();
    this.refreshHud(true);
  }

  // ---------- main loop ----------
  update(dt: number) {
    if (this.paused) { this.render(0); return; }
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const played = this.save.playTime ?? 0;
    this.save.playTime = played + dt;
    if (Math.floor(this.save.playTime / 60) > Math.floor(played / 60)) this.snapshot();
    if (this.input.pressed('KeyQ') || this.input.pressed('Space')) this.swapWeapon();
    if (this.input.pressed('KeyI') || this.input.pressed('KeyC')) { this.onOpenCharacter(); return; }
    if (this.input.pressed('KeyB')) { this.onOpenBag(); return; }
    if (this.input.pressed('KeyM')) { this.onOpenMap(); return; }
    this.updateHero(dt);
    this.updateMobs(dt);
    this.updateProps(dt);
    this.telegraphs.update(dt);
    this.particles.update(dt);
    this.pickups.update(dt, this.hero.position, 5.5);
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
      this.world.envAt(o.z, this.env);
      const fog = this.scene.fog as THREE.FogExp2;
      fog.color.copy(this.env.fog);
      fog.density = this.env.density * 0.5;
      this.scene.background = this.env.sky;
      this.sun.target.position.set(o.x, 0, o.z);
      this.sun.position.set(o.x - 16, 30, o.z + 8);
      this.world.update(dt, this.time, this.camPos);
      return;
    }
    this.camPos.lerp(hp, 1 - Math.exp(-dt * 8));
    const sh = this.shake > 0 ? this.shake : 0;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * sh,
      this.camPos.y + 19,
      this.camPos.z + 12.5 + (Math.random() - 0.5) * sh,
    );
    this.camera.lookAt(this.camPos.x, 0.6, this.camPos.z - 1.2);
    seeThrough.hero.value.set(hp.x, 1.0, hp.z);
    seeThrough.cam.value.copy(this.camera.position);
    this.world.envAt(hp.z, this.env);
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
    v1.copy(hp).setY(2.45).project(this.camera);
    const hb = this.heroBar;
    hb.el.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    hb.el.classList.toggle('dead', this.dead);
    const total = this.maxHp + this.shieldMax;
    hb.fill.style.width = `${(this.hp / this.maxHp) * 100}%`;
    hb.shield.style.width = `${(this.shield / Math.max(1, total)) * 100}%`;
    hb.text.textContent = `${Math.ceil(this.hp)}`;
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
      if (this.deadT > 1.6 && !this.ui.modalOpen) this.ui.showDeath(() => this.respawnAtFire(), () => this.reviveHere());
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

    // targeting: keep the current target while it lives and stays near (GDD 6.2)
    const w = this.weapon;
    const reach = w.range + HERO.acquireExtra;
    if (this.target) {
      const t = this.target;
      const alive = t.kind === 'mob' ? (t.ref as Mob).alive : (t.ref as Breakable).alive;
      if (!alive || t.ref.pos.distanceTo(p) > reach + t.ref.radius + 1) this.target = null;
    }
    if (!this.target) {
      let best: Target | null = null;
      let bd = Infinity;
      for (const m of this.mobs) {
        if (!m.alive || !m.awake || m.rise > 0) continue;
        const d = m.pos.distanceTo(p) - m.radius;
        if (d < reach && d < bd) { bd = d; best = { kind: 'mob', ref: m }; }
      }
      if (!best) {
        for (const b of this.props) {
          if (!b.alive) continue;
          const d = b.pos.distanceTo(p) - b.radius;
          if (d < reach && d < bd) { bd = d; best = { kind: 'prop', ref: b }; }
        }
      }
      this.target = best;
    }

    // facing
    let want = ch.facing;
    if (this.target) want = Math.atan2(this.target.ref.pos.x - p.x, this.target.ref.pos.z - p.z);
    else if (moving) want = Math.atan2(ix, iy);
    let diff = want - ch.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    ch.facing += diff * Math.min(1, dt * 16);

    // auto attack while moving
    this.atkCd -= dt;
    const period = 1 / w.aps;
    const combo = COMBOS[this.weaponItem.def];
    // A pause or a whiff breaks the chain (GDD: combo = N uninterrupted attacks).
    if (this.combo > 0 && this.impact < 0 && this.time - this.lastSwing > period + combo.window) this.combo = 0;
    // Swing only when the target is inside the strike shape (inShape's range + 0.35): the target is kept
    // up to 1 m further for facing, and swinging there was a whiff into thin air.
    const inReach = !!this.target && this.target.ref.pos.distanceTo(p) - this.target.ref.radius <= w.range + 0.35;
    if (inReach && this.atkCd <= 0) {
      const chained = this.lastSwingHit && this.time - this.lastSwing <= period + combo.window;
      this.combo = chained ? this.combo + 1 : 1;
      this.finisher = this.combo >= combo.hits;
      this.lastSwing = this.time;
      const impactAt = Math.min(0.42, period * 0.4);
      ch.attack(w.anim, period, impactAt);
      this.impact = impactAt;
      this.atkCd = period;
    }
    if (this.impact >= 0) {
      this.impact -= dt;
      if (this.impact < 0) this.heroStrike();
    }
    if (this.comboShown !== this.combo) {
      this.comboShown = this.combo;
      this.ui.combo(this.combo, combo.hits, combo.name);
    }

    // regen
    const outOfCombat = this.time - this.lastFight > HERO.outOfCombatDelay;
    this.nearFire = this.world.campfires.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < HERO.campfireRadius);
    let rate = (this.regen / 100) * this.maxHp;
    if (outOfCombat) rate *= HERO.outOfCombatRegen;
    if (this.nearFire) rate *= HERO.campfireRegen;
    this.hp = Math.min(this.maxHp, this.hp + rate * dt);
    if (this.shieldMax > 0 && this.time - this.lastHurt > 6) this.shield = this.shieldMax;

    // zone + interactions
    const zone = this.world.zoneAt(p.z);
    if (zone !== this.zone) {
      this.zone = zone;
      this.ui.zoneBanner(zone);
    }
    const smith = p.distanceTo(this.world.smithy) < 4.5;
    if (smith !== this.nearSmith) { this.nearSmith = smith; this.ui.showSmithButton(smith); }

    ch.update(dt, moving);
  }

  private damageFor(type: DamageType, resist: MobDef['resist'], mult = 1) {
    const tier = resist[type] ?? 'normal';
    const dmg = this.itemDamage(this.weaponItem) * this.powerMult() * RESIST_MULT[tier] * mult * (0.9 + Math.random() * 0.2);
    return { dmg: Math.max(1, Math.round(dmg)), tier };
  }

  private inShape(pos: THREE.Vector3, radius: number, shape: 'arc' | 'circle', arc: number, range: number) {
    const p = this.hero.position;
    const dx = pos.x - p.x;
    const dz = pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d - radius > range + 0.35) return false;
    if (shape === 'circle' || d < 0.6) return true;
    let a = Math.atan2(dx, dz) - this.hero.facing;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(a) <= THREE.MathUtils.degToRad(arc / 2) + Math.atan2(radius, d);
  }

  private heroStrike() {
    const w = this.weapon;
    const fin = this.finisher ? COMBOS[this.weaponItem.def] : null;
    const shape = fin ? fin.shape : w.shape;
    const arc = fin ? fin.arc : w.arc;
    const range = w.range + (fin ? fin.rangeAdd : 0);
    let hits = 0;
    sfx.swing();
    for (const m of this.mobs) {
      if (!m.alive || !m.awake || m.rise > 0 || !this.inShape(m.pos, m.radius, shape, arc, range)) continue;
      const { dmg, tier } = this.damageFor(w.type, m.def.resist, fin ? fin.mult : 1);
      const f = this.fightOf(m);
      f.hits++;
      if (fin) f.combos++;
      this.damageMob(m, dmg, tier, fin ? fin.knock : 3.5);
      if (m.alive && !m.def.boss) {
        if (fin?.stun) m.stun = Math.max(m.stun, fin.stun);
        else if (w.stun && Math.random() < w.stun) m.stun = 0.9;
      }
      hits++;
    }
    for (const b of this.props) {
      if (!b.alive || !this.inShape(b.pos, b.radius, shape, arc, range)) continue;
      this.hitProp(b, (fin ? 3 : 1) * RESIST_MULT[b.def.resist[w.type] ?? 'normal'], b.def.resist[w.type] ?? 'normal');
      hits++;
    }
    if (w.shape === 'circle' && hits) {
      this.shake = Math.max(this.shake, 0.18);
      this.particles.burst(v1.copy(this.hero.position).setY(0.2), 0x9a8a70, 8, 0.12, 5, 0.5);
    }
    if (fin) {
      this.finisher = false;
      this.combo = 0;
      this.waves.add(this.hero.position, range + 0.5, fin.color);
      if (fin.spin) this.hero.spin(0.35);
      this.shake = Math.max(this.shake, 0.35);
      this.fx.spawn(v1.copy(this.hero.position).setY(2.6), `${fin.name}!`, 'combo', 0.9);
      sfx.combo();
    }
    this.lastSwingHit = hits > 0;
    if (!hits) this.combo = 0;
    if (hits) this.lastFight = this.time;
  }

  private damageMob(m: Mob, dmg: number, tier: string, knock = 3.5) {
    this.fightOf(m).dealt += Math.min(dmg, m.hp);
    m.hp -= dmg;
    m.hurtAt = this.time;
    m.ch.hit();
    m.state = m.state === 'return' ? 'return' : 'chase';
    if (!m.def.boss) m.knock.set(m.pos.x - this.hero.position.x, 0, m.pos.z - this.hero.position.z).normalize().multiplyScalar(knock);
    const head = v1.copy(m.pos).setY(1.9 * m.def.scale);
    if (tier === 'weak') { this.fx.spawn(head, String(dmg), 'dmg weak'); sfx.hit(true); }
    else if (tier === 'resist' || tier === 'immune') {
      this.fx.spawn(head, `${dmg}<small>Сопротивление</small>`, 'dmg resist', 0.8, { html: true });
      sfx.resist();
    } else { this.fx.spawn(head, String(dmg), 'dmg'); sfx.hit(); }
    this.particles.burst(v2.copy(m.pos).setY(1.1 * m.def.scale), m.def.id.startsWith('skel') || m.def.id === 'ghost' || m.def.id === 'death' ? 0xd8d4c8 : 0xc0392b, 4, 0.08, 4, 0.45);
    if (m.hp <= 0) this.killMob(m);
  }

  private killMob(m: Mob) {
    m.state = 'dead';
    m.hp = 0;
    m.deadT = 0;
    m.ch.die();
    m.hpEl.classList.remove('show');
    m.respawnTotal = m.def.respawn;
    this.save.kills++;
    this.endFight(m, 'kill');
    if (this.target?.ref === m) this.target = null;
    const d = m.def;
    for (const [k, n] of Object.entries(d.reward) as [OrbKind, number][]) for (let i = 0; i < n; i++) this.pickups.spawn(m.pos, k);
    this.dropGold(m.pos, d.gold);
    if (d.boss) this.killBoss(m);
    else if (m.temp) m.respawnAt = Infinity;
    else {
      m.respawnAt = this.time + d.respawn;
      if (Math.random() < 0.07) this.pickups.spawnItem(m.pos, rollItem(this.zoneLevel(m.pos.z)));
    }
  }

  private zoneLevel(z: number) { return this.world.zoneAt(z).id === 'cemetery' ? 2 : 1; }

  private killBoss(m: Mob) {
    const d = m.def;
    const rec = (this.save.bosses[d.id] ??= { firstKill: false, deadUntil: 0 });
    rec.deadUntil = Date.now() + d.respawn * 1000;
    m.respawnAt = this.time + d.respawn;
    this.telegraphs.clear();
    this.shake = 0.6;
    sfx.levelUp();
    const lvl = this.zoneLevel(m.pos.z);
    const drops: Item[] = [];
    if (!rec.firstKill) {
      rec.firstKill = true;
      // Guaranteed first-kill rewards (GDD 7.3).
      drops.push(d.boss!.zone === 'forest'
        ? makeItem('weapon', 'hammer', 1, 1)
        : makeItem('weapon', FACTIONS[this.faction].startWeapon, 2, 2));
      drops.push(rollItem(lvl, 0.35));
      if (d.boss!.zone === 'forest' && !this.save.barrierOpen) {
        this.save.barrierOpen = true;
        this.world.openBarrier();
        setTimeout(() => { sfx.barrier(); this.ui.toast('Барьер пал! Путь на Старое кладбище открыт'); }, 1200);
      }
    } else {
      drops.push(rollItem(lvl, 0.3), rollItem(lvl, 0.15));
    }
    for (const it of drops) this.pickups.spawnItem(m.pos, it);
    this.persist();
  }

  private dropGold(at: THREE.Vector3, range: [number, number]) {
    const g = range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
    if (g <= 0) return;
    const coins = Math.min(g, 8);
    const per = Math.floor(g / coins);
    let rest = g - per * coins;
    for (let i = 0; i < coins; i++) {
      this.pickups.spawn(at, 'gold', per + (rest > 0 ? 1 : 0));
      rest--;
    }
  }

  private collect(kind: PickupKind, amount: number, pos: THREE.Vector3, item?: Item) {
    const s = this.save.stats;
    const head = v1.copy(this.hero.position).setY(2.1);
    if (kind === 'item' && item) {
      this.lootItem(item);
      return;
    }
    if (kind === 'gold') {
      this.save.gold += amount;
      sfx.coin();
      this.fx.spawn(head, `+${amount}`, 'gold', 0.6);
      return;
    }
    sfx.orb();
    switch (kind as OrbKind) {
      case 'power': s.power += ORBS.power.value; break;
      case 'hp': s.hp += ORBS.hp.value; this.hp = Math.min(this.maxHp, this.hp + ORBS.hp.value); break;
      case 'regen': s.regen = Math.min(HERO.regenCap, +(s.regen + ORBS.regen.value).toFixed(2)); break;
      case 'speed': s.speed = Math.min(HERO.speedCap, +(s.speed + ORBS.speed.value).toFixed(2)); break;
    }
    const o = ORBS[kind as OrbKind];
    this.fx.spawn(head, `${fmtOrb(kind as OrbKind)} ${o.label}`, 'orb', 0.7, { color: o.css });
    this.ui.popStat(kind as OrbKind);
    void pos;
  }

  // ---------- mobs ----------
  private updateMobs(dt: number) {
    const hp = this.hero.position;
    const heroInCamp = this.world.zoneAt(hp.z).id === 'camp';
    let removed = false;
    for (const m of this.mobs) {
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
        m.ch.update(dt, false, m.deadT < 3 && dHero < 34);
        if (m.deadT > 2.2) m.ch.position.y = -(m.deadT - 2.2) * 0.8;
        if (m.deadT > 4) m.ch.root.visible = false;
        if (m.temp && m.deadT > 4.5) { this.removeMob(m); removed = true; continue; }
        if (this.time >= m.respawnAt && m.spawn.distanceTo(hp) > RESPAWN_MIN_DIST) this.respawnMob(m);
        continue;
      }
      if (!m.awake) continue;
      const def = m.def;
      let moving = false;
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
          } else {
            const reach = def.range + m.radius * 0.5 + HERO.radius;
            if (def.boss) {
              // A boss on your tail keeps you in combat: no out-of-combat regen while kiting.
              this.lastFight = this.time;
              this.bossLogic(m, dt, dHero);
            }
            if (m.casting <= 0) {
              if (dHero > reach * 0.85) moving = this.stepTo(m, hp, def.speed, dt);
              m.ch.facing = turn(m.ch.facing, Math.atan2(hp.x - m.pos.x, hp.z - m.pos.z), dt * 8);
              m.atkCd -= dt;
              if (dHero < reach && m.atkCd <= 0 && m.impact < 0) {
                const period = 1 / def.aps;
                const impactAt = Math.min(0.55, period * 0.45);
                m.ch.attack(def.anim, period, impactAt);
                m.impact = impactAt;
                m.atkCd = period;
              }
            }
          }
        } else if (m.state === 'return') {
          moving = this.stepTo(m, m.spawn, def.speed * 1.4, dt);
          m.hp = Math.min(m.maxHp, m.hp + m.maxHp * dt * 0.5);
          if (m.pos.distanceTo(m.spawn) < 0.6) { m.state = 'idle'; m.hp = m.maxHp; }
        }
      }
      if (m.impact >= 0) {
        m.impact -= dt;
        if (m.impact < 0 && !this.dead && m.stun <= 0) {
          const reach = def.range + m.radius * 0.5 + HERO.radius + 0.5;
          if (m.pos.distanceTo(hp) < reach) this.hurtHero(def.dmg * (m.phase2 ? def.boss!.phase2Dmg : 1), m.pos, m);
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
      m.ch.update(dt, moving, dHero < 34);
    }
    if (removed) this.mobs = this.mobs.filter((m) => !m.removed);
  }

  private removeMob(m: Mob) {
    this.scene.remove(m.ch.root);
    m.hpEl.remove();
    m.respawnEl.remove();
    m.state = 'dead';
    m.removed = true;
  }

  /** Data-driven prop events (BREAKABLES[kind].onBreak). */
  private runBreakEvents(b: Breakable) {
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
          this.mobs.push(m);
          this.scene.add(m.ch.root);
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
    m.ch.walkRate = speed / 2.1;
    return true;
  }

  private bossColor(m: Mob) {
    // Time-to-kill against the hero's current weapon decides the name colour (GDD 6.4).
    const ttk = m.maxHp / Math.max(1, this.heroDps(this.weapon.type, m.def.resist));
    return ttk < 35 ? '#6cff7a' : ttk < 80 ? '#ffd84d' : '#ff5a5a';
  }

  private bossLogic(m: Mob, dt: number, dHero: number) {
    const b = m.def.boss!;
    if (this.time - m.hurtAt > b.regenDelay) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * b.regen * dt);
    if (!m.phase2 && m.hp < m.maxHp * b.phase2At) {
      m.phase2 = true;
      this.fx.spawn(v1.copy(m.pos).setY(4.5), m.def.id === 'death' ? 'Твоё время вышло!' : 'Ты меня разозлил!', 'bark', 2);
      sfx.telegraph();
    }
    m.special -= dt;
    if (m.special > 0 || m.impact >= 0) return;
    // Specials wait until the hero is in reach: no slams into thin air while the hero runs off.
    const chase = m.phase2 && dHero < b.chaseRange && Math.random() < b.chance;
    if (!chase && dHero > b.slamRadius + HERO.radius) return;
    m.special = m.phase2 ? b.cdPhase2 : b.cd;
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
          this.hurtHero(m.def.dmg * dmgMul, at, m);
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
    } else {
      m.casting = 1.35;
      m.ch.attack('AxeAttack', 1.35, 1.25);
      slam(m.pos.clone(), b.slamRadius, b.slamMul, b.slamDelay);
    }
  }

  private respawnMob(m: Mob) {
    m.fight = null;
    m.state = 'idle';
    m.hp = m.maxHp;
    m.phase2 = false;
    m.special = 4;
    m.casting = 0;
    m.impact = -1;
    m.pos.copy(m.spawn);
    m.ch.revive();
    m.ch.root.visible = true;
  }

  private hurtHero(raw: number, from: THREE.Vector3, src?: Mob) {
    if (this.dead) return;
    // GDD 10.5: reduction = defense / (defense + 100)
    let dmg = Math.max(1, Math.round(raw * (100 / (100 + this.defense)) * (0.9 + Math.random() * 0.2)));
    this.lastHurt = this.lastFight = this.time;
    if (src) this.fightOf(src).taken += Math.min(dmg, this.hp + this.shield);
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    this.hero.hit();
    sfx.hurt();
    // Fully absorbed by the human shield: show it in shield blue instead of "-0".
    if (dmg > 0) this.fx.spawn(v1.copy(this.hero.position).setY(2), `-${dmg}`, 'hurt', 0.7);
    else this.fx.spawn(v1.copy(this.hero.position).setY(2), '🛡', 'hurt', 0.5, { color: '#6cc6ff' });
    void from;
    this.ui.hurtFlash();
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

  private respawnAtFire() {
    const p = this.hero.position;
    const fires = this.world.campfires.filter((c) => c.zone !== 'cemetery' || this.save.barrierOpen);
    fires.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const f = fires[0];
    p.set(f.x, 0, f.z + 2);
    this.camPos.copy(p);
    this.revive();
  }

  private reviveHere() {
    // Push nearby mobs back so the hero does not die again instantly.
    for (const m of this.mobs) {
      if (!m.alive) continue;
      const d = m.pos.distanceTo(this.hero.position);
      if (d < 5) m.knock.set(m.pos.x - this.hero.position.x, 0, m.pos.z - this.hero.position.z).normalize().multiplyScalar(14);
    }
    this.revive();
  }

  private revive() {
    this.dead = false;
    this.hp = this.maxHp;
    this.shield = this.shieldMax;
    this.hero.revive();
    this.ui.flash();
    this.persist();
  }

  // ---------- breakables ----------
  private hitProp(b: Breakable, dmg: number, tier: string) {
    b.hp = +(b.hp - dmg).toFixed(2);
    if (tier === 'weak') this.fx.spawn(v2.copy(b.pos).setY(1.4), 'Слабость', 'dmg weak small', 0.6);
    else if (tier !== 'normal') this.fx.spawn(v2.copy(b.pos).setY(1.4), 'Сопротивление', 'dmg resist small', 0.6);
    b.shake = 0.2;
    b.flash = 0.1;
    sfx.hit();
    this.particles.burst(v1.copy(b.pos).setY(0.7), b.def.color, 3, 0.1, 3, 0.4);
    if (b.hp > 0) return;
    b.alive = false;
    b.obj.visible = false;
    b.respawnAt = this.time + b.def.respawn;
    if (this.target?.ref === b) this.target = null;
    sfx.break();
    this.particles.burst(v1.copy(b.pos).setY(0.6), b.def.color, 10, 0.22, 6, 1.1);
    for (const [k, n] of Object.entries(b.def.reward) as [OrbKind, number][]) for (let i = 0; i < n; i++) this.pickups.spawn(b.pos, k);
    this.dropGold(b.pos, b.def.gold);
    this.runBreakEvents(b);
    if (Math.random() < 0.025) this.pickups.spawnItem(b.pos, rollItem(this.zoneLevel(b.pos.z)));
  }

  private updateProps(dt: number) {
    const hp = this.hero.position;
    for (const b of this.props) {
      if (!b.alive) {
        if (this.time >= b.respawnAt && b.pos.distanceTo(hp) > RESPAWN_MIN_DIST) {
          b.alive = true;
          b.hp = b.def.hits;
          b.obj.visible = true;
        }
        continue;
      }
      b.obj.visible = b.pos.distanceTo(hp) < 36;
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
    for (const b of this.props) {
      const show = b.alive && b.obj.visible && b.pos.distanceTo(hp) < 9;
      if (!show) { if (b.uiEl.classList.contains('show')) b.uiEl.classList.remove('show'); continue; }
      v1.copy(b.pos).setY(1.25 * b.def.scale + 0.3).project(this.camera);
      b.uiEl.classList.add('show');
      b.uiEl.classList.toggle('hurt', b.hp < b.def.hits);
      b.uiEl.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      b.hpFill.style.width = `${Math.max(0, b.hp / b.def.hits) * 100}%`;
    }
    for (const b of this.props) {
      const show = !b.alive && b.pos.distanceTo(hp) < 22;
      if (!show) { if (b.respawnEl.classList.contains('show')) b.respawnEl.classList.remove('show'); continue; }
      v1.copy(b.pos).setY(0.4).project(this.camera);
      if (Math.abs(v1.x) > 1.1 || Math.abs(v1.y) > 1.1) { b.respawnEl.classList.remove('show'); continue; }
      const left = b.respawnAt - this.time;
      const waiting = left <= 0;
      b.respawnEl.classList.add('show');
      b.respawnEl.classList.toggle('waiting', waiting);
      b.respawnEl.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      b.respawnEl.style.setProperty('--p', `${Math.min(1, Math.max(0, 1 - left / b.def.respawn)) * 360}deg`);
      b.setRespawnText(left, waiting);
    }
    for (const m of this.mobs) {
      // HP bar + weakness icons + kill reward over living mobs near the hero.
      const show = m.alive && m.ch.root.visible && m.pos.distanceTo(hp) < (m.def.boss ? 24 : 16);
      if (!show) { if (m.hpEl.classList.contains('show')) m.hpEl.classList.remove('show'); }
      else {
        v1.copy(m.pos).setY(2.15 * m.def.scale).project(this.camera);
        m.hpEl.classList.add('show');
        m.hpEl.classList.toggle('hurt', m.hp < m.maxHp);
        m.hpEl.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
        m.hpFill.style.width = `${(m.hp / m.maxHp) * 100}%`;
        if (m.def.boss) {
          (m.hpEl.querySelector('.mobhp span') as HTMLElement).textContent = `${Math.ceil(m.hp)} / ${m.maxHp}`;
          (m.hpEl.querySelector('.bname') as HTMLElement).style.color = this.bossColor(m);
        }
      }
      // Respawn loader at the spawn point (appears once the corpse has gone).
      const dead = m.state === 'dead' && !m.temp && (m.deadT > 2.5 || m.def.boss) && m.spawn.distanceTo(hp) < 30;
      if (!dead) { if (m.respawnEl.classList.contains('show')) m.respawnEl.classList.remove('show'); continue; }
      v1.copy(m.spawn).setY(0.6).project(this.camera);
      if (Math.abs(v1.x) > 1.1 || Math.abs(v1.y) > 1.1) { m.respawnEl.classList.remove('show'); continue; }
      const left = m.respawnAt - this.time;
      const total = m.respawnTotal || m.def.respawn;
      const waiting = left <= 0; // ready, but the hero is closer than RESPAWN_MIN_DIST
      m.respawnEl.classList.add('show');
      m.respawnEl.classList.toggle('waiting', waiting);
      m.respawnEl.style.transform = `translate(${(v1.x * 0.5 + 0.5) * w}px, ${(-v1.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
      m.respawnEl.style.setProperty('--p', `${Math.min(1, Math.max(0, 1 - left / total)) * 360}deg`);
      m.setRespawnText(left, waiting);
    }
  }

  // ---------- items / inventory ----------
  private lootItem(item: Item) {
    const color = RARITY[item.rarity].color;
    const name = itemName(item, this.faction);
    const head = v1.copy(this.hero.position).setY(2.4);
    sfx.levelUp();
    // A weapon goes straight into a free weapon slot (e.g. the hammer from the first boss).
    const free = this.save.weapons.findIndex((x) => !x);
    if (item.kind === 'weapon' && free >= 0) {
      this.save.weapons[free] = item;
      this.fx.spawn(head, `${name} → слот ${free + 1}`, 'loot', 1.4, { color });
      this.ui.toast(`${name}: второй слот оружия. Переключай кнопкой ⇄`);
    } else if (this.save.bag.length < BAG_SIZE) {
      this.save.bag.push(item);
      this.newItems++;
      this.fx.spawn(head, `+ ${name}`, 'loot', 1.4, { color });
    } else {
      const g = scrapValue(item);
      this.save.gold += g;
      this.fx.spawn(head, `Сумка полна: ${name} → +${g} 🪙`, 'loot', 1.6, { color });
    }
    this.refreshHud(true);
    this.persist();
  }

  /** Equip an item from the bag; whatever was in that slot goes back into the bag. */
  equipFromBag(index: number, weaponSlot?: 0 | 1) {
    const it = this.save.bag[index];
    if (!it) return;
    this.save.bag.splice(index, 1);
    if (it.kind === 'weapon') {
      const slot = weaponSlot ?? (this.save.weapons.findIndex((x) => !x) >= 0 ? (this.save.weapons.findIndex((x) => !x) as 0 | 1) : this.save.active);
      const old = this.save.weapons[slot];
      this.save.weapons[slot] = it;
      if (old) this.save.bag.splice(index, 0, old);
    } else {
      const slot = ARMOR[it.def].slot;
      const old = this.save.equip[slot];
      this.save.equip[slot] = it;
      if (old) this.save.bag.splice(index, 0, old);
    }
    this.afterGearChange();
  }

  unequipArmor(slot: ArmorSlot) {
    const it = this.save.equip[slot];
    if (!it || this.save.bag.length >= BAG_SIZE) return false;
    delete this.save.equip[slot];
    this.save.bag.push(it);
    this.afterGearChange();
    return true;
  }

  unequipWeapon(slot: 0 | 1) {
    const it = this.save.weapons[slot];
    const other = this.save.weapons[1 - slot];
    if (!it || !other || this.save.bag.length >= BAG_SIZE) return false;
    this.save.weapons[slot] = null;
    this.save.bag.push(it);
    if (this.save.active === slot) this.save.active = (1 - slot) as 0 | 1;
    this.afterGearChange();
    return true;
  }

  setActiveWeapon(slot: 0 | 1) {
    if (!this.save.weapons[slot]) return;
    this.save.active = slot;
    this.afterGearChange();
  }

  scrapFromBag(index: number) {
    const it = this.save.bag[index];
    if (!it) return;
    this.save.bag.splice(index, 1);
    this.save.gold += scrapValue(it);
    sfx.break();
    this.persist();
    this.refreshHud(true);
  }

  private afterGearChange() {
    const hpFrac = this.hp / this.maxHp;
    this.equipVisual();
    this.hero.setOutfit(this.outfit());
    this.hp = Math.min(this.maxHp, Math.max(1, hpFrac * this.maxHp));
    this.combo = 0;
    sfx.click();
    this.persist();
    this.refreshHud(true);
  }

  statRows(): [string, string][] {
    const w = this.weapon;
    return [
      ['Урон (Power)', String(Math.round(this.power))],
      ['Здоровье', String(this.maxHp)],
      ['Реген', `${(Math.round(this.regen * 100) / 100)}%/с`],
      ['Скорость', `${(Math.round(this.speed * 10) / 10)} м/с`],
      ['Защита', `${this.defense} (−${Math.round((this.defense / (this.defense + 100)) * 100)}%)`],
      ['Оружие', `${Math.round(this.itemDamage(this.weaponItem) * this.powerMult())} × ${w.aps}/с`],
      ['Комбо', `${COMBOS[this.weaponItem.def].name} ×${COMBOS[this.weaponItem.def].mult}`],
      ['Пассивка', FACTIONS[this.faction].passiveName],
    ];
  }

  private openSmith() {
    this.paused = true;
    this.input.reset();
    const render = () => {
      this.ui.smithPanel(this.save.weapons, this.save.gold, (it) => this.itemDamage(it), (slot) => {
        const it = this.save.weapons[slot];
        if (!it || it.sharpen >= SHARPEN.max) return;
        const cost = SHARPEN.cost(it.sharpen);
        if (this.save.gold < cost) return;
        this.save.gold -= cost;
        it.sharpen++;
        sfx.levelUp();
        render();
      }, (slot) => {
        const it = this.save.weapons[slot];
        if (!it || this.save.weapons.filter(Boolean).length < 2) return;
        this.save.gold += scrapValue(it);
        this.save.weapons[slot] = null;
        if (this.save.active === slot) this.save.active = (1 - slot) as 0 | 1;
        this.equipVisual();
        sfx.break();
        render();
      }, () => {
        this.paused = false;
        this.refreshHud(true);
        this.persist();
      });
    };
    render();
  }

  // ---------- HUD / save ----------
  private goal() {
    const b = this.save.bosses;
    const forest = this.world.bosses[0];
    const cem = this.world.bosses[1];
    const fm = this.mobs.find((m) => m.def.id === forest.mob)!;
    const cm = this.mobs.find((m) => m.def.id === cem.mob)!;
    if (!b[forest.mob]?.firstKill) return { text: `Победи <b>${MOBS[forest.mob].boss!.titles[this.faction]}</b> на Опушке леса`, at: fm };
    if (!b[cem.mob]?.firstKill) return { text: 'Пройди через кладбище и одолей <b>Смерть</b>', at: cm };
    const alive = [fm, cm].filter((m) => m.alive);
    if (alive.length) return { text: 'Боссы вернулись — <b>фарм</b> снаряжения', at: alive[alive.length - 1] };
    const t = Math.ceil(Math.min(fm.respawnAt, cm.respawnAt) - this.time);
    return { text: `Боссы вернутся через <b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b>`, at: null };
  }

  /** Snapshot for the full-screen world map. */
  mapInfo() {
    const g = this.goal();
    return {
      hero: { x: this.hero.position.x, z: this.hero.position.z, facing: this.hero.facing },
      goal: { text: g.text, x: g.at?.spawn.x ?? null, z: g.at?.spawn.z ?? null },
      mobs: this.mobs.filter((m) => m.alive && !m.def.boss).map((m) => ({ x: m.pos.x, z: m.pos.z })),
      bosses: this.mobs.filter((m) => m.def.boss).map((m) => ({
        x: m.spawn.x, z: m.spawn.z, name: m.def.boss!.titles[this.faction], alive: m.alive,
        respawnIn: m.alive ? 0 : Math.max(0, m.respawnAt - this.time),
      })),
    };
  }

  refreshHud(full: boolean) {
    const g = this.goal();
    this.ui.hud({
      hp: this.hp, maxHp: this.maxHp, shield: this.shield, shieldMax: this.shieldMax,
      gold: this.save.gold,
      stats: { power: Math.round(this.power), hp: this.maxHp, regen: this.regen, speed: this.speed },
      goal: g.text,
      buffs: [
        this.nearFire ? '🔥 У костра: реген ×4' : '',
        this.time - this.lastFight > HERO.outOfCombatDelay && this.hp < this.maxHp ? '💤 Вне боя: реген ×3' : '',
        this.faction === 'orc' && this.hp < this.maxHp * 0.7 ? `🩸 Жажда крови: +${Math.round(30 * (1 - this.hp / this.maxHp))}% урона` : '',
      ].filter(Boolean),
      bosses: this.mobs.filter((m) => m.def.boss).map((m) => ({
        name: m.def.boss!.titles[this.faction],
        left: m.alive ? 0 : Math.max(1, Math.ceil(m.respawnAt - this.time)),
      })),
    });
    if (full) {
      this.ui.weapons(this.save.weapons, this.save.active, (it) => this.itemDamage(it), this.save.equip);
      this.ui.bagBadge(this.newItems, this.save.bag.length >= BAG_SIZE);
    }
    this.ui.minimap(this.hero.position, this.hero.facing, this.mobs.filter((m) => m.alive && m.pos.distanceTo(this.hero.position) < 45).map((m) => m.pos), this.world, this.mobs.filter((m) => m.def.boss).map((m) => ({ pos: m.spawn, alive: m.alive })));
    this.ui.edgeArrow(g.at && g.at.alive ? g.at.pos : null, this.camera);
  }

  /** Quality preset: shadows, mist and grass are the expensive parts on phones. */
  setLowGfx(low: boolean) {
    this.sun.castShadow = !low;
    this.world.setLowDetail(low);
  }

  persist() { writeSave(this.save); }

  // ---------- balance log ----------
  private fightOf(m: Mob) {
    return (m.fight ??= { t0: this.time, dealt: 0, taken: 0, hits: 0, combos: 0, slams: 0, slamHits: 0, hpStart: this.hp });
  }

  private endFight(m: Mob, result: 'kill' | 'reset' | 'death') {
    const f = m.fight;
    if (!f) return;
    m.fight = null;
    logFight({
      t: this.save.playTime ?? 0, mob: m.def.id, boss: !!m.def.boss, result, dur: +(this.time - f.t0).toFixed(1),
      dealt: Math.round(f.dealt), taken: Math.round(f.taken), hits: f.hits, combos: f.combos, slams: f.slams, slamHits: f.slamHits,
      hpStart: Math.round(f.hpStart), hpEnd: Math.round(this.hp), maxHp: this.maxHp, power: Math.round(this.power),
    });
  }

  private snapshot() {
    const it = this.weaponItem;
    const ttk: Record<string, number> = {};
    for (const d of Object.values(MOBS)) if (d.boss) ttk[d.id] = d.hp / Math.max(1, this.heroDps(this.weapon.type, d.resist));
    logSnap({
      t: Math.round(this.save.playTime ?? 0), zone: this.zone?.id ?? '?', power: this.power, maxHp: this.maxHp, regen: this.regen,
      gold: this.save.gold, kills: this.save.kills, deaths: heroDeaths(),
      weapon: `${it.def} r${it.rarity} lv${it.lvl}${it.sharpen ? ` +${it.sharpen}` : ''}`, ttk,
    });
  }
}


function turn(cur: number, want: number, k: number) {
  const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  return cur + d * Math.min(1, k);
}

