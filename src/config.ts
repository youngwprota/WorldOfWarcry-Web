import type { SwingKind } from './swing';
import type { HeroClass } from './party';
import type { MobBehavior } from './mobs/behavior';
// All gameplay numbers live here (GDD: "все числа — ориентиры").

/** Sword — slash (режущий), axe — chop (рубящий), hammer — crush (дробящий), mage staves — magic (магический). */
export type DamageType = 'slash' | 'chop' | 'crush' | 'pierce' | 'magic';
export type ResistTier = 'weak' | 'normal' | 'resist' | 'immune';
export type FactionId = 'human' | 'orc';
export type ZoneId = 'forest' | 'cemetery' | 'peaks' | 'swamp' | 'grove' | 'dunes' | 'hills';
export type WeaponAnim = 'SwordAttack' | 'AxeAttack' | 'MagicAttack';
/** Full-body Mixamo clips on the project rig (legs included), used by bosses. */
export type BossAnim = 'SlashAdvance' | 'MeleeHigh' | 'MeleeLong' | 'MeleeHorizontal';
export type AttackAnim = WeaponAnim | BossAnim;
/**
 * Hit markers: seconds into each attack clip at natural speed where the blow connects. Mob damage lands on this
 * frame if the hero is still in reach. Humanoid FBX clips by name, GLB creatures as `<model>:attack`.
 */
export const ATTACK_HIT: Record<string, number> = {
  SwordAttack: 0.6, AxeAttack: 0.83, MagicAttack: 1.13, SlashAdvance: 0.73, MeleeHigh: 0.32, MeleeLong: 1.07, MeleeHorizontal: 0.97,
  'orc_boar:attack': 9 / 24, 'undead_boar:attack': 9 / 24, 'human_murloc:attack': 0.6 / 1.3,
  'wild_bear:attack': 0.58, 'wild_direwolf:attack': 0.375, 'wild_lion:attack': 0.4, 'wild_dragon:attack': 1.04,
};
/** When a mob's damage lands: on the clip's hit marker, sped up only if the attack period is too short for it. */
export function mobImpact(hit: number, period: number) { return Math.min(hit, period * 0.8); }

/**
 * Design rectangles (virtual px, 9:16): the HUD and the windows are laid out at these sizes and scaled as a whole to fit
 * the screen, centred (src/ui.ts fit), so they look the same on every phone; outside the rectangle only the scene shows.
 */
export const UI_REF = { hud: { w: 540, h: 960 }, modal: { w: 760, h: 1351 } };

/** Damage taken by tier: a weakness +30%, a resistance −50%. */
export const RESIST_MULT: Record<ResistTier, number> = { weak: 1.3, normal: 1, resist: 0.5, immune: 0.25 };
/** Which party class deals a damage type: mobs resist and are weak to classes (warrior — sword, axe, hammer, polearm). */
export const DAMAGE_CLASS: Record<DamageType, HeroClass> = { slash: 'warrior', chop: 'warrior', crush: 'warrior', pierce: 'hunter', magic: 'mage' };
export const DAMAGE_TYPE_NAME: Record<DamageType, string> = { slash: 'режущий', chop: 'рубящий', crush: 'дробящий', pierce: 'колющий', magic: 'магический' };
export const DAMAGE_TYPE_COLOR: Record<DamageType, string> = { slash: '#7fd3ff', chop: '#ff8a5a', crush: '#ffb347', pierce: '#c8f07a', magic: '#b49bff' };

/**
 * Item quality. Weapon damage = (base + copy × (level − 1)) × the weapon's dmgMul: every extra copy of the same
 * item (same weapon / armour piece and quality) raises its level by one — a rare sword gains +100 per copy,
 * an epic one +500, a legendary one +1000. `mult` scales armour.
 */
export const RARITY = [
  { name: 'Обычное', color: '#c9c9c9', base: 20, copy: 10, mult: 1 },
  { name: 'Необычное', color: '#4cd964', base: 26, copy: 25, mult: 1.3 },
  { name: 'Редкое', color: '#4ea3ff', base: 34, copy: 100, mult: 1.7 },
  { name: 'Эпическое', color: '#b35cff', base: 45, copy: 500, mult: 2.3 },
  { name: 'Легендарное', color: '#ffc21a', base: 60, copy: 1000, mult: 3 },
  { name: 'Мифическое', color: '#ff3b3b', base: 80, copy: 2500, mult: 4 },
];

/** A specific item a mob drops (elites, bosses). `rarity` indexes RARITY. */
export interface ItemDrop { kind: 'weapon' | 'armor'; def: string; rarity: number }

export interface WeaponDef {
  id: string;
  name: string;
  type: DamageType;
  /** Damage multiplier on the quality's base damage (slow weapons hit harder). */
  dmgMul: number;
  aps: number; // attacks per second
  shape: 'arc' | 'circle';
  arc: number; // degrees, for 'arc'
  range: number; // metres
  anim: WeaponAnim;
  model: Record<FactionId, string>;
  icon: string;
  stun?: number; // chance
  /** Plain swings hit only the current target (the combo finisher still hits an area). */
  single?: boolean;
  /** Procedural swings (src/swing.ts) cycled along the combo chain, instead of the `anim` clip. */
  swing?: SwingKind[];
  /** Polearm: the series never breaks (a pause or a whiff does not reset it). */
  cycle?: boolean;
  /**
   * Shield (the warrior's class slot): never swings; incoming damage × (1 − `reduce`); a hit taken may trigger a
   * counter-strike of the weapon at the attacker (`counter` chance by its rank), not more often than every `cd` s;
   * `reflect`: that share of the damage taken goes back to the attacker.
   */
  guard?: { reduce: number; counter: Record<MobRank, number>; cd: number; reflect?: number };
  /** Held in the left hand (the bow). */
  leftHand?: boolean;
  /**
   * Bow: the blow looses an arrow (model by faction) flying at `speed` m/s that homes in on the target and hits on
   * arrival; the finisher is a volley of `volley` arrows at the nearest units in range.
   */
  shot?: { speed: number; arrow: Record<FactionId, string>; volley: number };
  /** Mage staff of this element (STAVES): the mage's weapon (src/party.ts), held in the left hand. */
  staff?: StaffElement;
  /**
   * Mage orb: the mage's second slot (like a shield, never swings), floats above the right shoulder.
   * Passive bonuses while equipped: `regen` +share of HP regen, `power` +share of damage, `speed` +share of run speed,
   * `defense` +share of defense, `pull` chance a kill gives an extra gacha pull, `critDmg` [min, max] rolled per hit
   * and added to the crit multiplier.
   */
  orb?: { regen?: number; power?: number; speed?: number; defense?: number; pull?: number; critDmg?: [number, number] };
  /** Model per rarity (RARITY index), GLB props with their own materials (src/assets.ts loadProps); over `model`. */
  tiers?: string[];
  /** The item exists only at this rarity (RARITY index): the mage's orbs. */
  rarity?: number;
}

export type MobRank = 'normal' | 'elite' | 'mini' | 'boss';
export const mobRank = (d: MobDef): MobRank => (d.boss ? 'boss' : d.rank ?? 'normal');

export const RARITY_IDS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const staffTiers = (el: StaffElement) => RARITY_IDS.map((r) => `staff_${el}_${r}`);
/** Mage armour skin: the caster body parts of a rarity (models/casters, loaded on demand; src/assets.ts prepareOwnMaterials). */
export const casterModel = (faction: FactionId, rarity: number) => `casters/${faction}_caster_${RARITY_IDS[rarity]}`;

export const WEAPONS: Record<string, WeaponDef> = {
  sword: {
    id: 'sword', name: 'Меч', type: 'slash', dmgMul: 1, aps: 1.15, shape: 'arc', arc: 140, range: 2.3,
    anim: 'SwordAttack', model: { human: 'sword_human_knight', orc: 'sword_orc_warrior' }, icon: '🗡️', single: true,
  },
  axe: {
    id: 'axe', name: 'Топор', type: 'chop', dmgMul: 1.25, aps: 0.95, shape: 'arc', arc: 160, range: 2.3,
    anim: 'AxeAttack', model: { human: 'axe', orc: 'axe_orc_grunt' }, icon: '🪓',
  },
  hammer: {
    id: 'hammer', name: 'Молот', type: 'crush', dmgMul: 1.7, aps: 0.7, shape: 'circle', arc: 360, range: 2.1,
    anim: 'AxeAttack', model: { human: 'hammer_human_paladin', orc: 'hammer_human_paladin' }, icon: '🔨',
  },
  // board «Система оружий»: damage a bit under the sword, slow, long reach; thrust → thrust (target only) → spin 360°
  polearm: {
    id: 'polearm', name: 'Древковое', type: 'slash', dmgMul: 0.9, aps: 1.0, shape: 'arc', arc: 60, range: 3.1,
    anim: 'SwordAttack', model: { human: 'nagamaki', orc: 'nagamaki' }, icon: '⚔️', single: true, cycle: true,
    swing: ['thrust', 'thrust', 'sweep'],
  },
  // shields: the warrior's class slot (src/party.ts); they never swing, the swing numbers are unused
  shield_tower: {
    id: 'shield_tower', name: 'Башенный щит', type: 'crush', dmgMul: 0, aps: 1, shape: 'arc', arc: 0, range: 0,
    anim: 'AxeAttack', model: { human: 'shield', orc: 'shield' }, icon: '🛡️',
    guard: { reduce: 0.3, counter: { normal: 0.08, elite: 0.12, mini: 0.15, boss: 0.2 }, cd: 0.6 },
  },
  shield_buckler: {
    id: 'shield_buckler', name: 'Баклер', type: 'crush', dmgMul: 0, aps: 1, shape: 'arc', arc: 0, range: 0,
    anim: 'AxeAttack', model: { human: 'shield', orc: 'shield' }, icon: '🛡️',
    guard: { reduce: 0.1, counter: { normal: 0.35, elite: 0.45, mini: 0.55, boss: 0.65 }, cd: 0.3 },
  },
  shield_spiked: {
    id: 'shield_spiked', name: 'Шипастый щит', type: 'crush', dmgMul: 0, aps: 1, shape: 'arc', arc: 0, range: 0,
    anim: 'AxeAttack', model: { human: 'shield', orc: 'shield' }, icon: '🛡️',
    guard: { reduce: 0.15, counter: { normal: 0.15, elite: 0.2, mini: 0.25, boss: 0.3 }, cd: 0.4, reflect: 0.5 },
  },
  // hunter (src/party.ts): ~2.5 sword ranges
  bow: {
    id: 'bow', name: 'Лук', type: 'pierce', dmgMul: 0.9, aps: 1.0, shape: 'arc', arc: 60, range: 5.75,
    anim: 'SwordAttack', model: { human: 'bow_human_archer', orc: 'bow_orc_archer' }, icon: '🏹', single: true,
    leftHand: true,
    shot: { speed: 24, arrow: { human: 'arrow_human_archer', orc: 'arrow_orc_archer' }, volley: 3 },
  },
  staff_fire: {
    id: 'staff_fire', name: 'Посох огня', type: 'magic', dmgMul: 1.9, aps: 0.495, shape: 'arc', arc: 60, range: 3.2,
    anim: 'MagicAttack', model: { human: 'mage_staff', orc: 'mage_staff' }, icon: '🔥', staff: 'fire',
    tiers: staffTiers('fire'),
  },
  staff_ice: {
    id: 'staff_ice', name: 'Посох льда', type: 'magic', dmgMul: 0.5, aps: 1.8, shape: 'arc', arc: 60, range: 3.2,
    anim: 'MagicAttack', model: { human: 'mage_staff', orc: 'mage_staff' }, icon: '❄️', single: true, staff: 'ice',
    tiers: staffTiers('ice'),
  },
  staff_wind: {
    id: 'staff_wind', name: 'Посох ветра', type: 'magic', dmgMul: 0.45, aps: 1.15, shape: 'arc', arc: 90, range: 3.2,
    anim: 'MagicAttack', model: { human: 'mage_staff', orc: 'mage_staff' }, icon: '🌪️', staff: 'wind',
    tiers: staffTiers('wind'),
  },
  orb_vigor: {
    id: 'orb_vigor', name: 'Благословление бодрости', type: 'magic', dmgMul: 0, aps: 0, shape: 'arc', arc: 0, range: 0,
    anim: 'SwordAttack', model: { human: 'orb_vigor', orc: 'orb_vigor' }, icon: '💚', orb: { regen: 0.3 }, rarity: 1,
  },
  orb_fury: {
    id: 'orb_fury', name: 'Яростный клич', type: 'magic', dmgMul: 0, aps: 0, shape: 'arc', arc: 0, range: 0,
    anim: 'SwordAttack', model: { human: 'orb_glass', orc: 'orb_glass' }, icon: '🎲', orb: { power: 0.1 }, rarity: 0,
  },
  orb_swift: {
    id: 'orb_swift', name: 'Сфера ветра', type: 'magic', dmgMul: 0, aps: 0, shape: 'arc', arc: 0, range: 0,
    anim: 'SwordAttack', model: { human: 'orb_swift', orc: 'orb_swift' }, icon: '💨', orb: { speed: 0.05 }, rarity: 2,
  },
  orb_ward: {
    id: 'orb_ward', name: 'Сфера оберега', type: 'magic', dmgMul: 0, aps: 0, shape: 'arc', arc: 0, range: 0,
    anim: 'SwordAttack', model: { human: 'orb_ward', orc: 'orb_ward' }, icon: '💠', orb: { defense: 0.2 }, rarity: 3,
  },
  orb_fortune: {
    id: 'orb_fortune', name: 'Сфера удачи', type: 'magic', dmgMul: 0, aps: 0, shape: 'arc', arc: 0, range: 0,
    anim: 'SwordAttack', model: { human: 'orb_fortune', orc: 'orb_fortune' }, icon: '🪙', orb: { pull: 0.01 }, rarity: 4,
  },
  orb_demon: {
    id: 'orb_demon', name: 'Сфера демона', type: 'magic', dmgMul: 0, aps: 0, shape: 'arc', arc: 0, range: 0,
    anim: 'SwordAttack', model: { human: 'orb_demon', orc: 'orb_demon' }, icon: '😈', orb: { critDmg: [0.11, 0.66] }, rarity: 5,
  },
};

