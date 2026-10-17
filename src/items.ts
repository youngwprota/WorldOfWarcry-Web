// Items: weapons + armour, rarity, item level (zone), stats and generation.
import { DAMAGE_TYPE_NAME, PETS, RARITY, RARITY_IDS, SHARPEN, WEAPONS, type FactionId, type ItemDrop, type StatId, type WeaponDef } from './config';
import { CLASS_DAMAGE_ICON, DAMAGE_TYPE_ICON, icon } from './icons';
import { art, hasPng } from './art';
import { CLASSES, weaponClass, type HeroClass } from './party';
import { CLASS_LOOK, type Wearer } from './looks';

/** Quality ids in model names (tools/blender/rarity_gear.py): `<def>_<id>`. */

/**
 * Sword, axe, hammer, polearm, the gun and the shields have a GLB per quality, common included
 * (tools/blender/rarity_gear.py, gun_v5.py / gun_rarity.py): one model for every race, no faction FBX.
 */
const GEAR_DEFS = ['sword', 'axe', 'hammer', 'polearm', 'gun', ...CLASSES.warrior.off];

/**
 * 3D model of a weapon, shield or staff: a staff's model per quality (WeaponDef.tiers); the per-quality GLB of a
 * GEAR_DEFS weapon or shield; otherwise the faction's model (WeaponDef.model: bow, gun).
 */
export function itemModel(it: Item, faction: FactionId) {
  const w = WEAPONS[it.def];
  if (w.tiers) return w.tiers[it.rarity] ?? w.model[faction];
  return GEAR_DEFS.includes(it.def) ? `${it.def}_${RARITY_IDS[it.rarity]}` : w.model[faction];
}

/**
 * Quality pieces worn over an armour item (tools/blender/armor_gear.py): body slots above common. Loaded on demand
 * (Character.setTrims), one GLB per item, fitted per faction. Rings and amulets are not worn (see showcaseModel).
 */
export function armorTrim(it: Item, faction: FactionId): string | null {
  const d = ARMOR[it.def];
  // pieces are fitted to the warrior's plate only (the hunter's and the mage's sets have their own textured parts)
  if (!d || it.rarity === 0 || !d.trim) return null;
  return trimModel(`${d.trim[faction]}_${d.slot}`, it.rarity, faction);
}

/**
 * Showcase model of the item's quality for the forge and the icons only: a ring / amulet (tools/blender/jewels.py,
 * one per quality) or gacha gloves (tools/blender/gloves.py, one per kind and quality); null = none (the hero wears
 * his class set's arms whatever gloves he has on).
 */
export function showcaseModel(it: Item): string | null {
  if (it.kind !== 'armor') return null;
  const slot = ARMOR[it.def]?.slot;
  if (slot === 'ring' || slot === 'amulet') return `jewel_${slot}_${RARITY_IDS[it.rarity]}`;
  return slot === 'arms' && GACHA_GEAR.includes(it.def) ? `${it.def}_${RARITY_IDS[it.rarity]}` : null;
}

/** Quality piece model of armour def `id`. */
export const trimModel = (id: string, rarity: number, faction: FactionId) => `armor_${id}_${RARITY_IDS[rarity]}_${faction}`;

/** Every per-quality GLB model (loaded up-front by main.ts). */
export const GEAR_MODELS = GEAR_DEFS.flatMap((def) => RARITY_IDS.map((id) => `${def}_${id}`));

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

/** Art icon of each bonus stat (the stat window's). */
export const BONUS_ICON: Record<BonusStat, string> = {
  hp: 'heart', regen: 'regen', power: 'hit', speed: 'run', defense: 'defense', dodge: 'dodge', crit: 'crit', critDmg: 'critdmg', haste: 'fist', leech: 'heart',
};
export const BONUS_NAME: Record<BonusStat, string> = {
  hp: 'Здоровье', regen: 'Реген, хп/с', power: 'Урон', speed: 'Скорость',
  defense: 'Защита', dodge: 'Уклонение', crit: 'Шанс крита', critDmg: 'Урон крита',
  haste: 'Скорость атаки', leech: 'Вампиризм',
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
  /** Plate set whose quality pieces and icons it uses, per faction (`armor_<trim>_<slot>_...`). */
  trim?: Record<FactionId, string>;
}

