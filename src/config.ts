// All gameplay numbers live here (GDD: "все числа — ориентиры").

export type DamageType = 'slash' | 'crush' | 'pierce' | 'fire';
export type ResistTier = 'weak' | 'normal' | 'resist' | 'immune';
export type FactionId = 'human' | 'orc';
export type ZoneId = 'camp' | 'forest' | 'cemetery';
export type AttackAnim = 'SwordAttack' | 'AxeAttack';

export const RESIST_MULT: Record<ResistTier, number> = { weak: 1.5, normal: 1, resist: 0.5, immune: 0.25 };
export const DAMAGE_TYPE_NAME: Record<DamageType, string> = {
  slash: 'режущий', crush: 'дробящий', pierce: 'колющий', fire: 'огонь',
};
export const DAMAGE_TYPE_COLOR: Record<DamageType, string> = {
  slash: '#7fd3ff', crush: '#ffb347', pierce: '#c5ff7f', fire: '#ff6a3d',
};

export const RARITY = [
  { name: 'Обычное', color: '#c9c9c9', mult: 1 },
  { name: 'Редкое', color: '#4ea3ff', mult: 1.25 },
  { name: 'Эпическое', color: '#b35cff', mult: 1.55 },
  { name: 'Легендарное', color: '#ffa31a', mult: 1.9 },
];

export interface WeaponDef {
  id: string;
  name: string;
  type: DamageType;
  dmg: number;
  aps: number; // attacks per second
  shape: 'arc' | 'circle';
  arc: number; // degrees, for 'arc'
  range: number; // metres
  anim: AttackAnim;
  model: Record<FactionId, string>;
  icon: string;
  stun?: number; // chance
}

