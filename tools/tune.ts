// Balance tuner CLI over src/tuner.ts: the targets (src/tunetargets.ts or --targets file.json) → config numbers.
// Run: npm run tune -- [--zone forest,cemetery] [--runs 8] [--iters 6] [--targets t.json] [--faction orc] [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { MOBS, TUNE_MANUAL, ZONES, type FactionId, type ZoneId } from '../src/config';
import { DEFAULT_TARGETS, type TuneTargets } from '../src/tunetargets';
import { getPath, tune, type Metrics } from '../src/tuner';
import { writeTuned } from '../src/tunedblock';
import { poolThreads, poolWorker, runPool } from './pool';

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const targets: TuneTargets = argv.includes('--targets') ? JSON.parse(readFileSync(arg('targets', ''), 'utf8')) : DEFAULT_TARGETS;
  const zones = argv.includes('--zone') ? (arg('zone', '').split(',') as ZoneId[]) : undefined;
  const t0 = Date.now();
  const sec = () => `${((Date.now() - t0) / 1000).toFixed(0)} с`;
  console.log(`== Подбор: ${zones?.join(', ') ?? 'вся цепочка'}, прогонов ${arg('runs', '8')}, потоков ${poolThreads}`);
  const out = await tune(targets, (job) => runPool(job), {
    sim: { faction: arg('faction', 'human') as FactionId }, runs: +arg('runs', '8'), iters: +arg('iters', '6'), zones,
    // hand-set knobs of config.ts (TUNE_MANUAL) stay as they are; --write keeps their marks
    fixed: Object.fromEntries(TUNE_MANUAL.map((p) => [p, getPath(p)])),
    log: (s) => console.log(`[${sec()}] ${s}`),
  });

  const zoneName = (id: string) => ZONES.find((z) => z.id === id)?.name ?? id;
  const m = (x: Metrics | undefined) => x ? `${x.at === undefined ? '—' : x.at.toFixed(1)} мин, бой ${x.fight?.toFixed(0) ?? '—'} с, гача ${x.gacha === undefined ? '—' : Math.round(x.gacha * 100) + '%'}, мобы ${(['normal', 'elite', 'mini'] as const).map((r) => x.fights[r]?.toFixed(0) ?? '—').join('/')} с, потеря HP ${(['normal', 'elite', 'mini'] as const).map((r) => (x.loss?.[r] === undefined ? '—' : Math.round(x.loss[r]! * 100))).join('/')}%` : '—';
  console.log('\n== Итог: было → стало (полный прогон с начала), цель');
  for (const r of out.reports) {
    const g = targets.bosses[r.boss];
    const f = targets.fights[r.zone] ?? {};
    console.log(`${r.ok ? '✓' : '✗'} ${MOBS[r.boss].name} (${zoneName(r.zone)}), кругов ${r.iters}`);
    console.log(`    было:  ${m(r.before)}\n    стало: ${m(r.after)}\n    цель:  ${g.at} мин, бой ${g.fight} с, гача ${Math.round(g.gacha * 100)}%, мобы ${f.normal ?? '—'}/${f.elite ?? '—'}/${f.mini ?? '—'} с, потеря HP ${(['normal', 'elite', 'mini'] as const).map((rk) => { const v = targets.loss?.[r.zone]?.[rk]; return v === undefined ? '—' : Math.round(v * 100); }).join('/')}%`);
    for (const n of r.notes) console.log(`    ! ${n}`);
  }
  console.log('\n== Правки конфига');
  for (const [p, v] of Object.entries(out.sets)) console.log(`${p.padEnd(34)} ${out.was[p]} → ${v}`);
  for (const [p, v] of Object.entries(out.fixed)) console.log(`${p.padEnd(34)} ${v} (вручную)`);
  console.log(`\nДля проверки: npm run sim -- ${Object.entries(out.sets).map(([p, v]) => `--set ${p}=${v}`).join(' ')}`);
  if (argv.includes('--write') && Object.keys(out.sets).length) {
    // npm runs from the project root
    writeFileSync('src/config.ts', writeTuned(readFileSync('src/config.ts', 'utf8'), out.sets));
    console.log('Записано в src/config.ts (блок <tuned>)');
  }
  console.log(`(${sec()})`);
}

// a worker thread of the pool runs its job instead of the CLI
if (!poolWorker()) await main();
