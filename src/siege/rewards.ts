import type { ZoneId } from '../config';
import type { Game } from '../game';
import { GATES } from '../island';
import { CLASS_SET, makeItem, type Item } from '../items';
import { CLASS_IDS } from '../party';
import type { SaveData } from '../save';
import type { SiegeResult, SiegeReward } from './types';

/** Armour rarity of the siege reward by the latest unlocked location (its elites' drops, kept monotonic). */
export const LOCATION_RARITY: Record<ZoneId, number> = { forest: 1, cemetery: 1, peaks: 2, hills: 2, grove: 2, swamp: 2, dunes: 3 };

const PROGRESSION: ZoneId[] = ['forest', 'cemetery', 'peaks', 'hills', 'grove', 'swamp', 'dunes'];
const PIECES = CLASS_IDS.flatMap((c) => (['head', 'chest', 'legs'] as const).map((s) => `${CLASS_SET[c]}_${s}`));
const FULL_PULLS = 2;
const ARMOR_COUNT = 3;
/** A failed run below this share of the kills may give no armour; at or above it, at least one piece. */
const MIN_PCT = 0.2;

export function latestLocation(s: SaveData): ZoneId {
  if (s.gatesOpen) return 'dunes';
  let best = 0;
  for (const id of s.gates ?? []) {
    const to = GATES.find((g) => g.id === id)?.to;
    if (to) best = Math.max(best, PROGRESSION.indexOf(to));
  }
  return PROGRESSION[best];
}

export function siegeReward(r: SiegeResult, main: SaveData): SiegeReward {
  const rarity = LOCATION_RARITY[latestLocation(main)];
  let count = ARMOR_COUNT;
  if (!r.completed) {
    count = Math.round(ARMOR_COUNT * r.pct);
    if (r.pct >= MIN_PCT) count = Math.max(1, count);
  }
  const items: Item[] = [];
  for (let i = 0; i < count; i++) items.push(makeItem('armor', PIECES[Math.floor(Math.random() * PIECES.length)], rarity, 1));
  return { pulls: r.completed ? FULL_PULLS : 0, items, rarity };
}

/** Straight into the paused main game and saved at once: closing the tab on the results screen can't lose it. */
export function grantReward(main: Game, rw: SiegeReward): void {
  main.save.pulls = (main.save.pulls ?? 0) + rw.pulls;
  for (const it of rw.items) main.lootItem(it);
  main.persist();
}
