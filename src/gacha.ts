// Gacha forge logic (docs/features/ludka): rarity roll with a hard pity; a legendary is always the banner weapon.
import { GACHA, WEAPONS } from './config';
import { ARMOR, makeItem, type Item } from './items';
import { droppable } from './party';

export interface PullResult { item: Item; pity: number }

/** Gacha tier 0..3 (index of GACHA.rates) of an item rarity. */
export const gachaTier = (rarity: number) => Math.max(0, GACHA.tiers.indexOf(rarity));

/** The banner's legendary weapon at the given item level. */
export function bannerItem(lvl: number): Item {
  const it = makeItem('weapon', GACHA.banner.def, GACHA.tiers[3], lvl);
  it.name = GACHA.banner.name;
  return it;
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
  const rarity = GACHA.tiers[tier];
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const item = Math.random() < 0.4
    // any class's weapon or class item (the inventory shows each to its class)
    ? makeItem('weapon', pick(Object.keys(WEAPONS).filter(droppable)), rarity, lvl)
    : makeItem('armor', pick(Object.keys(ARMOR)), rarity, lvl);
  return { item, pity: pity + 1 };
}