// One armour set per class. The warrior's plate reuses another character of the hero's own race as an "outfit"
// (the knight for humans, the chieftain for orcs; the hero itself is the plainest model, FACTIONS.hero); the
// hunter's and the mage's sets are class skins by quality (src/looks.ts CLASS_LOOK).
const SETS: { id: string; cls: HeroClass; of: Record<FactionId, string>; src?: Record<FactionId, string>; trim?: Record<FactionId, string>; mult: number }[] = [
  { id: 'plate', cls: 'warrior', of: { human: 'рыцаря', orc: 'вождя' }, src: { human: 'human_knight', orc: 'orc_chieftain' }, trim: { human: 'knight', orc: 'lord' }, mult: 1.2 },
  { id: 'hunter', cls: 'hunter', of: { human: 'охотника', orc: 'следопыта' }, mult: 1.2 },
  { id: 'mage', cls: 'mage', of: { human: 'мага', orc: 'шамана' }, mult: 1.2 },
];
/** The class's armour set id (`<set>_<slot>`). */
export const CLASS_SET = Object.fromEntries(SETS.map((s) => [s.cls, s.id])) as Record<HeroClass, string>;
// (gloves are not part of a set: they come from the gacha, see GACHA_GEAR below)
const PIECES: { slot: VisualPart; noun: string; defense: number; bonus: { stat: BonusStat; value: number } }[] = [
  { slot: 'head', noun: 'Шлем', defense: 5, bonus: { stat: 'regen', value: 1 } },
  { slot: 'chest', noun: 'Нагрудник', defense: 9, bonus: { stat: 'hp', value: 18 } },
  { slot: 'legs', noun: 'Сапоги', defense: 6, bonus: { stat: 'speed', value: 3 } },
];

export const ARMOR: Record<string, ArmorDef> = {};
for (const s of SETS) {
  for (const p of PIECES) {
    ARMOR[`${s.id}_${p.slot}`] = {
      id: `${s.id}_${p.slot}`, slot: p.slot,
      name: { human: `${p.noun} ${s.of.human}`, orc: `${p.noun} ${s.of.orc}` },
      ...(s.src ? { source: s.src } : {}), ...(s.trim ? { trim: s.trim } : {}), defense: Math.round(p.defense * s.mult),
      bonus: { stat: p.bonus.stat, value: Math.max(1, Math.round(p.bonus.value * s.mult)) },
      cls: s.cls,
    };
  }
}
/**
 * Gacha gear (docs/features/gacha-gear/concept.md): gloves — how the hero hits, rings — how he moves / a special
 * effect, amulets — how he survives. Anyone wears them. On the hero gloves look like the gloves of the wearer's class
 * set (the warrior's: the plate's, hence `source` / `trim`); in the forge and the icons — their showcase model. Numbers are placeholders until the balance pass.
 */
const PLATE = SETS[0];
const gloves = (id: string, human: string, orc: string, stat: BonusStat, value: number): ArmorDef =>
  ({ id, slot: 'arms', name: { human, orc }, source: PLATE.src, trim: PLATE.trim, defense: 4, bonus: { stat, value }, alwaysBonus: true });
const jewel = (id: string, slot: 'ring' | 'amulet', human: string, orc: string, defense: number, stat: BonusStat, value: number): ArmorDef =>
  ({ id, slot, name: { human, orc }, defense, bonus: { stat, value }, alwaysBonus: true });
for (const d of [
  gloves('gloves_power', 'Рукавицы силы', 'Кулаки вождя', 'power', 5),
  gloves('gloves_crit', 'Перчатки меткости', 'Хватка следопыта', 'crit', 6),
  gloves('gloves_haste', 'Перчатки проворства', 'Лапы ловкача', 'haste', 6),
  jewel('ring_swift', 'ring', 'Кольцо ветра', 'Кольцо следопыта', 0, 'speed', 4),
  jewel('ring_shadow', 'ring', 'Кольцо тени', 'Кольцо сумрака', 0, 'dodge', 5),
  jewel('ring_blood', 'ring', 'Кольцо крови', 'Клык крови', 0, 'leech', 4),
  jewel('amulet_spring', 'amulet', 'Амулет родника', 'Тотем крови', 2, 'regen', 1),
  jewel('amulet_heart', 'amulet', 'Сердце льва', 'Сердце вепря', 2, 'hp', 20),
  jewel('amulet_ward', 'amulet', 'Оберег', 'Костяной оберег', 6, 'defense', 4),
]) ARMOR[d.id] = d;
/** Armour the gacha gives (and nothing else drops these). */
export const GACHA_GEAR = ['gloves_power', 'gloves_crit', 'gloves_haste', 'ring_swift', 'ring_shadow', 'ring_blood', 'amulet_spring', 'amulet_heart', 'amulet_ward'];

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

