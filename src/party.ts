/**
 * The party: three heroes of different classes, one of them on the field at a time.
 * Only the switching is here so far; the classes themselves (stats, weapons, models) come later.
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
}

/** Order = order of the buttons, bottom-right of the HUD. */
export const CLASSES: Record<HeroClass, ClassDef> = {
  warrior: { name: 'Воин', icon: 'shield', color: ['#ff7a6a', '#c0352c'], key: 'Digit1' },
  hunter: { name: 'Охотник', icon: 'bow', color: ['#8fe05a', '#3f9a2c'], key: 'Digit2' },
  mage: { name: 'Маг', icon: 'staff', color: ['#8fb2ff', '#4b5fd6'], key: 'Digit3' },
};

export const CLASS_IDS = Object.keys(CLASSES) as HeroClass[];

/** Seconds between two switches, so a double tap does not flip the hero back and forth. */
export const SWITCH_COOLDOWN = 0.5;
