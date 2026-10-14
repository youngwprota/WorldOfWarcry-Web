import type { SwingKind } from './swing';
// All gameplay numbers live here (GDD: "все числа — ориентиры").

/** Sword — slash (режущий), axe — chop (рубящий), hammer — crush (дробящий). */
export type DamageType = 'slash' | 'chop' | 'crush';
export type ResistTier = 'weak' | 'normal' | 'resist' | 'immune';
export type FactionId = 'human' | 'orc';
export type ZoneId = 'forest' | 'cemetery' | 'peaks' | 'swamp' | 'grove' | 'dunes' | 'hills';
export type AttackAnim = 'SwordAttack' | 'AxeAttack';
/** The left hand has no clips: its swings by the right-hand clip the weapon uses. */
export const LEFT_SWING: Record<AttackAnim, SwingKind[]> = { SwordAttack: ['slashLR', 'slashRL'], AxeAttack: ['overhead'] };
/**
 * Hit markers: seconds into each attack clip at natural speed where the blow connects. Mob damage lands on this
 * frame if the hero is still in reach. Humanoid FBX clips by name, GLB creatures as `<model>:attack`.
 */
export const ATTACK_HIT: Record<string, number> = {
  SwordAttack: 0.6, AxeAttack: 0.83,
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

export const RESIST_MULT: Record<ResistTier, number> = { weak: 1.5, normal: 1, resist: 0.5, immune: 0.25 };
export const DAMAGE_TYPE_NAME: Record<DamageType, string> = { slash: 'режущий', chop: 'рубящий', crush: 'дробящий' };
export const DAMAGE_TYPE_COLOR: Record<DamageType, string> = { slash: '#7fd3ff', chop: '#ff8a5a', crush: '#ffb347' };

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
  anim: AttackAnim;
  model: Record<FactionId, string>;
  icon: string;
  stun?: number; // chance
  /** Plain swings hit only the current target (the combo finisher still hits an area). */
  single?: boolean;
  /**
   * Daggers: every hit on a mob adds `add` to the damage on that mob, up to `max` stacks; the stacks drop off
   * `decay` seconds after the last hit.
   */
  stack?: { add: number; max: number; decay: number };
  /**
   * Reaper: each swing drags mobs within `radius` m (×2 on the finisher) towards a point `ahead` m in front of
   * the hero (bosses stay); `force` = share of the way they slide. Then the blow deals
   * × (1 + perEnemy × (mobs hit − 1)), up to × `max`.
   */
  pull?: { radius: number; ahead: number; force: number; perEnemy: number; max: number };
  /** Procedural swings (src/swing.ts) cycled along the combo chain, instead of the `anim` clip. */
  swing?: SwingKind[];
  /** Nagamaki: the chain never breaks (a pause or a whiff does not reset it), the finisher is a narrow thrust. */
  cycle?: boolean;
  /** Pan: the 'circle' is centred `ahead` m in front of the hero (radius = range). */
  ahead?: number;
  /** Pan: `chance` of a ringing blow for × `mult`. */
  ring?: { chance: number; mult: number };
  /** Hidden blade: always stuns for `stun` s; plain mobs left under `execute` of their HP die; lunge `dash` m. */
  assassin?: { stun: number; execute: number; dash: number };
  /**
   * Throwing scythe: the blow throws it to circle the hero for `time` s at `radius` m (`turns` laps), cutting every
   * mob it passes (once per `rehit` s each); the hand waits for it to come back.
   */
  orbit?: { time: number; radius: number; turns: number; rehit: number };
  /**
   * Shield: never swings by itself; incoming damage × (1 − `reduce`); a hit taken may trigger a counter-strike of
   * the other hand at the attacker (`counter` chance by its rank), not more often than every `cd` s. Two shields
   * bash back with the shield.
   */
  guard?: { reduce: number; counter: Record<MobRank, number>; cd: number };
}

