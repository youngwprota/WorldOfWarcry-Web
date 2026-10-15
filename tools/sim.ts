// Balance simulator CLI over src/simcore.ts (the same core runs on balance.html). Prints a per-minute curve and when each boss falls.
// Run: npm run sim -- [--faction human|orc] [--class party|warrior|hunter|mage] [--weapon sword] [--off shield_tower] [--runs 20] [--until 45]
//                     [--dodge 0.6] [--uptime 0.8] [--combo 0.85] [--seed 1] [--keep] [--log] [--mobs] [--bench]
//                     [--set MOBS.bandit_chief.hp=6000 --set GACHA.token.normal=0.05 ...] (what-if: config edits for this run)
import { ORBS, type FactionId, type OrbKind } from '../src/config';
import { CLASSES, type HeroClass } from '../src/party';
import { BOSSES, DEFAULT_OPTS, TRAIL, applySet, bench, simMap, simulate, summarize, BENCH_HP, type SimOpts } from '../src/simcore';

declare const process: { argv: string[]; exit(code?: number): never };
// ---------- options ----------
const argv = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const D = DEFAULT_OPTS;
const OPT: SimOpts = {
  faction: arg('faction', D.faction) as FactionId,
  cls: arg('class', D.cls) as SimOpts['cls'],
  weapon: arg('weapon', D.weapon),
  off: arg('off', D.off),
  runs: +arg('runs', String(D.runs)),
  until: +arg('until', String(D.until / 60)) * 60,
  dodge: +arg('dodge', String(D.dodge)),
  uptime: +arg('uptime', String(D.uptime)),
  combo: +arg('combo', String(D.combo)),
  bossWin: +arg('boss-win', String(D.bossWin)),
  seed: +arg('seed', String(D.seed)),
  keep: flag('keep'),
  probes: D.probes,
};
const mmss = (t: number | undefined) => (t === undefined ? '  —  ' : `${String(Math.floor(t / 60)).padStart(2)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
const LOG = flag('log'); // per-minute table of the first run
const MOBS_TABLE = flag('mobs'); // per-mob fight table

for (let i = 0; i < argv.length; i++) {
  // a quoted "--set a=1 --set b=2" arrives as one word: refuse it instead of silently dropping the edits
  if (argv[i].startsWith('--set ')) throw new Error(`--set: правки склеились в один аргумент: «${argv[i].slice(0, 60)}…»`);
  if (argv[i] !== '--set') continue;
  const [path, raw] = argv[i + 1].split('=');
  applySet(path, JSON.parse(raw));
}

// ---------- the forest cycle: every capped spawner, what all its charges give ----------
if (flag('cycle')) {
  const m = simMap();
  const cyc = m.units.filter((u) => u.zone === 'forest' && u.charges.length > 1 && Math.max(...u.charges) >= 3600);
  const tot: Record<string, number> = {};
  const pts = (r: Partial<Record<OrbKind, number>>, k = 1) => Object.entries(r).map(([s, n]) => { const v = n! * ORBS[s as OrbKind].value * k; tot[s] = (tot[s] ?? 0) + v; return `+${v} ${s}`; }).join(' ');
  console.log(`== Цикл леса: ${cyc.length} спавнеров, ${cyc.reduce((a, u) => a + u.charges.length, 0)} зарядов. Спавнер | ранг глуб. | HP урон | за убийство (× зарядов)`);
  for (const u of [...cyc].sort((a, b) => a.depth - b.depth || a.hp - b.hp)) {
    const per = Object.entries(u.reward).map(([s, n]) => `+${n! * ORBS[s as OrbKind].value} ${s}`).join(' ');
    pts(u.reward, u.charges.length);
    // a mini-boss's bonus is stat points as they are (not orbs)
    for (const [s, n] of Object.entries(u.bonus ?? {})) tot[s] = (tot[s] ?? 0) + n! * u.charges.length;
    console.log(`${u.id.padEnd(14)} ${u.def.padEnd(18)} ${u.rank.padEnd(6)} ${u.depth.toFixed(2)} | ${String(Math.round(u.hp)).padStart(5)} ${u.dmg.toFixed(1).padStart(5)} | ${per}${u.bonus ? ` + сразу ${JSON.stringify(u.bonus)}` : ''}${u.drop ? ` + ${u.drop}` : ''} ×${u.charges.length}`);
  }
  console.log(`Итого за цикл (очки статов): ${Object.entries(tot).map(([s, v]) => `${s} +${Math.round(v)}`).join(', ')}`);
  process.exit(0);
}

// ---------- boss chance along the forest cycle: the bot never tries a boss, clears the forest, the snapshots tell ----------
if (flag('curve')) {
  const rs = simulate({ ...OPT, bossWin: 2, probes: 30 });
  const b = BOSSES.find((x) => x.boss!.zone === 'forest')!;
  console.log(`== ${b.name}: шанс победы (лучший класс) по доле выбитого цикла леса, ${rs.length} прогонов; урон / HP героя`);
  for (let d = 0; d <= 10; d++) {
    const at = rs.map((r) => [...r.snaps].reverse().find((s) => s.cycle <= d / 10 + 1e-9)).filter((s): s is NonNullable<typeof s> => !!s && s.cycle >= d / 10 - 0.1);
    if (!at.length) { console.log(`${String(d * 10).padStart(3)}%   —`); continue; }
    const avg = (f: (s: (typeof at)[number]) => number) => at.reduce((a, s) => a + f(s), 0) / at.length;
    console.log(`${String(d * 10).padStart(3)}%  ${String(Math.round(avg((s) => s.win[b.id]) * 100)).padStart(3)}%   урон ${avg((s) => s.power).toFixed(0).padStart(3)}  HP ${avg((s) => s.maxHp).toFixed(0).padStart(4)}  реген ${avg((s) => s.regen).toFixed(1)}  ${mmss(avg((s) => s.t))}`);
  }
  process.exit(0);
}

// ---------- weapon bench ----------
if (flag('bench')) {
  console.log(`== Стенд: время убийства цели ${BENCH_HP} HP (редкое ур.1, урон 0, без резистов), с`);
  for (const r of bench()) console.log(`${r.label.padEnd(r.label.includes('+') ? 21 : 13)} ${r.ttk.toFixed(0).padStart(4)}`);
  process.exit(0);
}

// ---------- report ----------
const t0 = Date.now();
const runs = simulate(OPT);
const sum = summarize(runs);
const lines: string[] = [];
const say = (s = '') => lines.push(s);
say(`== Сим: ${OPT.faction}, ${OPT.cls === 'party' ? 'партия' : OPT.cls}${OPT.weapon ? ', ' + OPT.weapon : ''}${OPT.off ? '+' + OPT.off : ''}, прогонов ${OPT.runs}, до ${OPT.until / 60} мин; увороты ${OPT.dodge}, uptime ${OPT.uptime}, комбо ${OPT.combo}`);
say(`   тропа: лагерь s=${TRAIL.camp.toFixed(0)}, форт s=${TRAIL.fort.toFixed(0)}, ворота s=${TRAIL.gate.toFixed(0)}, арена s=${TRAIL.arena.toFixed(0)} м`);
if (LOG) {
  say('\n== Минуты (прогон 1): время зона | урон HP реген защ | убийств смертей круток | оружие | шанс победы над боссами');
  for (const s of runs[0].snaps) {
    say(`${mmss(s.t)} ${s.zone.padEnd(8)} | ${String(s.power).padStart(4)} ${String(s.maxHp).padStart(5)} ${String(s.regen).padStart(3)} ${String(s.defense).padStart(3)} | ${String(s.kills).padStart(3)} ${String(s.deaths).padStart(2)} ${String(s.pulls).padStart(2)} | ${s.weapons.padEnd(18)} | ${BOSSES.map((b) => `${b.name} ${Math.round(s.win[b.id] * 100)}%`).join(' ')}`);
  }
}
say('\n== Боссы: первое убийство (медиана [p10–p90]), сколько прогонов успели, длительность того боя');
for (const b of sum.bosses) say(`${b.name.padEnd(8)} ${mmss(b.p50)} [${mmss(b.p10)}–${mmss(b.p90)}]  ${b.won}/${sum.runs}  бой ${b.dur?.toFixed(0) ?? '—'} с  цикл леса ${b.cycle === undefined ? '—' : Math.round(b.cycle * 100) + '%'}`);
say(`Цикл леса (${sum.cycle.total} зарядов до 12-часового кулдауна): закрыт в ${sum.cycle.closed}/${sum.runs}, медиана ${mmss(sum.cycle.doneAt)}`);
say(`\nКрутки (медиана): 10 мин ${sum.pulls[10]}, 20 мин ${sum.pulls[20]}, 30 мин ${sum.pulls[30]}; смертей за прогон ${sum.deaths}`);
say(`Время в боях по классам: ${Object.entries(sum.classShare).map(([c, s]) => `${CLASSES[c as HeroClass].name} ${Math.round(s * 100)}%`).join(', ') || '—'}`);
if (MOBS_TABLE) {
  say('\n== Мобы: боёв | первый бой: когда, ударов, с, урон по герою % HP | все бои: ударов, с, % HP | поражений');
  const cols = (a: { swings: number; dur: number; takenPct: number }) => `${a.swings.toFixed(1).padStart(5)} ${a.dur.toFixed(1).padStart(5)} ${(Math.round(a.takenPct) + '%').padStart(5)}`;
  for (const m of sum.mobs) say(`${m.key.padEnd(22)} ${String(m.n).padStart(4)} | ${mmss(m.first.t)} ${cols(m.first)} | ${cols(m.all)} | ${m.losses}`);
}
say(`\n(${((Date.now() - t0) / 1000).toFixed(1)} с)`);
console.log(lines.join('\n'));
