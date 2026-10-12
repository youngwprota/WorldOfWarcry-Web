import { ORBS, RESIST_MULT, WEAPONS, fmtOrb, type DamageType, type OrbKind, type ResistTier } from './config';

/** Anything with resistances and a fixed reward: mobs and breakable props. */
interface Target { resist: Partial<Record<DamageType, ResistTier>>; reward: Partial<Record<OrbKind, number>>; }

/** Weapon silhouettes tinted with currentColor (emoji cannot be recoloured). */
const SVG: Record<string, string> = {
  sword: '<g transform="rotate(45 12 12)"><path d="M10.6 1.5h2.8v13h-2.8z"/><path d="M6 14.5h12v2.6H6z"/><path d="M10.9 17h2.2v4.2h-2.2z"/><circle cx="12" cy="22" r="1.6"/></g>',
  axe: '<g transform="rotate(30 12 12)"><path d="M10.9 2.5h2.3v19.5h-2.3z"/><path d="M13 3.5c6-1 9.5 3.2 8.6 9.2-2.6-1.8-5.6-2.2-8.6-1.2z"/></g>',
  hammer: '<g transform="rotate(30 12 12)"><path d="M10.8 8h2.5v14h-2.5z"/><rect x="4" y="2.5" width="16" height="7" rx="1.5"/></g>',
};

export function weaponSvg(id: string, color: string, size = 16) {
  return `<svg class="wicon" width="${size}" height="${size}" viewBox="0 0 24 24" style="color:${color}" fill="currentColor" stroke="#000" stroke-width="1.4" paint-order="stroke">${SVG[id] ?? ''}</svg>`;
}

export const TIER_COLOR: Record<ResistTier, string> = {
  weak: '#4cff6a', normal: '#ffffff', resist: '#ffa030', immune: '#ff3b3b',
};
const TIER_NAME: Record<ResistTier, string> = { weak: 'слабость', normal: '', resist: 'сопротивление', immune: 'иммунитет' };

/** Icons of weapons the mob is weak (green) or resistant (orange) / immune (red) to. */
export function resistIcons(def: Target, size = 19) {
  return Object.values(WEAPONS).map((w) => {
    const tier = def.resist[w.type] ?? 'normal';
    if (tier === 'normal') return '';
    return `<span class="ri ${tier}" title="${w.name}: ${TIER_NAME[tier]} ×${RESIST_MULT[tier]}">${weaponSvg(w.id, TIER_COLOR[tier], size)}</span>`;
  }).join('');
}

/** "+2 +6" chips in orb colours: permanent stats granted by the kill. */
export function rewardChips(def: Target) {
  return (Object.entries(def.reward) as [OrbKind, number][])
    .map(([k, n]) => `<span class="rw" style="color:${ORBS[k].css}" title="${ORBS[k].label}"><i style="background:${ORBS[k].css}"></i>${fmtOrb(k, n)}</span>`)
    .join('');
}

/** Butcher-style compact numbers: 950, 3.05K, 33.5K, 1.2M. */
export function fmtK(n: number) {
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n * 10) / 10);
  const [v, s] = a < 1e6 ? [n / 1e3, 'K'] : [n / 1e6, 'M'];
  const d = Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0;
  return +v.toFixed(d) + s;
}