export const WEAPONS: Record<string, WeaponDef> = {
  sword: {
    id: 'sword', name: 'Меч', type: 'slash', dmg: 20, aps: 1.15, shape: 'arc', arc: 140, range: 2.3,
    anim: 'SwordAttack', model: { human: 'sword_human_knight', orc: 'sword_orc_warrior' }, icon: '🗡️',
  },
  axe: {
    id: 'axe', name: 'Топор', type: 'slash', dmg: 25, aps: 0.95, shape: 'arc', arc: 160, range: 2.3,
    anim: 'AxeAttack', model: { human: 'axe', orc: 'axe_orc_grunt' }, icon: '🪓',
  },
  hammer: {
    id: 'hammer', name: 'Молот', type: 'crush', dmg: 34, aps: 0.7, shape: 'circle', arc: 360, range: 2.7,
    anim: 'AxeAttack', model: { human: 'hammer_human_paladin', orc: 'hammer_human_paladin' }, icon: '🔨', stun: 0.25,
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
  sword: { name: 'Вихрь', hits: 3, window: 0.35, mult: 1.8, rangeAdd: 0.9, shape: 'circle', arc: 360, knock: 7, stun: 0, spin: true, color: 0x9fe3ff },
  axe: { name: 'Раскол', hits: 3, window: 0.35, mult: 2.3, rangeAdd: 1.2, shape: 'arc', arc: 220, knock: 11, stun: 0.4, spin: false, color: 0xff8a5a },
  hammer: { name: 'Землетрясение', hits: 3, window: 0.4, mult: 1.6, rangeAdd: 1.8, shape: 'circle', arc: 360, knock: 5, stun: 1.6, spin: false, color: 0xffc95a },
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
    id: 'human', name: 'Люди', fantasy: 'Дисциплина, защита, свет', hero: 'human_knight', preview: ['paladin', 'hammer_human_paladin'], startWeapon: 'sword',
    passiveName: 'Святой щит',
    passiveText: 'Щит на 15% HP, восстанавливается через 6 с без урона. +10% HP, +10% реген.',
    color: '#3f7fd8',
    campBuildings: ['house_Lv1', 'house_Lv2', 'smithy_Lv1', 'tower_Lv1', 'barrack_Lv1'],
    campProps: ['banner', 'flag', 'lantern_street', 'anvil_big'],
    campfire: 'campfire',
  },
  orc: {
    id: 'orc', name: 'Орки', fantasy: 'Ярость, натиск, сила', hero: 'orc_grunt', preview: ['orc_chieftain', 'axe_orc_chieftain'], startWeapon: 'axe',
    passiveName: 'Жажда крови',
    passiveText: 'Чем меньше HP, тем больше урон (до +30%). +10% урон, +5% скорость бега.',
    color: '#c0392b',
    campBuildings: ['orc_house_Lv1', 'orc_house_Lv2', 'orc_smithy_Lv1', 'orc_tower_Lv1', 'orc_barrack_Lv1'],
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
  /** Fixed power orbs dropped on death (shown above the HP bar). */
  reward: Partial<Record<OrbKind, number>>;
  gold: [number, number];
  /** Experience for the kill (bosses: x2 on the first kill). */
  xp: number;
  respawn: number; // seconds
  boss?: { titles: Record<FactionId, string>; slamRadius: number; zone: ZoneId };
}

export const MOBS: Record<string, MobDef> = {
  bandit_thug: {
    id: 'bandit_thug', name: 'Разбойник',
    model: { human: ['orc_peon', 'axe_orc_peon'], orc: ['peasant', 'axe'] },
    anim: 'AxeAttack', hp: 45, dmg: 5, aps: 0.7, range: 1.5, speed: 3.0, aggro: 7, scale: 1,
    resist: { slash: 'weak' }, reward: { hp: 1, power: 1 }, gold: [1, 3], xp: 10, respawn: 45,
  },
  bandit_fighter: {
    id: 'bandit_fighter', name: 'Головорез',
    model: { human: ['orc_warrior', 'sword_orc_warrior'], orc: ['soldier', 'sword_soldier'] },
    anim: 'SwordAttack', hp: 85, dmg: 8, aps: 0.8, range: 1.6, speed: 3.4, aggro: 7.5, scale: 1.08,
    resist: { slash: 'weak' }, reward: { power: 2, hp: 1 }, gold: [2, 5], xp: 16, respawn: 60,
  },
  bandit_chief: {
    id: 'bandit_chief', name: 'Атаман',
    model: { human: ['orc_chieftain', 'axe_orc_chieftain'], orc: ['paladin', 'hammer_human_paladin'] },
    anim: 'AxeAttack', hp: 1400, dmg: 16, aps: 0.6, range: 2.4, speed: 3.6, aggro: 9, scale: 1.9,
    resist: { slash: 'weak' }, reward: { power: 5, hp: 4, regen: 2, speed: 2 }, gold: [60, 90], xp: 300, respawn: 180,
    boss: { titles: { human: 'Вождь Клык', orc: 'Паладин-отступник' }, slamRadius: 4.2, zone: 'forest' },
  },
  skeleton_worker: {
    id: 'skeleton_worker', name: 'Мертвяк',
    model: { human: ['undead_worker', null], orc: ['undead_worker', null] },
    anim: 'SwordAttack', hp: 120, dmg: 11, aps: 0.8, range: 1.4, speed: 2.8, aggro: 7, scale: 1,
    resist: { slash: 'resist', crush: 'weak', pierce: 'immune' }, reward: { regen: 1, hp: 1, power: 1 }, gold: [3, 6], xp: 22, respawn: 50,
  },
  skeleton_warrior: {
    id: 'skeleton_warrior', name: 'Скелет-копейщик',
    model: { human: ['undead_warrior', 'spear_undead_warrior'], orc: ['undead_warrior', 'spear_undead_warrior'] },
    anim: 'SwordAttack', hp: 170, dmg: 14, aps: 0.75, range: 2.0, speed: 3.0, aggro: 8, scale: 1.08,
    resist: { slash: 'resist', crush: 'weak', pierce: 'immune' }, reward: { power: 2, hp: 1 }, gold: [4, 8], xp: 28, respawn: 70,
  },
  ghost: {
    id: 'ghost', name: 'Призрак',
    model: { human: ['undead_assassin', null], orc: ['undead_assassin', null] },
    anim: 'SwordAttack', hp: 110, dmg: 15, aps: 1.0, range: 1.4, speed: 4.3, aggro: 9, scale: 1,
    resist: { slash: 'resist', crush: 'weak', pierce: 'immune' }, reward: { speed: 2, power: 1 }, gold: [4, 7], xp: 26, respawn: 60,
  },
  death: {
    id: 'death', name: 'Смерть',
    model: { human: ['undead_king', 'sword_undead_king'], orc: ['undead_king', 'sword_undead_king'] },
    anim: 'SwordAttack', hp: 4200, dmg: 28, aps: 0.6, range: 2.6, speed: 3.4, aggro: 10, scale: 2.1,
    resist: { slash: 'resist', crush: 'weak', pierce: 'immune' }, reward: { power: 8, hp: 6, regen: 3, speed: 3 }, gold: [150, 220], xp: 800, respawn: 300,
    boss: { titles: { human: 'Смерть', orc: 'Смерть' }, slamRadius: 5, zone: 'cemetery' },
  },
};

export type OrbKind = 'power' | 'hp' | 'regen' | 'speed';
export const ORBS: Record<OrbKind, { color: number; css: string; label: string; value: number; unit: string }> = {
  power: { color: 0xff3b3b, css: '#ff4d4d', label: 'Урон', value: 2, unit: '' },
  hp: { color: 0x39e05a, css: '#4cff6a', label: 'Здоровье', value: 6, unit: '' },
  regen: { color: 0x3cc8ff, css: '#4fd2ff', label: 'Реген', value: 0.05, unit: '%/с' },
  speed: { color: 0xffd23c, css: '#ffd84d', label: 'Скорость', value: 0.05, unit: ' м/с' },
};
export const fmtOrb = (k: OrbKind, n = 1) => `+${+(ORBS[k].value * n).toFixed(2)}`;

export const HERO = {
  power: 10, hp: 100, regen: 1, speed: 5,
  regenCap: 5, speedCap: 7.5, outOfCombatRegen: 3, outOfCombatDelay: 3,
  radius: 0.45, acquireExtra: 0.4, campfireRegen: 4, campfireRadius: 6,
};

export interface ZoneDef {
  id: ZoneId;
  name: string;
  z: [number, number]; // zMax (south) .. zMin (north)
  ground: number;
  ground2: number;
  sky: number;
  fog: number;
  hemi: [number, number];
  fogDensity: number; // FogExp2
  mist: number; // ground mist strength 0..1
  mistColor: number;
  recommend?: DamageType;
}

export const ZONES: ZoneDef[] = [
  { id: 'camp', name: 'Лагерь', z: [30, -22], ground: 0x6cc23c, ground2: 0x8ed64c, sky: 0x8fd6ff, fog: 0xc4ecff, hemi: [0xffffff, 0x86a85a], fogDensity: 0.006, mist: 0.05, mistColor: 0xffffff },
  { id: 'forest', name: 'Опушка леса', z: [-22, -118], ground: 0x45b236, ground2: 0x6ac43e, sky: 0x9ae6c8, fog: 0xbaf0d0, hemi: [0xfaffef, 0x5a8a3a], fogDensity: 0.008, mist: 0.15, mistColor: 0xf0fff4, recommend: 'slash' },
  { id: 'cemetery', name: 'Старое кладбище', z: [-118, -225], ground: 0x625ea0, ground2: 0x746cb4, sky: 0x7c6ed0, fog: 0x9488d8, hemi: [0xf0e8ff, 0x4e4888], fogDensity: 0.012, mist: 0.4, mistColor: 0xddd4ff, recommend: 'crush' },
];

export const WORLD = { halfWidth: 34, zMax: 26, zMin: -222, barrierZ: -118 };

export const RESPAWN_MIN_DIST = 10;
export const LEASH = 15;
