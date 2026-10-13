import { FACTIONS, HERO, type FactionId } from './config';
import { makeItem, normalizeItem, type ArmorSlot, type Item } from './items';

export interface SaveData {
  v: 1;
  faction: FactionId;
  stats: { power: number; hp: number; regen: number; speed: number };
  gold: number;
  weapons: [Item | null, Item | null];
  active: 0 | 1;
  equip: Partial<Record<ArmorSlot, Item>>;
  bag: Item[];
  barrierOpen: boolean;
  /** Real-time stamps (ms) so bosses come back while the game is closed (GDD 3.2). */
  bosses: Record<string, { firstKill: boolean; deadUntil: number }>;
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
    barrierOpen: false,
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
    d.bag = (d.bag ?? []).map(normalizeItem);
    d.level ??= 1;
    d.xp ??= 0;
    d.talents ??= {};
    d.skills ??= [null, null];
    d.resets ??= 0;
    return d;
  } catch {
    return null;
  }
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
