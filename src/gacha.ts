// Gacha forge logic (docs/features/ludka): rarity roll with a hard pity; a legendary is always the banner weapon.
import { GACHA, WEAPONS } from './config';
import { ARMOR, makeItem, type Item } from './items';

export interface PullResult { item: Item; pity: number }

/** The banner's legendary weapon at the given item level. */
export function bannerItem(lvl: number): Item {
  const it = makeItem('weapon', GACHA.banner.def, 3, lvl);
  it.name = GACHA.banner.name;
  return it;
}

/** One pull. `pity` = pulls since the last legendary; returns the new value. */
export function pull(pity: number, lvl: number): PullResult {
  let rarity = 0;
  if (pity + 1 >= GACHA.pity) rarity = 3;
  else {
    let r = Math.random();
    for (let i = GACHA.rates.length - 1; i >= 0; i--) {
      if (r < GACHA.rates[i]) { rarity = i; break; }
      r -= GACHA.rates[i];
    }
  }
  if (rarity === 3) return { item: bannerItem(lvl), pity: 0 };
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const item = Math.random() < 0.4
    ? makeItem('weapon', pick(Object.keys(WEAPONS)), rarity, lvl)
    : makeItem('armor', pick(Object.keys(ARMOR)), rarity, lvl);
  return { item, pity: pity + 1 };
}