export type MobRank = 'normal' | 'elite' | 'mini' | 'boss';
export const mobRank = (d: MobDef): MobRank => (d.boss ? 'boss' : d.rank ?? 'normal');

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
    anim: 'AxeAttack', model: { human: 'hammer_human_paladin', orc: 'hammer_human_paladin' }, icon: '🔨', stun: 0.25,
  },
  dagger: {
    id: 'dagger', name: 'Кинжалы', type: 'slash', dmgMul: 0.38, aps: 2.4, shape: 'arc', arc: 90, range: 1.9,
    anim: 'SwordAttack', model: { human: 'dagger', orc: 'dagger' }, icon: '🔪', single: true,
    stack: { add: 0.06, max: 10, decay: 2.5 },
  },
  reaper: {
    id: 'reaper', name: 'Жнец', type: 'slash', dmgMul: 1.1, aps: 0.8, shape: 'arc', arc: 200, range: 2.6,
    anim: 'AxeAttack', model: { human: 'reaper', orc: 'reaper' }, icon: '🌙',
    pull: { radius: 5, ahead: 1.5, force: 0.85, perEnemy: 0.15, max: 2 },
  },
  nagamaki: {
    id: 'nagamaki', name: 'Нагамаки', type: 'slash', dmgMul: 0.95, aps: 1.3, shape: 'arc', arc: 200, range: 2.6,
    anim: 'SwordAttack', model: { human: 'nagamaki', orc: 'nagamaki' }, icon: '⚔️', cycle: true,
    swing: ['slashRL', 'slashLR', 'thrust'],
  },
  scythe: {
    id: 'scythe', name: 'Коса', type: 'slash', dmgMul: 1.0, aps: 0.4, shape: 'circle', arc: 360, range: 3,
    anim: 'AxeAttack', model: { human: 'scythe', orc: 'scythe' }, icon: '🌀',
    orbit: { time: 2.4, radius: 2.2, turns: 2, rehit: 0.45 },
    swing: ['throw'],
  },
  pan: {
    id: 'pan', name: 'Сковорода', type: 'crush', dmgMul: 1.1, aps: 0.9, shape: 'circle', arc: 360, range: 1.6, ahead: 1.3,
    anim: 'AxeAttack', model: { human: 'pan', orc: 'pan' }, icon: '🍳', stun: 0.6, ring: { chance: 0.3, mult: 2 },
    swing: ['overhead'],
  },
  hidden_blade: {
    id: 'hidden_blade', name: 'Скрытый клинок', type: 'slash', dmgMul: 2.4, aps: 0.45, shape: 'arc', arc: 120, range: 2.0,
    anim: 'SwordAttack', model: { human: 'hidden_blade', orc: 'hidden_blade' }, icon: '🗡', single: true,
    assassin: { stun: 1.2, execute: 0.25, dash: 1.2 },
    swing: ['assassin'],
  },
  shield: {
    id: 'shield', name: 'Щит', type: 'crush', dmgMul: 0.5, aps: 0.8, shape: 'arc', arc: 120, range: 1.8,
    anim: 'AxeAttack', model: { human: 'shield', orc: 'shield' }, icon: '🛡️',
    guard: { reduce: 0.15, counter: { normal: 0.2, elite: 0.3, mini: 0.4, boss: 0.5 }, cd: 0.4 },
    swing: ['bash'],
  },
};

/** Two weapons at once: each hand hits for `mul` of its damage (both hands ≈ ×1.2 of one). */
export const DUAL = { mul: 0.6 };

/**
 * A sword in one hand and weapon X in the other: the pair bonus (src/offhand.ts). The sword itself swings plainly
 * unless noted. Numbers are tuned by the balance bench (docs/features/new-weapons/handoff.md).
 */
export const SWORD_PAIRS = {
  /** Every sword hit: +`aps` attack speed for the daggers, up to +`max`, gone `decay` s after the last sword hit. */
  dagger: { aps: 0.08, max: 0.4, decay: 2.5 },
  /** Sword hit with more than `limit` plain mobs within `radius` m: the extra ones (weakest first) die; every `cd` s. */
  reaper: { limit: 7, radius: 5, cd: 4 },
  /** Sword hits also cut `pct` of the mob's current HP (`boss` for elites, minis and bosses); hands swing together. */
  axe: { pct: 0.04, boss: 0.01 },
  /** Sword hit: `chance` the mob attacks right away (feeds the shield's counters). */
  shield: { chance: 0.15 },
  /** The sword stabs along with the blade: blade damage × `dmg`, attack speed × `aps`; no swings of its own. */
  hidden_blade: { dmg: 1.45, aps: 0.85 },
  /** After the thrust a 4th blow, one of: falling sword, launch, dash — × `mult`. */
  nagamaki: { mult: 1.8, fall: 2.4, dash: 3.5 },
  /** Scythe cut: `chance` a sword starts circling that mob for `time` s, cutting it (×`mult`) every `rehit` s; it may
   *  jump to a mob within `jumpR` m with `jump` chance per cut; at most `max` at once. */
  scythe: { chance: 0.2, time: 4, rehit: 0.5, mult: 0.35, jump: 0.15, jumpR: 4, max: 6 },
  /** Hammer: no knockback, damage × (1 + `center` × closeness to the centre); the sword becomes a sickle: hit
   *  `chance` → a helper with a sickle or a hammer for `time` s (sickle helpers spawn more with `chain`), ≤ `max`. */
  hammer: { center: 0.6, chance: 0.1, chain: 0.05, time: 8, max: 4, dmg: 0.5 },
  /** The sword becomes a kitchen knife: mobs within `radius` m run away for `time` s; all damage × `dmg`; props
   *  are left alone. */
  pan: { radius: 6, time: 3, dmg: 0.5 },
};
export type SwordPair = keyof typeof SWORD_PAIRS;

