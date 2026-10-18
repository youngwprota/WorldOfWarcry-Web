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

/** A number the tuner may change; `zone` null — shared by all locations. */
export interface Knob { path: string; name: string; zone: ZoneId | null }
const OF_RANK: Record<FightRank, string> = { normal: 'мобов', elite: 'элиток', mini: 'мини-боссов' };
/** Every number the tuner may change, by location along the chain, then the shared ones (balance.html lists them). */
export const TUNE_KNOBS: Knob[] = [
  ...CHAIN.flatMap(({ zone, boss }): Knob[] => [
    ...RANKS.flatMap((rk): Knob[] => [
      { path: `ZONE_SCALE.${zone}.hp.${rk}`, name: `HP ${OF_RANK[rk]}, ×`, zone },
      { path: `ZONE_SCALE.${zone}.dmg.${rk}`, name: `урон ${OF_RANK[rk]}, ×`, zone },
    ]),
    { path: `ZONE_SCALE.${zone}.token`, name: 'шанс круток, ×', zone },
    { path: `MOBS.${boss}.hp`, name: `HP босса (${MOBS[boss].name})`, zone },
    { path: `MOBS.${boss}.dmg`, name: `урон босса (${MOBS[boss].name})`, zone },
  ]),
  ...(['normal', 'elite', 'mini', 'boss'] as const).map((rk): Knob => ({ path: `GACHA.token.${rk}`, name: `шанс крутки: ${rk === 'boss' ? 'босс' : OF_RANK[rk]}`, zone: null })),
];

export interface Metrics { at?: number; fight?: number; gacha?: number; fights: Partial<Record<FightRank, number>>; loss: Partial<Record<FightRank, number>>; won: number }
export interface ZoneReport {
  zone: ZoneId; boss: string; iters: number; ok: boolean;
  /** Before the tuning / after the whole chain (full sims from the start). */
  before?: Metrics; after?: Metrics;
  notes: string[];
}
export interface TuneOut { sets: Record<string, number>; was: Record<string, number>; fixed: Record<string, number>; reports: ZoneReport[] }
export interface TuneOpts {
  sim: Partial<SimOpts>;
  runs: number;
  /** Rounds per location (each: mobs, boss HP and damage, a check run). */
  iters: number;
  /** Only these locations (others keep their numbers); default: the whole chain. */
  zones?: ZoneId[];
  /** Hand-set knobs (TUNE_KNOBS paths): applied first, never changed. */
  fixed?: Record<string, number>;
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
  const f = s.fightDur[zone] ?? {}, l = s.fightLoss[zone] ?? {};
  return { at: b?.p50 === undefined ? undefined : b.p50 / 60, fight: b?.dur, gacha: b?.gacha, fights: { normal: f.normal, elite: f.elite, mini: f.mini }, loss: { normal: l.normal, elite: l.elite, mini: l.mini }, won: b?.won ?? 0 };
}

