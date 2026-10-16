import { STAT_ICON, art, hasPng, mini, pngUrl } from './art';
import { DAMAGE_CLASS, ORBS, RESIST_MULT, WEAPONS, fmtOrb, type DamageType, type OrbKind, type ResistTier } from './config';
import { CLASSES, CLASS_IDS, type HeroClass } from './party';

/** Anything with resistances and a fixed reward: mobs and breakable props. */
interface Target { resist: Partial<Record<DamageType, ResistTier>>; reward: Partial<Record<OrbKind, number>>; }

const INK = '#1d120b';
const gearTeeth = [0, 45, 90, 135].map((a) => `<rect x="10" y="1.2" width="4" height="21.6" rx="1" transform="rotate(${a} 12 12)"/>`).join('');

/** White-on-ink silhouettes in the Butcher Hero manner, tinted with currentColor (emoji cannot be recoloured or outlined). */
const SVG: Record<string, string> = {
  sword: '<g transform="rotate(45 12 12)"><path d="M10.6 1.5h2.8v13h-2.8z"/><path d="M6 14.5h12v2.6H6z"/><path d="M10.9 17h2.2v4.2h-2.2z"/><circle cx="12" cy="22" r="1.6"/></g>',
  axe: '<g transform="rotate(30 12 12)"><path d="M10.9 2.5h2.3v19.5h-2.3z"/><path d="M13 3.5c6-1 9.5 3.2 8.6 9.2-2.6-1.8-5.6-2.2-8.6-1.2z"/></g>',
  hammer: '<g transform="rotate(30 12 12)"><path d="M10.8 8h2.5v14h-2.5z"/><rect x="4" y="2.5" width="16" height="7" rx="1.5"/></g>',
  bow: '<g transform="rotate(45 12 12)"><path d="M9 1.5c7 2.5 7 18.5 0 21l-1.2-1.6c5.4-2.6 5.4-15.2 0-17.8z"/><path d="M8.4 2.6h1.4v18.8H8.4z"/><path d="M3 11h13v2H3z"/><path d="M15.5 9l5 3-5 3z"/></g>',
  staff: '<g transform="rotate(30 12 12)"><path d="M10.9 9h2.2v13h-2.2z"/><circle cx="12" cy="5.5" r="4"/></g>',
  head: '<path d="M11 2h2v4h-2z"/><path d="M4 15c0-5.5 3.6-9.5 8-9.5s8 4 8 9.5v2H4z"/><path d="M2.5 16h19v3.5h-19z"/><path d="M11 9h2v7h-2z" fill="' + INK + '"/>',
  chest: '<path d="M7 3l5 2.2L17 3l4.5 3.2-2.3 5.3H17V21H7v-9.5H4.8L2.5 6.2z"/><path d="M11.2 6.5h1.6V20h-1.6z" fill="' + INK + '" opacity=".35"/>',
  arms: '<path d="M7 21.5v-7.8L4.6 10.3a1.6 1.6 0 0 1 2.7-1.7L9 10.7V4.3a1.5 1.5 0 0 1 3 0V9.5V3a1.5 1.5 0 0 1 3 0v6.5V4.6a1.5 1.5 0 0 1 3 0V15l-2 6.5z"/>',
  legs: '<path d="M5.5 3h13l-1.2 18.5h-4.4L12 10.5l-.9 11H6.7z"/>',
  ring: '<path fill-rule="evenodd" d="M12 7.5a7 7 0 1 1 0 14 7 7 0 1 1 0-14zm0 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8z"/><path d="M8.5 2h7L12 7z"/>',
  amulet: '<path d="M4.5 2c0 6 3.4 9 7.5 9s7.5-3 7.5-9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M12 10l5.5 5.5L12 22l-5.5-6.5z"/>',
  gear: gearTeeth + '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.2" fill="' + INK + '"/>',
  hero: '<circle cx="12" cy="7.5" r="5"/><path d="M2.5 22.5c0-5.5 4.2-9 9.5-9s9.5 3.5 9.5 9z"/>',
  bag: '<path d="M8.5 6.5a3.5 3.5 0 0 1 7 0h-2.2a1.3 1.3 0 0 0-2.6 0z"/><rect x="3.5" y="6.5" width="17" height="15.5" rx="4"/><rect x="8" y="12" width="8" height="4.5" rx="1.2" fill="' + INK + '" opacity=".45"/>',
  skull: '<path d="M12 2c5.2 0 9.2 3.6 9.2 8.6 0 2.7-1.2 4.5-3 5.6V20H5.8v-3.8c-1.8-1.1-3-2.9-3-5.6C2.8 5.6 6.8 2 12 2z"/><circle cx="8.4" cy="11" r="2.4" fill="' + INK + '"/><circle cx="15.6" cy="11" r="2.4" fill="' + INK + '"/><path d="M12 14l1.5 2.6h-3z" fill="' + INK + '"/><path d="M9 20h1.6v2.4H9zm4.4 0H15v2.4h-1.6z"/>',
  lock: '<path d="M7 10.5V7.2a5 5 0 0 1 10 0v3.3h-2.6V7.2a2.4 2.4 0 0 0-4.8 0v3.3z"/><rect x="4.5" y="10" width="15" height="12" rx="2.6"/><rect x="11" y="13.5" width="2" height="4.5" rx="1" fill="' + INK + '"/>',
  coin: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.8" fill="none" stroke="#0005" stroke-width="2"/>',
  heart: '<path d="M12 21.5C5 16.5 1.8 12.8 1.8 8.6A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 10.2 2.2c0 4.2-3.2 7.9-10.2 12.9z"/>',
  hourglass: '<path d="M5 2h14v3.5c0 3-3 5-5 6.5 2 1.5 5 3.5 5 6.5V22H5v-3.5c0-3 3-5 5-6.5-2-1.5-5-3.5-5-6.5z"/>',
  plus: '<path d="M8.8 2.5h6.4v6.3h6.3v6.4h-6.3v6.3H8.8v-6.3H2.5V8.8h6.3z"/>',
  boot: '<path d="M6 2h7.5v11l6.6 3.4c1.3.7 2.1 1.7 2.1 3.1V22H3.8v-3.5z"/>',
  shield: '<path d="M12 2l9 3.5v6c0 5.5-4 9-9 10.5C7 20.5 3 17 3 11.5v-6z"/>',
  anvil: '<path d="M2 5h16c0 3 2 4 4 4v2h-6.5L13 14v3h3v4.5H7V17h3v-3l-3-3H4.5C3 9.4 2 7.4 2 5z"/>',
};