export const SHARPEN = { max: 10, perLevel: 0.08, cost: (lvl: number) => 40 + lvl * lvl * 25 };

/** Combo finisher: the 3rd uninterrupted hit in a row (each swing must connect, no pause between). */
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
export const COMBOS: Record<string, ComboDef> = {
  sword: { name: 'Вихрь', hits: 3, window: 0.35, mult: 1.3, rangeAdd: 0.5, shape: 'circle', arc: 360, knock: 7, stun: 0, spin: true, color: 0x9fe3ff },
  axe: { name: 'Раскол', hits: 3, window: 0.35, mult: 1.6, rangeAdd: 0.8, shape: 'arc', arc: 220, knock: 11, stun: 0.4, spin: false, color: 0xff8a5a },
  hammer: { name: 'Землетрясение', hits: 3, window: 0.4, mult: 1.3, rangeAdd: 0.8, shape: 'circle', arc: 360, knock: 5, stun: 1.6, spin: false, color: 0xffc95a },
  dagger: { name: 'Шквал', hits: 3, window: 0.25, mult: 1.2, rangeAdd: 0.4, shape: 'circle', arc: 360, knock: 2, stun: 0, spin: true, color: 0xff6b8a },
  // reaper: the finisher pulls from twice as far
  nagamaki: { name: 'Укол', hits: 3, window: 0.4, mult: 2.6, rangeAdd: 0.8, shape: 'arc', arc: 50, knock: 6, stun: 0.3, spin: false, color: 0xffe0a0 },
  scythe: { name: 'Смерч', hits: 3, window: 0.6, mult: 1.4, rangeAdd: 1, shape: 'circle', arc: 360, knock: 3, stun: 0, spin: true, color: 0xb0ff9a },
  pan: { name: 'БОНК', hits: 3, window: 0.4, mult: 1.6, rangeAdd: 0.4, shape: 'circle', arc: 360, knock: 2, stun: 1.5, spin: false, color: 0xffd28a },
  hidden_blade: { name: 'Казнь', hits: 2, window: 0.8, mult: 1.5, rangeAdd: 0, shape: 'arc', arc: 120, knock: 1, stun: 1, spin: false, color: 0xff4040 },
  shield: { name: 'Таран', hits: 3, window: 0.5, mult: 1.5, rangeAdd: 0.5, shape: 'arc', arc: 140, knock: 9, stun: 0.8, spin: false, color: 0xa0c8ff },
  reaper: { name: 'Жатва', hits: 3, window: 0.45, mult: 1.5, rangeAdd: 0.6, shape: 'circle', arc: 360, knock: 2, stun: 0.5, spin: true, color: 0x9a7bff },
};

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
  /** Recolour: body textures are swapped by the table SKINS[skin] (src/assets.ts). */
  skin?: string;
  /** Speed (m/s) the hit shoves the hero back with. */
  push?: number;
  /** elite: drops `drop` on every kill; mini: micro-boss giving `bonus` stats. Main bosses have `boss`. */
  rank?: 'elite' | 'mini';
  drop?: ItemDrop;
  /** Permanent stats added straight to the hero on every kill (micro-bosses), in stat units: hp 500 = +500 HP. */
  bonus?: OrbReward;
  /** Fixed power orbs dropped on death (shown above the HP bar) — one stat only. */
  reward: OrbReward;
  respawn: number; // seconds
  boss?: BossDef;
}

