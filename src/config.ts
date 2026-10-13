// All gameplay numbers live here (GDD: "все числа — ориентиры").

/** Sword — slash (режущий), axe — chop (рубящий), hammer — crush (дробящий). */
export type DamageType = 'slash' | 'chop' | 'crush';
export type ResistTier = 'weak' | 'normal' | 'resist' | 'immune';
export type FactionId = 'human' | 'orc';
export type ZoneId = 'forest' | 'cemetery' | 'peaks' | 'swamp' | 'grove' | 'dunes' | 'hills';
export type AttackAnim = 'SwordAttack' | 'AxeAttack';
/**
 * Hit markers: seconds into each attack clip at natural speed where the blow connects. Mob damage lands on this
 * frame if the hero is still in reach. Humanoid FBX clips by name, GLB creatures as `<model>:attack`.
 */
export const ATTACK_HIT: Record<string, number> = {
  SwordAttack: 0.6, AxeAttack: 0.83,
  'orc_boar:attack': 9 / 24, 'undead_boar:attack': 9 / 24, 'human_murloc:attack': 0.6 / 1.3,
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
   * Reaper: each swing drags mobs within `radius` m towards a point `ahead` m in front of the hero (bosses stay),
   * then the blow deals × (1 + perEnemy × (hits − 1)), up to × `max`.
   */
  pull?: { radius: number; ahead: number; force: number; perEnemy: number; max: number };
}

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
    id: 'dagger', name: 'Кинжалы', type: 'slash', dmgMul: 0.45, aps: 2.4, shape: 'arc', arc: 90, range: 1.9,
    anim: 'SwordAttack', model: { human: 'dagger', orc: 'dagger' }, icon: '🔪', single: true,
    stack: { add: 0.12, max: 10, decay: 2.5 },
  },
  reaper: {
    id: 'reaper', name: 'Жнец', type: 'slash', dmgMul: 1.1, aps: 0.8, shape: 'arc', arc: 200, range: 2.6,
    anim: 'AxeAttack', model: { human: 'reaper', orc: 'reaper' }, icon: '🌙',
    pull: { radius: 5, ahead: 1.5, force: 9, perEnemy: 0.15, max: 2 },
  },
};

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
  // daggers: the finisher also counts the target's stacks twice (src/game.ts heroStrike)
  dagger: { name: 'Шквал', hits: 3, window: 0.25, mult: 1.2, rangeAdd: 0.4, shape: 'circle', arc: 360, knock: 2, stun: 0, spin: true, color: 0xff6b8a },
  // reaper: the finisher pulls from twice as far
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
  passiveName: string;
  passiveText: string;
  color: string;
  campBuildings: string[];
  campProps: string[];
  campfire: string;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  human: {
    id: 'human', name: 'Люди', fantasy: 'Дисциплина, защита, свет', hero: 'peasant', preview: ['paladin', 'hammer_human_paladin'], startWeapon: 'sword',
    passiveName: 'Святой щит',
    passiveText: 'Щит на 15% HP, восстанавливается через 6 с без урона. +10% HP, +10% реген.',
    color: '#3f7fd8',
    campBuildings: ['house_Lv1', 'house_Lv2', 'tower_Lv1', 'barrack_Lv1'],
    campProps: ['banner', 'flag', 'lantern_street'],
    campfire: 'campfire',
  },
  orc: {
    id: 'orc', name: 'Орки', fantasy: 'Ярость, натиск, сила', hero: 'orc_peon', preview: ['orc_chieftain', 'axe_orc_chieftain'], startWeapon: 'axe',
    passiveName: 'Жажда крови',
    passiveText: 'Чем меньше HP, тем больше урон (до +30%). +10% урон, +5% скорость бега.',
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
  /** Damage type of its hits (the location's, see ZONE_FOES); the hero's armour resists it. */
  attack: DamageType;
  resist: Partial<Record<DamageType, ResistTier>>;
  /** HP fraction per second once nobody has hit the mob for MOB_REGEN_DELAY s. */
  regen: number;
  /** GLB animal (Creature): `model` names a .glb with its own rig and clips, weapon is always null. */
  creature?: boolean;
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
}
const BOSS_BASE = {
  slamMul: 2.2, slamDelay: 1.25, cd: 6.5, cdPhase2: 4.2, phase2At: 0.5, phase2Dmg: 1.2,
  chance: 0.55, chaseCount: 3, chaseRadius: 2.3, chaseMul: 1.4, chaseDelay: 1.0, chaseGap: 0.45, chaseRange: 11,
};

