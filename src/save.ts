import { FACTIONS, HERO, PETS, WEAPONS, type FactionId, type SavedSource, type StatId } from './config';
import { BASE_STATS, type PctPoints, type StatPoints } from './balance';
import { ARMOR, makeItem, normalizeItem, type ArmorSlot, type Item } from './items';
import { CLASSES, classSlot, kitOf, type HeroClass } from './party';

/**
 * Number scale of the save: 2 = hero HP ×10, regen in HP/s, 6 item qualities, item level = copies; 5 = flat power;
 * 6 = stat points by source.
 */
const SCALE = 6;

export interface SaveData {
  v: 1;
  faction: FactionId;
  /** Legacy (scale < 6): all of the hero's stat points in one sum, now in `src`. */
  stats?: Record<StatId, number>;
  /** Stat points by source on top of the base (HERO) and the gear (src/balance.ts statBreakdown). */
  src: Partial<Record<SavedSource, StatPoints>>;
  /** Percent bonuses by source (+1 = +1%) to hp, regen and power. */
  pct: Partial<Record<SavedSource, PctPoints>>;
  weapons: [Item | null, Item | null];
  active: 0 | 1;
  equip: Partial<Record<ArmorSlot, Item>>;
  bag: Item[];
  /** Legacy: the forest → cemetery barrier (now in `gates`). */
  barrierOpen?: boolean;
  /** Passages opened by main bosses (gate ids, src/island.ts GATES). */
  gates?: string[];
  /** Number scale (see SCALE); older saves are converted on load. */
  scale?: number;
  /** Debug: every passage between locations is open. */
  gatesOpen?: boolean;
  /** Real-time stamps (ms) so bosses come back while the game is closed (GDD 3.2). */
  bosses: Record<string, { firstKill: boolean; deadUntil: number }>;
  /** Mob spawners by id: `n` = charges used in the current cycle, `until` = end of the running cooldown (epoch ms). */
  spawners?: Record<string, { n: number; until: number }>;
  kills: number;
  /** Seconds of actual play (balance log). */
  playTime?: number;
  /** Gacha pulls since the last legendary (src/gacha.ts). */
  gachaPity: number;
  /** Gacha pulls the hero has (dropped by mobs, GACHA.token). */
  pulls?: number;
  muted: boolean;
  lowGfx?: boolean;
  /** Fog of war: explored location ids, comma-separated (src/fog.ts). */
  fog?: string;
  /** The party member on the field (src/party.ts); missing = warrior. */
  cls?: HeroClass;
  /**
   * Weapons of the party kits not on the field (src/party.ts kitOf); the kit on the field lives in `weapons`.
   * A kit missing here has never been on the field: it starts with its class weapon.
   */
  kits?: Partial<Record<HeroClass, [Item | null, Item | null]>>;
  /** Whose kit is in `weapons`; missing = the warrior's. */
  kit?: HeroClass;
  /** Armour of the party members not on the field; the one on the field wears `equip`. */
  gear?: Partial<Record<HeroClass, Partial<Record<ArmorSlot, Item>>>>;
  /** Whose armour is in `equip`; missing = the warrior's (saves from before the party wore one set for all). */
  gearOf?: HeroClass;
  /** The hunter's pet (config PETS id) in his second weapon slot; missing = START_PET. */
  pet?: string;
}

const KEY = 'warcry-save-v1';

export function newSave(faction: FactionId): SaveData {
  return {
    v: 1,
    faction,
    src: {},
    pct: {},
    weapons: [makeItem('weapon', FACTIONS[faction].startWeapon, 0, 1), null],
    active: 0,
    equip: {},
    bag: [],
    gates: [],
    scale: SCALE,
    bosses: {},
    kills: 0,
    gachaPity: 0,
    pulls: 0,
    muted: false,
    cls: 'warrior',
  };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1 || !FACTIONS[d.faction]) return null;
    // Fields added after the first prototype build.
    // items whose weapon / armour piece is gone from the game (renamed or removed in another branch) are dropped
    d.equip ??= {};
    for (const k of Object.keys(d.equip) as ArmorSlot[]) {
      const it = d.equip[k] && known(normalizeItem(d.equip[k]!));
      if (it) d.equip[k] = it; else delete d.equip[k];
    }
    d.bag = (d.bag ?? []).map(normalizeItem).filter((it) => known(it));
    d.gachaPity ??= 0;
    d.pulls ??= 0;
    // gold, hero level, XP and talents are gone from the game
    for (const k of ['gold', 'level', 'xp', 'talents', 'skills', 'resets']) delete (d as unknown as Record<string, unknown>)[k];
    if (d.barrierOpen) { d.gates = [...new Set([...(d.gates ?? []), 'forest-cemetery'])]; delete d.barrierOpen; }
    if ((d.scale ?? 1) < 2) migrateScale(d);
    if ((d.scale ?? 1) < 3) migrateInts(d);
    if ((d.scale ?? 1) < 4) migrateBack(d);
    if ((d.scale ?? 1) < 5) migrateFlat(d);
    if ((d.scale ?? 1) < 6) migrateSources(d);
    d.src ??= {};
    d.pct ??= {};
    if (!d.cls || !CLASSES[d.cls]) d.cls = 'warrior';
    if (d.kit && !CLASSES[d.kit]) delete d.kit;
    if (d.pet && !PETS[d.pet]) delete d.pet;
    if (d.gearOf && !CLASSES[d.gearOf]) delete d.gearOf;
    for (const set of Object.values(d.gear ?? {})) {
      for (const k of Object.keys(set) as ArmorSlot[]) {
        const it = set[k] && known(normalizeItem(set[k]!));
        if (it) set[k] = it; else delete set[k];
      }
    }
    // every pair of hands by its owner's slots: the pair in play is kit `d.kit`'s, the stored ones their class's
    d.weapons = fitHands(d, d.kit ?? 'warrior', d.weapons);
    for (const k of Object.keys(d.kits ?? {}) as HeroClass[]) d.kits![k] = fitHands(d, k, d.kits![k]!);
    return d;
  } catch {
    return null;
  }
}

