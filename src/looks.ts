import { casterModel, type FactionId } from './config';
import { ARMOR, trimModel, type Item, type VisualPart } from './items';
import { archerSet, type HeroClass } from './party';

export const BODY_PARTS: VisualPart[] = ['head', 'chest', 'arms', 'legs'];

const allParts = (model: string) => Object.fromEntries(BODY_PARTS.map((p) => [p, model])) as Record<VisualPart, string>;

/** Plate set the warrior's debug look shows. */
const WARRIOR_DEBUG_SET = 'lord';

interface ClassLook {
  /** Body part file an equipped armour item puts on the hero. */
  part(f: FactionId, it: Item, part: VisualPart): string | undefined;
  /** Debug look: the four body parts of the class set of quality `rarity`. */
  set(f: FactionId, rarity: number): Record<VisualPart, string>;
  /** Quality pieces (Character.setTrims) fit only the warrior's peasant / peon skeleton. */
  trims: boolean;
}

export const CLASS_LOOK: Record<HeroClass, ClassLook> = {
  warrior: {
    part: (f, it) => ARMOR[it.def].source?.[f],
    set: (f) => Object.fromEntries(BODY_PARTS.map((p) => [p, ARMOR[`${WARRIOR_DEBUG_SET}_${p}`].source![f]])) as Record<VisualPart, string>,
    trims: true,
  },
  hunter: {
    part: (f, it, part) => archerSet(f, it.rarity)[part],
    set: archerSet,
    trims: false,
  },
  mage: {
    part: (f, it) => casterModel(f, it.rarity),
    set: (f, r) => allParts(casterModel(f, r)),
    trims: false,
  },
};

/** Quality pieces of the warrior's debug look (none at common, like armorTrim). */
export const debugSetTrims = (f: FactionId, rarity: number) =>
  rarity > 0 ? BODY_PARTS.map((p) => trimModel(`${WARRIOR_DEBUG_SET}_${p}`, rarity, f)) : [];
