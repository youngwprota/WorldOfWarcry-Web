// Hero level, experience and the talent tree (design: docs/features/talents/plan.md).
// Like Task Bar Hero: tiers with passive nodes and auto-cast "active" skills, several ranks per node,
// 1 point per level. Unlike TBH a tier opens by hero level (every 10 levels), not by points spent.
import type { FactionId } from './config';

// ---------- level & experience ----------
export const MAX_LEVEL = 100;
/** XP needed to go from `level` to `level + 1`. */
export const xpToNext = (level: number) => Math.round(20 + 15 * level ** 1.5);
/** One talent point per level, the first one at level 1 (so level 10 = exactly 10 points for tier 2). */
export const pointsAt = (level: number) => level;
/** Tier i opens at this hero level (8 tiers: 1, 10, 20 … 70). */
export const TIER_LEVELS = [1, 10, 20, 30, 40, 50, 60, 70];
/** Points that must be spent in the previous tier before the next one accepts points. */
export const TIER_POINTS = 10;
export const SKILL_SLOTS = 2;
/** Respec: the first one is free, then gold that grows with the level. */
export const resetCost = (level: number, resets: number) => (resets === 0 ? 0 : 50 + 25 * level);

// ---------- passive stats ----------
export type TalentStat =
  | 'powerPct' | 'hpPct' | 'healPct' | 'speedPct' | 'atkSpeed' | 'defense'
  | 'resSlash' | 'resCrush' | 'resPierce' | 'resAll'
  | 'crit' | 'bossDmg' | 'thorns' | 'comboPct' | 'xpPct' | 'goldPct'
  | 'lifesteal' | 'shieldPct' | 'bloodlust' | 'killHeal';

/** How a stat reads in the UI: "+6% урона". `flat` stats have no % sign. */
export const STAT_TEXT: Record<TalentStat, { name: string; flat?: boolean }> = {
  powerPct: { name: 'урона' },
  hpPct: { name: 'к макс. здоровью' },
  healPct: { name: 'к исцелению и регену' },
  speedPct: { name: 'к скорости бега' },
  atkSpeed: { name: 'к скорости атаки' },
  defense: { name: 'защиты', flat: true },
  resSlash: { name: 'защиты от режущего урона' },
  resCrush: { name: 'защиты от дробящего урона' },
  resPierce: { name: 'защиты от колющего урона' },
  resAll: { name: 'защиты от любого урона' },
  crit: { name: 'шанс крит. удара (×2)' },
  bossDmg: { name: 'урона по боссам' },
  thorns: { name: 'полученного урона отражается врагу' },
  comboPct: { name: 'урона добивания комбо' },
  xpPct: { name: 'опыта' },
  goldPct: { name: 'золота' },
  lifesteal: { name: 'вампиризма (от нанесённого урона)' },
  shieldPct: { name: 'к Святому щиту (от макс. HP)' },
  bloodlust: { name: 'к максимуму Жажды крови' },
  killHeal: { name: 'макс. HP за каждое убийство' },
};
/** Caps so stacking talents, gear and buffs cannot break the game. */
export const STAT_CAP: Partial<Record<TalentStat, number>> = { crit: 50, lifesteal: 40, thorns: 50 };
export const RESIST_CAP = 75;

export interface PassiveDef {
  kind: 'passive';
  id: string;
  name: string;
  icon: string;
  max: number;
  /** Value added per rank. */
  per: Partial<Record<TalentStat, number>>;
}

// ---------- "passive actives": skills that fire on their own ----------
/**
 * lowHp    — HP fell below `below`%;          cooldown — every `cd` s while in combat;
 * everyHit — every `every`-th swing;          kill     — on a kill;
 * hurt     — `chance`% when hit;              lethal   — a hit that would kill the hero.
 */