/**
 * Icon id for icon(): the weapon's `<def>_<rarity>` PNG when there is one, else the weapon id; armour: the piece
 * `w` would wear (jewels and gacha gloves: by their showcase model) when it has a PNG, else the slot.
 */
export function itemIconId(it: Item, w?: Wearer) {
  if (it.kind === 'weapon') {
    const tier = `${it.def}_${RARITY_IDS[it.rarity]}`;
    return hasPng(tier) ? tier : it.def;
  }
  const slot = ARMOR[it.def].slot;
  // jewels: one icon per quality, rendered from their showcase model
  if (slot === 'ring' || slot === 'amulet') return hasPng(`${slot}_${RARITY_IDS[it.rarity]}`) ? `${slot}_${RARITY_IDS[it.rarity]}` : slot;
  // gacha gloves: one icon per kind and quality, from their showcase model
  if (hasPng(`${it.def}_${RARITY_IDS[it.rarity]}`)) return `${it.def}_${RARITY_IDS[it.rarity]}`;
  if (!w) return slot;
  const id = CLASS_LOOK[w.cls].icon(w.faction, it);
  return hasPng(id) ? id : slot;
}

export function itemIcon(it: Item, size = 24, w?: Wearer) {
  return art(itemIconId(it, w), size);
}

/** Butcher-style item cell: rarity background, damage-type badge, level, sharpening. Empty cells show a faded slot icon. */
export function cellHtml(it: Item | null | undefined, attrs = '', placeholder = '', extra = '', cls = '', w?: Wearer) {
  if (!it) {
    // an empty slot shows the slot's own icon, faded (the game PNG when there is one)
    const ph = !placeholder ? '' : hasPng(placeholder) ? art(placeholder, 30, 'ic ph') : icon(placeholder, '#ffffff55', 30, 'ic');
    return `<button class="cell empty ${cls}" ${attrs}>${ph}${extra}</button>`;
  }
  // weapons and pets: their damage type; gacha gear: the stat it gives (three kinds share one look per slot)
  const badge = it.kind === 'weapon'
    ? (!WEAPONS[it.def].guard && !WEAPONS[it.def].orb ? `<span class="badge">${icon(DAMAGE_TYPE_ICON[WEAPONS[it.def].type], '#4a2a12', 12)}</span>` : '')
    : GACHA_GEAR.includes(it.def) ? `<span class="badge stat">${art(BONUS_ICON[ARMOR[it.def].bonus.stat], 14)}</span>` : '';
  return `<button class="cell r${it.rarity} ${cls}" ${attrs}>${art(itemIconId(it, w), 34, 'ic')}${badge}` +
    `<span class="lv">${it.lvl}</span>${it.sharpen ? `<span class="sh">+${it.sharpen}</span>` : ''}${extra}</button>`;
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
    if (w.orb) return [orbLine(w.orb)];
    if (w.pet) {
      const p = PETS[w.pet];
      const out: [string, string][] = [['Урон укуса', String(Math.round(weaponDamage(it)))], ['Тип', DAMAGE_TYPE_NAME[w.type]], ['Укусов/с', String(w.aps)]];
      if (p.cleave) out.push(['Удар лапой', `все в ${p.cleave} м`]);
      if (p.pounce) out.push(['Прыжок', `до ${p.pounce.range} м, ×${p.pounce.mult}`]);
      return out;
    }
    return [
      ['Урон', String(Math.round(weaponDamage(it)))],
      ['Тип', DAMAGE_TYPE_NAME[w.type]],
      ['Атак/с', String(w.aps)],
      ['Удар', w.shape === 'circle' ? 'круг 360°' : `дуга ${w.arc}°`],
    ];
  }
  const s = armorStats(it);
  // (rings have no defense: only their bonus)
  const out: [string, string][] = s.defense ? [['Защита', String(s.defense)]] : [];
  if (s.bonus) out.push([BONUS_NAME[s.bonus.stat], `+${s.bonus.value}`]);
  return out;
}

