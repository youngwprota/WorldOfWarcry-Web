/**
 * The party: three heroes of different classes, one of them on the field at a time.
 * Each class has two gear slots: a weapon (save.weapons[0]) and its own class item (save.weapons[1]: the warrior's
 * shield, the hunter's pet, the mage's orb); each keeps its own pair (SaveData.kits).
 */
import { RARITY_IDS, type FactionId } from './config';
import type { VisualPart } from './items';

export type HeroClass = 'warrior' | 'hunter' | 'mage';

export interface ClassDef {
  name: string;
  /** Art icon id (src/art.ts) on the switch button. */
  icon: string;
  /** Button colour: the top and bottom halves of the round button. */
  color: [string, string];
  /** Keyboard shortcut. */
  key: string;
  /** Hero model by faction; none = the faction's hero (FactionDef.hero). */
  model?: Record<FactionId, string>;
  /** Weapon defs (src/config.ts WEAPONS) for slot 1; empty = the warrior's. */
  weapons: string[];
  /** Class item defs for slot 2. */
  off: string[];
  /** Name of slot 2. */
  offName: string;
  /** Slot 2 holds a pet (config PETS) instead of an item. */
  pet?: boolean;
  /** Slot 2 always holds the kit's `left` item: it never drops and is never swapped or taken off. */
  fixedOff?: boolean;
  /**
   * What the class holds when it first takes the field, and extra items put into the bag then (src/save.ts classKit);
   * missing = the faction's start weapon.
   */
  kit?: { hand: string; left?: string; bag?: string[] };
  /**
   * Closed at the start: its button is greyed out and the hero cannot switch to it until a boss opens it
   * (BossDef.unlockClass → SaveData.classes); saves on a closed class go back to the warrior.
   */
  locked?: boolean;
}

/** Order = order of the buttons, bottom-right of the HUD. */
export const CLASSES: Record<HeroClass, ClassDef> = {
  warrior: {
    name: 'Воин', icon: 'shield', color: ['#ff7a6a', '#c0352c'], key: 'Digit1',
    weapons: ['sword', 'axe', 'hammer', 'polearm'], off: ['shield_spiked'], offName: 'Щит',
  },
  hunter: {
    name: 'Охотник', icon: 'bow', color: ['#8fe05a', '#3f9a2c'], key: 'Digit2',
    model: { human: 'human_archer', orc: 'orc_archer' },
    weapons: ['bow'], off: [], offName: 'Питомец', pet: true, kit: { hand: 'bow' }, locked: true,
  },
  mage: {
    name: 'Маг', icon: 'staff', color: ['#8fb2ff', '#4b5fd6'], key: 'Digit3',
    model: { human: 'mage', orc: 'orc_shaman' },
    weapons: ['staff_fire', 'staff_ice', 'staff_wind'], off: ['orb_fury', 'orb_vigor', 'orb_swift', 'orb_ward', 'orb_fortune', 'orb_demon'], offName: 'Сфера',
    kit: { hand: 'staff_fire', left: 'orb_fury' }, locked: true,
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as HeroClass[];

/** Whose gear lists and weapon pair the class uses: its own once it has weapons, else the warrior's. */
export const kitOf = (c: HeroClass): HeroClass => (CLASSES[c].weapons.length ? c : 'warrior');

/** Which gear slot of class `c` takes weapon def `def`: 0 weapon, 1 class item, null — not for this class. */
export function classSlot(c: HeroClass, def: string): 0 | 1 | null {
  const k = CLASSES[kitOf(c)];
  return k.weapons.includes(def) ? 0 : k.off.includes(def) ? 1 : null;
}

/** The class whose lists hold weapon def `def` (null: nobody's). */
export function weaponClass(def: string): HeroClass | null {
  return CLASS_IDS.find((c) => CLASSES[c].weapons.includes(def) || CLASSES[c].off.includes(def)) ?? null;
}

/** Whether weapon def `def` can drop: it belongs to a class and is not a fixed class item (ClassDef.fixedOff). */
export function droppable(def: string) {
  const c = weaponClass(def);
  return !!c && !(CLASSES[c].fixedOff && CLASSES[c].off.includes(def));
}

/** Body part on the hero → part file of the hunter sets. */
const ARCHER_PART: Record<VisualPart, string> = { head: 'head', chest: 'torso', arms: 'arms', legs: 'legs' };

/** The four body parts of the hunter set of quality `rarity` (RARITY index), as models for Character.setOutfit. */
export function archerSet(f: FactionId, rarity: number): Record<VisualPart, string> {
  const r = RARITY_IDS[rarity];
  return Object.fromEntries(Object.entries(ARCHER_PART).map(([part, file]) => [part, `archers/${f}_archer_${file}_${r}`])) as Record<VisualPart, string>;
}

/** The set's bow; above common there are two variants (`v1`: the one close to the base bow). */
export function archerBow(rarity: number, v1: boolean) {
  return rarity === 0 ? 'archers/bow_common' : `archers/bow_${RARITY_IDS[rarity]}${v1 ? '_v1' : ''}`;
}

/** Seconds between two switches, so a double tap does not flip the hero back and forth. */
export const SWITCH_COOLDOWN = 0.5;