export type Trigger = 'lowHp' | 'cooldown' | 'everyHit' | 'kill' | 'hurt' | 'lethal';
/**
 * heal  — heal up to `to`% HP;                 shield — absorb `shield`% max HP for `dur` s;
 * aoe   — `mult`% weapon damage in `radius` m, optional `stun` s (`at: 'target'` drops it on the target);
 * buff  — `power`/`atkSpeed`/`speed`/`lifesteal`% for `dur` s;  invuln — no damage for `dur` s;
 * cheatDeath — survive the lethal hit, heal to `to`% and `dur` s of invulnerability.
 */
export type Effect = 'heal' | 'shield' | 'aoe' | 'buff' | 'invuln' | 'cheatDeath';

export interface ActiveDef {
  kind: 'active';
  id: string;
  name: string;
  icon: string;
  max: number;
  trigger: Trigger;
  effect: Effect;
  at?: 'hero' | 'target';
  /** FX colour of the trigger flash. */
  color: number;
  /** Per-rank values, each array has `max` entries. */
  r: Record<string, number[]>;
  text: (v: Record<string, number>) => string;
}

export type TalentDef = PassiveDef | ActiveDef;
export interface TierDef { level: number; nodes: TalentDef[] }

const P = (id: string, name: string, icon: string, max: number, per: PassiveDef['per']): PassiveDef =>
  ({ kind: 'passive', id, name, icon, max, per });
const A = (d: Omit<ActiveDef, 'kind' | 'max'>): ActiveDef => ({ kind: 'active', max: Object.values(d.r)[0].length, ...d });
const same = (v: number, n = 5) => Array.from({ length: n }, () => v);

/** Values of an active skill at a given rank (1-based). */
export function rankValues(d: ActiveDef, rank: number) {
  const out: Record<string, number> = {};
  for (const [k, arr] of Object.entries(d.r)) out[k] = arr[Math.max(0, Math.min(arr.length, rank) - 1)];
  return out;
}

