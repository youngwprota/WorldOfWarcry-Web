// Items: weapons + armour, rarity, item level (zone), stats and generation.
import { DAMAGE_TYPE_NAME, RARITY, SHARPEN, WEAPONS, type FactionId, type ItemDrop } from './config';
import { DAMAGE_TYPE_ICON, icon } from './icons';
import { art } from './art';

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
export type BonusStat = 'hp' | 'regen' | 'power' | 'speed';

export const ARMOR_SLOTS: { id: ArmorSlot; name: string; icon: string; side: 'left' | 'right' }[] = [
  { id: 'head', name: 'Шлем', icon: 'head', side: 'left' },
  { id: 'chest', name: 'Нагрудник', icon: 'chest', side: 'left' },
  { id: 'arms', name: 'Перчатки', icon: 'arms', side: 'left' },
  { id: 'legs', name: 'Поножи', icon: 'legs', side: 'right' },
  { id: 'ring', name: 'Кольцо', icon: 'ring', side: 'right' },
  { id: 'amulet', name: 'Амулет', icon: 'amulet', side: 'right' },
];
export const SLOT_NAME = Object.fromEntries(ARMOR_SLOTS.map((s) => [s.id, s.name])) as Record<ArmorSlot, string>;

/** Mesh-name prefixes of each body part (all Bitgem characters share these). */
export const PART_PREFIXES: Record<VisualPart, string[]> = {
  head: ['head_', 'helmet_', 'face_plate_'],
  chest: ['chest_', 'torso_', 'cape_'],
  arms: ['arms_'],
  legs: ['legs_', 'hip_', 'hips_'],
};

export interface ArmorDef {
  id: string;
  slot: ArmorSlot;
  /** Item name for each quality (RARITY index): one piece per slot and quality, 36 in all. */
  names: string[];
  /** Defense at common quality, level 1. Armour gives only defense (the board card: not hero stats). */
  defense: number;
}

// Body pieces borrow a part of another character of the hero's own race; the rarer the piece, the grander the
// outfit. The hero itself is the plainest model (peasant / peon, FACTIONS.hero), so every piece visibly changes it.
const OUTFITS: Record<FactionId, string>[] = [
  { human: 'soldier', orc: 'orc_warrior' }, { human: 'human_knight', orc: 'orc_grunt' }, { human: 'paladin', orc: 'orc_chieftain' },
];

/** The board card (docs/features/weapons-six): one piece per armour slot and quality. */
export const ARMOR: Record<string, ArmorDef> = {
  head: { id: 'head', slot: 'head', defense: 5, names: ['Кожаный шлем', 'Шлем стражника', 'Рыцарский шлем', 'Шлем героя', 'Шлем королей', 'Шлем бездны'] },
  chest: { id: 'chest', slot: 'chest', defense: 9, names: ['Кожаная куртка', 'Нагрудник стражника', 'Рыцарская кираса', 'Кираса героя', 'Доспех королей', 'Доспех бездны'] },
  arms: { id: 'arms', slot: 'arms', defense: 3, names: ['Кожаные перчатки', 'Перчатки стражника', 'Рыцарские рукавицы', 'Рукавицы героя', 'Рукавицы королей', 'Рукавицы бездны'] },
  legs: { id: 'legs', slot: 'legs', defense: 6, names: ['Кожаные поножи', 'Поножи стражника', 'Рыцарские поножи', 'Поножи героя', 'Поножи королей', 'Поножи бездны'] },
  ring: { id: 'ring', slot: 'ring', defense: 2, names: ['Медное кольцо', 'Серебряное кольцо', 'Золотое кольцо', 'Кольцо героя', 'Кольцо королей', 'Кольцо бездны'] },
  amulet: { id: 'amulet', slot: 'amulet', defense: 3, names: ['Костяной амулет', 'Медный амулет', 'Серебряный амулет', 'Амулет героя', 'Амулет королей', 'Амулет бездны'] },
};

/** Character model whose body part an armour piece shows on the hero (none for rings and amulets). */
export function armorSource(it: Item, f: FactionId): string | undefined {
  return it.def in PART_PREFIXES ? OUTFITS[Math.min(OUTFITS.length - 1, it.rarity >> 1)][f] : undefined;
}