/** Seconds without taking damage before a mob (bosses too) starts regenerating `MobDef.regen`. */
export const MOB_REGEN_DELAY = 5;

/**
 * Each location's enemies share one profile: the damage type they hit with (red icon over the minimap),
 * what they are weak to (green icon) and what they resist. Mobs take it via `foes(zone)`.
 */
export interface ZoneFoes { attack: DamageType; weak: DamageType[]; resist?: DamageType[] }
export const ZONE_FOES: Partial<Record<ZoneId, ZoneFoes>> = {
  forest: { attack: 'chop', weak: ['slash'] },
  cemetery: { attack: 'slash', weak: ['crush'], resist: ['slash', 'chop'] },
};
function foes(zone: ZoneId): Pick<MobDef, 'attack' | 'resist'> {
  const f = ZONE_FOES[zone]!;
  const resist: MobDef['resist'] = {};
  for (const t of f.resist ?? []) resist[t] = 'resist';
  for (const t of f.weak) resist[t] = 'weak';
  return { attack: f.attack, resist };
}

/**
 * Mob ranks besides plain mobs and the location's main boss (`boss`):
 * - elite — 1–3 per location, always drops its own `drop` item (map: that item's icon in a rarity frame);
 * - mini  — micro-boss (map: small orange skull), gives permanent stats `bonus` on every kill.
 * Main boss: big red skull on the map; its first kill opens the gates in `boss.unlocks`.
 */