/** Any UI icon: silhouette in `color` with an ink outline. */
const imgCache = new Map<string, HTMLImageElement>();
/** There is a flat icon drawn for `id`. */
export const hasIcon = (id: string) => !!SVG[id];
/** The same icon as an image for canvas drawing (cached; draws once loaded); `size`: pixels it is rasterised at. */
export function iconImage(id: string, color: string, size = 64) {
  const key = id + color + size;
  let img = imgCache.get(key);
  if (!img) {
    img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(icon(id, color, size));
    imgCache.set(key, img);
  }
  return img;
}

export function icon(id: string, color = '#fff', size = 24, cls = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="svgi ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" style="color:${color}" fill="currentColor" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke">${SVG[id] ?? ''}</svg>`;
}

export function weaponSvg(id: string, color: string, size = 16) {
  return icon(id, color, size, 'wicon');
}

/** Small corner badge: which weapon family deals this damage type. */
export const DAMAGE_TYPE_ICON: Record<DamageType, string> = { slash: 'sword', chop: 'axe', crush: 'hammer', pierce: 'bow', magic: 'staff' };
/** The weapon icon a class's resistances and weaknesses are shown with. */
export const CLASS_DAMAGE_ICON: Record<HeroClass, string> = { warrior: 'sword', hunter: 'bow', mage: 'staff' };

export const TIER_COLOR: Record<ResistTier, string> = {
  weak: '#4cff6a', normal: '#ffffff', resist: '#ffa030', immune: '#ff3b3b',
};
const TIER_NAME: Record<ResistTier, string> = { weak: 'слабость', normal: '', resist: 'сопротивление', immune: 'иммунитет' };

/**
 * Icons of what the mob is weak (green) or resistant (orange) / immune (red) to: one per class (DAMAGE_CLASS) when all
 * its damage types share the tier (mobs), else one per damage type (breakables: wood, stone).
 */