/**
 * Two hands → weapon + class slot of class `owner` (src/party.ts classSlot): whatever does not fit its slot (a second
 * weapon, a shield in the right hand, a weapon of another class) goes to the bag; the weapon slot is never empty.
 */
function fitHands(d: SaveData, owner: HeroClass, hands: (Item | null)[]): SaveData['weapons'] {
  const out: SaveData['weapons'] = [null, null];
  for (const raw of hands) {
    const it = raw && known(normalizeItem(raw));
    if (!it) continue;
    const s = classSlot(owner, it.def);
    if (s !== null && !out[s]) out[s] = it;
    else d.bag.push(it);
  }
  out[0] ??= makeItem('weapon', CLASSES[kitOf(owner)].kit?.hand ?? FACTIONS[d.faction].startWeapon, 0, 1);
  return out;
}

/** The item if its def still exists, else null. */
const known = (it: Item) => ((it.kind === 'weapon' ? WEAPONS[it.def] : ARMOR[it.def]) ? it : null);

/**
 * Scale (1 → 2): hero HP ×10 and regen from %/s to HP/s (×10 of the old base), qualities
 * common / rare / epic / legendary → their new places among six, item level becomes the copy count (1).
 */
function migrateScale(d: SaveData) {
  const s = d.stats!;
  s.hp = Math.round(s.hp * 10);
  s.regen = +(s.regen * 10).toFixed(2);
  const fix = (it: Item | null | undefined) => { if (it) { it.rarity = [0, 2, 3, 4][it.rarity] ?? it.rarity; it.lvl = 1; } };
  d.weapons.forEach(fix);
  Object.values(d.equip).forEach(fix);
  d.bag.forEach(fix);
  d.scale = 2;
}

/** Scale 2 → 3: whole-number stats; speed from m/s to points (HERO.speedPerMs per m/s). */
function migrateInts(d: SaveData) {
  const s = d.stats!;
  s.power = Math.round(s.power);
  s.regen = Math.round(s.regen);
  s.speed = Math.round(s.speed * HERO.speedPerMs);
  d.scale = 3;
}

/** Scale 3 → 4: back to the 100-HP balance — hero HP and regen ÷10. */
function migrateBack(d: SaveData) {
  const s = d.stats!;
  s.hp = Math.round(s.hp / 10);
  s.regen = Math.max(1, Math.round(s.regen / 10));
  d.scale = 4;
}

/** Scale 4 → 5: power is flat damage now (was +%), the old base 10 is gone; the orbs picked up stay. */
function migrateFlat(d: SaveData) {
  d.stats!.power = Math.max(0, d.stats!.power - 10);
  d.scale = 5;
}

/** Scale 5 → 6: the one stat sum becomes points by source; whatever is above the base was picked up from enemies. */
function migrateSources(d: SaveData) {
  const enemy: StatPoints = {};
  for (const [k, v] of Object.entries(d.stats ?? {}) as [StatId, number][]) {
    const n = Math.round(v - BASE_STATS[k]);
    if (n > 0) enemy[k] = n;
  }
  d.src = { enemy };
  d.pct = {};
  delete d.stats;
  d.scale = 6;
}

/** Set by wipeAll(): nothing may write the save again before the page reloads. */
let wiped = false;

export function writeSave(d: SaveData) {
  if (wiped) return;
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode: play without saving */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Full progress reset: every "warcry-*" key (hero save, finished prologue) is removed and autosaves
 * are blocked, so the reload starts a new game from the prologue.
 */
export function wipeAll() {
  wiped = true;
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('warcry-')) localStorage.removeItem(k);
  } catch { /* ignore */ }
}
