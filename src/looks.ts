import { FACTIONS, RARITY_IDS, WEAPONS, casterModel, type FactionId } from './config';
import { ARMOR, itemModel, trimModel, type Item, type VisualPart } from './items';
import { CLASSES, archerBow, archerSet, type HeroClass } from './party';

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
  /** Base mesh prefixes (PART_PREFIXES) a worn part leaves visible: the hunter's set legs are only the boots, the pants stay. */
  keep: string[];
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
    keep: [],
    icon: (f, it) => `${ARMOR[it.def].trim?.[f]}_${ARMOR[it.def].slot}_${RARITY_IDS[it.rarity]}_${f}`,
  },
  hunter: {
    part: (f, it, part) => archerSet(f, it.rarity)[part],
    set: archerSet,
    trims: false,
    keep: ['hip_'],
    icon: skinIcon('archer'),
  },
  mage: {
    part: (f, it) => casterModel(f, it.rarity),
    set: (f, r) => allParts(casterModel(f, r)),
    trims: false,
    keep: [],
    icon: skinIcon('caster'),
  },
};

/**
 * How class `c` of faction `f` looks with its start weapons: bare (`rarity` null) or in its whole set of that quality
 * (the faction screen's squad preview). `load`: parts that come on demand (assets.ensure) before setOutfit.
 */
export function classPreview(c: HeroClass, f: FactionId, rarity: number | null) {
  const kit = CLASSES[c].kit;
  const hand = kit?.hand ?? FACTIONS[f].startWeapon;
  const w = WEAPONS[hand];
  let main = itemModel({ kind: 'weapon', def: hand, rarity: rarity ?? 0, lvl: 1 } as Item, f);
  if (c === 'hunter' && rarity !== null) main = archerBow(rarity, false);
  const outfit: Partial<Record<VisualPart, string>> = rarity === null ? {} : CLASS_LOOK[c].set(f, rarity);
  return {
    model: CLASSES[c].model?.[f] ?? FACTIONS[f].hero,
    // [right, left, main weapon in the left hand]: the bow is held in the left hand, the staff casts from it
    weapon: (w.leftHand ? [null, main, false] : [main, null, !!w.staff]) as [string | null, string | null, boolean],
    orb: kit?.left && WEAPONS[kit.left].orb ? WEAPONS[kit.left].model[f] : null,
    outfit,
    keep: CLASS_LOOK[c].keep,
    trims: rarity !== null && CLASS_LOOK[c].trims ? debugSetTrims(f, rarity) : [],
    load: [...Object.values(outfit), ...(c === 'hunter' && rarity !== null ? [main] : [])] as string[],
  };
}

/** Quality pieces of the warrior's debug look (none at common, like armorTrim). */
export const debugSetTrims = (f: FactionId, rarity: number) =>
  rarity > 0 ? BODY_PARTS.map((p) => trimModel(`${ARMOR[`${WARRIOR_DEBUG_SET}_${p}`].trim![f]}_${p}`, rarity, f)) : [];
