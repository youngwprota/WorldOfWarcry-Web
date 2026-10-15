// Items: weapons + armour, rarity, item level (zone), stats and generation.
import { DAMAGE_TYPE_NAME, RARITY, SHARPEN, WEAPONS, type FactionId, type ItemDrop, type PetDef, type StatId } from './config';
import { DAMAGE_TYPE_ICON, icon } from './icons';
import { art, hasPng } from './art';
import { CLASSES, weaponClass, type HeroClass } from './party';

/** Quality ids in model names (tools/blender/rarity_gear.py): `<def>_<id>`. */
const RARITY_IDS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/** The warrior's weapons and shields have a GLB per quality (tools/blender/rarity_gear.py); other classes' don't. */
const GEAR_DEFS = [...CLASSES.warrior.weapons, ...CLASSES.warrior.off];

/**
 * 3D model of a weapon, shield or staff: a staff's model per quality (WeaponDef.tiers); above common every warrior
 * weapon has its own GLB per quality, shields have all six; otherwise the faction's FBX (WeaponDef.model).
 */
export function itemModel(it: Item, faction: FactionId) {
  const w = WEAPONS[it.def];
  if (w.tiers) return w.tiers[it.rarity] ?? w.model[faction];
  return GEAR_DEFS.includes(it.def) && (w.guard || it.rarity > 0) ? `${it.def}_${RARITY_IDS[it.rarity]}` : w.model[faction];
}

/** Every per-quality GLB model (loaded up-front by main.ts). */
export const GEAR_MODELS = GEAR_DEFS.flatMap((def) =>
  RARITY_IDS.filter((_, r) => r > 0 || WEAPONS[def].guard).map((id) => `${def}_${id}`));

export type ItemKind = 'weapon' | 'armor';
export interface Item {
  uid: number;
  kind: ItemKind;
  def: string;
  rarity: number;
  sharpen: number;
  /** 1 + number of extra copies merged into it (each raises the stats, see RARITY). */
  lvl: number;
  /** Unique name (gacha banner weapons); replaces the generic def name. */
  name?: string;
}

export type ArmorSlot = 'head' | 'chest' | 'arms' | 'legs' | 'ring' | 'amulet';
export type VisualPart = 'head' | 'chest' | 'arms' | 'legs';
export type BonusStat = StatId;

export const ARMOR_SLOTS: { id: ArmorSlot; name: string; icon: string }[] = [
  { id: 'head', name: 'Шлем', icon: 'head' },
  { id: 'chest', name: 'Нагрудник', icon: 'chest' },
  { id: 'arms', name: 'Перчатки', icon: 'arms' },
  { id: 'legs', name: 'Сапоги', icon: 'legs' },
  { id: 'ring', name: 'Кольцо', icon: 'ring' },
  { id: 'amulet', name: 'Амулет', icon: 'amulet' },
];
/** Armour around the two weapons in the HUD bottom bar and the inventory's "Экипировано" row. */
export const EQUIP_BAR: { left: ArmorSlot[]; right: ArmorSlot[] } = { left: ['head', 'chest', 'legs'], right: ['arms', 'ring', 'amulet'] };
export const SLOT_NAME = Object.fromEntries(ARMOR_SLOTS.map((s) => [s.id, s.name])) as Record<ArmorSlot, string>;

/** Mesh-name prefixes of each body part (all Bitgem characters share these). */
export const PART_PREFIXES: Record<VisualPart, string[]> = {
  head: ['head_', 'helmet_', 'face_plate_'],
  // (the archer's quiver goes with the chest: the hunter sets' torso brings its own)
  chest: ['chest_', 'torso_', 'cape_', 'quiver_'],
  arms: ['arms_'],
  legs: ['legs_', 'leg_', 'hip_', 'hips_', 'kilt_'],
};

export const BONUS_NAME: Record<BonusStat, string> = {
  hp: 'Здоровье', regen: 'Реген, хп/с', power: 'Урон', speed: 'Скорость',
  defense: 'Защита', dodge: 'Уклонение', crit: 'Шанс крита', critDmg: 'Урон крита',
};

export interface ArmorDef {
  id: string;
  slot: ArmorSlot;
  name: Record<FactionId, string>;
  /** Character model whose body part is shown on the hero. */
  source?: Record<FactionId, string>;
  defense: number;
  bonus: { stat: BonusStat; value: number };
  alwaysBonus?: boolean;
  /** Only this party class wears it; none = everyone (rings, amulets). */
  cls?: HeroClass;
}