export const MOBS: Record<string, MobDef> = {
  // ---------- Forest Edge: bandits hit with axes (chop), weak to swords (slash) ----------
  bandit_thug: {
    id: 'bandit_thug', name: 'Разбойник',
    model: { human: ['orc_peon', 'axe_orc_peon'], orc: ['peasant', 'axe'] },
    anim: 'AxeAttack', hp: 110, dmg: 9, aps: 0.7, range: 1.5, speed: 3.0, aggro: 4.5, regen: 0.04, scale: 1,
    ...foes('forest'), reward: { hp: 2 }, respawn: 45,
  },
  bandit_fighter: {
    id: 'bandit_fighter', name: 'Головорез',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 220, dmg: 16, aps: 0.8, range: 1.6, speed: 3.4, aggro: 5, regen: 0.03, scale: 1.08,
    ...foes('forest'), reward: { power: 3 }, respawn: 60,
  },
  bandit_veteran: {
    id: 'bandit_veteran', name: 'Ветеран', rank: 'elite',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 700, dmg: 19, aps: 0.9, range: 1.8, speed: 3.4, aggro: 5.2, regen: 0.03, scale: 1.3,
    ...foes('forest'), reward: { power: 5 }, respawn: 300,
    drop: { kind: 'weapon', def: 'sword', rarity: 1 },
  },
  bandit_brute: {
    id: 'bandit_brute', name: 'Громила', rank: 'elite',
    model: { human: ['orc_grunt', 'axe_orc_grunt'], orc: ['human_knight', 'sword_human_knight'] },
    anim: 'AxeAttack', hp: 800, dmg: 20, aps: 0.7, range: 1.8, speed: 3.2, aggro: 5.2, regen: 0.03, scale: 1.35,
    ...foes('forest'), reward: { hp: 5 }, respawn: 300,
    drop: { kind: 'weapon', def: 'hammer', rarity: 1 },
  },
  bandit_lumberjack: {
    id: 'bandit_lumberjack', name: 'Лесоруб', rank: 'elite',
    model: { human: ['orc_peon', 'axe_orc_peon'], orc: ['peasant', 'axe'] },
    anim: 'AxeAttack', hp: 900, dmg: 24, aps: 0.6, range: 1.8, speed: 3.0, aggro: 5.2, regen: 0.03, scale: 1.45,
    ...foes('forest'), reward: { regen: 1 }, respawn: 300,
    drop: { kind: 'armor', def: 'guard_chest', rarity: 1 },
  },
  bandit_warlord: {
    id: 'bandit_warlord', name: 'Свирепый вожак', rank: 'mini',
    model: { human: ['orc_chieftain', 'axe_orc_chieftain'], orc: ['paladin', 'hammer_human_paladin'] },
    anim: 'AxeAttack', hp: 2250, dmg: 26, aps: 0.65, range: 2.1, speed: 3.4, aggro: 5.5, regen: 0.03, scale: 1.55,
    ...foes('forest'), reward: { hp: 6 }, respawn: 900,
    bonus: { hp: 500 },
  },
  bandit_chief: {
    id: 'bandit_chief', name: 'Атаман',
    model: { human: ['orc_chieftain', 'axe_orc_chieftain'], orc: ['paladin', 'hammer_human_paladin'] },
    anim: 'AxeAttack', hp: 5200, dmg: 30, aps: 0.6, range: 2.4, speed: 3.6, aggro: 6, regen: 0.03, scale: 1.9,
    ...foes('forest'), reward: { power: 12 }, respawn: 180,
    drop: { kind: 'weapon', def: 'hammer', rarity: 2 },
    boss: {
      ...BOSS_BASE, titles: { human: 'Вождь Клык', orc: 'Паладин-отступник' }, zone: 'forest', unlocks: ['forest-cemetery'],
      slamRadius: 4.2, slamMul: 2.4, chaseMul: 1.4, phase2Dmg: 1.2,
    },
  },
  // ---------- Old Cemetery: the undead hit with blades (slash), weak to hammers, resist blades and axes ----------
  // ---------- creatures (GLB animals, src/creature.ts) ----------
  boar: {
    id: 'boar', name: 'Вепрь', creature: true, push: 5,
    model: { human: ['orc_boar', null], orc: ['orc_boar', null] },
    anim: 'AxeAttack', hp: 90, dmg: 8, aps: 0.9, range: 1.6, speed: 2.1, aggro: 4, regen: 0.04, scale: 1.5,
    ...foes('forest'), reward: { speed: 1 }, respawn: 40,
  },
  murloc: {
    id: 'murloc', name: 'Мурлок', creature: true,
    model: { human: ['human_murloc', null], orc: ['human_murloc', null] },
    anim: 'SwordAttack', hp: 1000, dmg: 2, aps: 0.85, range: 1.5, speed: 3.4, aggro: 4.5, regen: 0.04, scale: 1.1,
    ...foes('forest'), reward: { power: 1 }, respawn: 45,
  },
  undead_boar: {
    id: 'undead_boar', name: 'Нежить-вепрь', creature: true, push: 5,
    model: { human: ['undead_boar', null], orc: ['undead_boar', null] },
    anim: 'AxeAttack', hp: 150, dmg: 9, aps: 0.85, range: 1.6, speed: 1.9, aggro: 4.5, regen: 0.03, scale: 1.5,
    ...foes('cemetery'), reward: { hp: 1 }, respawn: 50,
  },
  skeleton_worker: {
    id: 'skeleton_worker', name: 'Мертвяк',
    model: { human: ['undead_worker', null], orc: ['undead_worker', null] },
    anim: 'SwordAttack', hp: 140, dmg: 8, aps: 0.8, range: 1.4, speed: 2.8, aggro: 4.5, regen: 0.03, scale: 1,
    ...foes('cemetery'), reward: { regen: 1 }, respawn: 50,
  },
  skeleton_warrior: {
    id: 'skeleton_warrior', name: 'Скелет-копейщик',
    model: { human: ['undead_warrior', 'spear_undead_warrior'], orc: ['undead_warrior', 'spear_undead_warrior'] },
    anim: 'SwordAttack', hp: 260, dmg: 15, aps: 0.75, range: 2.0, speed: 3.0, aggro: 5, regen: 0.025, scale: 1.08,
    ...foes('cemetery'), reward: { power: 3 }, respawn: 70,
  },
  ghost: {
    id: 'ghost', name: 'Призрак',
    model: { human: ['undead_assassin', null], orc: ['undead_assassin', null] },
    anim: 'SwordAttack', hp: 130, dmg: 14, aps: 1.0, range: 1.4, speed: 4.3, aggro: 6, regen: 0.05, scale: 1,
    ...foes('cemetery'), reward: { speed: 3 }, respawn: 60,
  },
  bone_guard: {
    id: 'bone_guard', name: 'Костяной страж', rank: 'elite',
    model: { human: ['undead_warrior', 'spear_undead_warrior'], orc: ['undead_warrior', 'spear_undead_warrior'] },
    anim: 'SwordAttack', hp: 820, dmg: 22, aps: 0.75, range: 2.1, speed: 3.0, aggro: 5.5, regen: 0.03, scale: 1.4,
    ...foes('cemetery'), reward: { hp: 6 }, respawn: 600,
    drop: { kind: 'armor', def: 'lord_head', rarity: 2 },
  },
  shade: {
    id: 'shade', name: 'Тень', rank: 'elite',
    model: { human: ['undead_assassin', null], orc: ['undead_assassin', null] },
    anim: 'SwordAttack', hp: 640, dmg: 20, aps: 1.1, range: 1.5, speed: 4.5, aggro: 6.2, regen: 0.03, scale: 1.3,
    ...foes('cemetery'), reward: { speed: 5 }, respawn: 600,
    drop: { kind: 'weapon', def: 'sword', rarity: 2 },
  },
  gravedigger: {
    id: 'gravedigger', name: 'Могильщик', rank: 'mini',
    model: { human: ['undead_worker', null], orc: ['undead_worker', null] },
    anim: 'SwordAttack', hp: 1820, dmg: 26, aps: 0.8, range: 1.9, speed: 3.0, aggro: 5.9, regen: 0.03, scale: 1.75,
    ...foes('cemetery'), reward: { regen: 2 }, respawn: 1800,
    bonus: { regen: 25 },
  },
  death: {
    id: 'death', name: 'Смерть',
    model: { human: ['undead_king', 'sword_undead_king'], orc: ['undead_king', 'sword_undead_king'] },
    anim: 'SwordAttack', hp: 4500, dmg: 19, aps: 0.6, range: 2.6, speed: 3.4, aggro: 6.5, regen: 0.03, scale: 2.1,
    ...foes('cemetery'), reward: { power: 18 }, respawn: 300,
    drop: { kind: 'weapon', def: 'hammer', rarity: 3 },
    boss: {
      ...BOSS_BASE, titles: { human: 'Смерть', orc: 'Смерть' }, zone: 'cemetery', unlocks: ['forest-peaks', 'cemetery-peaks'],
      slamRadius: 5, slamMul: 4.7, chaseMul: 2.6, phase2Dmg: 1.3,
    },
  },
};

