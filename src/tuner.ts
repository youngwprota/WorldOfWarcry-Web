// Balance tuner: from the targets (src/tunetargets.ts) to config numbers. Location by location along the boss chain,
// each from the checkpoints of the previous boss's kill: the mobs' HP by rank from their fight lengths, the boss's HP
// from the hero's damage per second at the target minute, its damage by bisection to a 50% win rate then, the gacha
// pull rate from the share of might at the kill. No DOM or node: the CLI (tools/tune.ts) and balance.html give the runner.
import * as CONFIG from './config';
import { MOBS, ZONE_SCALE, type ZoneId } from './config';
import { applySet, pct, probeBoss, summarize, type Checkpoint, type RunCtl, type RunOut, type SimOpts, type SimSummary } from './simcore';
import type { FightRank, TuneTargets } from './tunetargets';

export interface TuneJob { opts: Partial<SimOpts>; sets: [string, unknown][]; ctl: RunCtl[] }
export type RunResult = { out: RunOut; cps: Record<string, Checkpoint> };
/** Runs a job's runs (worker threads / web workers); run i keeps seed `opts.seed + i` and `ctl[i]` (or `ctl[0]`). */
export type Runner = (job: TuneJob) => Promise<RunResult[]>;

/** The boss chain: each location and its main boss, in the order the passages open. */
export const CHAIN: { zone: ZoneId; boss: string }[] = (['forest', 'cemetery', 'peaks', 'hills', 'grove', 'swamp', 'dunes'] as ZoneId[])
  .map((zone) => ({ zone, boss: Object.values(MOBS).find((d) => d.boss?.zone === zone)!.id }));
const RANKS: FightRank[] = ['normal', 'elite', 'mini'];
/** Pull weights by rank when the config has none (GACHA.token all 0) and a gacha share is wanted. */
const TOKEN_BASE = { normal: 0.01, elite: 0.05, mini: 0.2, boss: 1 };

export interface Metrics { at?: number; fight?: number; gacha?: number; fights: Partial<Record<FightRank, number>>; won: number }
export interface ZoneReport {
  zone: ZoneId; boss: string; iters: number; ok: boolean;
  /** Before the tuning / after the whole chain (full sims from the start). */
  before?: Metrics; after?: Metrics;
  notes: string[];
}
export interface TuneOut { sets: Record<string, number>; was: Record<string, number>; reports: ZoneReport[] }
export interface TuneOpts {
  sim: Partial<SimOpts>;
  runs: number;
  /** Rounds per location (each: mobs, boss HP and damage, a check run). */
  iters: number;
  /** Only these locations (others keep their numbers); default: the whole chain. */
  zones?: ZoneId[];
  log?: (s: string) => void;
}

/** Current value of a config path (MOBS.death.hp). */
export function getPath(path: string): number {
  let o = CONFIG as unknown as Record<string, unknown>;
  for (const k of path.split('.')) o = o?.[k] as Record<string, unknown>;
  return o as unknown as number;
}
const med = (a: number[]) => pct(a, 0.5);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Numbers rounded for the config: 3 significant digits. */
const round = (v: number) => { const p = 10 ** Math.max(0, 2 - Math.floor(Math.log10(Math.abs(v) || 1))); return Math.round(v * p) / p; };

export function metricsOf(s: SimSummary, zone: ZoneId, boss: string): Metrics {
  const b = s.bosses.find((x) => x.id === boss);
  const f = s.fightDur[zone] ?? {};
  return { at: b?.p50 === undefined ? undefined : b.p50 / 60, fight: b?.dur, gacha: b?.gacha, fights: { normal: f.normal, elite: f.elite, mini: f.mini }, won: b?.won ?? 0 };
}

