/**
 * The party: three heroes of different classes, one of them on the field at a time.
 * Each class has two gear slots: a weapon (save.weapons[0]) and its own class item (save.weapons[1]).
 * Only the warrior's kit exists so far; the other classes use it until theirs come.
 */

export type HeroClass = 'warrior' | 'hunter' | 'mage';

export interface ClassDef {
  name: string;
  /** Art icon id (src/art.ts) on the switch button. */
  icon: string;
  /** Button colour: the top and bottom halves of the round button. */
  color: [string, string];
  /** Keyboard shortcut. */
  key: string;
  /** Weapon defs (src/config.ts WEAPONS) for slot 1. */
  weapons: string[];
  /** Class item defs for slot 2. */
  off: string[];
  /** Name of slot 2. */
  offName: string;
}

/** Order = order of the buttons, bottom-right of the HUD. */
export const CLASSES: Record<HeroClass, ClassDef> = {
  warrior: {
    name: 'Воин', icon: 'shield', color: ['#ff7a6a', '#c0352c'], key: 'Digit1',
    weapons: ['sword', 'axe', 'hammer', 'polearm'], off: ['shield_tower', 'shield_buckler', 'shield_spiked'], offName: 'Щит',
  },
  hunter: { name: 'Охотник', icon: 'bow', color: ['#8fe05a', '#3f9a2c'], key: 'Digit2', weapons: [], off: [], offName: '' },
  mage: { name: 'Маг', icon: 'staff', color: ['#8fb2ff', '#4b5fd6'], key: 'Digit3', weapons: [], off: [], offName: '' },
};

export const CLASS_IDS = Object.keys(CLASSES) as HeroClass[];

/** The gear lists of class `c` (a class without its own kit yet uses the warrior's). */
export const kitOf = (c: HeroClass) => (CLASSES[c].weapons.length ? CLASSES[c] : CLASSES.warrior);

/** Which gear slot of class `c` takes weapon def `def`: 0 weapon, 1 class item, null — not for this class. */
export function classSlot(c: HeroClass, def: string): 0 | 1 | null {
  const k = kitOf(c);
  return k.weapons.includes(def) ? 0 : k.off.includes(def) ? 1 : null;
}

/** Seconds between two switches, so a double tap does not flip the hero back and forth. */
export const SWITCH_COOLDOWN = 0.5;