export type StaffElement = 'fire' | 'ice' | 'wind';
/**
 * Mage staves: they strike like melee weapons (WEAPONS range ≈ 2× the sword). A bolt (`bolt`: centre → edge colour)
 * leaves the hand at the peak of the swing and the hit lands when it arrives. `knock`: knockback speed of a hit (distance ≈ knock / 9 m).
 */
export const STAFF_BOLT_SPEED = 14; // m/s
export const STAVES = {
  /** Mobs within `splash.radius` m of the target take × `splash.mul`; every mob hit burns for `burn.time` s
   *  (`burn.dps` of the igniting hit per second, ticks every `burn.tick` s) and takes +`burn.vuln` damage from
   *  everything; a new hit refreshes the burn, never stacks it. */
  fire: { color: 0xff6a2a, bolt: [0xffa21f, 0xff2410], knock: 1.5, splash: { radius: 1.6, mul: 0.5 }, burn: { time: 3, dps: 0.06, tick: 0.5, vuln: 0.05 } },
  /** Hits slow the target's movement to × `slow.mul` for `slow.time` s (bosses too); every `freeze.every`-th hit in a
   *  row on the same mob freezes it for `freeze.time` s (not micro-bosses and bosses). `tint`: slowed, frozen. */
  ice: { color: 0x8fd8ff, bolt: [0x2f6bff, 0xffffff], knock: 0, slow: { time: 2.5, mul: 0.55 }, freeze: { every: 5, time: 2 }, tint: [0xa8d4ff, 0x6fe2ff] },
  /** Every `orb.every`-th landed swing also throws an orb at the target: after `orb.flight` s it hits every mob within
   *  `orb.radius` m for × `orb.dmg` and pulls them `orb.force` of the way to its centre (bosses too). */
  wind: { color: 0xd8ffe8, bolt: [0x3ee86a, 0x2fb8ff], knock: 6, orb: { every: 3, radius: 3, force: 0.4, dmg: 0.6, flight: 0.45 } },
} as const;

/**
 * Hunter's pets: they sit in the hunter's second weapon slot, run after him and bite what he shoots at. Mobs
 * ignore them for now. A bite deals `dmg` × the damage of the hunter's bow (with his power and crits off).
 */
export interface PetDef {
  id: string;
  name: string;
  /** Art icon id (src/art.ts) in the slot. */
  icon: string;
  /** GLB creature (src/creature.ts). */
  model: string;
  scale: number;
  type: DamageType;
  dmg: number;
  aps: number;
  /** Bite reach from its centre to the foe's edge, m. */
  range: number;
  /** Run speed, m/s: a bit above the hero's so it keeps up. */
  speed: number;
}
export const PETS: Record<string, PetDef> = {
  boar: { id: 'boar', name: 'Вепрь', icon: 'boar', model: 'orc_boar', scale: 1.0, type: 'crush', dmg: 0.6, aps: 0.9, range: 1.3, speed: 6.5 },
};
/** Pet the hunter starts with. */
export const START_PET = 'boar';

export const SHARPEN = { max: 10, perLevel: 0.08, cost: (lvl: number) => 40 + lvl * lvl * 25 };

/**
 * Combo finisher: the `hits`-th uninterrupted hit in a row (each swing must connect, no pause between).
 * No weapon has one for now: weapon abilities come from the «Эпическое» rarity up and are not implemented yet.
 */
export interface ComboDef {
  name: string;
  hits: number;
  window: number; // extra seconds allowed between swings
  mult: number;
  rangeAdd: number;
  shape: 'arc' | 'circle';
  arc: number;
  knock: number;
  stun: number;
  spin: boolean;
  color: number;
}
export const COMBOS: Record<string, ComboDef> = {};

export interface FactionDef {
  id: FactionId;
  name: string;
  fantasy: string;
  hero: string;
  /** Model + weapon shown on the faction-select stage (the race's champion). */
  preview: [string, string];
  startWeapon: string;
  color: string;
  campBuildings: string[];
  campProps: string[];
  campfire: string;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  human: {
    id: 'human', name: 'Люди', fantasy: 'Дисциплина, защита, свет', hero: 'peasant', preview: ['paladin', 'hammer_human_paladin'], startWeapon: 'sword',
    color: '#3f7fd8',
    campBuildings: ['house_Lv1', 'house_Lv2', 'tower_Lv1', 'barrack_Lv1'],
    campProps: ['banner', 'flag', 'lantern_street'],
    campfire: 'campfire',
  },
  orc: {
    id: 'orc', name: 'Орки', fantasy: 'Ярость, натиск, сила', hero: 'orc_peon', preview: ['orc_chieftain', 'axe_orc_chieftain'], startWeapon: 'sword',
    color: '#c0392b',
    campBuildings: ['orc_house_Lv1', 'orc_house_Lv2', 'orc_tower_Lv1', 'orc_barrack_Lv1'],
    campProps: ['orc_banner', 'orc_tusk_standing', 'orc_practice_dummy', 'orc_skull'],
    campfire: 'orc_campfire',
  },
};

export interface MobDef {
  id: string;
  name: string;
  /** model + weapon per player faction (enemy race mirrors the player's choice). */
  model: Record<FactionId, [string, string | null]>;
  anim: AttackAnim;
  hp: number;
  dmg: number;
  aps: number;
  range: number;
  speed: number;
  aggro: number;
  scale: number;
  resist: Partial<Record<DamageType, ResistTier>>;
  /** HP fraction per second once nobody has hit the mob for MOB_REGEN_DELAY s. */
  regen: number;
  /** Stat points on the hero's curves (STAT_CURVE), 0 when left out. */
  crit?: number;
  critDmg?: number;
  dodge?: number;
  /** GLB animal (Creature): `model` names a .glb with its own rig and clips, weapon is always null. */
  creature?: boolean;
  /**
   * Static unit (src/staticbody.ts): `model` names a level model (a tree, a crate…); it stands on its spawn
   * point, never moves or attacks, and is hit, resists, drops and respawns like any mob.
   */
  static?: boolean;
  /** Static unit recolour: multiplies its materials. */
  tint?: number;
  /** Recolour: body textures are swapped by the table SKINS[skin] (src/assets.ts). */
  skin?: string;
  /** Speed (m/s) the hit shoves the hero back with. */
  push?: number;
  /** elite: drops `drop` on every kill; mini: micro-boss giving `bonus` stats. Main bosses have `boss`. */
  rank?: 'elite' | 'mini';
  drop?: ItemDrop;
  /** More items dropped along with `drop` on every kill (main bosses), each shown over the HP bar. */
  moreDrops?: ItemDrop[];
  /** Permanent stats added straight to the hero on every kill (micro-bosses), in stat units: hp 500 = +500 HP. */
  bonus?: OrbReward;
  /** Fixed power orbs dropped on death (shown above the HP bar) — one stat only. */
  reward: OrbReward;
  respawn: number; // seconds
  /** Below this HP fraction it throws a smoke bomb once per fight and a second one of it steps out (Game.callTwin). */
  twin?: number;
  /** How it moves and when it fights (src/mobs/behavior.ts); a spawn slot may override it. */
  behavior?: Partial<MobBehavior>;
  /** Ranged: the blow is a projectile flying at the hero (`range` is then its shooting distance). */
  shot?: { speed: number; arrow: Record<FactionId, string> };
  boss?: BossDef;
}

/** Boss fight tunables (bossLogic in game.ts). Damage multipliers apply to the boss's `dmg`. */
export interface BossDef {
  titles: Record<FactionId, string>;
  zone: ZoneId;
  /** Gate ids (src/island.ts GATES) opened by the first kill. */
  unlocks: string[];
  /** Party class (src/party.ts, `locked`) the kill opens: shown over the boss as its drop until then. */
  unlockClass?: HeroClass;
  slamRadius: number;
  slamMul: number; // big slam around the boss
  slamDelay: number; // telegraph time, s
  cd: number; // seconds between specials
  cdPhase2: number;
  phase2At: number; // HP fraction
  phase2Dmg: number; // melee multiplier in phase 2
  chance: number; // phase 2: chance of the chasing blasts instead of the slam
  chaseCount: number;
  chaseRadius: number;
  chaseMul: number;
  chaseDelay: number;
  chaseGap: number; // s between blasts
  chaseRange: number; // blasts only when the hero is this close, m
  /** Cone attacks aimed at the hero; the boss cycles slam → cones[0] → cones[1] … → reap (phase 2 may swap any step for the chasing blasts). */
  cones?: ConeDef[];
  /** Soul reap, the last step of the cycle. */
  reap?: ReapDef;
  /** No slam around the boss: the cycle is the cones and the reap only (the phase 2 chasing blasts stay). */
  noSlam?: boolean;
  /**
   * Packs of small mobs run in when the boss HP first falls below each fraction in `at`: from the fort entrance
   * (`fort`), else from the far side of the arena. `bark`: the boss's call.
   */
  reinforce?: { at: number[]; pool: string[]; bark: string; fort?: boolean };
  souls?: SoulsDef;
}
/** One cone attack: `yaws` are offsets (rad) from the line to the hero, one cone each; damage = boss dmg × mul. */
export interface ConeDef { half: number; len: number; mul: number; yaws: number[]; delay?: number; anim?: BossAnim }
/** A slow scythe sweep at the hero (`delay` s telegraph): each of the boss's souls caught in it dies and heals the boss by heal × max HP. */
export interface ReapDef { half: number; len: number; mul: number; heal: number; delay: number; anim: BossAnim }
/**
 * Death's souls: one `mob` rises every `every` s of the fight, `burst` more at each HP fraction in `burstAt`
 * (the boss flies up `fly.height` m in `fly.up` s, hangs untargetable for `fly.hover` s in the bind pose (arms out), the burst rises, then it comes down in
 * `fly.down` s with an `anim` swipe, visual only). They rise `ring` m from the boss, never in the `backHalf` (rad)
 * cone behind it; HP = `hits` plain blows of the hero's weapon; the hero walks through them.
 */