// ---------- trees ----------
// Every tier: exactly 2 passives (3–10 ranks) and 0–2 actives (5 ranks).
// Tree size (~140 ranks) is larger than the 100 points of level 100, so a build is a choice.
// Every tier holds at least TIER_POINTS ranks, so the next tier can always be reached.
const HUMAN: TierDef[] = [
  { level: 1, nodes: [
    P('h_toughness', 'Закалка', 'heart', 10, { hpPct: 3 }),
    P('h_drill', 'Выучка мечника', 'sword', 10, { powerPct: 2 }),
    A({ id: 'h_hand_of_light', name: 'Длань света', icon: 'sun', trigger: 'lowHp', effect: 'heal', color: 0xfff1a0,
      r: { below: same(15), to: [50, 56, 62, 69, 75], cd: [60, 55, 50, 45, 40] },
      text: (v) => `Когда HP падает ниже ${v.below}%, свет исцеляет до ${v.to}% макс. HP. Перезарядка ${v.cd} с.` }),
  ] },
  { level: 10, nodes: [
    P('h_plate', 'Латная выдержка', 'shield', 5, { resCrush: 4 }),
    P('h_mail', 'Кольчуга', 'chest', 5, { resSlash: 4 }),
  ] },
  { level: 20, nodes: [
    P('h_prayer', 'Молитва', 'regen', 5, { healPct: 6 }),
    P('h_march', 'Строевой шаг', 'boot', 5, { speedPct: 2 }),
    A({ id: 'h_consecrated', name: 'Освящённый удар', icon: 'sun', trigger: 'everyHit', effect: 'aoe', color: 0xffe066,
      r: { every: [4, 4, 4, 3, 3], mult: [120, 140, 160, 180, 200], radius: same(2.6), cd: same(0) },
      text: (v) => `Каждая ${v.every}-я атака вызывает вспышку света: ${v.mult}% урона оружия всем врагам в радиусе ${v.radius} м.` }),
    A({ id: 'h_faith_shield', name: 'Щит веры', icon: 'shield', trigger: 'cooldown', effect: 'shield', color: 0x9fd8ff,
      r: { cd: [20, 19, 17, 16, 14], shield: [15, 20, 25, 30, 35], dur: same(6) },
      text: (v) => `В бою каждые ${v.cd} с: щит на ${v.shield}% макс. HP на ${v.dur} с.` }),
  ] },
  { level: 30, nodes: [
    P('h_bulwark', 'Святой оплот', 'shield', 6, { shieldPct: 5 }),
    P('h_precision', 'Меткость', 'star', 8, { crit: 2 }),
  ] },
  { level: 40, nodes: [
    P('h_monster_slayer', 'Победитель чудовищ', 'skull', 5, { bossDmg: 4 }),
    P('h_retribution', 'Возмездие', 'shield', 5, { thorns: 3 }),
    A({ id: 'h_battle_cry', name: 'Боевой клич', icon: 'flag', trigger: 'cooldown', effect: 'buff', color: 0xffb238,
      r: { cd: [30, 28, 25, 23, 20], power: [20, 25, 30, 35, 40], atkSpeed: same(15), dur: same(8) },
      text: (v) => `В бою каждые ${v.cd} с: +${v.power}% урона и +${v.atkSpeed}% скорости атаки на ${v.dur} с.` }),
  ] },
  { level: 50, nodes: [
    P('h_steadfast', 'Стойкость', 'shield', 10, { defense: 3 }),
    P('h_second_wind', 'Второе дыхание', 'regen', 5, { healPct: 8 }),
  ] },
  { level: 60, nodes: [
    P('h_crushing', 'Сокрушительный удар', 'hammer', 6, { comboPct: 5 }),
    P('h_blessing', 'Благословение', 'coin', 5, { xpPct: 3, goldPct: 3 }),
    A({ id: 'h_divine_shield', name: 'Божественный щит', icon: 'shield', trigger: 'hurt', effect: 'invuln', color: 0xfff6c0,
      r: { chance: [8, 10, 12, 14, 16], dur: [2, 2, 2.5, 2.5, 3], cd: same(25) },
      text: (v) => `При получении удара: ${v.chance}% шанс стать неуязвимым на ${v.dur} с. Перезарядка ${v.cd} с.` }),
    A({ id: 'h_sky_hammer', name: 'Небесный молот', icon: 'hammer', trigger: 'cooldown', effect: 'aoe', at: 'target', color: 0xffe066,
      r: { cd: [18, 16, 15, 13, 12], mult: [250, 290, 330, 370, 400], radius: same(3), stun: same(1.5) },
      text: (v) => `В бою каждые ${v.cd} с на цель падает молот: ${v.mult}% урона оружия в радиусе ${v.radius} м и оглушение ${v.stun} с.` }),
  ] },
  { level: 70, nodes: [
    P('h_aura', 'Аура паладина', 'sun', 10, { powerPct: 1, hpPct: 1, healPct: 1 }),
    P('h_unyielding', 'Неколебимость', 'shield', 5, { resAll: 5 }),
    A({ id: 'h_resurrection', name: 'Воскрешение', icon: 'sun', trigger: 'lethal', effect: 'cheatDeath', color: 0xffffff,
      r: { to: [30, 37, 45, 52, 60], dur: same(1.5), cd: [180, 165, 150, 135, 120] },
      text: (v) => `Смертельный удар не убивает: HP восстанавливается до ${v.to}%, ${v.dur} с неуязвимости. Перезарядка ${v.cd} с.` }),
  ] },
];