/** Boss fight tunables (bossLogic in game.ts). Damage multipliers apply to the boss's `dmg`. */
export interface BossDef {
  titles: Record<FactionId, string>;
  zone: ZoneId;
  /** Gate ids (src/island.ts GATES) opened by the first kill. */
  unlocks: string[];
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
  /** Cone attacks aimed at the hero; the boss cycles slam → cones[0] → cones[1] … (phase 2 may swap any step for the chasing blasts). */
  cones?: ConeDef[];
  /** Packs of small mobs run in from the fort entrance when the boss HP first falls below each fraction in `at`. */
  reinforce?: { at: number[]; pool: string[] };
}
/** One cone attack: `yaws` are offsets (rad) from the line to the hero, one cone each; damage = boss dmg × mul. */
export interface ConeDef { half: number; len: number; mul: number; yaws: number[] }
const BOSS_BASE = {
  slamMul: 2.2, slamDelay: 1.25, cd: 6.5, cdPhase2: 4.2, phase2At: 0.5, phase2Dmg: 1.2,
  chance: 0.55, chaseCount: 3, chaseRadius: 2.3, chaseMul: 1.4, chaseDelay: 1.0, chaseGap: 0.45, chaseRange: 11,
};

/** Seconds without taking damage before a mob (bosses too) starts regenerating `MobDef.regen`. */
export const MOB_REGEN_DELAY = 5;

/**
 * Each location's enemies share one profile: what they are weak to (green icon over the minimap) and what
 * they resist. Mobs take it via `foes(zone)`. The starting forest has neither: every blow lands as it is.
 */
export interface ZoneFoes { weak: DamageType[]; resist?: DamageType[] }
export const ZONE_FOES: Partial<Record<ZoneId, ZoneFoes>> = {
  forest: { weak: [] },
  cemetery: { weak: ['crush'], resist: ['slash', 'chop'] },
  peaks: { weak: ['crush'] },
  hills: { weak: ['slash'] },
  grove: { weak: ['crush'] },
  swamp: { weak: ['slash'] },
  dunes: { weak: ['crush'] },
};
function foes(zone: ZoneId): Pick<MobDef, 'resist'> {
  const f = ZONE_FOES[zone]!;
  const resist: MobDef['resist'] = {};
  for (const t of f.resist ?? []) resist[t] = 'resist';
  for (const t of f.weak) resist[t] = 'weak';
  return { resist };
}

