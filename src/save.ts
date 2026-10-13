import { FACTIONS, HERO, type AntiKite, type FactionId } from './config';
import { makeItem, normalizeItem, type ArmorSlot, type Item } from './items';

/** Number scale of the save: 2 = hero HP ×10, regen in HP/s, 6 item qualities, item level = copies. */
const SCALE = 4;

export interface SaveData {
  v: 1;
  faction: FactionId;
  stats: { power: number; hp: number; regen: number; speed: number };
  gold: number;
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
  /** Hero level 1..100 and XP towards the next level (src/talents.ts). */
  level: number;
  xp: number;
  /** Talent id → rank. */
  talents: Record<string, number>;
  /** Two equipped auto-cast skills (ids of learned actives). */
  skills: (string | null)[];
  /** Number of talent resets done (the first one is free). */
  resets: number;
  muted: boolean;
  lowGfx?: boolean;
  /** Fog of war: explored location ids, comma-separated (src/fog.ts). */
  fog?: string;
  /** Debug: anti-kite variant (ANTI_KITE in config). */
  antiKite?: AntiKite;
}

const KEY = 'warcry-save-v1';

export function newSave(faction: FactionId): SaveData {
  return {
    v: 1,
    faction,
    stats: { power: HERO.power, hp: HERO.hp, regen: HERO.regen, speed: HERO.speed },
    gold: 0,
    weapons: [makeItem('weapon', FACTIONS[faction].startWeapon, 0, 1), null],
    active: 0,
    equip: {},
    bag: [],
    gates: [],
    scale: SCALE,
    bosses: {},
    kills: 0,
    level: 1,
    xp: 0,
    talents: {},
    skills: [null, null],
    resets: 0,
    muted: false,
  };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1 || !FACTIONS[d.faction]) return null;
    // Fields added after the first prototype build.
    d.weapons = d.weapons.map((w) => (w ? normalizeItem(w) : null)) as SaveData['weapons'];
    d.equip ??= {};
    for (const k of Object.keys(d.equip) as ArmorSlot[]) { const it = d.equip[k]; if (it) d.equip[k] = normalizeItem(it); }
    d.bag = (d.bag ?? []).map(normalizeItem);
    d.level ??= 1;
    d.xp ??= 0;
    d.talents ??= {};
    d.skills ??= [null, null];
    d.resets ??= 0;
    if (d.barrierOpen) { d.gates = [...new Set([...(d.gates ?? []), 'forest-cemetery'])]; delete d.barrierOpen; }
    if ((d.scale ?? 1) < 2) migrateScale(d);
    if ((d.scale ?? 1) < 3) migrateInts(d);
    if ((d.scale ?? 1) < 4) migrateBack(d);
    return d;
  } catch {
    return null;
  }
}

/**
 * Scale (1 → 2): hero HP ×10 and regen from %/s to HP/s (×10 of the old base), qualities
 * common / rare / epic / legendary → their new places among six, item level becomes the copy count (1).
 */
function migrateScale(d: SaveData) {
  d.stats.hp = Math.round(d.stats.hp * 10);
  d.stats.regen = +(d.stats.regen * 10).toFixed(2);
  const fix = (it: Item | null | undefined) => { if (it) { it.rarity = [0, 2, 3, 4][it.rarity] ?? it.rarity; it.lvl = 1; } };
  d.weapons.forEach(fix);
  Object.values(d.equip).forEach(fix);
  d.bag.forEach(fix);
  d.scale = 2;
}

/** Scale 2 → 3: whole-number stats; speed from m/s to points (HERO.speedPerMs per m/s). */
function migrateInts(d: SaveData) {
  const s = d.stats;
  s.power = Math.round(s.power);
  s.regen = Math.round(s.regen);
  s.speed = Math.round(s.speed * HERO.speedPerMs);
  d.scale = 3;
}

/** Scale 3 → 4: back to the 100-HP balance — hero HP and regen ÷10. */
function migrateBack(d: SaveData) {
  const s = d.stats;
  s.hp = Math.round(s.hp / 10);
  s.regen = Math.max(1, Math.round(s.regen / 10));
  d.scale = 4;
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