export async function tune(targets: TuneTargets, run: Runner, o: TuneOpts): Promise<TuneOut> {
  const log = o.log ?? (() => {});
  const sets: Record<string, number> = {};
  const was: Record<string, number> = {};
  const set = (path: string, v: number) => {
    if (!(path in was)) was[path] = getPath(path);
    v = round(v);
    sets[path] = v;
    applySet(path, v);
  };
  const job = (ctl: RunCtl[], sim: Partial<SimOpts> = {}): TuneJob => ({ opts: { ...o.sim, runs: o.runs, ...sim }, sets: Object.entries(sets), ctl });
  const T = targets;
  const chain = CHAIN.filter((c) => T.bosses[c.boss]);
  const zones = o.zones ?? chain.map((c) => c.zone);
  const reports: ZoneReport[] = [];

  log('Исходный прогон…');
  const base = summarize((await run(job([{}], { until: (Math.max(...chain.map((c) => T.bosses[c.boss].at)) + 20) * 60 }))).map((r) => r.out));
  // checkpoints of the previous boss's kill, one per run (none: from the start)
  let cps: (Checkpoint | undefined)[] = [];
  for (const { zone, boss } of chain) {
    const goal = T.bosses[boss];
    const tAt = goal.at * 60;
    const rep: ZoneReport = { zone, boss, iters: 0, ok: false, before: metricsOf(base, zone, boss), notes: [] };
    // every round of this location starts from the previous boss's kill
    const start = cps;
    const from = (i: number): RunCtl => ({ from: start.length ? start[i % start.length] : undefined });
    if (zones.includes(zone)) {
      reports.push(rep);
      log(`== ${MOBS[boss].name} (${zone}): цель ${goal.at} мин, бой ${goal.fight} с, гача ${Math.round(goal.gacha * 100)}%`);
      let tProbe = tAt;
      let bestScore = Infinity;
      let early: [number, number] | null = null, late: [number, number] | null = null;
      let best: { sets: Record<string, number>; cps: (Checkpoint | undefined)[] } | null = null;
      for (let it = 0; it < o.iters; it++) {
        rep.iters = it + 1;
        // 1. the mobs: the location's fights up to the target minute, the boss never tried
        const toT = await run(job(Array.from({ length: o.runs }, (_, i) => ({ ...from(i), stopTime: tProbe })), { bossWin: 2, until: tProbe + 900 }));
        const t0 = start.length ? Math.min(...start.map((c) => c!.t)) : 0;
        for (const rk of RANKS) {
          const want = T.fights[zone]?.[rk];
          const d = med(toT.flatMap((r) => r.out.fights.filter((f) => f.win && f.zone === zone && f.rank === rk && f.t > t0).map((f) => f.dur)));
          if (!want || !d) continue;
          const path = `ZONE_SCALE.${zone}.hp.${rk}`;
          // damped: the hero's growth depends on these fights too, a full step overshoots
          set(path, clamp(getPath(path) * clamp(want / d, 0.2, 5) ** 0.6, 0.05, 200));
        }
        // 2. the boss's HP: the hero at the probe minute takes `fight` s at his damage per second
        const atT = toT.map((r) => r.cps.time).filter((c): c is Checkpoint => !!c);
        if (!atT.length) { rep.notes.push('бот не дожил до целевой минуты'); break; }
        const sim = { ...o.sim };
        const probeAll = () => atT.map((c) => probeBoss(c, boss, sim));
        const hp0 = getPath(`MOBS.${boss}.hp`);
        const dps = med(probeAll().map((p) => p.dps))!;
        // the partner (Spring sister) has the same def: her HP grows with it
        const total = hp0 * (boss === 'elf_priestess' ? 2 : 1);
        set(`MOBS.${boss}.hp`, hp0 * clamp((dps * goal.fight) / total, 0.05, 20));
        // 3. its damage: bisection (geometric) to a 50% win rate at the probe minute
        let lo = getPath(`MOBS.${boss}.dmg`) / 16, hi = getPath(`MOBS.${boss}.dmg`) * 16;
        for (let k = 0; k < 9; k++) {
          const mid = Math.sqrt(lo * hi);
          set(`MOBS.${boss}.dmg`, mid);
          const rate = med(probeAll().map((p) => p.rate))!;
          if (rate > 0.5) lo = mid; else hi = mid;
        }
        set(`MOBS.${boss}.dmg`, Math.sqrt(lo * hi));
        // 4. the check: the bot plays on to the kill
        const check = await run(job(Array.from({ length: o.runs }, (_, i) => ({ ...from(i), stopAt: boss })), { until: tAt * 1.6 + 600 }));
        const kills = check.map((r) => r.out.bossAt[boss]).filter((x): x is number => x !== undefined);
        const at = med(kills), fight = med(check.map((r) => r.out.bossDur[boss]).filter((x): x is number => x !== undefined));
        const share = med(check.map((r) => r.out.gachaShare[boss]).filter((x): x is number => x !== undefined)) ?? 0;
        const okAt = at !== undefined && Math.abs(at - tAt) <= T.tol * tAt;
        const okFight = fight !== undefined && Math.abs(fight - goal.fight) <= T.tol * goal.fight;
        const okGacha = Math.abs(share - goal.gacha) <= T.tol;
        // the location's fights up to the kill, rank by rank (ranks the bot did not fight there are not judged)
        const fl = check.flatMap((r) => r.out.fights.filter((f) => f.win && f.zone === zone && f.t > t0 && f.t <= (r.out.bossAt[boss] ?? Infinity)));
        const mobD = Object.fromEntries(RANKS.map((rk) => [rk, med(fl.filter((f) => f.rank === rk).map((f) => f.dur))])) as Record<FightRank, number | undefined>;
        const okMobs = RANKS.every((rk) => { const want = T.fights[zone]?.[rk]; const d = mobD[rk]; return !want || !d || Math.abs(d - want) <= T.tol * want; });
        log(`  круг ${it + 1}: убит ${kills.length}/${check.length}, минута ${at === undefined ? '—' : (at / 60).toFixed(1)}, бой ${fight?.toFixed(0) ?? '—'} с, гача ${Math.round(share * 100)}%, мобы ${RANKS.map((rk) => mobD[rk]?.toFixed(0) ?? '—').join('/')} с`);
        // how far off this round is (relative misses summed; no kill is worst): the best round's numbers are kept
        const miss = (v: number | undefined, want: number) => (v === undefined ? 1 : Math.abs(v - want) / want);
        const score = kills.length ? miss(at, tAt) + miss(fight, goal.fight) + Math.abs(share - goal.gacha)
          + RANKS.reduce((a, rk) => { const want = T.fights[zone]?.[rk]; return a + (want && mobD[rk] ? miss(mobD[rk], want) * 0.5 : 0); }, 0) : 99;
        if (score < bestScore) { bestScore = score; best = { sets: { ...sets }, cps: kills.length ? check.map((r) => r.cps[boss]).filter((c): c is Checkpoint => !!c) : cps }; }
        if (okAt && okFight && okGacha && okMobs) { rep.ok = true; break; }
        // the boss is matched to the hero of the probe minute: killed late → match an earlier hero, early → a later one
        // regula falsi on the probe minute: the last probe that killed early and the last that killed late bracket it
        if (at !== undefined && !okAt) (at < tAt ? (early = [tProbe, at]) : (late = [tProbe, at]));
        if (okAt) { /* the minute is right: keep matching the same hero */ }
        else if (early && late) tProbe = early[0] + ((tAt - early[1]) * (late[0] - early[0])) / (late[1] - early[1] || 1);
        else if (at !== undefined) tProbe = clamp(tProbe + (tAt - at) * 0.8, t0 + 60, tAt * 2);
        else tProbe = Math.max(t0 + 60, tProbe - 0.25 * (tAt - t0));
        if (!okGacha && zone !== 'forest' && !CONFIG.GACHA.noTokens.includes(zone)) {
          if (Object.values(CONFIG.GACHA.token).every((v) => !v)) for (const [rk, v] of Object.entries(TOKEN_BASE)) set(`GACHA.token.${rk}`, v);
          const k = share > 0.005 ? clamp((goal.gacha / share) ** 1.5, 0.25, 4) : 4;
          set(`ZONE_SCALE.${zone}.token`, clamp(ZONE_SCALE[zone].token * k, 0.01, 100));
        }
        if (!kills.length) rep.notes.push(`круг ${it + 1}: босс не убит ни в одном прогоне`);
      }
      // back to the best round's numbers (the later guesses of a round that did not converge are dropped)
      if (best) {
        for (const p of Object.keys(sets)) if (!(p in best.sets)) { applySet(p, was[p]); delete sets[p]; }
        for (const [p, v] of Object.entries(best.sets)) set(p, v);
        cps = best.cps;
      }
      if (!rep.ok) rep.notes.push('не сошлось за отведённые круги — взят лучший круг');
    }
    // the next location goes on from this boss's kill (as it is now, tuned or not)
    if (!zones.includes(zone) || !cps.length || cps[0]!.boss !== boss) {
      const res = await run(job(Array.from({ length: o.runs }, (_, i) => ({ ...from(i), stopAt: boss })), { until: (goal.at * 3 + 30) * 60 }));
      const got = res.map((r) => r.cps[boss]).filter((c): c is Checkpoint => !!c);
      if (!got.length) { log(`${MOBS[boss].name} не убит — дальше цепочку не подобрать`); break; }
      cps = got;
    }
    if (zones.every((z) => reports.some((r) => r.zone === z))) break;
  }

  log('Проверочный прогон с подобранными числами…');
  const last = Math.max(...chain.filter((c) => zones.includes(c.zone)).map((c) => T.bosses[c.boss].at));
  const after = summarize((await run(job([{}], { until: (last + 20) * 60 }))).map((r) => r.out));
  for (const r of reports) r.after = metricsOf(after, r.zone, r.boss);
  return { sets, was, reports };
}
