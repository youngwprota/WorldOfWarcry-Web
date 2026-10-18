// Gacha forge logic (docs/features/ludka, docs/features/gacha-gear): rarity roll with a hard pity; a legendary is
// always the banner item. Only gloves, rings, amulets and the class items (shields, pets, orbs) come from here.
import { GACHA } from './config';
import { ARMOR, GACHA_GEAR, makeItem, type Item } from './items';
import { CLASSES, CLASS_IDS } from './party';

export interface PullResult { item: Item; pity: number }

/** Gacha tier 0..3 (index of GACHA.rates) of an item rarity. */
export const gachaTier = (rarity: number) => Math.max(0, GACHA.tiers.indexOf(rarity));

/** The banner's legendary item at the given item level. */
export function bannerItem(lvl: number): Item {
  const it = makeItem(GACHA.banner.kind, GACHA.banner.def, GACHA.tiers[3], lvl);
  it.name = GACHA.banner.name;
  return it;
}

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** A non-banner item of gacha tier `tier`: a random slot (gloves / ring / amulet / any class's item), then its kind. */
function poolItem(tier: number, lvl: number): Item {
  const rarity = GACHA.tiers[tier];
  const slot = pick(['arms', 'ring', 'amulet', 'class'] as const);
  if (slot !== 'class') return makeItem('armor', pick(GACHA_GEAR.filter((d) => ARMOR[d].slot === slot)), rarity, lvl);
  return makeItem('weapon', pick(CLASSES[pick(CLASS_IDS)].off), rarity, lvl);
}

/** One pull. `pity` = pulls since the last legendary; returns the new value. */
export function pull(pity: number, lvl: number): PullResult {
  let tier = 0;
  if (pity + 1 >= GACHA.pity) tier = 3;
  else {
    let r = Math.random();
    for (let i = GACHA.rates.length - 1; i >= 0; i--) {
      if (r < GACHA.rates[i]) { tier = i; break; }
      r -= GACHA.rates[i];
    }
  }
  if (tier === 3) return { item: bannerItem(lvl), pity: 0 };
  return { item: poolItem(tier, lvl), pity: pity + 1 };
}
