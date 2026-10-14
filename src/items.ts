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

export const BONUS_NAME: Record<BonusStat, string> = { hp: 'Здоровье', regen: 'Реген HP/с', power: 'Урон', speed: 'Скорость' };

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
  { slot: 'legs', noun: 'Поножи', defense: 6, bonus: { stat: 'speed', value: 3 } },
];

export const ARMOR: Record<string, ArmorDef> = {};
for (const s of SETS) {
  for (const p of PIECES) {
    ARMOR[`${s.id}_${p.slot}`] = {
      id: `${s.id}_${p.slot}`, slot: p.slot,
      name: { human: `${p.noun} ${s.of.human}`, orc: `${p.noun} ${s.of.orc}` },
      source: s.src, defense: Math.round(p.defense * s.mult),
      bonus: { stat: p.bonus.stat, value: Math.max(1, Math.round(p.bonus.value * s.mult)) },
    };
  }
}
ARMOR.ring_power = { id: 'ring_power', slot: 'ring', name: { human: 'Кольцо силы', orc: 'Кольцо ярости' }, defense: 0, bonus: { stat: 'power', value: 5 }, alwaysBonus: true };
ARMOR.ring_swift = { id: 'ring_swift', slot: 'ring', name: { human: 'Кольцо ветра', orc: 'Кольцо следопыта' }, defense: 0, bonus: { stat: 'speed', value: 4 }, alwaysBonus: true };
ARMOR.amulet_life = { id: 'amulet_life', slot: 'amulet', name: { human: 'Амулет жизни', orc: 'Клык предков' }, defense: 2, bonus: { stat: 'hp', value: 20 }, alwaysBonus: true };
ARMOR.amulet_spring = { id: 'amulet_spring', slot: 'amulet', name: { human: 'Амулет родника', orc: 'Тотем крови' }, defense: 2, bonus: { stat: 'regen', value: 1 }, alwaysBonus: true };

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

/** The item a mob's `drop` describes (one copy). */
export const dropItem = (d: ItemDrop) => makeItem(d.kind, d.def, d.rarity, 1);
/** Icon id of a drop (weapon id or armour slot). */
export const dropIconId = (d: ItemDrop) => (d.kind === 'weapon' ? d.def : ARMOR[d.def].slot);

/** Old saves stored bare {def, rarity, sharpen} weapons. */
const GONE_WEAPONS: Record<string, string> = { nagamaki: 'sword', scythe: 'reaper', pan: 'hammer', hidden_blade: 'dagger' };

export function normalizeItem(it: Partial<Item> & { def: string }): Item {
  // the old peasant set is gone (the hero looks like a peasant already): its pieces become guard pieces
  // removed weapons (docs/features/weapons-six) become the closest kept one, same quality and level
  const gone = GONE_WEAPONS[it.def];
  const def = gone ?? (it.def.startsWith('peasant_') ? it.def.replace('peasant_', 'guard_') : it.def);
  return { uid: it.uid ?? newUid(), kind: it.kind ?? 'weapon', def, rarity: it.rarity ?? 0, sharpen: it.sharpen ?? 0, lvl: it.lvl ?? 1, ...(it.name && !gone ? { name: it.name } : {}) };
}