// Armour sets reuse other characters of the hero's own race as "outfits". The hero itself is the plainest
// model (peasant / peon, FACTIONS.hero), so every piece visibly changes it.
const SETS = [
  { id: 'guard', of: { human: 'стражника', orc: 'рубаки' }, src: { human: 'soldier', orc: 'orc_warrior' }, mult: 1 },
  { id: 'knight', of: { human: 'рыцаря', orc: 'громилы' }, src: { human: 'human_knight', orc: 'orc_grunt' }, mult: 1.2 },
  { id: 'lord', of: { human: 'паладина', orc: 'вождя' }, src: { human: 'paladin', orc: 'orc_chieftain' }, mult: 1.45 },
] as const;
const PIECES: { slot: VisualPart; noun: string; defense: number; bonus: { stat: BonusStat; value: number } }[] = [
  { slot: 'head', noun: 'Шлем', defense: 5, bonus: { stat: 'regen', value: 1 } },
  { slot: 'chest', noun: 'Нагрудник', defense: 9, bonus: { stat: 'hp', value: 18 } },
  { slot: 'arms', noun: 'Перчатки', defense: 3, bonus: { stat: 'power', value: 4 } },
  { slot: 'legs', noun: 'Сапоги', defense: 6, bonus: { stat: 'speed', value: 3 } },
];

export const ARMOR: Record<string, ArmorDef> = {};
for (const s of SETS) {
  for (const p of PIECES) {
    ARMOR[`${s.id}_${p.slot}`] = {
      id: `${s.id}_${p.slot}`, slot: p.slot,
      name: { human: `${p.noun} ${s.of.human}`, orc: `${p.noun} ${s.of.orc}` },
      source: s.src, defense: Math.round(p.defense * s.mult),
      bonus: { stat: p.bonus.stat, value: Math.max(1, Math.round(p.bonus.value * s.mult)) },
      // plate of soldiers, knights and paladins: the warrior's
      cls: 'warrior',
    };
  }
}
ARMOR.ring_power = { id: 'ring_power', slot: 'ring', name: { human: 'Кольцо силы', orc: 'Кольцо ярости' }, defense: 0, bonus: { stat: 'power', value: 5 }, alwaysBonus: true };
ARMOR.ring_swift = { id: 'ring_swift', slot: 'ring', name: { human: 'Кольцо ветра', orc: 'Кольцо следопыта' }, defense: 0, bonus: { stat: 'speed', value: 4 }, alwaysBonus: true };
ARMOR.amulet_life = { id: 'amulet_life', slot: 'amulet', name: { human: 'Амулет жизни', orc: 'Клык предков' }, defense: 2, bonus: { stat: 'hp', value: 20 }, alwaysBonus: true };
ARMOR.amulet_spring = { id: 'amulet_spring', slot: 'amulet', name: { human: 'Амулет родника', orc: 'Тотем крови' }, defense: 2, bonus: { stat: 'regen', value: 1 }, alwaysBonus: true };

export const BAG_SIZE = 128;

/** The party class that may use the item (weapons by the class lists, src/party.ts; plate is the warrior's), or null for everyone. */
export const itemClass = (it: Item): HeroClass | null =>
  it.kind === 'weapon' ? weaponClass(it.def) : ARMOR[it.def].cls ?? null;

/** Armour: each extra copy adds 30% of the piece's stats. */
export const lvlMult = (lvl: number) => 1 + 0.3 * (lvl - 1);

/** The weapon's own flat damage: quality base + a fixed amount per extra copy. */
export const weaponBase = (it: Item) => RARITY[it.rarity].base + RARITY[it.rarity].copy * (it.lvl - 1);

/**
 * (weapon base + the hero's flat `power`) × the hero's damage percents (`powerMul`) × the weapon's multiplier
 * (so a point of power is worth about the same DPS to a fast dagger and a slow hammer; old saves may carry sharpening).
 */
export function weaponDamage(it: Item, power = 0, powerMul = 1) {
  return (weaponBase(it) + power) * powerMul * WEAPONS[it.def].dmgMul * (1 + SHARPEN.perLevel * it.sharpen);
}

/** Damage one more copy would add (shown on pickup). */
export function copyGain(it: Item) {
  return it.kind === 'weapon' ? Math.round(RARITY[it.rarity].copy * WEAPONS[it.def].dmgMul) : 0;
}

/** Same item for merging copies: same weapon / armour piece and the same quality. */
export const sameItem = (a: Item, b: Item) => a.kind === b.kind && a.def === b.def && a.rarity === b.rarity;

export function armorStats(it: Item) {
  const d = ARMOR[it.def];
  const r = RARITY[it.rarity].mult;
  const defense = Math.round(d.defense * r * lvlMult(it.lvl));
  // GDD 8.3: common armour has no bonus; rarer pieces get a bigger one.
  const has = d.alwaysBonus || it.rarity > 0;
  const value = has ? Math.max(1, Math.round(d.bonus.value * (0.6 + 0.4 * (it.rarity + 1)) * lvlMult(it.lvl))) : 0;
  return { defense, bonus: has ? { stat: d.bonus.stat, value } : null };
}

export function slotOf(it: Item): ArmorSlot | 'weapon' {
  return it.kind === 'weapon' ? 'weapon' : ARMOR[it.def].slot;
}

