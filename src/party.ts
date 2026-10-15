import { FACTIONS, WEAPONS, type FactionId } from './config';

/**
 * The party: three heroes of different classes, one of them on the field at a time.
 * Each class keeps its own weapons (save.kits); stats are shared so far.
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
  /** Wields only staves (and nobody else can). */
  staves?: boolean;
  /** Own body model per faction; missing = FACTIONS[faction].hero. */
  model?: Record<FactionId, string>;
  /** First weapon in hand and extra weapons put into the bag when the class first takes the field; missing = the
   *  faction's start weapon. */
  kit?: { hand: string; left?: string; bag: string[] };
}

/** Order = order of the buttons, bottom-right of the HUD. */
export const CLASSES: Record<HeroClass, ClassDef> = {
  warrior: { name: 'Воин', icon: 'shield', color: ['#ff7a6a', '#c0352c'], key: 'Digit1' },
  hunter: { name: 'Охотник', icon: 'bow', color: ['#8fe05a', '#3f9a2c'], key: 'Digit2' },
  mage: {
    name: 'Маг', icon: 'staff', color: ['#8fb2ff', '#4b5fd6'], key: 'Digit3',
    staves: true, model: { human: 'mage', orc: 'orc_shaman' }, kit: { hand: 'staff_fire', left: 'orb_vigor', bag: ['staff_ice', 'staff_wind', 'orb_fury'] },
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as HeroClass[];

export const heroModel = (c: HeroClass, faction: FactionId) => CLASSES[c].model?.[faction] ?? FACTIONS[faction].hero;

/** Seconds between two switches, so a double tap does not flip the hero back and forth. */
export const SWITCH_COOLDOWN = 0.5;

/** Staves and orbs are for the mage only, and the mage holds nothing else. */
export const canWield = (c: HeroClass, def: string) => !!CLASSES[c].staves === !!(WEAPONS[def].staff || WEAPONS[def].orb);
