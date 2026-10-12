// Items: weapons + armour, rarity, item level (zone), stats and generation.
import { DAMAGE_TYPE_NAME, RARITY, SHARPEN, WEAPONS, type FactionId } from './config';
import { DAMAGE_TYPE_ICON, icon } from './icons';
import { art } from './art';

export type ItemKind = 'weapon' | 'armor';
export interface Item {
  uid: number;
  kind: ItemKind;
  def: string;
  rarity: number;
  sharpen: number;
  lvl: number; // zone level the item dropped in
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

export const BONUS_NAME: Record<BonusStat, string> = { hp: 'Здоровье', regen: 'Реген %/с', power: 'Урон', speed: 'Бег м/с' };

export interface ArmorDef {
  id: string;
  slot: ArmorSlot;
  name: Record<FactionId, string>;
  /** Character model whose body part is shown on the hero. */
  source?: Record<FactionId, string>;
  defense: number;
  bonus: { stat: BonusStat; value: number };
  alwaysBonus?: boolean;
}

// Armour sets reuse other characters of the hero's own race as "outfits".
const SETS = [
  { id: 'peasant', of: { human: 'крестьянина', orc: 'батрака' }, src: { human: 'peasant', orc: 'orc_peon' }, mult: 0.6 },
  { id: 'guard', of: { human: 'стражника', orc: 'рубаки' }, src: { human: 'soldier', orc: 'orc_warrior' }, mult: 1 },
  { id: 'lord', of: { human: 'паладина', orc: 'вождя' }, src: { human: 'paladin', orc: 'orc_chieftain' }, mult: 1.45 },
] as const;
const PIECES: { slot: VisualPart; noun: string; defense: number; bonus: { stat: BonusStat; value: number } }[] = [
  { slot: 'head', noun: 'Шлем', defense: 5, bonus: { stat: 'regen', value: 0.15 } },
  { slot: 'chest', noun: 'Нагрудник', defense: 9, bonus: { stat: 'hp', value: 18 } },
  { slot: 'arms', noun: 'Перчатки', defense: 3, bonus: { stat: 'power', value: 4 } },
  { slot: 'legs', noun: 'Поножи', defense: 6, bonus: { stat: 'speed', value: 0.15 } },
];

export const ARMOR: Record<string, ArmorDef> = {};
for (const s of SETS) {
  for (const p of PIECES) {
    ARMOR[`${s.id}_${p.slot}`] = {
      id: `${s.id}_${p.slot}`, slot: p.slot,
      name: { human: `${p.noun} ${s.of.human}`, orc: `${p.noun} ${s.of.orc}` },
      source: s.src, defense: Math.round(p.defense * s.mult),
      bonus: { stat: p.bonus.stat, value: +(p.bonus.value * s.mult).toFixed(2) },
    };
  }
}
ARMOR.ring_power = { id: 'ring_power', slot: 'ring', name: { human: 'Кольцо силы', orc: 'Кольцо ярости' }, defense: 0, bonus: { stat: 'power', value: 5 }, alwaysBonus: true };
ARMOR.ring_swift = { id: 'ring_swift', slot: 'ring', name: { human: 'Кольцо ветра', orc: 'Кольцо следопыта' }, defense: 0, bonus: { stat: 'speed', value: 0.2 }, alwaysBonus: true };
ARMOR.amulet_life = { id: 'amulet_life', slot: 'amulet', name: { human: 'Амулет жизни', orc: 'Клык предков' }, defense: 2, bonus: { stat: 'hp', value: 20 }, alwaysBonus: true };
ARMOR.amulet_spring = { id: 'amulet_spring', slot: 'amulet', name: { human: 'Амулет родника', orc: 'Тотем крови' }, defense: 2, bonus: { stat: 'regen', value: 0.2 }, alwaysBonus: true };

export const BAG_SIZE = 24;

export const lvlMult = (lvl: number) => 1 + 0.6 * (lvl - 1);

export function weaponDamage(it: Item) {
  return WEAPONS[it.def].dmg * RARITY[it.rarity].mult * (1 + SHARPEN.perLevel * it.sharpen) * lvlMult(it.lvl);
}

export function armorStats(it: Item) {
  const d = ARMOR[it.def];
  const r = RARITY[it.rarity].mult;
  const defense = Math.round(d.defense * r * lvlMult(it.lvl));
  // GDD 8.3: common armour has no bonus; rarer pieces get a bigger one.
  const has = d.alwaysBonus || it.rarity > 0;
  const value = has ? +(d.bonus.value * (0.6 + 0.4 * (it.rarity + 1)) * lvlMult(it.lvl)).toFixed(2) : 0;
  return { defense, bonus: has ? { stat: d.bonus.stat, value } : null };
}

export function slotOf(it: Item): ArmorSlot | 'weapon' {
  return it.kind === 'weapon' ? 'weapon' : ARMOR[it.def].slot;
}

export function itemName(it: Item, f: FactionId) {
  return it.kind === 'weapon' ? WEAPONS[it.def].name : ARMOR[it.def].name[f];
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

/** Random drop: mostly armour, sometimes weapons; luck shifts the rarity roll (bosses). */
export function rollItem(lvl: number, luck = 0): Item {
  const r = Math.random() + luck;
  const rarity = r > 1.12 ? 3 : r > 0.93 ? 2 : r > 0.65 ? 1 : 0;
  if (Math.random() < 0.25) {
    const ids = Object.keys(WEAPONS);
    return makeItem('weapon', ids[Math.floor(Math.random() * ids.length)], rarity, lvl);
  }
  const ids = Object.keys(ARMOR);
  return makeItem('armor', ids[Math.floor(Math.random() * ids.length)], rarity, lvl);
}

/** Old saves stored bare {def, rarity, sharpen} weapons. */
export function normalizeItem(it: Partial<Item> & { def: string }): Item {
  return { uid: it.uid ?? newUid(), kind: it.kind ?? 'weapon', def: it.def, rarity: it.rarity ?? 0, sharpen: it.sharpen ?? 0, lvl: it.lvl ?? 1 };
}