export function itemName(it: Item, f: FactionId) {
  return it.name ?? (it.kind === 'weapon' ? WEAPONS[it.def].name : ARMOR[it.def].name[f]);
}

/** Icon id for icon(): weapon id or armour slot. */
export function itemIconId(it: Item) {
  return it.kind === 'weapon' ? it.def : ARMOR[it.def].slot;
}

export function itemIcon(it: Item, size = 24) {
  return art(itemIconId(it), size);
}

/** Butcher-style item cell: rarity background, damage-type badge, level, sharpening. Empty cells show a faded slot icon. */
export function cellHtml(it: Item | null | undefined, attrs = '', placeholder = '', extra = '', cls = '') {
  if (!it) {
    // an empty slot shows the slot's own icon, faded (the game PNG when there is one)
    const ph = !placeholder ? '' : hasPng(placeholder) ? art(placeholder, 30, 'ic ph') : icon(placeholder, '#ffffff55', 30, 'ic');
    return `<button class="cell empty ${cls}" ${attrs}>${ph}${extra}</button>`;
  }
  const badge = it.kind === 'weapon' && !WEAPONS[it.def].guard ? `<span class="badge">${icon(DAMAGE_TYPE_ICON[WEAPONS[it.def].type], '#4a2a12', 12)}</span>` : '';
  return `<button class="cell r${it.rarity} ${cls}" ${attrs}>${art(itemIconId(it), 34, 'ic')}${badge}` +
    `<span class="lv">${it.lvl}</span>${it.sharpen ? `<span class="sh">+${it.sharpen}</span>` : ''}${extra}</button>`;
}

/** The hunter's pet in his second weapon slot (config PETS). */
export function petCellHtml(pet: PetDef, attrs = '', cls = '', extra = '') {
  return `<button class="cell pet ${cls}" ${attrs}>${art(pet.icon, 34, 'ic')}${extra}</button>`;
}

export function scrapValue(it: Item) {
  return Math.round((25 * (it.rarity + 1) * (it.rarity + 1) + it.sharpen * 20) * lvlMult(it.lvl));
}

/** Short stat lines for tooltips. */
export function itemLines(it: Item): [string, string][] {
  if (it.kind === 'weapon') {
    const w = WEAPONS[it.def];
    const g = w.guard;
    if (g) {
      const pc = (x: number) => `${Math.round(x * 100)}%`;
      const out: [string, string][] = [['Блок', `−${pc(g.reduce)}`], ['Контратака', `${pc(g.counter.normal)}–${pc(g.counter.boss)}`]];
      if (g.reflect) out.push(['Отражение', pc(g.reflect)]);
      return out;
    }
    if (w.orb) return [w.orb.regen ? ['Реген здоровья', `+${Math.round(w.orb.regen * 100)}%`] : ['Урон', `+${Math.round((w.orb.power ?? 0) * 100)}%`]];
    return [
      ['Урон', String(Math.round(weaponDamage(it)))],
      ['Тип', DAMAGE_TYPE_NAME[w.type]],
      ['Атак/с', String(w.aps)],
      ['Удар', w.shape === 'circle' ? 'круг 360°' : `дуга ${w.arc}°`],
    ];
  }
  const s = armorStats(it);
  const out: [string, string][] = [['Защита', String(s.defense)]];
  if (s.bonus) out.push([BONUS_NAME[s.bonus.stat], `+${s.bonus.value}`]);
  return out;
}

let uidSeq = Date.now() % 1e9;
export const newUid = () => ++uidSeq;

export function makeItem(kind: ItemKind, def: string, rarity: number, lvl: number): Item {
  return { uid: newUid(), kind, def, rarity, sharpen: 0, lvl };
}

/** The item a mob's `drop` describes (one copy). */
export const dropItem = (d: ItemDrop) => makeItem(d.kind, d.def, d.rarity, 1);
/** Icon id of a drop (weapon id or armour slot). */
export const dropIconId = (d: ItemDrop) => (d.kind === 'weapon' ? d.def : ARMOR[d.def].slot);

/** Old saves stored bare {def, rarity, sharpen} weapons. */
const RENAMED: Record<string, string> = { nagamaki: 'polearm', shield: 'shield_tower' };

export function normalizeItem(it: Partial<Item> & { def: string }): Item {
  // the old peasant set is gone (the hero looks like a peasant already): its pieces become guard pieces
  // the nagamaki became the polearm, the one shield the tower shield
  const def = it.def.startsWith('peasant_') ? it.def.replace('peasant_', 'guard_') : RENAMED[it.def] ?? it.def;
  return { uid: it.uid ?? newUid(), kind: it.kind ?? 'weapon', def, rarity: it.rarity ?? 0, sharpen: it.sharpen ?? 0, lvl: it.lvl ?? 1, ...(it.name ? { name: it.name } : {}) };
}
