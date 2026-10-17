// Balance tuner CLI over src/tuner.ts: the targets (src/tunetargets.ts or --targets file.json) → config numbers.
// Run: npm run tune -- [--zone forest,cemetery] [--runs 8] [--iters 6] [--targets t.json] [--faction orc] [--write]
import { readFileSync } from 'node:fs';
import { MOBS, ZONES, type FactionId, type ZoneId } from '../src/config';
import { DEFAULT_TARGETS, type TuneTargets } from '../src/tunetargets';
import { tune, type Metrics } from '../src/tuner';
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
    log: (s) => console.log(`[${sec()}] ${s}`),
  });

  const zoneName = (id: string) => ZONES.find((z) => z.id === id)?.name ?? id;
  const m = (x: Metrics | undefined) => x ? `${x.at === undefined ? '—' : x.at.toFixed(1)} мин, бой ${x.fight?.toFixed(0) ?? '—'} с, гача ${x.gacha === undefined ? '—' : Math.round(x.gacha * 100) + '%'}, мобы ${(['normal', 'elite', 'mini'] as const).map((r) => x.fights[r]?.toFixed(0) ?? '—').join('/')} с` : '—';
  console.log('\n== Итог: было → стало (полный прогон с начала), цель');
  for (const r of out.reports) {
    const g = targets.bosses[r.boss];
    const f = targets.fights[r.zone] ?? {};
    console.log(`${r.ok ? '✓' : '✗'} ${MOBS[r.boss].name} (${zoneName(r.zone)}), кругов ${r.iters}`);
    console.log(`    было:  ${m(r.before)}\n    стало: ${m(r.after)}\n    цель:  ${g.at} мин, бой ${g.fight} с, гача ${Math.round(g.gacha * 100)}%, мобы ${f.normal ?? '—'}/${f.elite ?? '—'}/${f.mini ?? '—'} с`);
    for (const n of r.notes) console.log(`    ! ${n}`);
  }
  console.log('\n== Правки конфига');
  for (const [p, v] of Object.entries(out.sets)) console.log(`${p.padEnd(34)} ${out.was[p]} → ${v}`);
  console.log(`\nДля проверки: npm run sim -- ${Object.entries(out.sets).map(([p, v]) => `--set ${p}=${v}`).join(' ')}`);
  console.log(`(${sec()})`);
}

// a worker thread of the pool runs its job instead of the CLI
if (!poolWorker()) await main();
