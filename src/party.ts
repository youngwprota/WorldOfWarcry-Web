/**
 * The party: three heroes of different classes, one of them on the field at a time.
 * Each class keeps its own pair of weapons (SaveData.kits); the hunter is done, the mage still plays as the warrior.
 */
import type { FactionId } from './config';
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
  /** Weapon (WEAPONS id) the class starts with; none = it shares the warrior's weapons for now. */
  weapon?: string;
  /** The second weapon slot holds a pet (config PETS) instead of a weapon. */
  pet?: boolean;
}

/** Order = order of the buttons, bottom-right of the HUD. */
export const CLASSES: Record<HeroClass, ClassDef> = {
  warrior: { name: 'Воин', icon: 'shield', color: ['#ff7a6a', '#c0352c'], key: 'Digit1' },
  hunter: {
    name: 'Охотник', icon: 'bow', color: ['#8fe05a', '#3f9a2c'], key: 'Digit2',
    model: { human: 'human_archer', orc: 'orc_archer' }, weapon: 'bow', pet: true,
  },
  mage: { name: 'Маг', icon: 'staff', color: ['#8fb2ff', '#4b5fd6'], key: 'Digit3' },
};

export const CLASS_IDS = Object.keys(CLASSES) as HeroClass[];

/** Whose weapons the class uses: its own once it has a starting weapon, else the warrior's. */
export const kitOf = (c: HeroClass): HeroClass => (CLASSES[c].weapon ? c : 'warrior');

/** Hunter looks by quality (tools/import-archers.mjs), in config RARITY order. */
const ARCHER_RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
/** Body part on the hero → part file of the hunter sets. */
const ARCHER_PART: Record<VisualPart, string> = { head: 'head', chest: 'torso', arms: 'arms', legs: 'legs' };

/** The four body parts of the hunter set of quality `rarity` (RARITY index), as models for Character.setOutfit. */
export function archerSet(f: FactionId, rarity: number): Record<VisualPart, string> {
  const r = ARCHER_RARITY[rarity];
  return Object.fromEntries(Object.entries(ARCHER_PART).map(([part, file]) => [part, `archers/${f}_archer_${file}_${r}`])) as Record<VisualPart, string>;
}

/** The set's bow; above common there are two variants (`v1`: the one close to the base bow). */
export function archerBow(rarity: number, v1: boolean) {
  return rarity === 0 ? 'archers/bow_common' : `archers/bow_${ARCHER_RARITY[rarity]}${v1 ? '_v1' : ''}`;
}

/** Seconds between two switches, so a double tap does not flip the hero back and forth. */
export const SWITCH_COOLDOWN = 0.5;