let uidSeq = Date.now() % 1e9;
export const newUid = () => ++uidSeq;

/** The orb's bonus as [stat, value] (WeaponDef.orb). */
export function orbLine(o: NonNullable<WeaponDef['orb']>): [string, string] {
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  if (o.regen) return ['Реген здоровья', `+${pc(o.regen)}`];
  if (o.speed) return ['Скорость бега', `+${pc(o.speed)}`];
  if (o.defense) return ['Защита', `+${pc(o.defense)}`];
  if (o.pull) return ['Крутка с моба', pc(o.pull)];
  if (o.critDmg) return ['Крит. урон', `+${pc(o.critDmg[0])}–${pc(o.critDmg[1])}`];
  return ['Урон', `+${pc(o.power ?? 0)}`];
}

/** The only rarity a weapon exists at (WeaponDef.rarity: the mage's orbs), or undefined. */
export const fixedRarity = (kind: ItemKind, def: string) => (kind === 'weapon' ? WEAPONS[def]?.rarity : undefined);

export function makeItem(kind: ItemKind, def: string, rarity: number, lvl: number): Item {
  return { uid: newUid(), kind, def, rarity: fixedRarity(kind, def) ?? rarity, sharpen: 0, lvl };
}

/** The item a mob's `drop` describes (one copy). */
export const dropItem = (d: ItemDrop) => makeItem(d.kind, d.def, d.rarity, 1);
/** What a weapon drop stands for: the whole weapon set of its class when it is one of them (ClassDef.weapons), else itself. */
export function dropChoices(d: ItemDrop): string[] {
  const c = d.kind === 'weapon' ? weaponClass(d.def) : null;
  return c && CLASSES[c].weapons.includes(d.def) ? CLASSES[c].weapons : [d.def];
}
/** The drop is a random weapon of a class's set (the elites' and bosses' weapons): rolled on the kill (rollDrop). */
export const dropAny = (d: ItemDrop) => dropChoices(d).length > 1;
/** What a kill gives: a random weapon of the class's set at the drop's quality, any other item as it is. */
export function rollDrop(d: ItemDrop) {
  const ch = dropChoices(d);
  return makeItem(d.kind, ch[Math.floor(Math.random() * ch.length)], d.rarity, 1);
}
/** Icon id of a drop (weapon id or armour slot). */
/** Icon of a drop over its mob and on the maps: a random weapon (dropAny) shows its class's weapon icon (and a «?»). */
export const dropIconId = (d: ItemDrop) => (d.kind !== 'weapon' ? ARMOR[d.def].slot : dropAny(d) ? CLASS_DAMAGE_ICON[weaponClass(d.def)!] : d.def);

/** Old saves stored bare {def, rarity, sharpen} weapons. Items taken out of the game become the kept one of their slot. */
const RENAMED: Record<string, string> = {
  nagamaki: 'polearm', shield: 'shield_spiked', shield_tower: 'shield_spiked', shield_buckler: 'shield_spiked',
  ring_power: 'ring_swift', amulet_life: 'amulet_spring',
};

export function normalizeItem(it: Partial<Item> & { def: string }): Item {
  // the old peasant, guard, knight and lord sets became the one warrior plate; set gloves became gacha gloves
  const old = /^(peasant|guard|knight|lord)_(head|chest|arms|legs)$/.exec(it.def);
  // pet items of the gacha-gear branch were `pet_<PETS id>`; now the item id is the pet's own (WEAPONS[<id>].pet)
  const pet = /^pet_(\w+)$/.exec(it.def);
  const def = /^[a-z]+_arms$/.test(it.def) ? 'gloves_power' : old ? `plate_${old[2]}` : pet && PETS[pet[1]] ? pet[1] : RENAMED[it.def] ?? it.def;
  const kind = it.kind ?? 'weapon';
  return { uid: it.uid ?? newUid(), kind, def, rarity: fixedRarity(kind, def) ?? it.rarity ?? 0, sharpen: it.sharpen ?? 0, lvl: it.lvl ?? 1, ...(it.name ? { name: it.name } : {}) };
}
