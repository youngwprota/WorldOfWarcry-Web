import type { OrbKind } from './config';

// Coloured cartoon icons in the Butcher Hero manner: flat fills, a shade side, a white highlight and a thick ink outline.
// Drawn on a 64×64 grid. Outlined parts use P(), unoutlined shading/details use N(), highlights use H().

const INK = '#1d120b';
const STEEL = '#dde5ee', STEEL_D = '#9eacbc', STEEL_DD = '#6f7d8e';
const GOLD = '#ffc93a', GOLD_D = '#e0962a', GOLD_L = '#ffe68a';
const WOOD = '#b5733f', WOOD_D = '#82492a';
const LEATHER = '#c07a43', LEATHER_D = '#8a4f2b';
const SKIN = '#f2c29b', SKIN_D = '#d99a6e';
const RED = '#e8414f', BLUE = '#3d7be0', BLUE_D = '#2c5fb5';

const P = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
const N = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}" stroke="none"${extra}/>`;
const H = (d: string, w = 3) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" opacity=".85"/>`;
const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  `M${x + r} ${y}h${w - 2 * r}${r ? `a${r} ${r} 0 0 1 ${r} ${r}` : ''}v${h - 2 * r}${r ? `a${r} ${r} 0 0 1 -${r} ${r}` : ''}h-${w - 2 * r}${r ? `a${r} ${r} 0 0 1 -${r} -${r}` : ''}v-${h - 2 * r}${r ? `a${r} ${r} 0 0 1 ${r} -${r}` : ''}z`;
const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0z`;

const HEART = 'M32 58C14 45 5 35 5 22C5 13 12 7 20 7C26 7 30 10 32 14C34 10 38 7 44 7C52 7 59 13 59 22C59 35 50 45 32 58Z';
const HEART_SHADE = 'M9 31C15 41 23 48 32 54C41 48 49 41 55 31C49 39 41 45 32 49C23 45 15 39 9 31Z';

const staffArt = (orb: string, shade: string, glint: string) => `${P(rect(28.5, 22, 7, 40, 3.5), WOOD, ' transform="rotate(20 32 42)"')}
    ${N(rect(32, 25, 3.5, 34), WOOD_D, ' transform="rotate(20 32 42)"')}
    ${P('M30 25C24 24 21 18 23 12C25 7 31 5 34 9C30 9 28 13 30 16C32 20 38 19 39 15C42 20 37 26 30 25Z', GOLD)}
    ${P(circ(31, 14, 9), orb)}${N('M31 5A9 9 0 0 1 31 23Z', shade)}${N(circ(28, 11, 2.8), glint)}
    ${H('M14 8L17 11M48 12L51 9M46 26L50 27', 2.5)}`;

const ART: Record<string, string> = {
  fist: `${P(rect(21, 44, 24, 18, 3), '#e3a97d')}
    ${[14, 24, 34, 44].map((x) => P(rect(x, 9, 10, 24, 5), SKIN)).join('')}
    ${P(rect(14, 22, 40, 26, 7), SKIN)}${N('M44 24H52V40C52 44 50 46 46 46H30C38 44 44 38 44 24Z', SKIN_D, ' opacity=".7"')}
    ${P(rect(9, 29, 27, 10, 5), SKIN, ' transform="rotate(-12 22 34)"')}${H('M18 13V20M28 13V20', 2.5)}`,
  run: `${P('M42 3L55 8L46 34C50 38 50 44 46 48L14 54C8 55 6 50 10 46L30 38Z', '#fff')}
    ${N('M55 8L46 34C50 38 50 44 46 48L20 53L44 44C46 40 44 36 40 34Z', '#c9d2dc')}
    <path d="M52 50l9 2M48 57l9 3M58 40l5 1" fill="none" stroke-width="3.5" stroke-linecap="round"/>`,
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
  dagger: `<g transform="rotate(40 32 32)">
    ${P('M32 3L38 14L37 38H27L26 14Z', STEEL)}${N('M32 3L38 14L37 38H32Z', STEEL_D)}${H('M29.5 14L29 33', 2)}
    ${P(rect(19, 37, 26, 6, 3), GOLD)}${N(rect(21, 40, 22, 2), GOLD_D)}${P(circ(32, 40, 3.2), RED)}
    ${P(rect(28.5, 43, 7, 13, 1.5), LEATHER_D)}${N(rect(28.5, 47, 7, 1.6), '#4e1f14')}${N(rect(28.5, 51, 7, 1.6), '#4e1f14')}
    ${P(circ(32, 59, 4), GOLD)}</g>`,
  reaper: `<g transform="rotate(20 32 32)">
    ${P(rect(29, 6, 6, 56, 3), WOOD_D)}${N(rect(32, 9, 3, 50), '#5e321c')}
    ${P(rect(28, 46, 8, 10, 2), '#efe6cf')}
    ${P('M33 8C24 1 9 3 2 16C12 10 22 11 31 18Z', STEEL)}${N('M31 18C22 11 12 10 2 16C10 13 20 14 31 13Z', STEEL_DD)}${H('M8 9C14 6 20 6 25 7', 2.2)}
    ${P(rect(27, 5, 10, 9, 2), STEEL_DD)}${P('M37 8L46 6L37 13Z', STEEL_D)}</g>`,
  polearm: `<g transform="rotate(40 32 32)">
    ${P('M33 1C37 9 37 20 35 31H29C30 20 31 10 33 1Z', STEEL)}${N('M33 1C37 9 37 20 35 31H32C33 20 33 10 33 1Z', STEEL_D)}${H('M31.5 9C31 16 30.8 22 30.8 27', 2)}
    ${P(circ(32, 33, 6), GOLD)}${N(circ(32, 33, 2.5), GOLD_D)}
    ${P(rect(29, 38, 6, 24, 2), '#2b2b33')}${[41, 46, 51, 56].map((y) => N(rect(29, y, 6, 2), RED)).join('')}</g>`,
  scythe: `<g transform="rotate(25 32 32)">
    ${P(rect(29, 14, 6, 38, 3), WOOD_D)}${P(rect(28, 26, 8, 10, 2), LEATHER)}
    ${P('M32 14C22 4 9 4 3 12C12 9 21 11 29 19Z', STEEL)}${H('M9 8C14 6 19 6 23 8', 2)}
    ${P('M32 52C42 62 55 62 61 54C52 57 43 55 35 47Z', STEEL)}${N('M35 47C43 55 52 57 61 54C55 60 45 60 37 53Z', STEEL_D)}</g>`,
  pan: `<g transform="rotate(35 32 32)">
    ${P(rect(28.5, 34, 7, 28, 3), WOOD)}${N(rect(32, 36, 3.5, 24), WOOD_D)}${P(rect(29.5, 30, 5, 7, 1.5), STEEL_DD)}
    ${P(circ(32, 18, 16), '#4a5260')}${N(circ(32, 18, 12), '#2e343d')}${H('M22 12C24 8 28 6 32 6', 2.5)}</g>`,
  hidden_blade: `<g transform="rotate(40 32 32)">
    ${P('M32 2L35 9L34.5 33H29.5L29 9Z', STEEL)}${N('M32 2L35 9L34.5 33H32Z', STEEL_D)}
    ${P(rect(24, 32, 16, 28, 5), LEATHER_D)}${N(rect(32, 34, 7, 24, 3), '#6e3d20')}
    ${P(rect(23, 35, 18, 4, 2), GOLD)}${P(rect(23, 46, 18, 4, 2), GOLD)}${P(rect(23, 55, 18, 4, 2), GOLD)}</g>`,
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
  // the warrior's shields (WEAPONS.shield_*): tall and blue, small and round, red with spikes
  shield_tower: `${P(rect(12, 3, 40, 58, 6), STEEL)}${P(rect(17, 8, 30, 48, 4), BLUE)}${N(rect(32, 8, 15, 48, 4), BLUE_D)}
    ${P(rect(29, 8, 6, 48), GOLD)}${P(rect(17, 26, 30, 6), GOLD)}${H('M21 14V24', 2.5)}`,
  shield_buckler: `${P(circ(32, 32, 24), WOOD)}${N('M32 8A24 24 0 0 1 32 56Z', WOOD_D)}
    ${P(circ(32, 32, 17), STEEL)}${N('M32 15A17 17 0 0 1 32 49Z', STEEL_D)}${P(circ(32, 32, 7), GOLD)}${H('M19 24C21 19 25 16 29 15', 2.5)}`,
  shield_spiked: `${P('M32 0L37 8H27Z', STEEL)}${P('M2 22L11 18V28Z', STEEL)}${P('M62 22L53 18V28Z', STEEL)}${P('M32 64L27 56H37Z', STEEL)}
    ${P('M32 6L53 13V30C53 44 44 53 32 58C20 53 11 44 11 30V13Z', STEEL_DD)}
    ${P('M32 12L47 17V30C47 40 41 47 32 52C23 47 17 40 17 30V17Z', RED)}${N('M32 12L47 17V30C47 40 41 47 32 52Z', '#b52a37')}
    ${P('M32 22L37 32L32 42L27 32Z', STEEL)}${H('M21 21V31', 2.5)}`,
  // party classes (src/party.ts): the warrior's is `shield`
  bow: `<g transform="rotate(45 32 32)">
    <path d="M32 6L32 58" fill="none" stroke="${STEEL}" stroke-width="2.2"/>
    ${P('M32 4C46 4 54 18 54 32C54 46 46 60 32 60L32 54C42 54 47 43 47 32C47 21 42 10 32 10Z', WOOD)}
    ${N('M32 4C46 4 54 18 54 32C54 46 46 60 32 60L32 57C44 56 51 45 51 32C51 19 44 8 32 7Z', WOOD_D)}
    ${P(rect(45, 27, 10, 10, 3), LEATHER_D)}${P(rect(29, 2, 6, 6, 2), GOLD)}${P(rect(29, 56, 6, 6, 2), GOLD)}</g>
    ${P(rect(10, 30, 40, 4, 2), WOOD, ' transform="rotate(-45 32 32)"')}
    ${P('M50 7L58 6L57 14L52 12Z', STEEL, ' transform="translate(-1 1)"')}${P('M8 50L15 49L15 56L9 56Z', RED)}`,
  staff: staffArt('#8f6cff', '#6747d6', '#e6dcff'),
  // mage staves (config STAVES): the same staff, the orb in the element's colours
  staff_fire: staffArt('#ff7a2a', '#d8401c', '#ffe08a'),
  staff_ice: staffArt('#8fd8ff', '#4f9de0', '#f0fbff'),
  staff_wind: staffArt('#c8f5d8', '#7fcf9e', '#ffffff'),
  // pets (config PETS): the boar's head, snout forward
  boar: `${P('M14 10L22 22L10 26Z', '#6b3f24')}${P('M50 10L42 22L54 26Z', '#6b3f24')}
    ${P('M32 12C46 12 54 22 54 34C54 44 48 52 40 56H24C16 52 10 44 10 34C10 22 18 12 32 12Z', '#8a5530')}
    ${N('M32 12C46 12 54 22 54 34C54 44 48 52 40 56H34C42 48 46 38 45 28C44 20 39 14 32 12Z', '#6b3f24')}
    ${P('M20 6L26 12L32 4L38 12L44 6L42 18H22Z', '#3d2414')}
    ${N(circ(23, 30, 3.5), INK)}${N(circ(41, 30, 3.5), INK)}${N(circ(24, 29, 1.2), '#ff5a3a')}${N(circ(42, 29, 1.2), '#ff5a3a')}
    ${P(rect(22, 38, 20, 16, 7), '#d9a07a')}${N(circ(28, 46, 2.3), '#6b3f24')}${N(circ(36, 46, 2.3), '#6b3f24')}
    ${P('M20 44C14 42 11 36 12 30C15 35 18 38 22 39Z', '#f6eedf')}${P('M44 44C50 42 53 36 52 30C49 35 46 38 42 39Z', '#f6eedf')}`,
  anvil: `${P('M4 14H44C44 22 50 26 60 27V32H44L38 38V46H46V58H18V46H26V38L20 32H10C6 27 4 21 4 14Z', '#717c8b')}
    ${N(rect(7, 16, 35, 3), '#aab5c2')}${N('M32 32H44L38 38V46H32Z', '#4f5866')}${N(rect(32, 46, 14, 12), '#4f5866')}`,
  lock: `${P('M18 30V20C18 11 24 5 32 5C40 5 46 11 46 20V30H39V20C39 15 36 12 32 12C28 12 25 15 25 20V30Z', STEEL_D)}
    ${P(rect(11, 28, 42, 32, 6), GOLD)}${N(rect(32, 30, 19, 28, 4), GOLD_D, ' opacity=".5"')}
    ${N(circ(32, 40, 4), INK)}${N(rect(30, 41, 4, 10, 1.5), INK)}${H('M16 34V52', 2.5)}`,
  // talents
  sun: `${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => P('M27 13L32 2L37 13Z', GOLD, ` transform="rotate(${a} 32 32)"`)).join('')}
    ${P(circ(32, 32, 16), GOLD_L)}${N('M32 16A16 16 0 0 1 32 48Z', GOLD, ' opacity=".7"')}${H('M21 27A12 12 0 0 1 27 20', 2.5)}`,
  star: `${P('M32 4L39.5 22.5L59 23.5L44 36L49 55L32 44.5L15 55L20 36L5 23.5L24.5 22.5Z', GOLD)}
    ${N('M32 4L39.5 22.5L59 23.5L44 36L49 55L32 44.5Z', GOLD_D, ' opacity=".55"')}${H('M28 17L25.5 24L17 25', 2.5)}`,
  flag: `${P(rect(9, 4, 7, 57, 3), WOOD)}${P('M16 8H55L46 21L55 34H16Z', RED)}${N('M16 22H50L55 34H16Z', '#b52a37', ' opacity=".6"')}
    ${P(circ(31, 20, 5), GOLD)}${H('M21 13H40', 2.5)}`,
  drop: `${P('M32 4C40 18 52 30 52 42C52 53 43 61 32 61C21 61 12 53 12 42C12 30 24 18 32 4Z', RED)}
    ${N('M32 61C43 61 52 53 52 42C52 36 49 30 45 24C47 34 46 48 32 61Z', '#a8222f')}${H('M20 40C20 33 24 26 28 20', 3)}`,
  flame: `${P('M32 3C36 15 50 22 50 40C50 52 42 61 32 61C22 61 14 52 14 40C14 30 20 25 24 18C26 26 28 28 31 29C30 20 31 11 32 3Z', '#ff7a2a')}
    ${N('M32 33C36 38 41 42 41 49C41 55 37 59 32 59C27 59 23 55 23 49C23 44 27 41 32 33Z', '#ffd23f')}${H('M20 38C20 32 23 27 26 23', 2.5)}`,
};

/** Sprite of each stat: HUD stats panel and kill-reward chips. */
export const STAT_ICON: Record<OrbKind, string> = { power: 'dps', hp: 'heart', regen: 'regen', speed: 'run' };

/**
 * Simplified stat sprites for the small over-head chips: one flat silhouette, outlined in a darker shade of its own
 * colour (not ink). Shapes are stroked first and filled on top, so overlaps merge into one outline.
 */
const MINI: Record<string, { fill: string; line: string; shapes: string; detail?: string }> = {
  heart: { fill: '#ef3e5c', line: '#8e1f33', shapes: `<path d="${HEART}"/>` },
  regen: { fill: '#41cf62', line: '#1d6e35', shapes: `<path d="${HEART}"/>`, detail: '<path d="M28 18H36V26H44V34H36V42H28V34H20V26H28Z" fill="#fff"/>' },
  fist: {
    fill: SKIN, line: '#8a5634',
    shapes: `<path d="${rect(21, 44, 24, 16, 3)}"/>${[14, 24, 34, 44].map((x) => `<path d="${rect(x, 9, 10, 24, 5)}"/>`).join('')}<path d="${rect(14, 22, 40, 26, 7)}"/>`,
  },
  run: { fill: '#fff', line: '#6b7685', shapes: '<path d="M42 3L55 8L46 34C50 38 50 44 46 48L14 54C8 55 6 50 10 46L30 38Z"/>' },
};

export function mini(id: string, size = 14) {
  if (PNG[id]) return png(id, size, 'mini');
  const m = MINI[id];
  // no simplified sprite (the sword of the damage stat): the full coloured icon
  if (!m) return art(id, size, 'mini');
  return `<svg class="svgi mini" width="${size}" height="${size}" viewBox="0 0 64 64" stroke-linejoin="round">` +
    `<g fill="${m.line}" stroke="${m.line}" stroke-width="10">${m.shapes}</g><g fill="${m.fill}">${m.shapes}</g>${m.detail ?? ''}</svg>`;
}

/** UI icons drawn from the casual GUI pack (public/assets/ui); item icons stay vector. */
const PNG: Record<string, string> = {
  gear: 'i-gear', bag: 'i-bag', skull: 'i-skull', hourglass: 'i-hourglass',
  heart: 'i-heart', regen: 'i-regen', fist: 'i-fist', run: 'i-run',
  // white with an ink outline: the main boss's skull, swords / axes / hammers, the armour slots (legs = boots)
  boss: 'i-boss', sword: 'i-sword', axe: 'i-axe', hammer: 'i-hammer',
  head: 'i-head', chest: 'i-chest', arms: 'i-arms', legs: 'i-legs', ring: 'i-ring', amulet: 'i-amulet',
  // orange crit: crit damage, and crit chance (with "%"); the defense stat's shield
  crit: 'i-crit', critdmg: 'i-critdmg', defense: 'i-defense',
  // coloured: damage of one blow (hammer), damage per second (sword); blue chevrons of dodge
  hit: 'i-hit', dps: 'i-dps', dodge: 'i-dodge',
  // weapon item icons per rarity (`<def>_<rarity>`), rendered from their models
  ...Object.fromEntries(['staff_fire', 'staff_ice', 'staff_wind', 'sword', 'axe', 'hammer', 'polearm', 'shield_tower',
    'shield_buckler', 'shield_spiked', 'bow'].flatMap((def) =>
    ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'].map((r) => [`${def}_${r}`, `${def}_${r}`]))),
  // armour item icons per rarity and faction (src/looks.ts CLASS_LOOK.icon): plate sets, hunter / caster skins, jewels
  ...Object.fromEntries([
    ...['guard', 'knight', 'lord', 'archer', 'caster'].flatMap((set) => ['head', 'chest', 'arms', 'legs'].map((slot) => `${set}_${slot}`)),
    'ring', 'amulet',
  ].flatMap((piece) => ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'].flatMap((r) =>
    ['human', 'orc'].map((f) => [`${piece}_${r}_${f}`, `armor/${piece}_${r}_${f}`])))),
  orb_vigor: 'orb_vigor', orb_fury: 'orb_glass',
  orb_swift: 'orb_swift', orb_ward: 'orb_ward', orb_fortune: 'orb_fortune', orb_demon: 'orb_demon',
};
/** The id has a pack PNG (art() draws it instead of the vector). */
export const hasPng = (id: string) => !!PNG[id];
/** URL of a pack PNG icon. */
export const pngUrl = (id: string) => `${import.meta.env.BASE_URL}assets/ui/${PNG[id]}.png`;

const pngCache = new Map<string, HTMLImageElement>();
/** A pack PNG icon as an image for canvas drawing (map marks); null for ids without one. Draw once `complete`. */
export function artImage(id: string) {
  if (!PNG[id]) return null;
  let img = pngCache.get(id);
  if (!img) {
    img = new Image();
    img.src = pngUrl(id);
    pngCache.set(id, img);
  }
  return img;
}
const png = (id: string, size: number, cls: string) =>
  `<img class="svgi art png ${cls}" src="${import.meta.env.BASE_URL}assets/ui/${PNG[id]}.png" width="${size}" height="${size}" alt="" draggable="false">`;

const tintCache = new Map<string, HTMLCanvasElement | null>();
/**
 * A pack PNG icon recoloured for canvas drawing (map marks): the light parts take `color`, the dark outline stays.
 * Cached per id + colour; null until the PNG has loaded.
 */
export function tintedArt(id: string, color: string) {
  const key = id + color;
  if (tintCache.get(key)) return tintCache.get(key)!;
  if (!tintCache.has(key)) {
    tintCache.set(key, null);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(img, 0, 0);
      tintCache.set(key, c);
    };
    img.src = `${import.meta.env.BASE_URL}assets/ui/${PNG[id]}.png`;
  }
  return null;
}

const whiteCache = new Map<string, HTMLCanvasElement | null>();
/**
 * A pack PNG icon in white for canvas drawing (map tiles on a quality colour): every lit pixel turns white, the dark
 * ink outline stays dark, at the PNG's own resolution. Cached per id; null until the PNG has loaded.
 */
export function whiteArt(id: string) {
  if (whiteCache.get(id)) return whiteCache.get(id)!;
  if (!whiteCache.has(id)) {
    whiteCache.set(id, null);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height);
      const d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        const v = 255 * Math.min(1, Math.max(0, (l - 0.12) / 0.28));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      g.putImageData(px, 0, 0);
      whiteCache.set(id, c);
    };
    img.src = pngUrl(id);
  }
  return null;
}

/** Coloured icon; falls back to nothing for unknown ids. */
export function art(id: string, size = 24, cls = '') {
  if (PNG[id]) return png(id, size, cls);
  return `<svg class="svgi art ${cls}" width="${size}" height="${size}" viewBox="0 0 64 64" stroke="${INK}" stroke-width="5.5" stroke-linejoin="round" paint-order="stroke">${ART[id] ?? ''}</svg>`;
}
