import { RARITY_IDS, casterModel, type FactionId } from './config';
import { ARMOR, trimModel, type Item, type VisualPart } from './items';
import { archerSet, type HeroClass } from './party';

export const BODY_PARTS: VisualPart[] = ['head', 'chest', 'arms', 'legs'];

const allParts = (model: string) => Object.fromEntries(BODY_PARTS.map((p) => [p, model])) as Record<VisualPart, string>;

/** Plate set the warrior's debug look shows. */
const WARRIOR_DEBUG_SET = 'plate';

interface ClassLook {
  /** Body part file an equipped armour item puts on the hero. */
  part(f: FactionId, it: Item, part: VisualPart): string | undefined;
  /** Debug look: the four body parts of the class set of quality `rarity`. */
  set(f: FactionId, rarity: number): Record<VisualPart, string>;
  /** Quality pieces (Character.setTrims) fit only the warrior's peasant / peon skeleton. */
  trims: boolean;
  /** Item icon (public/assets/ui/armor) of the body part an equipped armour item puts on the hero. */
  icon(f: FactionId, it: Item): string;
}

/** Who would wear an item: its icon shows that hero's look of it. */
export interface Wearer { cls: HeroClass; faction: FactionId }

const skinIcon = (skin: string) => (f: FactionId, it: Item) => `${skin}_${ARMOR[it.def].slot}_${RARITY_IDS[it.rarity]}_${f}`;

export const CLASS_LOOK: Record<HeroClass, ClassLook> = {
  warrior: {
    part: (f, it) => ARMOR[it.def].source?.[f],
    set: (f) => Object.fromEntries(BODY_PARTS.map((p) => [p, ARMOR[`${WARRIOR_DEBUG_SET}_${p}`].source![f]])) as Record<VisualPart, string>,
    trims: true,
    icon: (f, it) => `${ARMOR[it.def].trim?.[f]}_${ARMOR[it.def].slot}_${RARITY_IDS[it.rarity]}_${f}`,
  },
  hunter: {
    part: (f, it, part) => archerSet(f, it.rarity)[part],
    set: archerSet,
    trims: false,
    icon: skinIcon('archer'),
  },
  mage: {
    part: (f, it) => casterModel(f, it.rarity),
    set: (f, r) => allParts(casterModel(f, r)),
    trims: false,
    icon: skinIcon('caster'),
  },
};

/** Quality pieces of the warrior's debug look (none at common, like armorTrim). */
export const debugSetTrims = (f: FactionId, rarity: number) =>
  rarity > 0 ? BODY_PARTS.map((p) => trimModel(`${ARMOR[`${WARRIOR_DEBUG_SET}_${p}`].trim![f]}_${p}`, rarity, f)) : [];