/** Static trees of the forest (MobDef.static), 1K–4K HP, each with its own loot. */
function staticTrees(): Record<string, MobDef> {
  const tree = (id: string, name: string, hp: number, scale: number, loot: Pick<MobDef, 'reward' | 'drop'>): MobDef => ({
    id, name, static: true, model: { human: ['elf_tree', null], orc: ['elf_tree', null] },
    anim: 'SwordAttack', hp, dmg: 0, aps: 0, range: 0, speed: 0, aggro: 0, regen: 0, scale,
    ...foes('forest'), respawn: 300, ...loot,
  });
  return {
    tree_young: tree('tree_young', 'Молодое дерево', 1000, 0.6, { reward: { hp: 3 } }),
    tree_birch: tree('tree_birch', 'Берёза', 2000, 0.7, { reward: { power: 2 } }),
    tree_spring: tree('tree_spring', 'Родниковое дерево', 3000, 0.75, { reward: { regen: 1 } }),
    tree_windy: tree('tree_windy', 'Ветреный дуб', 4000, 0.8, { reward: { speed: 3 } }),
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
    anim: 'SwordAttack', hp: 220, dmg: 5, aps: 0.7, range: 1.5, speed: 3.0, aggro: 4.5, regen: 0.04, scale: 1,
    ...foes('forest'), reward: { hp: 2 }, respawn: 45,
  },
  bandit_fighter: {
    id: 'bandit_fighter', name: 'Головорез',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 360, dmg: 10, aps: 0.8, range: 1.6, speed: 3.4, aggro: 5, regen: 0.03, scale: 1.08,
    ...foes('forest'), reward: { power: 3 }, respawn: 60,
  },
  bandit_veteran: {
    id: 'bandit_veteran', name: 'Ветеран', rank: 'elite',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 1400, dmg: 16.5, aps: 0.9, range: 1.8, speed: 3.4, aggro: 5.2, regen: 0.03, scale: 1.3,
    ...foes('forest'), reward: { power: 5 }, respawn: 300,
    // the hero's own starting sword: a copy levels it up
    drop: { kind: 'weapon', def: 'sword', rarity: 0 },
  },
  bandit_brute: {
    id: 'bandit_brute', name: 'Громила', rank: 'elite',
    model: { human: ['orc_grunt', 'sword_orc_warrior'], orc: ['human_knight', 'sword_human_knight'] },
    anim: 'SwordAttack', hp: 2592, dmg: 14.4, aps: 0.7, range: 1.8, speed: 3.2, aggro: 5.2, regen: 0.03, scale: 1.35,
    ...foes('forest'), reward: { hp: 5 }, respawn: 300,
    drop: { kind: 'weapon', def: 'sword', rarity: 1 },
  },
  bandit_lumberjack: {
    id: 'bandit_lumberjack', name: 'Лесоруб', rank: 'elite',
    model: { human: ['orc_peon', 'sword_orc_warrior'], orc: ['peasant', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 1800, dmg: 21, aps: 0.6, range: 1.8, speed: 3.0, aggro: 5.2, regen: 0.03, scale: 1.45,
    ...foes('forest'), reward: { regen: 1 }, respawn: 300,
    drop: { kind: 'armor', def: 'guard_chest', rarity: 0 },
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
  // Guards of the hub boss camp and the Snow Pass gate: above every regular forest mob (max hp 1200, dmg 10), no unlocks.
  boss_guard: {
    id: 'boss_guard', name: 'Страж лагеря',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 3600, dmg: 20, aps: 0.8, range: 1.8, speed: 3.4, aggro: 5.5, regen: 0.03, scale: 1.3,
    ...foes('forest'), reward: { power: 5 }, respawn: 300,
  },
  gate_guard: {
    id: 'gate_guard', name: 'Страж прохода',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 2400, dmg: 16, aps: 0.8, range: 1.7, speed: 3.4, aggro: 5.2, regen: 0.03, scale: 1.2,
    ...foes('forest'), reward: { power: 3 }, respawn: 300,
  },
  bandit_warlord: {
    id: 'bandit_warlord', name: 'Свирепый вожак', rank: 'mini',
    model: { human: ['orc_chieftain', 'sword_orc_warrior'], orc: ['paladin', 'sword_human_knight'] },
    anim: 'SwordAttack', hp: 4320, dmg: 24, aps: 0.65, range: 2.1, speed: 3.4, aggro: 5.5, regen: 0.03, scale: 1.55,
    ...foes('forest'), reward: { hp: 6 }, respawn: 900,
    bonus: { hp: 500 },
  },
  bandit_chief: {
    id: 'bandit_chief', name: 'Атаман',
    model: { human: ['orc_chieftain', 'sword_orc_warrior'], orc: ['paladin', 'sword_human_knight'] },
    anim: 'SwordAttack', hp: 4600, dmg: 12, aps: 0.6, range: 2.4, speed: 3.6, aggro: 6, regen: 0.03, scale: 1.9,
    ...foes('forest'), reward: { power: 12 }, respawn: 900,
    // the forest's swords barely scratch him (−50%); his hammer is the key to the undead behind the gate
    resist: { slash: 'resist' },
    drop: { kind: 'weapon', def: 'hammer', rarity: 0 },
    boss: {
      ...BOSS_BASE, titles: { human: 'Вождь Клык', orc: 'Паладин-отступник' }, zone: 'forest', unlocks: ['forest-cemetery'],
      slamRadius: 4.2, slamMul: 2.4, chaseMul: 1.4, phase2Dmg: 1.2,
      cones: [
        { half: 0.18, len: 15, mul: 2.2, yaws: [0] }, // narrow and long
        { half: 0.95, len: 6.5, mul: 2.4, yaws: [0] }, // wide and short
        { half: 0.2, len: 11, mul: 1.8, yaws: [-0.65, 0, 0.65] }, // three-cone fan
      ],
      reinforce: { at: [0.5, 0.3, 0.2], pool: ['bandit_runner', 'bandit_hammerer', 'bandit_cutter', 'boar'] },
    },
  },
  // ---------- Old Cemetery: the undead hit with blades (slash), weak to hammers, resist blades and axes ----------
  // ---------- creatures (GLB animals, src/creature.ts) ----------
  boar: {
    id: 'boar', name: 'Вепрь', creature: true, push: 5,
    model: { human: ['orc_boar', null], orc: ['orc_boar', null] },
    anim: 'AxeAttack', hp: 180, dmg: 5, aps: 0.9, range: 1.6, speed: 2.1, aggro: 4, regen: 0.04, scale: 1.5,
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
    drop: { kind: 'armor', def: 'lord_head', rarity: 2 },
  },
  shade: {
    id: 'shade', name: 'Тень', rank: 'elite',
    model: { human: ['undead_assassin', null], orc: ['undead_assassin', null] },
    anim: 'SwordAttack', hp: 1280, dmg: 12, aps: 1.1, range: 1.5, speed: 4.5, aggro: 6.2, regen: 0.03, scale: 1.3,
    ...foes('cemetery'), reward: { speed: 5 }, respawn: 600,
    drop: { kind: 'armor', def: 'lord_legs', rarity: 2 },
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
    model: { human: ['undead_king', 'reaper'], orc: ['undead_king', 'reaper'] },
    anim: 'SwordAttack', hp: 16000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.1,
    ...foes('cemetery'), reward: { power: 18 }, respawn: 1200,
    drop: { kind: 'armor', def: 'ring_power', rarity: 3 },
    boss: {
      ...BOSS_BASE, titles: { human: 'Смерть', orc: 'Смерть' }, zone: 'cemetery', unlocks: ['cemetery-peaks'],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
    },
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
    anim: 'SwordAttack', hp: 650, dmg: 18, aps: 1.2, range: 1.5, speed: 4.0, aggro: 5.5, regen: 0.03, scale: 1.05,
    ...foes('peaks'), reward: { speed: 3 }, respawn: 60,
  },
  elf_queen: {
    id: 'elf_queen', name: 'Королева перевала',
    model: { human: ['elf_queen', 'glaive_elf_queen'], orc: ['elf_queen', 'glaive_elf_queen'] },
    anim: 'SwordAttack', hp: 16000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.0,
    ...foes('peaks'), reward: { power: 20 }, respawn: 1200,
    boss: {
      ...BOSS_BASE, titles: { human: 'Королева льдов', orc: 'Королева льдов' }, zone: 'peaks', unlocks: ['forest-peaks', 'forest-hills'],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
    },
  },
  elf_priestess: {
    id: 'elf_priestess', name: 'Жрица рощи',
    model: { human: ['elf_priestess', 'magic_ball'], orc: ['elf_priestess', 'magic_ball'] },
    anim: 'SwordAttack', hp: 16000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.0,
    ...foes('grove'), reward: { regen: 3 }, respawn: 1200,
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
    boss: {
      ...BOSS_BASE, titles: { human: 'Шаман Чёрной Скалы', orc: 'Шаман Чёрной Скалы' }, zone: 'hills', unlocks: ['hills-grove'],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
    },
  },
  // Rotten Swamp and Sand Dunes: only their bosses for now
  murloc_king: {
    id: 'murloc_king', name: 'Король мурлоков', creature: true,
    model: { human: ['human_murloc', null], orc: ['human_murloc', null] },
    anim: 'SwordAttack', hp: 16000, dmg: 37, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.4,
    ...foes('swamp'), reward: { hp: 20 }, respawn: 1200,
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
    boss: {
      ...BOSS_BASE, titles: { human: 'Песчаный вепрь', orc: 'Песчаный вепрь' }, zone: 'dunes', unlocks: [],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
    },
  },
};
/** «Свирепый вожак» of the Rocky Hills: a tauren chieftain for both factions. */
MOBS.tauren_warlord = {
  ...MOBS.bandit_warlord, ...foes('hills'), id: 'tauren_warlord', name: 'Вожак тауренов', skin: 'tauren', drop: undefined,
  model: { human: ['orc_chieftain', 'axe_orc_chieftain'], orc: ['orc_chieftain', 'axe_orc_chieftain'] }, anim: 'AxeAttack',
};

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
  { id: 'forest', name: 'Лесная опушка', ground: 0x45b236, ground2: 0x6ac43e, sky: 0x9ae6c8, fog: 0xbaf0d0, hemi: [0xfaffef, 0x5a8a3a], fogDensity: 0.008, mist: 0.15, mistColor: 0xf0fff4 },
  { id: 'cemetery', name: 'Старое кладбище', ground: 0x625ea0, ground2: 0x746cb4, sky: 0x7c6ed0, fog: 0x9488d8, hemi: [0xf0e8ff, 0x4e4888], fogDensity: 0.012, mist: 0.4, mistColor: 0xddd4ff },
  // Placeholder locations around the forest (no content yet: ground, sky and fog only).
  { id: 'peaks', name: 'Снежный перевал', ground: 0xdfe9f4, ground2: 0xf2f6fc, sky: 0xbfe2ff, fog: 0xe2f1ff, hemi: [0xffffff, 0x8a9ab0], fogDensity: 0.009, mist: 0.2, mistColor: 0xffffff },
  { id: 'swamp', name: 'Гнилое болото', ground: 0x5f8a3c, ground2: 0x739a46, sky: 0x9cc8b0, fog: 0xa8d0b8, hemi: [0xf0fff0, 0x4a6a3a], fogDensity: 0.01, mist: 0.35, mistColor: 0xd8f0e0 },
  { id: 'grove', name: 'Осенняя роща', ground: 0xd8902e, ground2: 0xe8a840, sky: 0xffd8a0, fog: 0xffe4c0, hemi: [0xfff4e0, 0x8a6a3a], fogDensity: 0.007, mist: 0.1, mistColor: 0xfff0e0 },
  { id: 'dunes', name: 'Песчаные дюны', ground: 0xe6c674, ground2: 0xf0d68e, sky: 0xa8dcff, fog: 0xfff0d0, hemi: [0xffffff, 0xa08a5a], fogDensity: 0.006, mist: 0.05, mistColor: 0xffffff },
  { id: 'hills', name: 'Скалистые холмы', ground: 0x9a9286, ground2: 0xaca496, sky: 0xb0c8e0, fog: 0xc8d4e0, hemi: [0xffffff, 0x6a6458], fogDensity: 0.008, mist: 0.1, mistColor: 0xeef0f4 },
];

/**
 * Zone depth: packs further along the trail are bigger, tougher and pay more, so progress means
 * pushing on rather than farming the first clearing. t = 0 for the zone's first pack, 1 for its last
 * (set by World from the trail); bosses, elites, micro-bosses and mobs from graves are not scaled.
 */
export interface DepthDef { hp: number; dmg: number; reward: number; scale: number }
export const DEPTH: Partial<Record<ZoneId, DepthDef>> = {
  forest: { hp: 2.2, dmg: 1.8, reward: 2, scale: 1.15 },
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
  hits: number; // HP in "normal hits"
  color: number;
  scale: number;
  /** Fixed power orbs, shown above the HP bar like on mobs — one stat only. */
  reward: OrbReward;
  /** Material resistances: wood is easy to chop, stone needs a hammer. */
  resist: Partial<Record<DamageType, ResistTier>>;
  r: number;
  /** Respawn cooldown, seconds (GDD 7.3: 30–60 s). */
  respawn: number;
  onBreak?: BreakEvent[];
  /** A turret: while the hero is within `range` it lobs a shot every `cd` s at his position; it lands after `delay` s, hits within `r` for `dmg`. */
  shoot?: { dmg: number; range: number; cd: number; r: number; delay: number; height: number };
}
const GRAVE_RISE: BreakEvent[] = [{ type: 'spawnMob', mob: 'skeleton_worker', chance: 0.35, bark: 'Кто потревожил мой сон?!' }];
// wood is easy to chop, stone needs a hammer
const WOOD: BreakableDef['resist'] = { chop: 'weak', crush: 'resist' };
const STONE: BreakableDef['resist'] = { slash: 'resist', chop: 'resist', crush: 'weak' };
const TOWER_SHOT = { dmg: 10, range: 20, cd: 2.4, r: 1.5, delay: 1.3, height: 5 };
export const BREAKABLES: Record<string, BreakableDef> = {
  barrel: { model: 'barrel', hits: 2, color: 0x8a5a2b, scale: 0.85, reward: { hp: 1 }, resist: WOOD, r: 0.5, respawn: 40 },
  orc_barrel: { model: 'orc_barrel', hits: 2, color: 0x7a4a22, scale: 0.85, reward: { hp: 1 }, resist: WOOD, r: 0.5, respawn: 40 },
  box: { model: 'box_small_1', hits: 1, color: 0xa87a45, scale: 0.9, reward: { power: 1 }, resist: {}, r: 0.45, respawn: 30 },
  box_large: { model: 'box_large_1', hits: 3, color: 0xa87a45, scale: 0.8, reward: { power: 2 }, resist: {}, r: 0.7, respawn: 60 },
  orc_box: { model: 'orc_box_small_1', hits: 1, color: 0x8a5a2b, scale: 0.9, reward: { power: 1 }, resist: {}, r: 0.45, respawn: 30 },
  bush: { model: null, hits: 1, color: 0x3f8f2f, scale: 1, reward: { regen: 1 }, resist: { slash: 'weak', crush: 'resist' }, r: 0.6, respawn: 25 },
  tomb1: { model: 'undead_tomb_stone_1', hits: 2, color: 0x77748a, scale: 0.75, reward: { power: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb2: { model: 'undead_tomb_stone_2', hits: 2, color: 0x77748a, scale: 0.75, reward: { regen: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb3: { model: 'undead_tomb_stone_3', hits: 2, color: 0x77748a, scale: 0.75, reward: { hp: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb4: { model: 'undead_tomb_stone_4', hits: 2, color: 0x77748a, scale: 0.75, reward: { speed: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  fort_tower_orc: { model: 'orc_tower_Lv2', hits: 30, color: 0x7a5a38, scale: 0.38, reward: { power: 3 }, resist: { slash: 'weak' }, r: 1.4, respawn: 900, shoot: TOWER_SHOT },
  fort_tower_human: { model: 'tower_Lv2', hits: 30, color: 0x7a5a38, scale: 0.38, reward: { power: 3 }, resist: { slash: 'weak' }, r: 1.4, respawn: 900, shoot: TOWER_SHOT },
  coffin: { model: 'undead_coffin', hits: 3, color: 0x5a3c2c, scale: 0.34, reward: { hp: 2 }, resist: { crush: 'weak' }, r: 0.7, respawn: 75, onBreak: [{ type: 'spawnMob', mob: 'skeleton_warrior', chance: 0.7, bark: 'Вечный покой окончен!' }] },
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
const MIN = 60;
const HOUR = 3600;
/** Forest Edge: every spawner (elites and the micro-boss too) has 3 charges — 4 min, 5 min, 12 h. */
const FOREST_CHARGES = [4 * MIN, 5 * MIN, 12 * HOUR];
const spawner = (id: string, charges?: number[]): SpawnerDef => ({ unit: 'mob', id, charges });
/** Mob spawners by location, placed along the trail in list order (first = nearest the location's entrance). */
export const SPAWNERS: Partial<Record<ZoneId, SpawnerDef[]>> = {
  forest: ([
    'boar', 'bandit_thug', 'bandit_thug', 'boar', 'bandit_thug', 'bandit_fighter', 'bandit_veteran',
    'bandit_thug', 'bandit_fighter', 'boar', 'bandit_warlord', 'bandit_thug', 'bandit_fighter', 'bandit_brute',
    'bandit_thug', 'boar', 'bandit_fighter', 'bandit_fighter', 'bandit_lumberjack',
  ]).map((id) => spawner(id, FOREST_CHARGES)),
  // one endless charge with the mob's own respawn time
  cemetery: ([
    'skeleton_worker', 'undead_boar', 'skeleton_worker', 'ghost', 'bone_guard', 'skeleton_warrior', 'undead_boar',
    'skeleton_worker', 'ghost', 'gravedigger', 'skeleton_warrior', 'undead_boar', 'skeleton_worker', 'shade', 'skeleton_warrior',
    'skeleton_warrior', 'undead_boar',
  ]).map((id) => spawner(id)),
  peaks: ([
    'elf_lumberjack', 'elf_sentinel', 'elf_lumberjack', 'elf_assassin', 'elf_sentinel', 'elf_lumberjack',
    'elf_assassin', 'elf_sentinel', 'elf_lumberjack', 'elf_assassin', 'elf_sentinel', 'elf_assassin',
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
/** «Свирепый вожак» mini-bosses of the cemetery and the outer lands. */
export const MINI_SPAWNER = spawner('bandit_warlord');
/** Zones whose mini-bosses are a local variant instead of «Свирепый вожак». */
export const MINI_SPAWNER_OF: Partial<Record<ZoneId, SpawnerDef>> = { hills: spawner('tauren_warlord') };
/** Round the gloves elite (world.glovesGuards): two bandit pairs in the trees. */
export const GLOVES_BANDITS = ['bandit_thug', 'bandit_fighter', 'bandit_fighter', 'bandit_thug'].map((id) => spawner(id, FOREST_CHARGES));
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
  /** Chance a kill gives one pull, by mob rank (tuned with `npm run sim` to ~1 pull per 5 min of play). */
  token: { normal: 0.015, elite: 0.15, mini: 0.3, boss: 1 } as Record<MobRank, number>,
  banner: { def: 'hammer', name: 'Молот Короля-лича', subtitle: 'Выкован из костей павших королей. Шанс повышен!' },
  /** Hammer blows per pull; the rarity colour can climb after each, legendary only on the last one. */
  strikes: 5,
  /** Reveal timing, seconds: delay between hammer blows, then the final flash. */
  strikeGap: 0.6,
  revealHold: 0.9,
};

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
/** Kill feel: the death clip starts on the lethal hit, holds `holdAt` s into the fall for `freeze` s (hit-stop), then the corpse is thrown back harder than a normal hit. */
/** Every non-lethal hit holds the mob's pose (animation only) for this many seconds. */
export const HIT_FREEZE = 0.15;
export const KILL_FX ={ holdAt: 0.1, freeze: 0.3, knockMul: 2, shake: 0.31, blood: 14 };
