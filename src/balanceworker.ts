// Runs the balance simulator (src/simcore.ts) off the page's thread. One worker per job: config edits
// land on a fresh copy of the config and vanish with the worker.
import { applySet, bench, simMap, simulate, summarize, type BenchRow, type RunOut, type SimMap, type SimOpts, type SimSummary } from './simcore';

export type Job =
  | { kind: 'sim'; opts: Partial<SimOpts>; sets: [string, unknown][] }
  | { kind: 'bench'; sets: [string, unknown][] };
export type JobMsg =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'sim'; runs: Omit<RunOut, 'fights'>[]; summary: SimSummary; map: SimMap; ms: number }
  | { kind: 'bench'; rows: BenchRow[]; ms: number }
  | { kind: 'error'; message: string };

const post = (m: JobMsg) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<Job>) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    for (const [path, value] of job.sets) applySet(path, value);
    if (job.kind === 'bench') {
      post({ kind: 'bench', rows: bench(), ms: performance.now() - t0 });
      return;
    }
    const total = job.opts.runs ?? 20;
    const runs = simulate(job.opts, (done) => post({ kind: 'progress', done, total }));
    // fights only feed the summary: the page needs the curves
    post({ kind: 'sim', runs: runs.map(({ fights: _, ...r }) => r), summary: summarize(runs), map: simMap(), ms: performance.now() - t0 });
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
