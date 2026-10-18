// Runs the sim's runs over several node worker threads (the CLIs tools/sim.ts and tools/tune.ts). Each job is a fresh
// worker of the same bundle: config edits (--set, the tuner's guesses) land on its own copy of the config.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { applySet, simulateFrom, type RunCtl, type SimOpts } from '../src/simcore';

export interface PoolJob { opts: Partial<SimOpts>; sets: [string, unknown][]; ctl: RunCtl[] }
type Result = ReturnType<typeof simulateFrom>;

/** In a worker: run the job and post the result. Returns true there (the CLI must then do nothing else). */
export function poolWorker(): boolean {
  if (isMainThread) return false;
  const job = workerData as PoolJob;
  for (const [p, v] of job.sets) applySet(p, v);
  parentPort!.postMessage(simulateFrom(job.opts, job.ctl));
  return true;
}

const THREADS = Math.max(1, Math.min(16, availableParallelism() - 1));

/**
 * `opts.runs` runs split over the threads: run i keeps seed `opts.seed + i` and `ctl[i]` (or `ctl[0]` for all), so the
 * result is what one thread would give. `onRun`: runs done so far.
 */
export function runPool(job: PoolJob, onRun?: (done: number) => void): Promise<Result> {
  const runs = job.opts.runs ?? 10, seed = job.opts.seed ?? 1;
  const n = Math.max(1, Math.min(runs, THREADS));
  let done = 0;
  const parts = Array.from({ length: n }, (_, k) => {
    const from = Math.floor((k * runs) / n), to = Math.floor(((k + 1) * runs) / n);
    const ctl = job.ctl.length > 1 ? job.ctl.slice(from, to) : job.ctl;
    const part: PoolJob = { opts: { ...job.opts, runs: to - from, seed: seed + from }, sets: job.sets, ctl };
    return new Promise<Result>((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: part });
      w.on('message', (m) => { done += to - from; onRun?.(done); resolve(m as Result); });
      w.on('error', reject);
      w.on('exit', (code) => { if (code) reject(new Error(`поток сима упал: код ${code}`)); });
    });
  });
  return Promise.all(parts).then((r) => r.flat());
}
export const poolThreads = THREADS;
