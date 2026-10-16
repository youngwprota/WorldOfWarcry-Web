import * as THREE from 'three';
import { Character } from '../character';
import { Creature } from '../creature';
import { StaticBody } from '../staticbody';
import { RARITY, STAVES, type BossAnim, type MobDef, type OrbKind } from '../config';
import type { Item } from '../items';
import { lootHtml, resistIcons } from '../icons';
import { MARK_COLOR, Unit, unitBar } from './unit';
import { behaviorOf, type MobBehavior } from './behavior';

/** Running counters of one fight with a mob (balance log). */
export interface FightStat { t0: number; dealt: number; taken: number; hits: number; combos: number; slams: number; slamHits: number; hpStart: number }

export class Mob extends Unit {
  readonly kind = 'mob';
  ch: Character | Creature | StaticBody;
  state: 'idle' | 'chase' | 'return' | 'dead' = 'idle';
  atkCd = 0;
  impact = -1;
  stun = 0;
  deadT = 0;
  wanderT = Math.random() * 3;
  wander = new THREE.Vector3();
  behavior: MobBehavior;
  /** Kiting: sidestep direction (±1) and seconds until it may flip. */
  strafe = 1;
  strafeT = 0;
  /** Zone kiting: flee direction as a turn (rad) off straight away from the hero, and seconds until it is re-rolled. */
  fleeA = 0;
  fleeT = 0;
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
  /** MobDef.twin: the shadow twin was called this fight; on the twin: the mob that called it. */
  twinned = false;
  twinOf: Mob | null = null;
  /** Death's soul: the hero walks through it. */
  passable = false;
  /** Death: seconds since the last soul rose, and seconds left of the summoning flight (untargetable meanwhile). */
  soulT = 0;
  ritual = 0;
  burstDue = false;
  /** Boss: `animNext` starts in `animDelay` s (a cone clip timed to its telegraph); -1 = none. */
  animDelay = -1;
  animNext: BossAnim = 'MeleeHigh';
  awake = true;
  /** Depth-scaled stats (DEPTH in config): use these instead of def.dmg / def.reward. */
  dmg: number;
  /** Fire staff: seconds of burning left, its damage per second, seconds to the next tick. */
  burn = 0;
  burnDps = 0;
  burnTick = 0;
  /** Ice staff: seconds of the slow and of the freeze left; the tint shown (0 none, 1 slowed, 2 frozen). */
  slow = 0;
  frozen = 0;
  chill = 0;
  constructor(public def: MobDef, spawn: THREE.Vector3, faction: 'human' | 'orc', layer: HTMLElement,
    mul = { hp: 1, dmg: 1, reward: 1, scale: 1 }, slot?: Partial<MobBehavior>, item: { icon: string; color: string }[] = []) {
    // Bosses, micro-bosses and elites get a bigger HP bar with their name: a boss's is coloured by difficulty,
    // a micro-boss's is orange, an elite's has its drop's quality colour. Over the bar: the loot (lootHtml);
    // right of it: weaknesses and resistances.
    const reward: Partial<Record<OrbKind, number>> = {};
    for (const [k, n] of Object.entries(def.reward) as [OrbKind, number][]) if (n) reward[k] = Math.round(n * mul.reward);
    const named = !!(def.boss || def.rank);
    const title = def.boss ? `<div class="bname">${def.boss.titles[faction]}</div>`
      : def.rank === 'mini' ? `<div class="bname" style="color:${MARK_COLOR.mini}">${def.name}</div>`
      : def.drop ? `<div class="bname" style="color:${RARITY[def.drop.rarity].color}">${def.name}</div>`
      : '';
    // a drop (Game.dropBadge: the item, or the class a boss opens) shows only that; a micro-boss its permanent bonus (+500 HP) instead of its orbs
    const loot = def.bonus ? lootHtml(def.bonus, null, true) : lootHtml(reward, item);
    super(spawn, layer, named ? 'mobui boss' : 'mobui', title + unitBar(loot, resistIcons(def, named ? 27 : 24)),
      'respawn' + (named ? ' boss' : ''));
    this.reward = reward;
    const [model, weapon] = def.model[faction];
    const scale = def.scale * mul.scale;
    this.ch = def.static ? new StaticBody(model, scale, def.tint === undefined ? undefined : new THREE.Color(def.tint))
      : def.creature ? new Creature(model, scale) : new Character(model, weapon, scale, def.skin);
    this.dmg = def.dmg * mul.dmg;
    this.ch.position.copy(spawn);
    this.ch.facing = Math.random() * Math.PI * 2;
    this.maxHp = this.hp = Math.round(def.hp * mul.hp);
    this.radius = def.static ? 0.8 : (def.creature ? 0.7 : 0.45) * scale;
    this.wander.copy(spawn);
    this.behavior = behaviorOf(def, slot);
  }
  /** Never fights: no AI, no knockback (static units and other passive behaviors). */
  get passive() { return this.behavior.disposition === 'passive'; }
  get fighting() { return this.state === 'chase'; }
  get alive() { return this.state !== 'dead'; }
  get pos() { return this.ch.position; }
  get visible() { return this.ch.root.visible; }
  get boss() { return !!this.def.boss; }
  get mark() { return this.def.boss ? 'boss' as const : this.def.rank ?? null; }
  get hittable() { return this.alive && this.awake && this.rise <= 0 && this.ritual <= 0; }
  get barY() { return (this.ch instanceof StaticBody ? this.ch.height + 0.3 : 2.15 * this.def.scale) * this.ch.root.scale.x; }
  get barRange() { return this.def.boss || this.def.rank ? 24 : 16; }
  get loaderReady() { return !this.temp && ((!this.dying && this.deadT - this.paidAt > 2.2) || this.boss); }
  /** Ice staff tint (static bodies keep their colours). */
  setChill(k: 0 | 1 | 2) {
    if (k === this.chill || this.ch instanceof StaticBody) return;
    this.chill = k;
    this.ch.setTint(k ? STAVES.ice.tint[k - 1] : 0xffffff);
  }
  respawn() {
    this.burn = this.slow = this.frozen = 0;
    this.setChill(0);
    this.fight = null;
    this.dying = false;
    this.loot = [];
    this.knock.set(0, 0, 0);
    this.state = 'idle';
    this.hp = this.maxHp;
    this.phase2 = false;
    this.adds = 0;
    this.twinned = false;
    this.soulT = 0;
    this.ritual = 0;
    this.burstDue = false;
    this.animDelay = -1;
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