export interface SoulsDef { mob: string; every: number; burstAt: number[]; burst: number; anim: BossAnim; fly: { up: number; hover: number; down: number; height: number }; hits: number; ring: [number, number]; backHalf: number }
const BOSS_BASE = {
  slamMul: 2.2, slamDelay: 1.25, cd: 6.5, cdPhase2: 4.2, phase2At: 0.5, phase2Dmg: 1.2,
  chance: 0.55, chaseCount: 3, chaseRadius: 2.3, chaseMul: 1.4, chaseDelay: 1.0, chaseGap: 0.45, chaseRange: 11,
};

/** Seconds without taking damage before a mob (bosses too) starts regenerating `MobDef.regen`. */
export const MOB_REGEN_DELAY = 5;

/**
 * Each location's enemies share one profile by class (DAMAGE_CLASS): what they resist (−50%) and are weak to (+30%).
 * `alt`: every other mob of the location has this profile instead (the Snow Pass: half resist the warrior and are weak to
 * the hunter, half the other way round);
 * `boss`: the location's main boss resists these and has no weakness (none: like everyone). Game.addMob gives every
 * mob the profile of the location it stands in; MobDefs carry their home location's one (`foes`).
 */
export interface ZoneFoes { weak: HeroClass[]; resist: HeroClass[]; alt?: { weak: HeroClass[]; resist: HeroClass[] }; boss?: HeroClass[] }
const ALL_CLASSES: HeroClass[] = ['warrior', 'hunter', 'mage'];
export const ZONE_FOES: Partial<Record<ZoneId, ZoneFoes>> = {
  forest: { weak: [], resist: [], boss: ['warrior'] },
  cemetery: { weak: ['hunter'], resist: ['warrior'] },
  peaks: { weak: ['hunter'], resist: ['warrior'], alt: { weak: ['warrior'], resist: ['hunter'] }, boss: ['warrior', 'hunter'] },
  hills: { weak: ['mage'], resist: ['warrior', 'hunter'] },
  grove: { weak: ['warrior'], resist: ['hunter', 'mage'], boss: ALL_CLASSES },
  swamp: { weak: ['hunter'], resist: ['mage', 'warrior'], boss: ALL_CLASSES },
  dunes: { weak: ['mage'], resist: ['hunter', 'warrior'], boss: ALL_CLASSES },
};
/** Resistances of a mob of location `zone`: a plain one, an `alt` one (ZoneFoes.alt) or the main boss. */
export function zoneResist(zone: ZoneId, kind: 'mob' | 'alt' | 'boss' = 'mob'): MobDef['resist'] {
  const f = ZONE_FOES[zone];
  if (!f) return {};
  const boss = kind === 'boss' && f.boss;
  const alt = kind === 'alt' ? f.alt : undefined;
  const resist = boss ? f.boss! : alt ? alt.resist : f.resist;
  const weak = boss ? [] : alt ? alt.weak : f.weak;
  const out: MobDef['resist'] = {};
  for (const t of Object.keys(DAMAGE_CLASS) as DamageType[]) {
    if (resist.includes(DAMAGE_CLASS[t])) out[t] = 'resist';
    else if (weak.includes(DAMAGE_CLASS[t])) out[t] = 'weak';
  }
  return out;
}
function foes(zone: ZoneId): Pick<MobDef, 'resist'> {
  return { resist: zoneResist(zone) };
}

/** Static trees of the forest (MobDef.static), 400–2000 HP, each with its own loot: HP early, then damage, regen, speed. */
function staticTrees(): Record<string, MobDef> {
  const tree = (id: string, name: string, hp: number, scale: number, loot: Pick<MobDef, 'reward' | 'drop'>): MobDef => ({
    id, name, static: true, model: { human: ['elf_tree', null], orc: ['elf_tree', null] },
    anim: 'SwordAttack', hp, dmg: 0, aps: 0, range: 0, speed: 0, aggro: 0, regen: 0, scale,
    ...foes('forest'), respawn: 300, ...loot,
  });
  return {
    tree_young: tree('tree_young', 'Молодое дерево', 400, 0.6, { reward: { hp: 4 } }),
    tree_birch: tree('tree_birch', 'Берёза', 1000, 0.7, { reward: { power: 2 } }),
    tree_spring: tree('tree_spring', 'Родниковое дерево', 2000, 0.75, { reward: { regen: 1 } }),
    tree_windy: tree('tree_windy', 'Ветреный дуб', 2000, 0.8, { reward: { speed: 2 } }),
  };
}

/**
 * Mob ranks besides plain mobs and the location's main boss (`boss`):
 * - elite — 1–3 per location, always drops its own `drop` item (map: that item's icon in a rarity frame);
 * - mini  — micro-boss (map: small orange skull), gives permanent stats `bonus` on every kill.
 * Main boss: big red skull on the map; its first kill opens the gates in `boss.unlocks`.
 */
