// Runs the balance simulator (src/simcore.ts) off the page's thread. One worker per job: config edits
// land on a fresh copy of the config and vanish with the worker. The page splits a sim's runs over several
// workers (seed ranges) and summarizes them itself. A 'tune' job runs the whole tuner (src/tuner.ts) here — its
// guesses and boss probes stay off the page — and plays its runs in nested 'run' workers.
import { applySet, bench, simMap, simulate, simulateFrom, type BenchRow, type RunOut, type SimMap, type SimOpts } from './simcore';
import { tune, type Runner, type RunResult, type TuneJob, type TuneOut } from './tuner';
import type { TuneTargets } from './tunetargets';
import type { ZoneId } from './config';

export type Job =
  | { kind: 'sim'; opts: Partial<SimOpts>; sets: [string, unknown][] }
  | { kind: 'bench'; sets: [string, unknown][] }
  | ({ kind: 'run' } & TuneJob)
  | { kind: 'tune'; targets: TuneTargets; sim: Partial<SimOpts>; runs: number; iters: number; zones?: ZoneId[]; fixed?: Record<string, number>; threads: number; sets: [string, unknown][] };
export type JobMsg =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'log'; line: string }
  | { kind: 'sim'; runs: RunOut[]; map: SimMap; ms: number }
  | { kind: 'bench'; rows: BenchRow[]; ms: number }
  | { kind: 'run'; res: RunResult[] }
  | { kind: 'tune'; out: TuneOut; ms: number }
  | { kind: 'error'; message: string };

const post = (m: JobMsg) => (self as unknown as Worker).postMessage(m);

/** One nested worker for a share of a 'run' job (same split as tools/pool.ts: run i keeps seed + i and ctl[i]). */
function runPart(job: TuneJob): Promise<RunResult[]> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./balanceworker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<JobMsg>) => {
      const m = e.data;
      if (m.kind === 'progress' || m.kind === 'log') return;
      w.terminate();
      if (m.kind === 'run') resolve(m.res);
      else reject(new Error(m.kind === 'error' ? m.message : 'не тот ответ воркера'));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'ошибка воркера')); };
    w.postMessage({ kind: 'run', ...job } satisfies Job);
  });
}
const runner = (threads: number): Runner => async (job) => {
  const runs = job.opts.runs ?? 10, seed = job.opts.seed ?? 1;
  const n = Math.max(1, Math.min(runs, threads));
  const parts = Array.from({ length: n }, (_, k) => {
    const from = Math.floor((k * runs) / n), to = Math.floor(((k + 1) * runs) / n);
    return runPart({ opts: { ...job.opts, runs: to - from, seed: seed + from }, sets: job.sets, ctl: job.ctl.length > 1 ? job.ctl.slice(from, to) : job.ctl });
  });
  return (await Promise.all(parts)).flat();
};

self.onmessage = async (e: MessageEvent<Job>) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    for (const [path, value] of job.sets) applySet(path, value);
    if (job.kind === 'bench') {
      post({ kind: 'bench', rows: bench(), ms: performance.now() - t0 });
      return;
    }
    if (job.kind === 'run') {
      post({ kind: 'run', res: simulateFrom(job.opts, job.ctl) });
      return;
    }
    if (job.kind === 'tune') {
      // the page's edits are the starting config: the nested runs get them before the tuner's own sets
      const base = job.sets;
      const run = runner(job.threads);
      const out = await tune(job.targets, (j) => run({ ...j, sets: [...base, ...j.sets] }), {
        sim: job.sim, runs: job.runs, iters: job.iters, zones: job.zones, fixed: job.fixed, log: (line) => post({ kind: 'log', line }),
      });
      post({ kind: 'tune', out, ms: performance.now() - t0 });
      return;
    }
    const total = job.opts.runs ?? 20;
    const runs = simulate(job.opts, (done) => post({ kind: 'progress', done, total }));
    post({ kind: 'sim', runs, map: simMap(), ms: performance.now() - t0 });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