export const BAG_SIZE = 128;

/** Armour: each extra copy adds 30% of the piece's stats. */
export const lvlMult = (lvl: number) => 1 + 0.3 * (lvl - 1);

/** Quality base + a fixed amount per extra copy, times the weapon's multiplier (old saves may carry sharpening). */
export function weaponDamage(it: Item) {
  const r = RARITY[it.rarity];
  return (r.base + r.copy * (it.lvl - 1)) * WEAPONS[it.def].dmgMul * (1 + SHARPEN.perLevel * it.sharpen);
}

/** Damage one more copy would add (shown on pickup). */
export function copyGain(it: Item) {
  return it.kind === 'weapon' ? Math.round(RARITY[it.rarity].copy * WEAPONS[it.def].dmgMul) : 0;
}

/** Same item for merging copies: same weapon / armour piece and the same quality. */
export const sameItem = (a: Item, b: Item) => a.kind === b.kind && a.def === b.def && a.rarity === b.rarity;

export function armorDefense(it: Item) {
  return Math.round(ARMOR[it.def].defense * RARITY[it.rarity].mult * lvlMult(it.lvl));
}

export function slotOf(it: Item): ArmorSlot | 'weapon' {
  return it.kind === 'weapon' ? 'weapon' : ARMOR[it.def].slot;
}

export function itemName(it: Item, f: FactionId) {
  void f;
  return it.name ?? (it.kind === 'weapon' ? WEAPONS[it.def] : ARMOR[it.def]).names[it.rarity];
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
  if (!it) return `<button class="cell empty ${cls}" ${attrs}>${placeholder ? icon(placeholder, '#ffffff55', 30, 'ic') : ''}${extra}</button>`;
  const badge = it.kind === 'weapon' ? `<span class="badge">${icon(DAMAGE_TYPE_ICON[WEAPONS[it.def].type], '#fff', 12)}</span>` : '';
  return `<button class="cell r${it.rarity} ${cls}" ${attrs}>${art(itemIconId(it), 34, 'ic')}${badge}` +
    `<span class="lv">${it.lvl}</span>${it.sharpen ? `<span class="sh">+${it.sharpen}</span>` : ''}${extra}</button>`;
}

export function scrapValue(it: Item) {
  return Math.round((25 * (it.rarity + 1) * (it.rarity + 1) + it.sharpen * 20) * lvlMult(it.lvl));
}

/** Short stat lines for tooltips. */
export function itemLines(it: Item): [string, string][] {
  if (it.kind === 'weapon') {
    const w = WEAPONS[it.def];
    return [
      ['Урон', String(Math.round(weaponDamage(it)))],
      ['Тип', DAMAGE_TYPE_NAME[w.type]],
      ['Атак/с', String(w.aps)],
      ['Удар', w.single ? 'по цели' : w.shape === 'circle' ? 'круг 360°' : `дуга ${w.arc}°`],
      ['Дальность', `${w.range} м`],
    ];
  }
  return [['Защита', String(armorDefense(it))]];
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
const GONE_WEAPONS: Record<string, string> = {
  dagger: 'sword', hidden_blade: 'sword', reaper: 'polearm', scythe: 'polearm', nagamaki: 'polearm', shield: 'hammer', pan: 'hammer',
};

export function normalizeItem(it: Partial<Item> & { def: string }): Item {
  // weapons off the board card (docs/features/weapons-six) become the closest of the 4 types, same quality and level;
  // old set pieces (guard_head, ring_power, …) become the piece of their slot
  const gone = GONE_WEAPONS[it.def];
  const def = gone ?? (it.kind === 'armor' && !ARMOR[it.def] ? it.def.split('_').find((p) => p in ARMOR) ?? 'chest' : it.def);
  return { uid: it.uid ?? newUid(), kind: it.kind ?? 'weapon', def, rarity: it.rarity ?? 0, sharpen: it.sharpen ?? 0, lvl: it.lvl ?? 1, ...(it.name && !gone ? { name: it.name } : {}) };
}
