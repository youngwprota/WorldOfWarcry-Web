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
    return d;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode: play without saving */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