export function resistIcons(def: Target, size = 19) {
  const types = Object.keys(DAMAGE_TYPE_ICON) as DamageType[];
  const out: string[] = [];
  for (const c of CLASS_IDS) {
    const own = types.filter((t) => DAMAGE_CLASS[t] === c);
    const tier = def.resist[own[0]] ?? 'normal';
    if (own.every((t) => (def.resist[t] ?? 'normal') === tier)) {
      if (tier !== 'normal') out.push(resistIcon(CLASS_DAMAGE_ICON[c], tier, `${CLASSES[c].name}: ${TIER_NAME[tier]} ×${RESIST_MULT[tier]}`, size));
      continue;
    }
    for (const type of own) {
      const t = def.resist[type] ?? 'normal';
      if (t === 'normal') continue;
      const names = Object.values(WEAPONS).filter((w) => w.type === type).map((w) => w.name).join(', ');
      out.push(resistIcon(DAMAGE_TYPE_ICON[type], t, `${names}: ${TIER_NAME[t]} ×${RESIST_MULT[t]}`, size));
    }
  }
  return out.join('');
}

function resistIcon(id: string, tier: ResistTier, title: string, size: number) {
  // the game's weapon icon (white, ink outline) with the tier colour multiplied over it: the white turns
  // green / orange / red, the outline stays dark
  if (hasPng(id)) {
    return `<span class="ri png ${tier}" title="${title}" style="--tc:${TIER_COLOR[tier]};--ic:url('${pngUrl(id)}');width:${size}px;height:${size}px">` +
      `${art(id, size)}<i></i></span>`;
  }
  return `<span class="ri ${tier}" title="${title}">${weaponSvg(id, TIER_COLOR[tier], size)}</span>`;
}

/**
 * "+2 +6" chips in orb colours: permanent stats granted by the kill. `raw`: the numbers are stat units
 * already (a micro-boss's bonus, e.g. hp 500 → "+500"), not orb counts.
 */
export function rewardChips(def: Pick<Target, 'reward'>, raw = false) {
  return (Object.entries(def.reward) as [OrbKind, number][])
    .map(([k, n]) => `<span class="rw" title="${ORBS[k].label}">${mini(STAT_ICON[k])}${raw ? `+${n}` : fmtOrb(k, n)}</span>`)
    .join('');
}

/**
 * Loot over a unit's HP bar: an item drop is just the item's icon (glowing in its quality colour);
 * otherwise the stats it gives, each a big number with the stat's icon ("20 ❤").
 * `raw`: the numbers are stat units already (a micro-boss's bonus: hp 500 → 500), not orb counts.
 */
export function lootHtml(reward: Partial<Record<OrbKind, number>>, item?: { icon: string; color: string } | { icon: string; color: string }[] | null, raw = false) {
  const items = !item ? [] : Array.isArray(item) ? item : [item];
  if (items.length) return items.map((it) => `<span class="lt item" style="--rc:${it.color}">${art(it.icon, 40)}</span>`).join('');
  return (Object.entries(reward) as [OrbKind, number][])
    .map(([k, n]) => `<span class="lt" title="${ORBS[k].label}"><b>${fmtK(raw ? n : Math.round(ORBS[k].value * n))}</b>${art(STAT_ICON[k], 28)}</span>`)
    .join('');
}

/** Letters of the compact numbers (Cyrillic): тысячи, миллионы, миллиарды, триллионы. */
const SUFFIX = ['', 'К', 'М', 'Б', 'Т'];
/** Compact numbers: 950, 1К, 1.4К, 13.5К, 135К, 1.2М, 3.4Б, 5Т. */
export function fmtK(n: number) {
  if (Math.abs(n) < 1000) return String(Math.round(n * 10) / 10);
  let i = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(Math.abs(n)) / 3));
  let v = n / 1000 ** i;
  // 999.96K rounds to 1000K: show 1M instead
  if (Math.abs(+v.toFixed(Math.abs(v) < 100 ? 1 : 0)) >= 1000 && i < SUFFIX.length - 1) { i++; v /= 1000; }
  return +v.toFixed(Math.abs(v) < 100 ? 1 : 0) + SUFFIX[i];
}