const ORC: TierDef[] = [
  { level: 1, nodes: [
    P('o_thick_hide', 'Толстая шкура', 'heart', 10, { hpPct: 3 }),
    P('o_heavy_hand', 'Тяжёлая рука', 'axe', 10, { powerPct: 2 }),
    A({ id: 'o_blood_rage', name: 'Кровавая ярость', icon: 'drop', trigger: 'lowHp', effect: 'buff', color: 0xff3b3b,
      r: { below: same(30), power: [30, 35, 40, 45, 50], lifesteal: [10, 14, 17, 21, 25], dur: same(8), cd: [45, 41, 38, 34, 30] },
      text: (v) => `Когда HP падает ниже ${v.below}%: +${v.power}% урона и ${v.lifesteal}% вампиризма на ${v.dur} с. Перезарядка ${v.cd} с.` }),
  ] },
  { level: 10, nodes: [
    P('o_scars', 'Шрамы', 'chest', 5, { resSlash: 4 }),
    P('o_stone_brow', 'Каменный лоб', 'head', 5, { resCrush: 4 }),
  ] },
  { level: 20, nodes: [
    P('o_vampirism', 'Вкус крови', 'drop', 5, { lifesteal: 1 }),
    P('o_onslaught', 'Натиск', 'boot', 5, { speedPct: 2 }),
    A({ id: 'o_blood_whirl', name: 'Кровавый смерч', icon: 'axe', trigger: 'everyHit', effect: 'aoe', color: 0xff5a3a,
      r: { every: [5, 5, 4, 4, 4], mult: [100, 120, 140, 160, 180], radius: same(3), cd: same(0) },
      text: (v) => `Каждая ${v.every}-я атака превращается в смерч: ${v.mult}% урона оружия всем врагам в радиусе ${v.radius} м.` }),
    A({ id: 'o_war_roar', name: 'Устрашающий рёв', icon: 'skull', trigger: 'cooldown', effect: 'aoe', color: 0xffb238,
      r: { cd: [25, 23, 20, 18, 15], mult: same(0), radius: same(5), stun: [1, 1.25, 1.5, 1.75, 2] },
      text: (v) => `В бою каждые ${v.cd} с: рёв оглушает всех врагов в радиусе ${v.radius} м на ${v.stun} с.` }),
  ] },
  { level: 30, nodes: [
    P('o_thirst', 'Неутолимая жажда', 'drop', 6, { bloodlust: 5 }),
    P('o_ferocity', 'Свирепость', 'star', 8, { crit: 2 }),
  ] },
  { level: 40, nodes: [
    P('o_head_hunter', 'Охотник за головами', 'skull', 5, { bossDmg: 4 }),
    P('o_spiked', 'Шипастая броня', 'shield', 5, { thorns: 3 }),
    A({ id: 'o_berserk', name: 'Берсерк', icon: 'flame', trigger: 'cooldown', effect: 'buff', color: 0xff3b3b,
      r: { cd: [30, 28, 25, 23, 20], atkSpeed: [15, 20, 25, 30, 35], power: same(20), dur: same(8) },
      text: (v) => `В бою каждые ${v.cd} с: +${v.atkSpeed}% скорости атаки и +${v.power}% урона на ${v.dur} с.` }),
  ] },
  { level: 50, nodes: [
    P('o_oak_skin', 'Дубовая кожа', 'shield', 10, { defense: 3 }),
    P('o_feast', 'Пир победителя', 'heart', 5, { killHeal: 1 }),
  ] },
  { level: 60, nodes: [
    P('o_finisher', 'Добивание', 'axe', 6, { comboPct: 5 }),
    P('o_trophies', 'Трофеи', 'coin', 5, { xpPct: 3, goldPct: 3 }),
    A({ id: 'o_frenzy', name: 'Неистовство', icon: 'flame', trigger: 'kill', effect: 'buff', color: 0xff7a3a,
      r: { atkSpeed: [20, 25, 30, 35, 40], speed: same(10), dur: same(4), cd: same(0) },
      text: (v) => `После убийства: +${v.atkSpeed}% скорости атаки и +${v.speed}% скорости бега на ${v.dur} с.` }),
    A({ id: 'o_quake', name: 'Землетряс', icon: 'hammer', trigger: 'cooldown', effect: 'aoe', color: 0xc9a26a,
      r: { cd: [20, 18, 16, 14, 12], mult: [300, 340, 380, 420, 450], radius: same(3.5), stun: same(1) },
      text: (v) => `В бою каждые ${v.cd} с: удар о землю, ${v.mult}% урона оружия в радиусе ${v.radius} м и оглушение ${v.stun} с.` }),
  ] },
  { level: 70, nodes: [
    P('o_ancestors', 'Кровь предков', 'flame', 10, { powerPct: 1, hpPct: 1, healPct: 1 }),
    P('o_unbreakable', 'Несокрушимость', 'shield', 5, { resAll: 5 }),
    A({ id: 'o_not_today', name: 'Не сегодня!', icon: 'skull', trigger: 'lethal', effect: 'cheatDeath', color: 0xff3b3b,
      r: { to: [20, 25, 30, 35, 40], dur: [3, 3.5, 4, 4.5, 5], cd: [180, 165, 150, 135, 120] },
      text: (v) => `Смертельный удар не убивает: HP восстанавливается до ${v.to}%, ${v.dur} с неуязвимости. Перезарядка ${v.cd} с.` }),
  ] },
];