export async function tune(targets: TuneTargets, run: Runner, o: TuneOpts): Promise<TuneOut> {
  const log = o.log ?? (() => {});
  const sets: Record<string, number> = {};
  const was: Record<string, number> = {};
  const fixed = o.fixed ?? {};
  for (const [p, v] of Object.entries(fixed)) applySet(p, v);
  const set = (path: string, v: number) => {
    if (path in fixed) return;
    if (!(path in was)) was[path] = getPath(path);
    v = round(v);
    sets[path] = v;
    applySet(path, v);
  };
  const job = (ctl: RunCtl[], sim: Partial<SimOpts> = {}): TuneJob => ({ opts: { ...o.sim, runs: o.runs, ...sim }, sets: [...Object.entries(fixed), ...Object.entries(sets)], ctl });
  const T = targets;
  const chain = CHAIN.filter((c) => T.bosses[c.boss]);
  const zones = o.zones ?? chain.map((c) => c.zone);
  const reports: ZoneReport[] = [];

  log('Исходный прогон…');
  const baseRuns = (await run(job([{}], { until: (Math.max(...chain.map((c) => T.bosses[c.boss].at)) + 20) * 60 }))).map((r) => r.out);
  const base = summarize(baseRuns);
  // ranks each location fields (the bot fought them somewhere in the base runs)
  const seen = new Set(baseRuns.flatMap((r) => r.fights.map((f) => `${f.zone}/${f.rank}`)));
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
      const own = TUNE_KNOBS.filter((k) => k.zone === zone && k.path in fixed);
      if (own.length) log(`  вручную: ${own.map((k) => `${k.path} = ${fixed[k.path]}`).join(', ')}`);
      let bestScore = Infinity;
      let best: { sets: Record<string, number>; cps: (Checkpoint | undefined)[] } | null = null;
      const t0 = start.length ? Math.min(...start.map((c) => c!.t)) : 0;
      /** Ranks fought before the kill in round 0 (the numbers as they were). */
      const c0Ranks = new Set<FightRank>();
      /** The check: the bot plays on to the kill with the numbers as they are now; how far off that is. */
      const checkRound = async (label: string) => {
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
        // HP lost per fight, a share of max HP (judged in points, like the gacha share)
        const mobL = Object.fromEntries(RANKS.map((rk) => [rk, med(fl.filter((f) => f.rank === rk).map((f) => f.taken / f.maxHp))])) as Record<FightRank, number | undefined>;
        const okLoss = RANKS.every((rk) => { const want = T.loss?.[zone]?.[rk]; const l = mobL[rk]; return want === undefined || l === undefined || Math.abs(l - want) <= T.tol; });
        log(`  ${label}: убит ${kills.length}/${check.length}, минута ${at === undefined ? '—' : (at / 60).toFixed(1)}, бой ${fight?.toFixed(0) ?? '—'} с, гача ${Math.round(share * 100)}%, мобы ${RANKS.map((rk) => mobD[rk]?.toFixed(0) ?? '—').join('/')} с, потеря HP ${RANKS.map((rk) => (mobL[rk] === undefined ? '—' : Math.round(mobL[rk]! * 100))).join('/')}%`);
        // how far off (relative misses summed; no kill is worst): the best round's numbers are kept
        // a rank the bot fought here at the start but not in this round is not a hit: it is the worst miss
        const fought = (rk: FightRank) => c0Ranks.has(rk);
        const miss = (v: number | undefined, want: number) => (v === undefined ? 1 : Math.abs(v - want) / want);
        const score = kills.length ? miss(at, tAt) + miss(fight, goal.fight) + Math.abs(share - goal.gacha)
          + RANKS.reduce((a, rk) => { const want = T.fights[zone]?.[rk]; return a + (want && mobD[rk] ? miss(mobD[rk], want) * 0.5 : want && fought(rk) ? 0.5 : 0); }, 0)
          + RANKS.reduce((a, rk) => { const want = T.loss?.[zone]?.[rk]; const l = mobL[rk]; return a + (want !== undefined && l !== undefined ? Math.abs(l - want) * 0.5 : want !== undefined && fought(rk) ? 0.5 : 0); }, 0) : 99;
        if (!c0Ranks.size) for (const rk of RANKS) if (mobD[rk] !== undefined) c0Ranks.add(rk);
        const cps = kills.length ? check.map((r) => r.cps[boss]).filter((c): c is Checkpoint => !!c) : [];
        return { runs: check, at, fight, okAt, okGacha, share, kills, score, cps, mobsOk: okMobs && okLoss, ok: okAt && okFight && okGacha && okMobs && okLoss };
      };
      /** The bot plays to minute `tp` from the previous kill, the boss never tried. */
      const toMinute = (tp: number) => run(job(Array.from({ length: o.runs }, (_, i) => ({ ...from(i), stopTime: tp })), { bossWin: 2, until: tp + 900 }));
      /** The location's mobs from their fights in `toT`: HP by rank to the fight lengths, damage to the HP lost. True when
       * every rank was already within the tolerance (nothing changed). */
      const tuneMobs = (toT: RunResult[], label = ` к ${goal.at} мин`, soften = true) => {
        let ok = true;
        const seen2: string[] = [];
        for (const rk of RANKS) {
          const want = T.fights[zone]?.[rk], wantLoss = T.loss?.[zone]?.[rk];
          const won = toT.flatMap((r) => r.out.fights.filter((f) => f.win && f.zone === zone && f.rank === rk && f.t > t0));
          const d = med(won.map((f) => f.dur)), loss = med(won.map((f) => f.taken / f.maxHp));
          seen2.push(`${d?.toFixed(0) ?? '—'} с ${loss === undefined ? '—' : Math.round(loss * 100)}%`);
          if (!want && wantLoss === undefined) continue;
          const path = `ZONE_SCALE.${zone}.hp.${rk}`, dmgPath = `ZONE_SCALE.${zone}.dmg.${rk}`;
          // the location has this rank but the bot won no such fight before the minute: too hard for him then — softer
          // (only when he played to the target minute: a check that killed the boss early may just have skipped them)
          if (!d) {
            if (!soften || !seen.has(`${zone}/${rk}`)) continue;
            ok = false;
            set(path, clamp(getPath(path) * 0.6, 0.05, 200));
            set(dmgPath, clamp(getPath(dmgPath) * 0.6, 0.05, 200));
            continue;
          }
          const inD = !want || Math.abs(d - want) <= T.tol * want;
          const inL = wantLoss === undefined || loss === undefined || Math.abs(loss - wantLoss) <= T.tol;
          if (inD && inL) continue;
          ok = false;
          // damped: the hero's growth depends on these fights too, a full step overshoots
          const hpk = want && !inD && !(path in fixed) ? clamp(want / d, 0.2, 5) ** 0.6 : 1;
          set(path, clamp(getPath(path) * hpk, 0.05, 200));
          // the edge: HP lost ≈ the mobs' damage × the fight's length, and the length follows the HP just set
          if (wantLoss !== undefined && loss !== undefined) set(dmgPath, clamp(getPath(dmgPath) * clamp(wantLoss / Math.max(0.01, loss * hpk), 0.25, 4) ** 0.7, 0.05, 200));
        }
        log(`  мобы${label}: ${seen2.join(' / ')}${ok ? ' — в допуске' : ''}`);
        return ok;
      };
      // round 0: the numbers as they are — already within the targets: the location is left alone; else they are the
      // first candidate, so a noisy round never ends worse than the start
      const c0 = await checkRound('как есть');
      bestScore = c0.score;
      best = { sets: { ...sets }, cps: c0.cps };
      let bestRound = 0;
      if (c0.ok) { rep.ok = true; rep.notes.push('уже в допуске — числа не тронуты'); }
      // the mobs first, on their own: the boss is then matched to a hero who grew among the final mobs
      let mobsMoved = false;
      for (let k = 0, ok = c0.mobsOk; k < 4 && !rep.ok && !ok; k++) { ok = tuneMobs(await toMinute(tAt)); mobsMoved ||= !ok; }
      // the boss: its threat (HP × damage — the hero has to outlast damage × a fight as long as the HP) sets the minute of
      // the kill, more → later; it is searched by the kills themselves: a step by the miss until a threat that killed
      // early and one that killed late bracket the target, then geometric bisection. The HP follows the fight length,
      // the damage is the threat over it. (A hero matched at the target minute and a 50% win rate then killed minutes
      // late — the bot loses some tries — and moving that minute moved both numbers by a noisy DPS: it never settled.)
      const hpPath = `MOBS.${boss}.hp`, dmgPath = `MOBS.${boss}.dmg`;
      const bossFixed = hpPath in fixed && dmgPath in fixed;
      let lo: number | null = null, hi: number | null = null;
      let last = c0;
      for (let it = 0; it < o.iters && !rep.ok; it++) {
        rep.iters = it + 1;
        const hp = getPath(hpPath), dmg = getPath(dmgPath), threat = hp * dmg;
        const far = !last.kills.length || last.at === undefined || Math.abs(last.at - tAt) > 0.3 * tAt;
        if (it === 0 && (far || mobsMoved) && !bossFixed) {
          // a first guess from scratch (the numbers are far off, or the mobs moved under them): the hero at the target
          // minute takes `fight` s at his damage per second, and wins half the time
          const atT = (await toMinute(tAt)).map((r) => r.cps.time).filter((c): c is Checkpoint => !!c);
          if (!atT.length) { rep.notes.push('бот не дожил до целевой минуты'); break; }
          const sim = { ...o.sim };
          const probeAll = () => atT.map((c) => probeBoss(c, boss, sim));
          const probes = probeAll();
          // the fight's HP as fielded (× ZONE_TIER, + the Spring sister of the same def) scales with the def's hp
          const dps = med(probes.map((p) => p.dps))!, total = probes[0].hp;
          set(hpPath, hp * clamp((dps * goal.fight) / total, 0.05, 20));
          if (!(dmgPath in fixed)) {
            let a = dmg / 16, b = dmg * 16;
            for (let k = 0; k < 9; k++) {
              const mid = Math.sqrt(a * b);
              set(dmgPath, mid);
              if (med(probeAll().map((p) => p.rate))! > 0.5) a = mid; else b = mid;
            }
            set(dmgPath, Math.sqrt(a * b));
          }
        } else if (!last.mobsOk && last.okAt) {
          // the minute is right: the mobs are matched once more, by the fights of that check (up to the kill — the hero
          // grew among them as he will); they move the minute, so the threat's bracket starts over
          tuneMobs(last.runs, ' по проверке', false);
          lo = hi = null;
        } else if (!bossFixed) {
          // the last check brackets the threat: killed early → too weak, late (or never) → too strong
          if (last.at !== undefined && last.at < tAt && !last.okAt) { lo = threat; if (hi !== null && hi <= lo) hi = null; }
          if ((last.at === undefined || last.at > tAt) && !last.okAt) { hi = threat; if (lo !== null && lo >= hi) lo = null; }
          const next = last.okAt ? threat
            : lo !== null && hi !== null ? Math.sqrt(lo * hi)
              : last.at === undefined ? threat * 0.5
                : threat * clamp((tAt / last.at) ** 1.5, 0.5, 2);
          // the fight's length follows the HP (the hero's DPS barely depends on it)
          const hpNext = last.fight !== undefined && !(hpPath in fixed) && Math.abs(last.fight - goal.fight) > T.tol * goal.fight
            ? hp * clamp(goal.fight / last.fight, 0.5, 2) ** 0.8 : hp;
          if (dmgPath in fixed) set(hpPath, next / dmg);
          else { set(hpPath, hpNext); set(dmgPath, next / getPath(hpPath)); }
        }
        const c = await checkRound(`круг ${it + 1} (HP ${getPath(hpPath)}, урон ${getPath(dmgPath)})`);
        last = c;
        const { okGacha, share, kills } = c;
        if (c.score < bestScore) { bestScore = c.score; best = { sets: { ...sets }, cps: c.cps }; bestRound = it + 1; }
        if (c.ok) { rep.ok = true; break; }
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
        // no kill in the kept round: the fallback below plays on to it
        cps = best.cps;
      }
      if (!rep.ok) rep.notes.push(bestRound ? `не сошлось за отведённые круги — взят лучший, круг ${bestRound}` : 'не сошлось, а круги вышли хуже исходных чисел — числа не тронуты');
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
  return { sets, was, fixed, reports };
}