export const MOBS: Record<string, MobDef> = {
  // ---------- Forest Edge: bandits hit with swords (slash), weak to swords (slash) ----------
  bandit_thug: {
    id: 'bandit_thug', name: 'Разбойник',
    model: { human: ['orc_peon', 'sword_orc_warrior'], orc: ['peasant', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 150, dmg: 4, aps: 0.7, range: 1.5, speed: 3.0, aggro: 4.5, regen: 0.04, scale: 1,
    ...foes('forest'), reward: { hp: 3 }, respawn: 45,
  },
  bandit_fighter: {
    id: 'bandit_fighter', name: 'Головорез',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 220, dmg: 6, aps: 0.8, range: 1.6, speed: 3.4, aggro: 5, regen: 0.03, scale: 1.08,
    ...foes('forest'), reward: { power: 1 }, respawn: 60,
  },
  // ---------- the forest's elites: each drops an uncommon piece of the warrior's kit (no common items drop: only the start weapons are common) ----------
  bandit_veteran: {
    id: 'bandit_veteran', name: 'Ветеран', rank: 'elite',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 800, dmg: 8, aps: 0.9, range: 1.8, speed: 3.4, aggro: 5.2, regen: 0.03, scale: 1.3,
    ...foes('forest'), reward: { power: 3 }, respawn: 300,
    drop: { kind: 'armor', def: 'plate_chest', rarity: 1 },
  },
  bandit_brute: {
    id: 'bandit_brute', name: 'Громила', rank: 'elite',
    model: { human: ['orc_grunt', 'sword_orc_warrior'], orc: ['human_knight', 'sword_human_knight'] },
    anim: 'SwordAttack', hp: 1600, dmg: 14, aps: 0.7, range: 1.8, speed: 3.2, aggro: 5.2, regen: 0.03, scale: 1.35,
    ...foes('forest'), reward: { hp: 8 }, respawn: 300,
    drop: { kind: 'armor', def: 'plate_head', rarity: 1 },
  },
  bandit_lumberjack: {
    id: 'bandit_lumberjack', name: 'Лесоруб', rank: 'elite',
    model: { human: ['orc_peon', 'sword_orc_warrior'], orc: ['peasant', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 2000, dmg: 17, aps: 0.6, range: 1.8, speed: 3.0, aggro: 5.2, regen: 0.03, scale: 1.45,
    ...foes('forest'), reward: { regen: 3 }, respawn: 300,
    // a copy of the hero's starting sword: it levels the sword up
    drop: { kind: 'weapon', def: 'sword', rarity: 1 },
  },
  bandit_runner_elite: {
    id: 'bandit_runner_elite', name: 'Скороход', rank: 'elite',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 1200, dmg: 11, aps: 0.9, range: 1.8, speed: 3.8, aggro: 5.2, regen: 0.03, scale: 1.3,
    ...foes('forest'), reward: { speed: 2 }, respawn: 300,
    drop: { kind: 'armor', def: 'plate_legs', rarity: 1 },
  },
  // Reinforcements of the bandit chief: weak, no drops (they leave only a few orbs).
  bandit_runner: {
    id: 'bandit_runner', name: 'Бегун',
    model: { human: ['orc_peon', 'sword_orc_warrior'], orc: ['peasant', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 260, dmg: 5, aps: 0.9, range: 1.5, speed: 4.4, aggro: 8, regen: 0, scale: 0.95,
    ...foes('forest'), reward: { speed: 1 }, respawn: 0,
  },
  bandit_hammerer: {
    id: 'bandit_hammerer', name: 'Мечник',
    model: { human: ['orc_grunt', 'sword_orc_warrior'], orc: ['human_knight', 'sword_human_knight'] },
    anim: 'SwordAttack', hp: 450, dmg: 8, aps: 0.6, range: 1.7, speed: 3.2, aggro: 8, regen: 0, scale: 1.1,
    ...foes('forest'), reward: { hp: 1 }, respawn: 0,
  },
  bandit_cutter: {
    id: 'bandit_cutter', name: 'Рубака',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 340, dmg: 7, aps: 0.8, range: 1.6, speed: 3.6, aggro: 8, regen: 0, scale: 1,
    ...foes('forest'), reward: { power: 1 }, respawn: 0,
  },
  // Guards of the hub boss camp and the Snow Pass gate: late in the forest cycle (GUARD_PACKS: forest charges), its biggest damage, no unlocks.
  boss_guard: {
    id: 'boss_guard', name: 'Страж лагеря',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 2000, dmg: 15, aps: 0.8, range: 1.8, speed: 3.4, aggro: 5.5, regen: 0.03, scale: 1.3,
    ...foes('forest'), reward: { power: 6 }, respawn: 300,
  },
  gate_guard: {
    id: 'gate_guard', name: 'Страж прохода',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 1500, dmg: 12, aps: 0.8, range: 1.7, speed: 3.4, aggro: 5.2, regen: 0.03, scale: 1.2,
    ...foes('forest'), reward: { power: 4 }, respawn: 300,
  },
  bandit_warlord: {
    id: 'bandit_warlord', name: 'Свирепый вожак', rank: 'mini',
    model: { human: ['orc_chieftain', 'sword_orc_warrior'], orc: ['paladin', 'sword_human_knight'] },
    anim: 'SwordAttack', hp: 2200, dmg: 17, aps: 0.65, range: 2.1, speed: 3.4, aggro: 5.5, regen: 0.03, scale: 1.55,
    ...foes('forest'), reward: { hp: 8 }, respawn: 900,
    bonus: { hp: 100 },
  },
  bandit_chief: {
    id: 'bandit_chief', name: 'Атаман',
    model: { human: ['orc_chieftain', 'sword_orc_warrior'], orc: ['paladin', 'sword_human_knight'] },
    // tuned to the hero after one forest cycle on the forest's own drops (no gacha there): a coin flip at ~90% of it
    anim: 'SwordAttack', hp: 10500, dmg: 34, aps: 0.6, range: 2.4, speed: 3.6, aggro: 6, regen: 0.03, scale: 1.9,
    ...foes('forest'), reward: { power: 12 }, respawn: 900,
    // the warrior's weapons barely scratch him (−50%)
    resist: zoneResist('forest', 'boss'),
    boss: {
      ...BOSS_BASE, titles: { human: 'Вождь Клык', orc: 'Паладин-отступник' }, zone: 'forest', unlocks: ['forest-cemetery'], unlockClass: 'hunter',
      slamRadius: 4.2, slamMul: 2.4, chaseMul: 1.4, phase2Dmg: 1.2,
      cones: [
        { half: 0.18, len: 15, mul: 2.2, yaws: [0] }, // narrow and long
        { half: 0.95, len: 6.5, mul: 2.4, yaws: [0] }, // wide and short
        { half: 0.2, len: 11, mul: 1.8, yaws: [-0.65, 0, 0.65] }, // three-cone fan
      ],
      reinforce: { at: [0.5, 0.3, 0.2], pool: ['bandit_runner', 'bandit_hammerer', 'bandit_cutter', 'boar'], bark: 'Ко мне, ребята!', fort: true },
    },
  },
  // ---------- Old Cemetery: the undead hit with blades (slash), weak to hammers, resist blades and axes ----------
  // ---------- creatures (GLB animals, src/creature.ts) ----------
  boar: {
    id: 'boar', name: 'Вепрь', creature: true, push: 5,
    model: { human: ['orc_boar', null], orc: ['orc_boar', null] },
    anim: 'AxeAttack', hp: 130, dmg: 4, aps: 0.9, range: 1.6, speed: 2.1, aggro: 4, regen: 0.04, scale: 1.5,
    ...foes('forest'), reward: { speed: 1 }, respawn: 40,
  },
  murloc: {
    id: 'murloc', name: 'Мурлок', creature: true,
    model: { human: ['human_murloc', null], orc: ['human_murloc', null] },
    anim: 'SwordAttack', hp: 1200, dmg: 1, aps: 0.85, range: 1.5, speed: 3.4, aggro: 4.5, regen: 0.04, scale: 1.1,
    ...foes('forest'), reward: { power: 1 }, respawn: 45,
  },
  undead_boar: {
    id: 'undead_boar', name: 'Нежить-вепрь', creature: true, push: 5,
    model: { human: ['undead_boar', null], orc: ['undead_boar', null] },
    anim: 'AxeAttack', hp: 520, dmg: 10, aps: 0.85, range: 1.6, speed: 1.9, aggro: 4.5, regen: 0.03, scale: 1.5,
    ...foes('cemetery'), reward: { hp: 1 }, respawn: 50,
  },
  // ---------- static units of the forest: trees that only stand and drop their loot ----------
  ...staticTrees(),
  // WoW creatures in the game palette, shown in the "zoo" by the camp gate (ZOO, src/world.ts); weak on purpose
  wild_bear: {
    id: 'wild_bear', name: 'Медведь', creature: true, push: 4,
    model: { human: ['wild_bear', null], orc: ['wild_bear', null] },
    anim: 'AxeAttack', hp: 160, dmg: 4, aps: 0.7, range: 1.8, speed: 2.4, aggro: 3.5, regen: 0.04, scale: 0.8,
    ...foes('forest'), reward: { hp: 1 }, respawn: 20,
  },
  wild_direwolf: {
    id: 'wild_direwolf', name: 'Лютоволк', creature: true,
    model: { human: ['wild_direwolf', null], orc: ['wild_direwolf', null] },
    anim: 'AxeAttack', hp: 110, dmg: 3, aps: 0.9, range: 1.6, speed: 3.2, aggro: 3.5, regen: 0.04, scale: 0.65,
    ...foes('forest'), reward: { speed: 1 }, respawn: 20,
  },
  wild_lion: {
    id: 'wild_lion', name: 'Лев', creature: true,
    model: { human: ['wild_lion', null], orc: ['wild_lion', null] },
    anim: 'AxeAttack', hp: 130, dmg: 4, aps: 0.8, range: 1.7, speed: 3.0, aggro: 3.5, regen: 0.04, scale: 0.8,
    ...foes('forest'), reward: { power: 1 }, respawn: 20,
  },
  wild_dragon: {
    id: 'wild_dragon', name: 'Чёрный дракон', creature: true, push: 6,
    model: { human: ['wild_dragon', null], orc: ['wild_dragon', null] },
    anim: 'AxeAttack', hp: 400, dmg: 6, aps: 0.5, range: 2.6, speed: 2.2, aggro: 4, regen: 0.04, scale: 0.25,
    ...foes('forest'), reward: { power: 2 }, respawn: 30,
  },
  skeleton_worker: {
    id: 'skeleton_worker', name: 'Мертвяк',
    model: { human: ['undead_worker', null], orc: ['undead_worker', null] },
    anim: 'SwordAttack', hp: 500, dmg: 10, aps: 0.8, range: 1.4, speed: 2.8, aggro: 4.5, regen: 0.03, scale: 1,
    ...foes('cemetery'), reward: { hp: 2 }, respawn: 50,
  },
  skeleton_warrior: {
    id: 'skeleton_warrior', name: 'Скелет-копейщик',
    model: { human: ['undead_warrior', 'spear_undead_warrior'], orc: ['undead_warrior', 'spear_undead_warrior'] },
    anim: 'SwordAttack', hp: 800, dmg: 16, aps: 0.75, range: 2.0, speed: 3.0, aggro: 5, regen: 0.025, scale: 1.08,
    ...foes('cemetery'), reward: { power: 3 }, respawn: 70,
  },
  ghost: {
    id: 'ghost', name: 'Призрак',
    model: { human: ['undead_assassin', null], orc: ['undead_assassin', null] },
    anim: 'SwordAttack', hp: 560, dmg: 14, aps: 1.0, range: 1.4, speed: 4.3, aggro: 6, regen: 0.05, scale: 1,
    ...foes('cemetery'), reward: { speed: 3 }, respawn: 60,
  },
  bone_guard: {
    id: 'bone_guard', name: 'Костяной страж', rank: 'elite',
    model: { human: ['undead_warrior', 'spear_undead_warrior'], orc: ['undead_warrior', 'spear_undead_warrior'] },
    anim: 'SwordAttack', hp: 1640, dmg: 13, aps: 0.75, range: 2.1, speed: 3.0, aggro: 5.5, regen: 0.03, scale: 1.4,
    ...foes('cemetery'), reward: { hp: 6 }, respawn: 600,
    drop: { kind: 'armor', def: 'hunter_head', rarity: 1 },
  },
  shade: {
    id: 'shade', name: 'Тень', rank: 'elite',
    model: { human: ['undead_assassin', null], orc: ['undead_assassin', null] },
    anim: 'SwordAttack', hp: 1280, dmg: 12, aps: 1.1, range: 1.5, speed: 4.5, aggro: 6.2, regen: 0.03, scale: 1.3,
    ...foes('cemetery'), reward: { speed: 5 }, respawn: 600,
    drop: { kind: 'armor', def: 'hunter_legs', rarity: 1 },
  },
  // the cemetery's elites dress the hunter in his uncommon set (left half of the equip bar; the right half comes from the gacha)
  grave_looter: {
    id: 'grave_looter', name: 'Мародёр', rank: 'elite',
    model: { human: ['undead_worker', null], orc: ['undead_worker', null] },
    anim: 'SwordAttack', hp: 1460, dmg: 12, aps: 0.8, range: 1.7, speed: 3.2, aggro: 5.5, regen: 0.03, scale: 1.45,
    ...foes('cemetery'), reward: { hp: 6 }, respawn: 600,
    drop: { kind: 'armor', def: 'hunter_chest', rarity: 1 },
  },
  cursed_archer: {
    id: 'cursed_archer', name: 'Проклятый стрелок', rank: 'elite',
    model: { human: ['undead_warrior', 'spear_undead_warrior'], orc: ['undead_warrior', 'spear_undead_warrior'] },
    anim: 'SwordAttack', hp: 1800, dmg: 14, aps: 0.75, range: 2.1, speed: 3.1, aggro: 5.8, regen: 0.03, scale: 1.5,
    ...foes('cemetery'), reward: { power: 4 }, respawn: 600,
    drop: { kind: 'weapon', def: 'bow', rarity: 1 },
  },
  gravedigger: {
    id: 'gravedigger', name: 'Могильщик', rank: 'mini',
    model: { human: ['undead_worker', null], orc: ['undead_worker', null] },
    anim: 'SwordAttack', hp: 3640, dmg: 16, aps: 0.8, range: 1.9, speed: 3.0, aggro: 5.9, regen: 0.03, scale: 1.75,
    ...foes('cemetery'), reward: { regen: 2 }, respawn: 1800,
    bonus: { regen: 5 },
  },
  death: {
    id: 'death', name: 'Смерть',
    model: { human: ['undead_king', 'death_scythe'], orc: ['undead_king', 'death_scythe'] },
    anim: 'MeleeHigh', hp: 16000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.1,
    ...foes('cemetery'), reward: { power: 18 }, respawn: 1200,
    // a better sword for the warrior
    drop: { kind: 'weapon', def: 'sword', rarity: 2 },
    boss: {
      ...BOSS_BASE, titles: { human: 'Смерть', orc: 'Смерть' }, zone: 'cemetery', unlocks: ['cemetery-peaks'],
      slamRadius: 5, slamMul: 4.7, noSlam: true, chaseMul: 2.6, phase2Dmg: 1.3,
      reap: { half: Math.PI / 3, len: 6, mul: 3.2, heal: 0.05, delay: 1.8, anim: 'MeleeHorizontal' },
      souls: { mob: 'skeleton_soul', every: 3, burstAt: [0.5, 0.1], burst: 6, anim: 'MeleeHigh', fly: { up: 0.6, hover: 1.5, down: 0.5, height: 3.5 }, hits: 3, ring: [2.5, 6], backHalf: Math.PI / 6 },
    },
  },
  // Death's souls (BossDef.souls): HP is set from the hero's hit on spawn, no orbs
  skeleton_soul: {
    id: 'skeleton_soul', name: 'Душа',
    model: { human: ['undead_worker', null], orc: ['undead_worker', null] },
    anim: 'SwordAttack', hp: 100, dmg: 2.5, aps: 0.8, range: 1.4, speed: 3.2, aggro: 30, regen: 0, scale: 0.9,
    ...foes('cemetery'), reward: { hp: 0 }, respawn: 0,
  },
  // ---------- outer lands, in map order after the cemetery (ZONE_TIER multiplies their HP and damage) ----------
  // Snow Pass and Autumn Grove: elves
  elf_lumberjack: {
    id: 'elf_lumberjack', name: 'Эльф-лесоруб',
    model: { human: ['elf_worker', 'axe'], orc: ['elf_worker', 'axe'] },
    anim: 'AxeAttack', hp: 700, dmg: 14, aps: 0.8, range: 1.6, speed: 3.2, aggro: 5, regen: 0.03, scale: 1.05,
    ...foes('peaks'), reward: { hp: 3 }, respawn: 60,
  },
  elf_sentinel: {
    id: 'elf_sentinel', name: 'Эльф-страж',
    model: { human: ['elf_warrior', 'sword_elf_warrior'], orc: ['elf_warrior', 'sword_elf_warrior'] },
    anim: 'SwordAttack', hp: 900, dmg: 16, aps: 0.8, range: 1.8, speed: 3.2, aggro: 5, regen: 0.03, scale: 1.1,
    ...foes('peaks'), reward: { power: 4 }, respawn: 60,
  },
  elf_assassin: {
    id: 'elf_assassin', name: 'Эльф-убийца',
    model: { human: ['elf_assassin', 'dagger'], orc: ['elf_assassin', 'dagger'] },
    anim: 'SwordAttack', hp: 650, dmg: 18, aps: 1.2, range: 1.5, speed: 4.5, aggro: 11, regen: 0.03, scale: 1.05,
    ...foes('peaks'), reward: { speed: 3 }, respawn: 60, twin: 0.9,
  },
  elf_queen: {
    id: 'elf_queen', name: 'Королева перевала',
    model: { human: ['elf_queen', 'glaive_elf_queen'], orc: ['elf_queen', 'glaive_elf_queen'] },
    anim: 'SwordAttack', hp: 16000, dmg: 100, aps: 0.25, range: 2.6, speed: 2.6, aggro: 6.5, regen: 0.03, scale: 2.0,
    ...foes('peaks'), reward: { power: 20 }, respawn: 1200,
    boss: {
      ...BOSS_BASE, titles: { human: 'Королева льдов', orc: 'Королева льдов' }, zone: 'peaks', unlocks: ['forest-peaks', 'forest-hills'], unlockClass: 'mage',
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.15,
      // a small guard: the fight stays about her blows
      reinforce: { at: [0.4], pool: ['elf_sentinel', 'elf_sentinel'], bark: 'Стража, ко мне!' },
    },
  },
  elf_priestess: {
    id: 'elf_priestess', name: 'Жрица рощи',
    model: { human: ['elf_priestess', 'magic_ball'], orc: ['elf_priestess', 'magic_ball'] },
    anim: 'SwordAttack', hp: 32000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.0,
    ...foes('grove'), reward: { regen: 3 }, respawn: 1200,
    drop: { kind: 'weapon', def: 'staff_fire', rarity: 2 },
    boss: {
      ...BOSS_BASE, titles: { human: 'Жрица Осенней рощи', orc: 'Жрица Осенней рощи' }, zone: 'grove', unlocks: ['grove-swamp', 'forest-swamp'],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
    },
  },
  // Rocky Hills: orcs
  orc_laborer: {
    id: 'orc_laborer', name: 'Таурен-батрак',
    model: { human: ['orc_peon', 'axe_orc_peon'], orc: ['orc_peon', 'axe_orc_peon'] },
    skin: 'tauren', anim: 'AxeAttack', hp: 700, dmg: 14, aps: 0.75, range: 1.6, speed: 3.0, aggro: 5, regen: 0.03, scale: 1.05,
    ...foes('hills'), reward: { hp: 3 }, respawn: 60,
  },
  orc_axeman: {
    id: 'orc_axeman', name: 'Таурен-рубака',
    model: { human: ['orc_grunt', 'axe_orc_grunt'], orc: ['orc_grunt', 'axe_orc_grunt'] },
    skin: 'tauren', anim: 'AxeAttack', hp: 900, dmg: 16, aps: 0.75, range: 1.8, speed: 3.2, aggro: 5, regen: 0.03, scale: 1.15,
    ...foes('hills'), reward: { power: 4 }, respawn: 60,
  },
  orc_blademaster: {
    id: 'orc_blademaster', name: 'Таурен-воин',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['orc_warrior', 'sword_orc_warrior'] },
    skin: 'tauren', anim: 'SwordAttack', hp: 1000, dmg: 17, aps: 0.8, range: 1.8, speed: 3.3, aggro: 5.2, regen: 0.03, scale: 1.15,
    ...foes('hills'), reward: { speed: 3 }, respawn: 60,
  },
  orc_shaman: {
    id: 'orc_shaman', name: 'Шаман Чёрной Скалы',
    model: { human: ['orc_shaman', 'staff_orc_shaman'], orc: ['orc_shaman', 'staff_orc_shaman'] },
    skin: 'tauren', anim: 'AxeAttack', hp: 16000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.0,
    ...foes('hills'), reward: { power: 20 }, respawn: 1200,
    drop: { kind: 'weapon', def: 'bow', rarity: 2 },
    boss: {
      ...BOSS_BASE, titles: { human: 'Шаман Чёрной Скалы', orc: 'Шаман Чёрной Скалы' }, zone: 'hills', unlocks: ['hills-grove'],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
      reinforce: { at: [0.6, 0.3], pool: ['orc_laborer', 'orc_axeman', 'orc_blademaster'], bark: 'Сыны Чёрной Скалы, к бою!' },
    },
  },
  // Rotten Swamp and Sand Dunes: only their bosses for now
  murloc_king: {
    id: 'murloc_king', name: 'Король мурлоков', creature: true,
    model: { human: ['human_murloc', null], orc: ['human_murloc', null] },
    anim: 'SwordAttack', hp: 16000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.4,
    ...foes('swamp'), reward: { hp: 20 }, respawn: 1200,
    // an epic weapon for every class
    drop: { kind: 'weapon', def: 'sword', rarity: 3 },
    moreDrops: [{ kind: 'weapon', def: 'staff_fire', rarity: 3 }, { kind: 'weapon', def: 'bow', rarity: 3 }],
    boss: {
      ...BOSS_BASE, titles: { human: 'Король мурлоков', orc: 'Король мурлоков' }, zone: 'swamp', unlocks: ['swamp-dunes'],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
    },
  },
  sand_boar: {
    id: 'sand_boar', name: 'Песчаный вепрь', creature: true, push: 5,
    model: { human: ['orc_boar', null], orc: ['orc_boar', null] },
    anim: 'AxeAttack', hp: 16000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 3,
    ...foes('dunes'), reward: { speed: 20 }, respawn: 1200,
    // an epic helmet for every class
    drop: { kind: 'armor', def: 'plate_head', rarity: 3 },
    moreDrops: [{ kind: 'armor', def: 'hunter_head', rarity: 3 }, { kind: 'armor', def: 'mage_head', rarity: 3 }],
    boss: {
      ...BOSS_BASE, titles: { human: 'Песчаный вепрь', orc: 'Песчаный вепрь' }, zone: 'dunes', unlocks: [],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
    },
  },
  // Dunes: a ranged mob, the arrow is its blow (MobDef.shot)
  archer: {
    id: 'archer', name: 'Лучник',
    model: { human: ['human_archer', 'bow_human_archer'], orc: ['orc_archer', 'bow_orc_archer'] },
    anim: 'SwordAttack', hp: 160, dmg: 5, aps: 0.7, range: 9, speed: 3.2, aggro: 11, regen: 0.03, scale: 1,
    shot: { speed: 24, arrow: { human: 'arrow_human_archer', orc: 'arrow_orc_archer' } },
    ...foes('dunes'), reward: { power: 1 }, respawn: 60,
  },
};
// Snow Pass look variants: the stats of the mob they copy on another elf body
const elf = (base: string, id: string, name: string, body: string, weapon: string): MobDef =>
  ({ ...MOBS[base], ...foes('peaks'), id, name, model: { human: [body, weapon], orc: [body, weapon] } });
MOBS.elf_swordsman = elf('elf_sentinel', 'elf_swordsman', 'Эльф-мечник', 'elf_worker', 'sword_elf_warrior');
MOBS.elf_cutthroat = elf('elf_assassin', 'elf_cutthroat', 'Эльф-головорез', 'elf_worker', 'dagger');
MOBS.elf_gate_guard = elf('gate_guard', 'elf_gate_guard', 'Эльф-привратник', 'elf_warrior', 'sword_elf_warrior');
// Snow Pass elites: each drops a rare (blue) piece of the warrior's armour
const elfElite = (id: string, name: string, body: string, weapon: string, scale: number, reward: OrbReward, drop: ItemDrop): MobDef => ({
  id, name, rank: 'elite', model: { human: [body, weapon], orc: [body, weapon] },
  anim: 'SwordAttack', hp: 1600, dmg: 14, aps: 0.8, range: 1.8, speed: 3.3, aggro: 5.5, regen: 0.03, scale,
  ...foes('peaks'), reward, respawn: 600, drop,
});
MOBS.elf_glovemaster = elfElite('elf_glovemaster', 'Эльф-дозорный', 'elf_assassin', 'sword_elf_warrior', 1.3, { power: 4 }, { kind: 'armor', def: 'plate_head', rarity: 2 });
MOBS.elf_champion = elfElite('elf_champion', 'Эльф-латник', 'elf_warrior', 'sword_elf_warrior', 1.4, { hp: 6 }, { kind: 'armor', def: 'plate_chest', rarity: 2 });
MOBS.elf_bladesmith = elfElite('elf_bladesmith', 'Эльф-следопыт', 'elf_worker', 'sword_elf_warrior', 1.35, { power: 4 }, { kind: 'armor', def: 'plate_legs', rarity: 2 });
/** Faded grey-green crowns of the Snow Pass trees (multiply the elf tree texture: low green mutes it). */
export const WITHERED = [0xd9c4cc, 0xccbcc4, 0xe0ccd2, 0xc4b4bc];
MOBS.snow_tree_young = { ...MOBS.tree_young, id: 'snow_tree_young', name: 'Увядшее дерево', tint: WITHERED[0] };
MOBS.snow_tree_birch = { ...MOBS.tree_birch, id: 'snow_tree_birch', name: 'Увядшая берёза', tint: WITHERED[1] };
// Local mini-bosses of the outer lands: each carries a small version of its location boss's mechanic (src/bosses).
MOBS.frost_warden = {
  ...MOBS.bandit_warlord, ...foes('peaks'), id: 'frost_warden', name: 'Ледяной страж', drop: undefined,
  model: { human: ['elf_warrior', 'sword_elf_warrior'], orc: ['elf_warrior', 'sword_elf_warrior'] },
};
MOBS.grove_dryad = {
  ...MOBS.bandit_warlord, ...foes('grove'), id: 'grove_dryad', name: 'Дриада', drop: undefined, scale: 1.4,
  model: { human: ['elf_priestess', 'magic_ball'], orc: ['elf_priestess', 'magic_ball'] },
};
MOBS.murloc_tidehunter = {
  ...MOBS.bandit_warlord, ...foes('swamp'), id: 'murloc_tidehunter', name: 'Мурлок-приливник', drop: undefined, creature: true, scale: 1.6,
  model: { human: ['human_murloc', null], orc: ['human_murloc', null] },
};
/** «Свирепый вожак» of the Rocky Hills: a tauren chieftain for both factions (a storm-shaman mini, src/bosses). */
MOBS.tauren_warlord = {
  ...MOBS.bandit_warlord, ...foes('hills'), id: 'tauren_warlord', name: 'Вожак тауренов', skin: 'tauren', drop: undefined,
  model: { human: ['orc_chieftain', 'axe_orc_chieftain'], orc: ['orc_chieftain', 'axe_orc_chieftain'] }, anim: 'AxeAttack',
};

// Loot elites of the outer lands (LAND_ELITES): one item each on every kill, stats like the Snow Pass elites (ZONE_TIER scales them).
const landElite = (zone: ZoneId, id: string, name: string, look: Pick<MobDef, 'model' | 'anim'> & Partial<Pick<MobDef, 'skin' | 'creature'>>, scale: number, reward: OrbReward, drop: ItemDrop): MobDef => ({
  id, name, rank: 'elite', hp: 1600, dmg: 14, aps: 0.8, range: 1.8, speed: 3.3, aggro: 5.5, regen: 0.03, scale,
  ...foes(zone), ...look, reward, respawn: 600, drop,
});
const both = (body: string, weapon: string | null): MobDef['model'] => ({ human: [body, weapon], orc: [body, weapon] });
const TAUREN = { skin: 'tauren', anim: 'AxeAttack' as const };
// Rocky Hills: the mage's uncommon set and staff
MOBS.tauren_seer = landElite('hills', 'tauren_seer', 'Таурен-провидец', { ...TAUREN, model: both('orc_peon', 'axe_orc_peon') }, 1.35, { regen: 2 }, { kind: 'armor', def: 'mage_head', rarity: 1 });
MOBS.tauren_hide = landElite('hills', 'tauren_hide', 'Таурен-кожевник', { ...TAUREN, model: both('orc_grunt', 'axe_orc_grunt') }, 1.4, { hp: 6 }, { kind: 'armor', def: 'mage_chest', rarity: 1 });
MOBS.tauren_strider = landElite('hills', 'tauren_strider', 'Таурен-бегун', { ...TAUREN, model: both('orc_warrior', 'sword_orc_warrior') }, 1.35, { speed: 3 }, { kind: 'armor', def: 'mage_legs', rarity: 1 });
MOBS.tauren_totem = landElite('hills', 'tauren_totem', 'Таурен-тотемщик', { ...TAUREN, model: both('orc_shaman', 'staff_orc_shaman') }, 1.4, { power: 4 }, { kind: 'weapon', def: 'staff_fire', rarity: 1 });
// Autumn Grove: the hunter's rare set
MOBS.elf_ranger = landElite('grove', 'elf_ranger', 'Эльф-егерь', { anim: 'SwordAttack', model: both('elf_assassin', 'dagger') }, 1.3, { speed: 3 }, { kind: 'armor', def: 'hunter_head', rarity: 2 });
MOBS.elf_poacher = landElite('grove', 'elf_poacher', 'Эльф-браконьер', { anim: 'SwordAttack', model: both('elf_worker', 'sword_elf_warrior') }, 1.4, { hp: 6 }, { kind: 'armor', def: 'hunter_chest', rarity: 2 });
MOBS.elf_tracker = landElite('grove', 'elf_tracker', 'Эльф-следопыт рощи', { anim: 'SwordAttack', model: both('elf_warrior', 'sword_elf_warrior') }, 1.35, { power: 4 }, { kind: 'armor', def: 'hunter_legs', rarity: 2 });
// Rotten Swamp: the mage's rare set
MOBS.murloc_oracle = landElite('swamp', 'murloc_oracle', 'Мурлок-оракул', { anim: 'SwordAttack', creature: true, model: both('human_murloc', null) }, 1.35, { regen: 2 }, { kind: 'armor', def: 'mage_head', rarity: 2 });
MOBS.murloc_brute = landElite('swamp', 'murloc_brute', 'Мурлок-громила', { anim: 'SwordAttack', creature: true, model: both('human_murloc', null) }, 1.5, { hp: 6 }, { kind: 'armor', def: 'mage_chest', rarity: 2 });
MOBS.murloc_runner = landElite('swamp', 'murloc_runner', 'Мурлок-бегун', { anim: 'SwordAttack', creature: true, model: both('human_murloc', null) }, 1.3, { speed: 3 }, { kind: 'armor', def: 'mage_legs', rarity: 2 });
// Sand Dunes: epic chests and boots of every class
MOBS.dune_raider = landElite('dunes', 'dune_raider', 'Пустынный налётчик', { anim: 'SwordAttack', model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] } }, 1.4, { hp: 6 }, { kind: 'armor', def: 'plate_chest', rarity: 3 });
MOBS.dune_hunter = landElite('dunes', 'dune_hunter', 'Пустынный охотник', { anim: 'SwordAttack', model: { human: ['human_archer', 'bow_human_archer'], orc: ['orc_archer', 'bow_orc_archer'] } }, 1.35, { power: 4 }, { kind: 'armor', def: 'hunter_chest', rarity: 3 });
MOBS.dune_mystic = landElite('dunes', 'dune_mystic', 'Пустынный мистик', { anim: 'SwordAttack', model: both('orc_shaman', 'staff_orc_shaman') }, 1.35, { regen: 2 }, { kind: 'armor', def: 'mage_chest', rarity: 3 });
MOBS.dune_nomad = landElite('dunes', 'dune_nomad', 'Кочевник', { anim: 'SwordAttack', model: { human: ['orc_grunt', 'sword_orc_warrior'], orc: ['human_knight', 'sword_human_knight'] } }, 1.4, { speed: 3 }, { kind: 'armor', def: 'plate_legs', rarity: 3 });
MOBS.dune_scout = landElite('dunes', 'dune_scout', 'Пустынный разведчик', { anim: 'SwordAttack', model: { human: ['human_archer', 'bow_human_archer'], orc: ['orc_archer', 'bow_orc_archer'] } }, 1.3, { speed: 3 }, { kind: 'armor', def: 'hunter_legs', rarity: 3 });
MOBS.dune_seer = landElite('dunes', 'dune_seer', 'Пустынный провидец', { anim: 'SwordAttack', model: both('orc_shaman', 'staff_orc_shaman') }, 1.3, { power: 4 }, { kind: 'armor', def: 'mage_legs', rarity: 3 });

export type OrbKind = 'power' | 'hp' | 'regen' | 'speed';
/** Stats a mob / prop gives: exactly one stat ({ hp: 3 }), a second key is a type error. */
export type OrbReward = { [K in OrbKind]: Record<K, number> & Partial<Record<Exclude<OrbKind, K>, never>> }[OrbKind];
export const ORBS: Record<OrbKind, { color: number; css: string; label: string; value: number; unit: string }> = {
  power: { color: 0xff3b3b, css: '#ff4d4d', label: 'Урон', value: 1, unit: '' },
  hp: { color: 0x39e05a, css: '#4cff6a', label: 'Здоровье', value: 2, unit: '' },
  regen: { color: 0x3cc8ff, css: '#4fd2ff', label: 'Реген', value: 1, unit: ' хп/с' },
  speed: { color: 0xffd23c, css: '#ffd84d', label: 'Скорость', value: 1, unit: '' },
};
export const fmtOrb = (k: OrbKind, n = 1) => `+${Math.round(ORBS[k].value * n)}`;

/** Every stat of the hero (and of mobs: crit, critDmg, dodge in MobDef). All are whole points. */
export type StatId = OrbKind | 'defense' | 'dodge' | 'crit' | 'critDmg';
/** Stats that also take percent bonuses: value = (sum of the flat parts) × (1 + sum of the percents / 100). */
export type PctStat = 'hp' | 'regen' | 'power';
export const PCT_STATS: readonly PctStat[] = ['hp', 'regen', 'power'];
export const isPctStat = (k: StatId): k is PctStat => (PCT_STATS as readonly StatId[]).includes(k);

/**
 * Where stat points come from, in the order the stat window lists them. `base` (HERO) and `gear` (the
 * equipped armour) are computed; the others are saved (SaveData.src / pct). New sources (shop, quests, events)
 * go here.
 */
export const STAT_SOURCES = ['base', 'weapon', 'enemy', 'mini', 'gear', 'debug'] as const;
export type StatSource = (typeof STAT_SOURCES)[number];
/** Sources kept in the save. */
export type SavedSource = Exclude<StatSource, 'base' | 'weapon' | 'gear'>;
export const STAT_SOURCE_NAME: Record<StatSource, string> = {
  base: 'База', weapon: 'Оружие', enemy: 'Враг', mini: 'Мини-босс', gear: 'Снаряжение', debug: 'Дебаг',
};

/**
 * Look of the game view: the hero's and the enemies' visual size (collisions, reach and hitboxes stay the same) and the
 * camera's vertical field of view, degrees. The debug panel tunes them live; ENV is the size of trees, buildings and
 * props placed in the level (src/world.ts).
 */
export const VIEW = { heroScale: 1.4, mobScale: 1, fov: 59, env: 1.15 };

export const HERO = {
  /**
   * All stats are whole numbers. power: flat damage added to the weapon's base (before its type
   * multiplier), regen: HP per second, speed: points (100 = base run speed, see STAT_CURVE.speed).
   */
  // regen benchmark at every stage of the game: about 2% of max HP per second (sources are tuned to it)
  power: 0, hp: 100, regen: 2, speed: 100,
  /** Speed points per metre per second (prologue only: 100 points = 5 m/s). */
  speedPerMs: 20,
  /** Run speed at 100 speed points, m/s. Mobs run 2.8–4.3. */
  baseSpeed: 4,
  /** In the camp HP comes back fast: % of max HP per second (on top of the normal regen). */
  campRegen: 10,
  /** Share of max HP the hero is back with in the camp after a death (no death window). */
  respawnHp: 0.1,
  radius: 0.45, acquireExtra: 0.4,
};

/**
 * Diminishing returns (src/balance.ts curve): `base + max · p / (p + k)` — never reaches base + max,
 * half of `max` at `k` points. Health, regen and damage grow linearly without a cap.
 */
export const STAT_CURVE = {
  /** Run speed multiplier from the points above 100: ×1.25 at +50, never ×1.5 (6 m/s). */
  speed: { base: 1, max: 0.5, k: 50 },
  /** Chance to avoid a blow completely (any blow, boss specials too). */
  dodge: { base: 0, max: 0.5, k: 100 },
  crit: { base: 0, max: 0.6, k: 100 },
  /** Damage multiplier of a critical hit. */
  critDmg: { base: 1.5, max: 1.5, k: 100 },
};
/** Defense: incoming damage × 100 / (100 + defense), at most this share is taken off. */
export const DEFENSE_CAP = 0.75;

export interface ZoneDef {
  id: ZoneId;
  name: string;
  ground: number;
  ground2: number;
  sky: number;
  fog: number;
  hemi: [number, number];
  fogDensity: number; // FogExp2
  mist: number; // ground mist strength 0..1
  mistColor: number;
}

export const ZONES: ZoneDef[] = [
  // hemi: [sky, ground bounce] — the sky colour is what the shadows get, so it is kept cool against the warm sun
  { id: 'forest', name: 'Лесная опушка', ground: 0x509a3a, ground2: 0x76b246, sky: 0x9ad8c8, fog: 0xb2dfcc, hemi: [0xc4d8ff, 0x6b8a4a], fogDensity: 0.008, mist: 0.08, mistColor: 0xf0fff4 },
  { id: 'cemetery', name: 'Старое кладбище', ground: 0x5a5698, ground2: 0x6c64aa, sky: 0x7c6ed0, fog: 0x9086d4, hemi: [0xbcb4ff, 0x4e4888], fogDensity: 0.012, mist: 0.3, mistColor: 0xddd4ff },
  // Placeholder locations around the forest (no content yet: ground, sky and fog only).
  { id: 'peaks', name: 'Снежный перевал', ground: 0xdfe9f4, ground2: 0xf2f6fc, sky: 0xbfe2ff, fog: 0xe2f1ff, hemi: [0xd2e2ff, 0x8a9ab0], fogDensity: 0.009, mist: 0.12, mistColor: 0xffffff },
  { id: 'swamp', name: 'Гнилое болото', ground: 0x587f3a, ground2: 0x6c9044, sky: 0x9cc8b0, fog: 0xa4ccb4, hemi: [0xc4dcec, 0x4a6a3a], fogDensity: 0.01, mist: 0.25, mistColor: 0xd8f0e0 },
  { id: 'grove', name: 'Осенняя роща', ground: 0xcc8a30, ground2: 0xdea244, sky: 0xffd8a0, fog: 0xffe0bc, hemi: [0xe8d8e8, 0x8a6a3a], fogDensity: 0.007, mist: 0.06, mistColor: 0xfff0e0 },
  { id: 'dunes', name: 'Песчаные дюны', ground: 0xe6c674, ground2: 0xf0d68e, sky: 0xa8dcff, fog: 0xfff0d0, hemi: [0xd4e4ff, 0xa08a5a], fogDensity: 0.006, mist: 0.03, mistColor: 0xffffff },
  { id: 'hills', name: 'Скалистые холмы', ground: 0x9a9286, ground2: 0xaca496, sky: 0xb0c8e0, fog: 0xc8d4e0, hemi: [0xccd8f0, 0x6a6458], fogDensity: 0.008, mist: 0.06, mistColor: 0xeef0f4 },
];

/**
 * Zone depth: packs further along the trail are bigger, tougher and pay more, so progress means
 * pushing on rather than farming the first clearing. t = 0 for the zone's first pack, 1 for its last
 * (set by World from the trail); bosses, elites, micro-bosses and mobs from graves are not scaled.
 */
export interface DepthDef { hp: number; dmg: number; reward: number; scale: number }
export const DEPTH: Partial<Record<ZoneId, DepthDef>> = {
  // the far end of the trail is ×3 tougher and ×2.5 richer: the forest's progression (balance.html → «Цикл леса»)
  forest: { hp: 3, dmg: 3, reward: 2.5, scale: 1.15 },
};
/** Outer lands: HP and damage multiplier of everything spawned there, doubling at each step of the map order. */
export const ZONE_TIER: Partial<Record<ZoneId, number>> = { peaks: 2, hills: 4, grove: 8, swamp: 16, dunes: 32 };
export function depthMul(zone: ZoneId, t: number) {
  const d = DEPTH[zone];
  t = d ? Math.min(1, Math.max(0, t)) : 0;
  const k = (v: number) => 1 + (v - 1) * t;
  return { hp: d ? k(d.hp) : 1, dmg: d ? k(d.dmg) : 1, reward: d ? k(d.reward) : 1, scale: d ? k(d.scale) : 1 };
}

// ---------- breakable props ----------
/**
 * Something that happens when a prop is destroyed (data-driven; add new types here).
 * - spawnMob: a mob crawls out of the prop (e.g. a skeleton rising from a grave).
 */
export type BreakEvent = { type: 'spawnMob'; mob: string; chance: number; count?: number; bark?: string };

export interface BreakableDef {
  model: string | null;
  /** Plain HP: the hero's blows take their real damage (resistances and crits included), like on mobs. */
  hp: number;
  color: number;
  scale: number;
  /** Fixed power orbs, shown above the HP bar like on mobs — one stat only. */
  reward: OrbReward | Record<never, never>;
  /** Material resistances: wood is easy to chop, stone needs a hammer. */
  resist: Partial<Record<DamageType, ResistTier>>;
  r: number;
  /** Respawn cooldown, seconds (GDD 7.3: 30–60 s). */
  respawn: number;
  /** Mob id whose death keeps the prop down: it comes back only while that mob is alive. */
  needsAlive?: string;
  onBreak?: BreakEvent[];
  /** A turret: while the hero is within `range` it lobs a shot every `cd` s at his position; it lands after `delay` s, hits within `r` for `dmg`. */
  shoot?: { dmg: number; range: number; cd: number; r: number; delay: number; height: number };
}
const GRAVE_RISE: BreakEvent[] = [{ type: 'spawnMob', mob: 'skeleton_worker', chance: 0.35, bark: 'Кто потревожил мой сон?!' }];
// wood is easy to chop, stone needs a hammer
const WOOD: BreakableDef['resist'] = { chop: 'weak', crush: 'resist' };
const STONE: BreakableDef['resist'] = { slash: 'resist', chop: 'resist', crush: 'weak' };
/** The first boss's tower: no stats, no weaknesses; the boss rebuilds it after 20 s while alive. */
const FORT_TOWER = { hp: 1500, respawn: 30, needsAlive: 'bandit_chief' };
const TOWER_SHOT = { dmg: 10, range: 20, cd: 2.4, r: 1.5, delay: 1.3, height: 5 };
export const BREAKABLES: Record<string, BreakableDef> = {
  barrel: { model: 'barrel', hp: 120, color: 0x8a5a2b, scale: 0.85, reward: { hp: 1 }, resist: WOOD, r: 0.5, respawn: 40 },
  orc_barrel: { model: 'orc_barrel', hp: 120, color: 0x7a4a22, scale: 0.85, reward: { hp: 1 }, resist: WOOD, r: 0.5, respawn: 40 },
  box: { model: 'box_small_1', hp: 60, color: 0xa87a45, scale: 0.9, reward: { power: 1 }, resist: {}, r: 0.45, respawn: 30 },
  box_large: { model: 'box_large_1', hp: 200, color: 0xa87a45, scale: 0.8, reward: { power: 2 }, resist: {}, r: 0.7, respawn: 60 },
  orc_box: { model: 'orc_box_small_1', hp: 60, color: 0x8a5a2b, scale: 0.9, reward: { power: 1 }, resist: {}, r: 0.45, respawn: 30 },
  bush: { model: null, hp: 40, color: 0x3f8f2f, scale: 1, reward: { regen: 1 }, resist: { slash: 'weak', crush: 'resist' }, r: 0.6, respawn: 25 },
  tomb1: { model: 'undead_tomb_stone_1', hp: 500, color: 0x77748a, scale: 0.75, reward: { power: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb2: { model: 'undead_tomb_stone_2', hp: 500, color: 0x77748a, scale: 0.75, reward: { regen: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb3: { model: 'undead_tomb_stone_3', hp: 500, color: 0x77748a, scale: 0.75, reward: { hp: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb4: { model: 'undead_tomb_stone_4', hp: 500, color: 0x77748a, scale: 0.75, reward: { speed: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  fort_tower_orc: { model: 'orc_tower_Lv2', ...FORT_TOWER, color: 0x7a5a38, scale: 0.38, reward: {}, resist: {}, r: 1.4, shoot: TOWER_SHOT },
  fort_tower_human: { model: 'tower_Lv2', ...FORT_TOWER, color: 0x7a5a38, scale: 0.38, reward: {}, resist: {}, r: 1.4, shoot: TOWER_SHOT },
  coffin: { model: 'undead_coffin', hp: 900, color: 0x5a3c2c, scale: 0.34, reward: { hp: 2 }, resist: { crush: 'weak' }, r: 0.7, respawn: 75, onBreak: [{ type: 'spawnMob', mob: 'skeleton_warrior', chance: 0.7, bark: 'Вечный покой окончен!' }] },
};

// ---------- spawners ----------
/**
 * A spawner stands at a fixed spot on the map and always spawns the same unit: a mob or a breakable prop
 * (one type for both). `unit` says which table `id` is from: 'mob' → MOBS, 'prop' → BREAKABLES (src/world.ts).
 * `charges` are cooldowns in seconds: the 1st kill / break starts charges[0], the 2nd charges[1], and so on;
 * after the last charge the cycle starts over from the first. Without `charges` there is one endless charge
 * with the unit's own `respawn`. The hero's position does not affect respawning.
 */
export interface SpawnerDef { unit: 'mob' | 'prop'; id: string; charges?: number[] }
/** One mob of a pack; `behavior` overrides its MobDef.behavior here only. */
export interface SpawnSlot { id: string; behavior?: Partial<MobBehavior> }
/**
 * A spawn of several mobs standing together. It respawns as a whole: the charge starts once the last of them dies.
 * `link` social: pulling one pulls the rest. Without `charges` one endless charge with the slowest slot's `respawn`.
 */
export interface PackDef { slots: SpawnSlot[]; charges?: number[]; link: 'social' | 'none' }
const MIN = 60;
const HOUR = 3600;
/** Forest Edge: every spawner (elites and the micro-boss too) has 3 charges — 4 min, 5 min, 12 h. */
const FOREST_CHARGES = [4 * MIN, 5 * MIN, 12 * HOUR];
const spawner = (id: string, charges?: number[]): SpawnerDef => ({ unit: 'mob', id, charges });
const pack = (ids: string[], charges?: number[], link: PackDef['link'] = 'social'): PackDef => ({ slots: ids.map((id) => ({ id })), charges, link });
/** A pack as single spawners (the balance sim models units one by one). */
export const packUnits = (p: PackDef): SpawnerDef[] => p.slots.map((sl) => spawner(sl.id, p.charges));
/** Guards of the boss camp and the Snow Pass gate (world.buildForest): forest charges like everyone, so one clear of the forest is one cycle. */
export const GUARD_PACKS = { boss_guard: pack(['boss_guard', 'boss_guard', 'boss_guard'], FOREST_CHARGES), gate_guard: pack(['gate_guard', 'gate_guard', 'gate_guard'], FOREST_CHARGES) };
/** Mob spawners by location, placed along the trail in list order (first = nearest the location's entrance). */
export const SPAWNERS: Partial<Record<ZoneId, SpawnerDef[]>> = {
  forest: ([
    'boar', 'bandit_thug', 'bandit_thug', 'boar', 'bandit_thug', 'bandit_fighter', 'bandit_veteran',
    'bandit_thug', 'bandit_fighter', 'boar', 'bandit_warlord', 'bandit_thug', 'bandit_fighter', 'bandit_brute',
    'bandit_thug', 'boar', 'bandit_fighter', 'bandit_fighter', 'bandit_lumberjack',
    // appended (pinned, FOREST_PINS) so the spawners before it keep their save ids
    'bandit_runner_elite',
  ]).map((id) => spawner(id, FOREST_CHARGES)),
  // one endless charge with the mob's own respawn time
  cemetery: ([
    // village (Мародёр) → graves by the trail (Костяной страж) → chapel ruins (Проклятый стрелок) →
    // grave field (Могильщик) → before the arena (Тень); CEMETERY_PINS put the specials into their areas
    'skeleton_worker', 'undead_boar', 'skeleton_worker', 'grave_looter', 'ghost', 'bone_guard', 'skeleton_warrior', 'undead_boar',
    'skeleton_worker', 'cursed_archer', 'ghost', 'gravedigger', 'skeleton_warrior', 'undead_boar', 'skeleton_worker', 'shade', 'skeleton_warrior',
    'skeleton_warrior', 'undead_boar',
  ]).map((id) => spawner(id)),
  hills: ([
    'orc_laborer', 'orc_axeman', 'orc_laborer', 'orc_blademaster', 'orc_axeman', 'orc_laborer',
    'orc_blademaster', 'orc_axeman', 'orc_laborer', 'orc_blademaster', 'orc_axeman', 'orc_blademaster',
  ]).map((id) => spawner(id)),
  grove: ([
    'elf_lumberjack', 'elf_assassin', 'elf_lumberjack', 'elf_sentinel', 'elf_assassin', 'elf_lumberjack',
    'elf_sentinel', 'elf_assassin', 'elf_lumberjack', 'elf_sentinel', 'elf_assassin', 'elf_sentinel',
  ]).map((id) => spawner(id)),
};
/** Snow Pass (world.snowMobs): sword packs on and beside its roads, lone assassins in the woods, guards past the hub gate. */
export const PEAKS_SPAWNERS = {
  packs: [
    ['elf_sentinel', 'elf_swordsman', 'elf_swordsman'], ['elf_swordsman', 'elf_lumberjack', 'elf_sentinel'], ['elf_sentinel', 'elf_swordsman', 'elf_swordsman'],
    ['elf_lumberjack', 'elf_sentinel', 'elf_swordsman'], ['elf_swordsman', 'elf_sentinel', 'elf_lumberjack'], ['elf_sentinel', 'elf_swordsman', 'elf_lumberjack'],
    ['elf_swordsman', 'elf_sentinel', 'elf_sentinel'],
  ].map((ids) => pack(ids)),
  assassins: ['elf_assassin', 'elf_cutthroat', 'elf_assassin', 'elf_cutthroat', 'elf_assassin', 'elf_cutthroat', 'elf_assassin', 'elf_cutthroat', 'elf_assassin']
    .map((id) => spawner(id)),
  guards: pack(['elf_gate_guard', 'elf_gate_guard', 'elf_gate_guard']),
  /** Elites at hand-picked spots (map drawing; slid onto walkable land). */
  elites: ([['elf_glovemaster', -14, -135], ['elf_champion', 59.5, -148], ['elf_bladesmith', 13, -115.5]] as const)
    .map(([id, x, z]) => ({ def: spawner(id), x, z })),
  /** Wolves and bears wandering alone through the empty woods. */
  beasts: ['wild_direwolf', 'wild_bear', 'wild_direwolf', 'wild_direwolf', 'wild_bear', 'wild_direwolf', 'wild_bear', 'wild_direwolf', 'wild_bear', 'wild_direwolf']
    .map((id) => spawner(id)),
  /** Bears by the west mini-boss (LAND_BOSSES peaks minis[1]). */
  bears: pack(['wild_bear', 'wild_bear', 'wild_bear']),
  /** Attackable trees, one at a time a road's width off the roads. */
  trees: ['snow_tree_young', 'snow_tree_birch', 'snow_tree_young', 'snow_tree_young', 'snow_tree_birch', 'snow_tree_young', 'snow_tree_birch', 'snow_tree_young']
    .map((id) => spawner(id)),
};
/** «Свирепый вожак» mini-bosses of the cemetery and the outer lands. */
export const MINI_SPAWNER = spawner('bandit_warlord');
/**
 * Loot elites of the outer lands (MOBS landElite): spots spread over each location, away from its boss and mini-boss
 * and from each other (World slides them onto walkable land).
 */
const at = (list: [string, number, number][]) => list.map(([id, x, z]) => ({ def: spawner(id), x, z }));
export const LAND_ELITES: Partial<Record<ZoneId, { def: SpawnerDef; x: number; z: number }[]>> = {
  hills: at([['tauren_seer', -56, -20], ['tauren_hide', -82, -50], ['tauren_strider', -104, -82], ['tauren_totem', -58, -118]]),
  grove: at([['elf_ranger', -38, -2], ['elf_poacher', -84, 0], ['elf_tracker', -98, 32]]),
  swamp: at([['murloc_oracle', -8, 10], ['murloc_brute', -6, 56], ['murloc_runner', -16, 100]]),
  dunes: at([['dune_raider', 16, 12], ['dune_hunter', 8, 90], ['dune_mystic', 64, 4], ['dune_nomad', 32, 52], ['dune_scout', 46, 82], ['dune_seer', 82, 30]]),
};
/** Zones whose mini-bosses are a local variant instead of «Свирепый вожак». */
export const MINI_SPAWNER_OF: Partial<Record<ZoneId, SpawnerDef>> = {
  hills: spawner('tauren_warlord'), peaks: spawner('frost_warden'), grove: spawner('grove_dryad'), swamp: spawner('murloc_tidehunter'),
};
/**
 * Spawn presets: the words for placing mobs on a location (World.addPack places a preset's pack).
 * Unit kinds outside packs, by MobDef:
 * - tree / object: `static` — stands, never attacks, gives stats (reward) when broken;
 * - mob: plain MobDef — fights, gives stats;
 * - loot mob (elite): `rank: 'elite'` + `drop` — its item on every kill;
 * - mini-boss: `rank: 'mini'` — permanent `bonus` stats per kill;
 * - boss: `boss` (BossDef) — its own fight kit, unlocks gates.
 * Packs below (behavior axes: src/mobs/behavior.ts).
 */
export const SPAWN_PRESETS = {
  /** A kiting archer and two melee guards who chase the hero. */
  archer_escort: {
    name: 'Лучник с охраной',
    pack: { slots: [{ id: 'archer', behavior: { combat: 'kite' } }, { id: 'bandit_fighter' }, { id: 'bandit_fighter' }], link: 'social' },
  },
  /** Melee who spread round the hero and strike from different sides. */
  flankers: {
    name: 'Окружение',
    pack: { slots: [{ id: 'bandit_thug', behavior: { combat: 'flank' } }, { id: 'bandit_thug', behavior: { combat: 'flank' } }, { id: 'bandit_fighter', behavior: { combat: 'flank' } }], link: 'social' },
  },
  /** Grows in the fight: assassins call a shadow twin each (MobDef.twin). */
  growing: {
    name: 'Растущая группа',
    pack: { slots: [{ id: 'elf_assassin' }, { id: 'elf_assassin' }], link: 'social' },
  },
  /** Two archers who run off in random directions inside their spawn zone, keeping the hero at the edge of their range. */
  skirmishers: {
    name: 'Отбегающие стрелки',
    pack: { slots: [{ id: 'archer', behavior: { combat: 'kite', zone: 9 } }, { id: 'archer', behavior: { combat: 'kite', zone: 9 } }], link: 'social' },
  },
  /** A big melee crowd of ten that rushes the hero together. */
  horde: {
    name: 'Орда',
    horde: 'ring',
    pack: {
      slots: [
        { id: 'bandit_thug' }, { id: 'bandit_fighter' }, { id: 'bandit_thug' }, { id: 'bandit_fighter' }, { id: 'bandit_thug' },
        { id: 'bandit_fighter' }, { id: 'bandit_thug' }, { id: 'bandit_fighter' }, { id: 'bandit_thug' }, { id: 'bandit_fighter' },
      ],
      link: 'social',
    },
  },
  /** Ten scattered at random: archers kiting, bandits chasing, assassins calling twins. */
  horde_mixed: {
    name: 'Смешанная орда',
    horde: 'scatter',
    pack: {
      slots: [
        { id: 'archer', behavior: { combat: 'kite' } }, { id: 'bandit_thug' }, { id: 'elf_assassin' }, { id: 'bandit_fighter' },
        { id: 'archer', behavior: { combat: 'kite' } }, { id: 'elf_assassin' }, { id: 'bandit_thug' }, { id: 'archer', behavior: { combat: 'kite' } },
        { id: 'bandit_fighter' }, { id: 'elf_assassin' },
      ],
      link: 'social',
    },
  },
} satisfies Record<string, SpawnPreset>;
/** `horde`: a big pack the debug teleport drops the hero into the middle of — standing in a ring or scattered at random. */
export interface SpawnPreset { name: string; pack: PackDef; horde?: 'ring' | 'scatter' }
export type SpawnPresetId = keyof typeof SPAWN_PRESETS;

/** Round the gloves elite (world.glovesGuards): two bandit trios in the trees. */
export const GLOVES_BANDITS = [pack(['bandit_thug', 'bandit_fighter', 'bandit_thug'], FOREST_CHARGES), pack(['bandit_fighter', 'bandit_thug', 'bandit_fighter'], FOREST_CHARGES)];
/** Static trees of the forest (world.buildForest turns some of its trees into them), charges like the forest mobs. */
export const FOREST_TREES = [
  'tree_young', 'tree_birch', 'tree_young', 'tree_spring', 'tree_windy',
  'tree_young', 'tree_birch', 'tree_spring', 'tree_windy',
].map((id) => spawner(id, FOREST_CHARGES));
/** Bandits in the wood between the settlement and the fort (world.campToFort). */
export const MID_SPAWNERS = ['bandit_thug', 'bandit_fighter', 'bandit_thug', 'bandit_fighter', 'bandit_thug'].map((id) => spawner(id, FOREST_CHARGES));

/**
 * "Zoo" just outside the camp gate (src/world.ts buildZoo): the WoW creatures, one endless charge each.
 * Empty for now: the starting location has no animals (wild_bear, wild_direwolf… are still in MOBS).
 */
export const ZOO: SpawnerDef[] = [];

/**
 * Breakable prop spawners (same SpawnerDef, unit 'prop'), spread over an area by group:
 * camp, forest — none (the starting location has no breakables besides the fort tower);
 * cemetery — graves beside the cemetery trail; cemeteryField — graves in the cemetery's far end.
 */
/** n prop spawners cycling through the given kinds. */
const props = (kinds: string[], n: number, charges?: number[]): SpawnerDef[] =>
  Array.from({ length: n }, (_, i) => ({ unit: 'prop', id: kinds[i % kinds.length], charges }));
const GRAVES = ['tomb1', 'tomb2', 'tomb3', 'tomb4', 'tomb1', 'tomb2', 'coffin'];
export const PROP_SPAWNERS: Record<'camp' | 'forest' | 'cemetery' | 'cemeteryField', SpawnerDef[]> = {
  camp: [],
  forest: [],
  cemetery: props(GRAVES, 18),
  cemeteryField: props(GRAVES, 6),
};
/**
 * Areas of the Old Cemetery (world.buildCemetery): centre by angle (deg) and distance from the island centre, like its
 * buildings; `r` — radius, m (stepping in shows the name). `pin` — the special mob standing in the centre.
 */
export const CEMETERY_AREAS: { id: 'village' | 'chapel' | 'field'; name: string; deg: number; d: number; r: number; pin?: string }[] = [
  { id: 'village', name: 'Заброшенная деревня', deg: 90, d: 72, r: 12, pin: 'grave_looter' },
  { id: 'chapel', name: 'Руины часовни', deg: 70, d: 99, r: 10, pin: 'cursed_archer' },
  { id: 'field', name: 'Старое поле могил', deg: 113, d: 72, r: 11, pin: 'gravedigger' },
];
export const LEASH = 15;

/**
 * "Горнило судьбы" — gacha forge (docs/features/ludka). `rates` are the per-pull chances of gacha tiers 0..3;
 * a legendary always drops on pull number `pity` without one. Every legendary is the banner weapon.
 */
export const GACHA = {
  /** Gacha tier 0..3 → RARITY index: common, rare, epic, legendary. */
  tiers: [0, 2, 3, 4],
  rates: [0.7, 0.22, 0.074, 0.006],
  pity: 60,
  /**
   * Chance a kill gives one pull, by mob rank. All 0 for now: a mob drops only what is shown above it (its stat
   * orbs, an elite's / boss's own item), pulls come from elsewhere.
   */
  token: { normal: 0, elite: 0, mini: 0, boss: 0 } as Record<MobRank, number>,
  /** Locations whose kills never give a pull (bosses there too): the first one is beaten on the forest's own drops alone. */
  noTokens: ['forest'] as ZoneId[],
  banner: { def: 'hammer', name: 'Молот Короля-лича', subtitle: 'Выкован из костей павших королей. Шанс повышен!' },
  /** Hammer blows per pull; the rarity colour can climb after each, legendary only on the last one. */
  strikes: 5,
  /** Reveal timing, seconds: delay between hammer blows, then the final flash. */
  strikeGap: 0.6,
  revealHold: 0.9,
};
/** Chance a kill of a `rank` mob from location `zone` gives a gacha pull (GACHA.token, none in GACHA.noTokens). */
export const tokenChance = (rank: MobRank, zone: ZoneId) => (GACHA.noTokens.includes(zone) ? 0 : GACHA.token[rank]);

/** 3D forge scene of the gacha (src/forge3d.ts). Positions in metres; `top` = anvil top, y offsets are added to it. */
export const FORGE3D = {
  bg: 0x140a08,
  fov: 44,
  /** Narrower screens widen the vertical FOV so this aspect's width always fits. */
  minAspect: 0.5,
  camera: [0.55, 1.95, 4.3] as [number, number, number],
  lookAt: [0, 0.25, -0.5] as [number, number, number],
  /** Camera push-in (m) over the three blows. */
  push: 0.45,
  anvilScale: 0.4,
  anvilYaw: 0,
  ingot: [0, 0.04, 0] as [number, number, number],
  ingotYaw: 0,
  hammerScale: 0.68,
  /** Hammer shoulder pivot relative to the ingot top; angles (rad) around Z: raised and on the ingot. */
  pivot: [-0.45, 0.2, 0] as [number, number, number],
  hammerUp: 1.25,
  hammerDown: -0.04,
  hearth: [0, 0, -1.6] as [number, number, number],
  hearthScale: [1.1, 1.35, 1.1] as [number, number, number],
  coalLight: 13,
  /** [model, x, z, scale, yaw] */
  decor: [['bucket', 0.95, -0.55, 0.3, 0.4], ['wood_pile_small', -1.35, -1.2, 0.4, 0.8], ['barrel', 1.35, -1.1, 0.6, 0.3]] as [string, number, number, number, number][],
  itemSize: 1.0,
  itemRise: 0.85,
  bloom: { strength: 0.8, radius: 0.5, threshold: 0.85 },
};
/** Every non-lethal hit holds the mob's pose (animation only) for this many seconds. */
export const HIT_FREEZE = 0.15;
/**
 * Kill feedback: the death clip and the shove start at once (no freeze frame — it read as the body hanging, then
 * flying off, then falling). `maxKnock` (m/s) caps the shove: ×knockMul of a finisher (axe 11 → 22 m/s) slid the body
 * ~2.4 m; 5 m/s is ~0.5 m, a stagger back while falling.
 */
export const KILL_FX = { knockMul: 2, maxKnock: 5, shake: 0.31, blood: 14 };