export const TREES: Record<FactionId, TierDef[]> = { human: HUMAN, orc: ORC };

const BY_ID = new Map<string, { def: TalentDef; tier: number }>();
for (const tree of Object.values(TREES)) tree.forEach((t, i) => t.nodes.forEach((def) => BY_ID.set(def.id, { def, tier: i })));
export const talent = (id: string) => BY_ID.get(id)?.def;
export const tierOf = (id: string) => BY_ID.get(id)?.tier ?? 0;

// ---------- state helpers (work on the save) ----------
export interface TalentState {
  level: number;
  talents: Record<string, number>;
  skills: (string | null)[];
}

export const spentPoints = (s: TalentState) => Object.values(s.talents).reduce((a, b) => a + b, 0);
export const freePoints = (s: TalentState) => pointsAt(s.level) - spentPoints(s);
export const tierOpen = (level: number, tier: number) => level >= TIER_LEVELS[tier];

/** Points spent in one tier (any race: ids are unique). */
export function spentInTier(s: TalentState, tier: number) {
  let n = 0;
  for (const [id, rank] of Object.entries(s.talents)) if (tierOf(id) === tier) n += rank;
  return n;
}

/** Why a tier does not accept points yet (level first, then the previous tier's points), or null. */
export function tierLock(s: TalentState, tier: number): string | null {
  if (!tierOpen(s.level, tier)) return `Откроется на ${TIER_LEVELS[tier]} уровне`;
  if (tier > 0) {
    const prev = spentInTier(s, tier - 1);
    if (prev < TIER_POINTS) return `Вложи ${TIER_POINTS} очков в этап ${tier} (сейчас ${prev})`;
  }
  return null;
}

export function canLearn(s: TalentState, id: string): string | null {
  const def = talent(id);
  if (!def) return 'Неизвестный талант';
  const lock = tierLock(s, tierOf(id));
  if (lock) return lock;
  if ((s.talents[id] ?? 0) >= def.max) return 'Максимальный ранг';
  if (freePoints(s) <= 0) return 'Нет свободных очков';
  return null;
}

/** Sum of all passive talents of the hero. */
export function passiveTotals(s: TalentState): Partial<Record<TalentStat, number>> {
  const out: Partial<Record<TalentStat, number>> = {};
  for (const [id, rank] of Object.entries(s.talents)) {
    const def = talent(id);
    if (!def || def.kind !== 'passive' || rank <= 0) continue;
    for (const [k, v] of Object.entries(def.per) as [TalentStat, number][]) out[k] = (out[k] ?? 0) + v * rank;
  }
  return out;
}

/** "+6% урона, +3 защиты" for a passive at `rank`. */
export function passiveText(def: PassiveDef, rank: number) {
  return (Object.entries(def.per) as [TalentStat, number][])
    .map(([k, v]) => `+${+(v * rank).toFixed(1)}${STAT_TEXT[k].flat ? '' : '%'} ${STAT_TEXT[k].name}`)
    .join(', ');
}
