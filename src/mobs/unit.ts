import * as THREE from 'three';
import type { OrbKind } from '../config';
import type { Spawn } from './spawn';

/** Map / name colours of special mobs (an elite uses its drop's quality colour). */
export const MARK_COLOR = { boss: '#ff3b3b', mini: '#ff9a2e', elite: '#ffffff' };

/** The block over a unit: loot on top, the HP bar under it, weakness / resistance icons right of the bar. */
export function unitBar(loot: string, resist: string) {
  return `<div class="mloot">${loot}</div><div class="mrow"><div class="mobhp"><div></div><span></span></div><div class="ris">${resist}</div></div>`;
}

/** Respawn timer text: 45s, 4m05s, or 11h45m from an hour up (no seconds). */
function fmtRespawn(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  const p2 = (n: number) => String(n).padStart(2, '0');
  const u = (n: number | string, unit: string) => `${n}<small>${unit}</small>`; // smaller unit letters keep it inside the ring
  return s >= 3600 ? u(Math.floor(s / 3600), 'ч') + u(p2(Math.floor(s / 60) % 60), 'м')
    : s >= 60 ? u(Math.floor(s / 60), 'м') + u(p2(s % 60), 'с') : u(s, 'с');
}

/** Respawn loader at a spawn point: progress ring, timer and one bar per spawner charge. */
function respawnLoader(layer: HTMLElement, cls: string) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = '<div class="ring"></div><span></span><div class="charges"></div>';
  layer.appendChild(el);
  return el;
}

/** Charge bars (green = used in the current cycle, dark = still available). */
export function setChargeBars(el: HTMLElement, used: number, total: number) {
  const key = `${used}/${total}`;
  const bars = el.lastChild as HTMLElement;
  if (bars.dataset.k === key) return;
  bars.dataset.k = key;
  bars.innerHTML = total > 1 ? Array.from({ length: total }, (_, i) => `<i${i < used ? ' class="used"' : ''}></i>`).join('') : '';
}

/**
 * Anything that stands at a spawn point and can be destroyed: a mob or a breakable prop. Both are one type and live
 * in one list (Game.units): targeting, hits, death rewards, spawner charges, respawn, the HP bar, the respawn loader
 * and the minimap treat them alike; only the body (animated character / static model) differs.
 */
export abstract class Unit {
  abstract readonly kind: 'mob' | 'prop';
  hp = 0;
  maxHp = 0;
  respawnAt = 0;
  respawnTotal = 0;
  /** Its spawn (config SPAWNERS / PROP_SPAWNERS / packs); null for bosses and mobs risen from graves. */
  spawner: Spawn | null = null;
  /** Charges of the spawn used in the current cycle. */
  chargesUsed = 0;
  /** Dropped on death. */
  reward: Partial<Record<OrbKind, number>> = {};
  /** Above the unit: reward chips, weakness/resistance icons, HP bar. */
  uiEl: HTMLDivElement;
  hpFill: HTMLDivElement;
  /** HP number on the bar (mobs; props have none). */
  hpText: HTMLSpanElement | null;
  /** Shown at the spawn point while the unit is dead. */
  respawnEl: HTMLDivElement;
  private lastSec = -1;
  constructor(public spawn: THREE.Vector3, layer: HTMLElement, uiCls: string, uiHtml: string, loaderCls: string) {
    this.uiEl = document.createElement('div');
    this.uiEl.className = uiCls;
    this.uiEl.innerHTML = uiHtml;
    this.hpFill = this.uiEl.querySelector('.mobhp > div')!;
    this.hpText = this.uiEl.querySelector('.mobhp span');
    layer.appendChild(this.uiEl);
    this.respawnEl = respawnLoader(layer, loaderCls);
  }
  abstract get alive(): boolean;
  abstract get pos(): THREE.Vector3;
  abstract readonly radius: number;
  abstract get visible(): boolean;
  /** Special units get their own map mark instead of a red dot (see Game.mapMarks). */
  get mark(): 'boss' | 'mini' | 'elite' | null { return null; }
  /** Can be targeted and hit right now. */
  get hittable() { return this.alive; }
  /** HP bar: height above the ground and how near the hero must be to see it. */
  abstract get barY(): number;
  abstract get barRange(): number;
  /** In a fight with the hero right now (a social spawn pulls its other units then). */
  get fighting() { return false; }
  /** Never fights back (props, static units): the hero turns to it only when no enemy is in reach. */
  get passive() { return true; }
  /** The respawn loader may show (a mob's corpse has to sink first). */
  get loaderReady() { return true; }
  /** Back at the spawn point, full HP. */
  abstract respawn(): void;
  /** Dead and hidden at once (a cooldown restored from the save). */
  abstract vanish(): void;
  setRespawnText(sec: number) {
    const s = Math.max(0, Math.ceil(sec));
    if (s === this.lastSec) return;
    this.lastSec = s;
    (this.respawnEl.children[1] as HTMLElement).innerHTML = fmtRespawn(s);
  }
}