export type OrbKind = 'power' | 'hp' | 'regen' | 'speed';
/** Stats a mob / prop gives: exactly one stat ({ hp: 3 }), a second key is a type error. */
export type OrbReward = { [K in OrbKind]: Record<K, number> & Partial<Record<Exclude<OrbKind, K>, never>> }[OrbKind];
export const ORBS: Record<OrbKind, { color: number; css: string; label: string; value: number; unit: string }> = {
  power: { color: 0xff3b3b, css: '#ff4d4d', label: 'Урон', value: 1, unit: '' },
  hp: { color: 0x39e05a, css: '#4cff6a', label: 'Здоровье', value: 2, unit: '' },
  regen: { color: 0x3cc8ff, css: '#4fd2ff', label: 'Реген', value: 1, unit: ' HP/с' },
  speed: { color: 0xffd23c, css: '#ffd84d', label: 'Скорость', value: 1, unit: '' },
};
export const fmtOrb = (k: OrbKind, n = 1) => `+${Math.round(ORBS[k].value * n)}`;

export const HERO = {
  /** All stats are whole numbers. power: +% damage, regen: HP per second, speed: points (see speedPerMs). */
  power: 10, hp: 100, regen: 1, speed: 100,
  regenCap: 50, speedCap: 150,
  /** Speed points per metre per second: 100 points = 5 m/s. */
  speedPerMs: 20,
  /** In the camp HP comes back fast: % of max HP per second (on top of the normal regen). */
  campRegen: 10,
  /** Final run speed multiplier (applies to old saves too): 100 points → 4 m/s. Mobs run 2.8–4.3. */
  speedMul: 0.8,
  radius: 0.45, acquireExtra: 0.4,
};

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
export function depthMul(zone: ZoneId, t: number) {
  const d = DEPTH[zone];
  t = d ? Math.min(1, Math.max(0, t)) : 0;
  const k = (v: number) => 1 + (v - 1) * t;
  return { hp: d ? k(d.hp) : 1, dmg: d ? k(d.dmg) : 1, reward: d ? k(d.reward) : 1, scale: d ? k(d.scale) : 1 };
}

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
    'boar', 'bandit_thug', 'murloc', 'bandit_thug', 'boar', 'bandit_thug', 'bandit_fighter', 'bandit_veteran',
    'bandit_thug', 'bandit_fighter', 'boar', 'bandit_warlord', 'bandit_thug', 'murloc', 'bandit_fighter', 'bandit_brute',
    'bandit_thug', 'boar', 'bandit_fighter', 'bandit_fighter', 'bandit_lumberjack',
  ]).map((id) => spawner(id, FOREST_CHARGES)),
  // one endless charge with the mob's own respawn time
  cemetery: ([
    'skeleton_worker', 'undead_boar', 'skeleton_worker', 'ghost', 'bone_guard', 'skeleton_warrior', 'undead_boar',
    'skeleton_worker', 'ghost', 'gravedigger', 'skeleton_warrior', 'undead_boar', 'skeleton_worker', 'shade', 'skeleton_warrior',
  ]).map((id) => spawner(id)),
};

/**
 * Breakable prop spawners (same SpawnerDef, unit 'prop'), spread over an area by group:
 * camp — crates by the settlement gate; forest — beside the forest trail;
 * cemetery — graves beside the cemetery trail; cemeteryField — graves in the cemetery's far end.
 */
/** n prop spawners cycling through the given kinds. */
const props = (kinds: string[], n: number, charges?: number[]): SpawnerDef[] =>
  Array.from({ length: n }, (_, i) => ({ unit: 'prop', id: kinds[i % kinds.length], charges }));
const GRAVES = ['tomb1', 'tomb2', 'tomb3', 'tomb4', 'tomb1', 'tomb2', 'coffin'];
export const PROP_SPAWNERS: Record<'camp' | 'forest' | 'cemetery' | 'cemeteryField', SpawnerDef[]> = {
  camp: props(['barrel', 'box', 'box', 'barrel'], 4, FOREST_CHARGES),
  forest: props(['barrel', 'box', 'bush', 'box_large', 'orc_barrel', 'bush', 'orc_box'], 24, FOREST_CHARGES),
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
export const KILL_FX = { holdAt: 0.1, freeze: 0.1, knockMul: 2, shake: 0.31, blood: 14 };
