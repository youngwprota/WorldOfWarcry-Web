// Coloured cartoon icons in the Butcher Hero manner: flat fills, a shade side, a white highlight and a thick ink outline.
// Drawn on a 64×64 grid. Outlined parts use P(), unoutlined shading/details use N(), highlights use H().

const INK = '#1d120b';
const STEEL = '#dde5ee', STEEL_D = '#9eacbc', STEEL_DD = '#6f7d8e';
const GOLD = '#ffc93a', GOLD_D = '#e0962a', GOLD_L = '#ffe68a';
const WOOD = '#b5733f', WOOD_D = '#82492a';
const LEATHER = '#c07a43', LEATHER_D = '#8a4f2b';
const RED = '#e8414f', BLUE = '#3d7be0', BLUE_D = '#2c5fb5';

const P = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
const N = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}" stroke="none"${extra}/>`;
const H = (d: string, w = 3) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" opacity=".85"/>`;
const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  `M${x + r} ${y}h${w - 2 * r}${r ? `a${r} ${r} 0 0 1 ${r} ${r}` : ''}v${h - 2 * r}${r ? `a${r} ${r} 0 0 1 -${r} ${r}` : ''}h-${w - 2 * r}${r ? `a${r} ${r} 0 0 1 -${r} -${r}` : ''}v-${h - 2 * r}${r ? `a${r} ${r} 0 0 1 ${r} -${r}` : ''}z`;
const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0z`;

const HEART = 'M32 58C14 45 5 35 5 22C5 13 12 7 20 7C26 7 30 10 32 14C34 10 38 7 44 7C52 7 59 13 59 22C59 35 50 45 32 58Z';
const HEART_SHADE = 'M9 31C15 41 23 48 32 54C41 48 49 41 55 31C49 39 41 45 32 49C23 45 15 39 9 31Z';

const ART: Record<string, string> = {
  sword: `<g transform="rotate(45 32 32) translate(0 -1)">
    ${P('M32 2L38 10L37 41H27L26 10Z', STEEL)}${N('M32 2L38 10L37 41H32Z', STEEL_D)}${N(rect(31, 13, 2, 25), STEEL_DD)}${H('M29.3 12L28.8 36', 2)}
    ${P(rect(17, 39, 30, 7, 3.5), GOLD)}${N(rect(19, 43, 26, 2), GOLD_D)}
    ${P(rect(28.5, 46, 7, 12, 1.5), '#7a3524')}${N(rect(28.5, 49, 7, 1.6), '#4e1f14')}${N(rect(28.5, 53, 7, 1.6), '#4e1f14')}
    ${P(circ(32, 60, 4.5), GOLD)}</g>`,
  axe: `<g transform="rotate(30 32 32)">
    ${P(rect(28.5, 6, 7, 54, 3.5), WOOD)}${N(rect(32, 9, 3.5, 48), WOOD_D)}
    ${P('M34 9C50 3 62 14 59 33C53 27 44 25 34 28Z', STEEL)}${N('M34 20C45 18 54 22 59 33C53 27 44 25 34 28Z', STEEL_D)}${H('M49 7.5C55 11 58.5 17 59 25', 2.5)}
    ${P('M29 12L18 15V23L29 25Z', STEEL_D)}
    ${P(rect(26.5, 8, 11, 6, 2), GOLD)}${P(rect(26.5, 24, 11, 5, 2), GOLD)}${P(rect(27.5, 56, 9, 6, 2), GOLD)}</g>`,
  hammer: `<g transform="rotate(30 32 32)">
    ${P(rect(28.5, 22, 7, 38, 3.5), WOOD)}${N(rect(32, 25, 3.5, 32), WOOD_D)}
    ${P(rect(8, 6, 48, 20, 5), STEEL_D)}${N(rect(11, 8, 42, 7, 3), STEEL)}
    ${P(rect(3, 8, 9, 16, 3), STEEL)}${P(rect(52, 8, 9, 16, 3), STEEL)}
    ${P(rect(26, 3, 12, 26, 3), GOLD)}${N(rect(28.5, 6, 3, 20), GOLD_L)}${P(rect(27, 57, 10, 6, 2), GOLD)}</g>`,
  head: `${P('M27 12L32 1L37 12Z', RED)}
    ${P('M9 42C9 21 19 10 32 10C45 10 55 21 55 42Z', STEEL)}${N('M32 10C45 10 55 21 55 42H43C44 27 40 16 32 10Z', STEEL_D)}${H('M17 32C18 23 23 17 29 14')}
    ${N(rect(14, 29, 13, 4.5, 2), INK)}${N(rect(37, 29, 13, 4.5, 2), INK)}
    ${P(rect(28.5, 26, 7, 28, 3), STEEL_D)}
    ${P(rect(5, 39, 54, 10, 5), GOLD)}${N(rect(8, 45, 48, 2.5), GOLD_D)}
    ${P('M12 49H24L22 60H14Z', STEEL_D)}${P('M40 49H52L50 60H42Z', STEEL_D)}`,
  chest: `${P('M17 7H26C27 12 37 12 38 7H47L59 15L55 31L48 29V57H16V29L9 31L5 15Z', STEEL)}
    ${N('M32 11C35 11 37 10 38 7H47L59 15L55 31L48 29V57H32Z', STEEL_D)}${N(rect(31, 13, 2, 31), STEEL_DD)}
    ${P('M5 15L17 7L19 20L8 28Z', GOLD)}${P('M59 15L47 7L45 20L56 28Z', GOLD)}
    ${P(rect(16, 45, 32, 7), LEATHER_D)}${P(rect(28, 43.5, 8, 10, 2), GOLD)}${H('M21 19C20 26 20 33 21 39', 2.5)}`,
  arms: `${P(rect(7, 27, 9, 19, 4.5), LEATHER, ' transform="rotate(-35 11.5 36.5)"')}
    ${P(rect(17, 9, 9, 24, 4.5), LEATHER)}${P(rect(26.5, 5, 9, 26, 4.5), LEATHER)}${P(rect(36, 8, 9, 24, 4.5), LEATHER)}${P(rect(45, 15, 8, 20, 4), LEATHER)}
    ${P(rect(17, 23, 36, 24, 7), LEATHER)}${N(rect(40, 25, 11, 20, 5), LEATHER_D, ' opacity=".55"')}${H('M21.5 14V25', 2.5)}
    ${P(rect(14, 43, 42, 16, 4), LEATHER_D)}${N(rect(14, 48, 42, 4), GOLD)}`,
  legs: `${P('M13 5H51L49 50H36L32 24L28 50H15Z', '#5d79a8')}${N('M32 7H50.5L48.6 48H36L32 24Z', '#47608a')}
    ${P(rect(12, 4, 40, 9, 3), LEATHER_D)}${P(rect(28, 2.5, 8, 12, 2), GOLD)}
    ${P(circ(22, 31, 5.5), STEEL)}${P(circ(42, 31, 5.5), STEEL)}
    ${P('M14 47H30V60H10C10 55 11 50 14 47Z', LEATHER)}${P('M34 47H50C53 50 54 55 54 60H34Z', LEATHER)}`,
  ring: `${P('M32 21a19 19 0 1 1 0 38a19 19 0 1 1 0-38zm0 7a12 12 0 1 0 0 24a12 12 0 1 0 0-24z', GOLD, ' fill-rule="evenodd"')}
    ${H('M17.5 37C17.5 31 21 26.5 25.5 24.5', 2.5)}${P('M22 18L28 24H36L42 18Z', GOLD_D)}
    ${P('M22 5H42L48 13L32 28L16 13Z', '#4fc3ff')}${N('M32 28L48 13H32Z', '#2a8fd6')}${N('M22 5H30L26 13H16Z', '#c9f1ff')}`,
  amulet: `<path d="M10 3C10 22 20 30 32 30C44 30 54 22 54 3" fill="none" stroke="${INK}" stroke-width="7"/>
    <path d="M10 3C10 22 20 30 32 30C44 30 54 22 54 3" fill="none" stroke="${GOLD}" stroke-width="3.2" stroke-dasharray="5 2"/>
    ${P(circ(32, 29, 4.5), GOLD)}${P(circ(32, 46, 16), GOLD)}${N('M32 30A16 16 0 0 1 32 62Z', GOLD_D, ' opacity=".6"')}
    ${P(circ(32, 46, 10), '#b35cff')}${N('M32 36A10 10 0 0 1 32 56Z', '#8a35d6')}${N(circ(28.5, 42.5, 3.2), '#efd6ff')}`,
  gear: `${[0, 45, 90, 135].map((a) => P(rect(26.5, 3, 11, 58, 3), STEEL_D, ` transform="rotate(${a} 32 32)"`)).join('')}
    ${P(circ(32, 32, 21), STEEL)}${N('M32 11A21 21 0 0 1 32 53Z', STEEL_D, ' opacity=".55"')}
    ${P(circ(32, 32, 8.5), '#4c5464')}${H('M17 25A16 16 0 0 1 26 16.5')}`,
  hero: `${P('M7 63C7 47 18 39 32 39C46 39 57 47 57 63Z', BLUE)}${N('M32 41C44 41 55 48 55.5 61H32Z', BLUE_D)}
    ${P('M22 40L32 51L42 40Z', GOLD)}
    ${P('M28 9L32 0L36 9Z', RED)}${P(circ(32, 23, 15), STEEL)}${N('M32 8A15 15 0 0 1 32 38Z', STEEL_D)}
    ${N(rect(20, 20, 24, 5, 2.5), INK)}${P(rect(29.5, 21, 5, 14, 2), STEEL_D)}${H('M22 15C24 11.5 27 10 30 9.5', 2.5)}`,
  bag: `${P(rect(5, 29, 54, 30, 4), WOOD)}${N(rect(32, 31, 25, 26), WOOD_D, ' opacity=".5"')}
    ${P('M5 31V22C5 12 17 7 32 7C47 7 59 12 59 22V31Z', '#cf8a4f')}${N('M32 7C47 7 59 12 59 22V31H32Z', WOOD, ' opacity=".6"')}
    ${N(rect(5, 29, 54, 3), WOOD_D)}
    ${P(rect(13, 9, 7, 50), GOLD)}${P(rect(44, 9, 7, 50), GOLD)}
    ${P(rect(26, 23, 12, 16, 3), GOLD)}${N(circ(32, 29.5, 2.2), INK)}${N(rect(31, 30, 2, 5), INK)}${H('M9 20C11 14 17 11 24 10', 2.5)}`,
  skull: `${P('M14 18L3 5L21 11Z', '#f0b9a6')}${P('M50 18L61 5L43 11Z', '#f0b9a6')}
    ${P('M32 6C46 6 56 16 56 29C56 37 52 42 47 45V55H17V45C12 42 8 37 8 29C8 16 18 6 32 6Z', '#f6eedf')}
    ${N('M32 6C46 6 56 16 56 29C56 37 52 42 47 45V55H36C44 46 48 36 47 26C46 16 40 9 32 6Z', '#d9cbb0')}
    ${N(circ(22, 30, 6.5), INK)}${N(circ(42, 30, 6.5), INK)}${N(circ(23, 31, 2), '#ff5a5a')}${N(circ(43, 31, 2), '#ff5a5a')}
    ${N('M32 37L35.5 43H28.5Z', INK)}${N(rect(24, 48, 2.6, 7), INK)}${N(rect(30.7, 48, 2.6, 7), INK)}${N(rect(37.4, 48, 2.6, 7), INK)}
    ${H('M14.5 24C15.5 18 19.5 13 25.5 10.5')}`,
  coin: `${P(circ(32, 32, 27), GOLD)}${N('M32 5A27 27 0 0 1 32 59Z', GOLD_D, ' opacity=".55"')}
    ${P(circ(32, 32, 18.5), '#ffd95a', ' stroke-width="2.5"')}
    ${N('M32 20L35.5 28H44L37 33L39.5 42L32 36.5L24.5 42L27 33L20 28H28.5Z', GOLD_D)}${H('M12 26A21 21 0 0 1 24 12')}`,
  heart: `${P(HEART, '#ef3e5c')}${N(HEART_SHADE, '#c42a45')}${N('M12 20C12 14 16 11 20 11C23 11 25 12 26 14C21 13 15 15 12 20Z', '#fff', ' opacity=".85"')}`,
  regen: `${P(HEART, '#41cf62')}${N(HEART_SHADE, '#2a9e48')}${N('M12 20C12 14 16 11 20 11C23 11 25 12 26 14C21 13 15 15 12 20Z', '#fff', ' opacity=".85"')}
    ${P('M28 18H36V26H44V34H36V42H28V34H20V26H28Z', '#fff', ' stroke-width="2.5"')}`,
  plus: `${P('M24 6H40V24H58V40H40V58H24V40H6V24H24Z', '#45d16a')}${N('M40 24H58V40H40V58H32V32H40Z', '#2ea64f')}${H('M28 11V27H12', 2.5)}`,
  hourglass: `${P('M17 11H47C47 22 38 28 35 32C38 36 47 42 47 53H17C17 42 26 36 29 32C26 28 17 22 17 11Z', '#cfefff')}
    ${N('M22 16H42C40 22 34 26 32 30C30 26 24 22 22 16Z', '#ffb21a')}${N('M32 38C30 44 22 47 21 50H43C42 47 34 44 32 38Z', '#ffb21a')}
    ${P(rect(11, 4, 42, 8, 3), WOOD)}${P(rect(11, 52, 42, 8, 3), WOOD)}${H('M21 13C22 20 26 24 28 27', 2)}`,
  boot: `${P('M36 14C46 7 56 9 61 13C55 14 50 17 46 21C50 19 56 19 60 23C51 26 43 26 36 24Z', '#fff')}
    ${P('M14 4H36V34L52 40C57 42 60 46 60 51V56H10V44C10 38 14 34 14 30Z', LEATHER)}${N('M28 6H36V34L52 40C57 42 60 46 60 51V54H40C44 46 30 40 28 30Z', LEATHER_D, ' opacity=".55"')}
    ${P(rect(12, 3, 26, 9, 3), LEATHER_D)}${P(rect(8, 53, 54, 8, 3), '#5a3420')}${H('M18 16V30', 2.5)}`,
  shield: `${P('M32 3L56 11V30C56 45 46 55 32 61C18 55 8 45 8 30V11Z', STEEL)}
    ${P('M32 10L50 16V30C50 41 43 49 32 54C21 49 14 41 14 30V16Z', BLUE)}${N('M32 10L50 16V30C50 41 43 49 32 54Z', BLUE_D)}
    ${P(circ(32, 30, 6.5), GOLD)}${H('M18 20V31C18 36 20 40 23 43', 2.5)}`,
  anvil: `${P('M4 14H44C44 22 50 26 60 27V32H44L38 38V46H46V58H18V46H26V38L20 32H10C6 27 4 21 4 14Z', '#717c8b')}
    ${N(rect(7, 16, 35, 3), '#aab5c2')}${N('M32 32H44L38 38V46H32Z', '#4f5866')}${N(rect(32, 46, 14, 12), '#4f5866')}`,
  lock: `${P('M18 30V20C18 11 24 5 32 5C40 5 46 11 46 20V30H39V20C39 15 36 12 32 12C28 12 25 15 25 20V30Z', STEEL_D)}
    ${P(rect(11, 28, 42, 32, 6), GOLD)}${N(rect(32, 30, 19, 28, 4), GOLD_D, ' opacity=".5"')}
    ${N(circ(32, 40, 4), INK)}${N(rect(30, 41, 4, 10, 1.5), INK)}${H('M16 34V52', 2.5)}`,
};

/** Coloured icon; falls back to nothing for unknown ids. */
export function art(id: string, size = 24, cls = '') {
  return `<svg class="svgi art ${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke">${ART[id] ?? ''}</svg>`;
}
