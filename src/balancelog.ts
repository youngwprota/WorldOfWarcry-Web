// Balance telemetry: every fight and a stat snapshot per minute of play, kept in localStorage
// so a playtest can be copied out of ⚙ → «Лог баланса» and compared with the paper model.

export interface FightRec {
  t: number; // play time at the end, s
  mob: string;
  boss: boolean;
  /** Old logs only: anti-kite variant (mechanic removed). */
  kite?: string;
  result: 'kill' | 'reset' | 'death';
  dur: number; // s from the first hit (either side)
  dealt: number;
  taken: number;
  hits: number; // hero swings that connected
  combos: number; // finishers that connected
  slams: number; // boss specials that went off
  slamHits: number; // ...of which hit the hero
  hpStart: number;
  hpEnd: number;
  maxHp: number;
  power: number;
}

export interface SnapRec {
  t: number;
  zone: string;
  power: number;
  maxHp: number;
  regen: number;
  kills: number;
  deaths: number;
  weapon: string;
  kite?: string;
  /** Paper TTK (s) of each boss with the current weapon, as the name colour sees it. */
  ttk: Record<string, number>;
}

export interface Log { fights: FightRec[]; snaps: SnapRec[]; deaths: number }

const KEY = 'warcry-balance-log';
const MAX_FIGHTS = 400;
let log: Log = load();

/** The stored log (the balance page reads it from the same origin). */
export function load(): Log {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '') as Log;
    if (Array.isArray(d.fights) && Array.isArray(d.snaps)) return d;
  } catch { /* empty or broken */ }
  return { fights: [], snaps: [], deaths: 0 };
}

function store() {
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* private mode */ }
}

export function logFight(f: FightRec) {
  log.fights.push(f);
  if (log.fights.length > MAX_FIGHTS) log.fights.splice(0, log.fights.length - MAX_FIGHTS);
  if (f.result === 'death') log.deaths++;
  store();
}

export function logSnap(s: SnapRec) {
  log.snaps.push(s);
  store();
}

export const heroDeaths = () => log.deaths;

export function clearLog() {
  log = { fights: [], snaps: [], deaths: 0 };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;

/** Plain-text report: per-minute curve, per-mob averages, every boss fight. */
export function report(): string {
  const out: string[] = ['== Минуты: время зона | сила HP реген | убийств смертей | оружие | TTK боссов'];
  for (const s of log.snaps) {
    const ttk = Object.entries(s.ttk).map(([k, v]) => `${k} ${Math.round(v)}с`).join(', ');
    out.push(`${mmss(s.t)} ${s.zone} | ${Math.round(s.power)} ${s.maxHp} ${s.regen.toFixed(2)} | ${s.kills} ${s.deaths} | ${s.weapon} | ${ttk}`);
  }
  out.push('', '== Мобы (кроме боссов): боёв | ср. длительность | ср. получено % HP | убито/сброс/смерть');
  const by = new Map<string, FightRec[]>();
  for (const f of log.fights) {
    if (f.boss) continue;
    const key = f.mob;
    by.set(key, [...(by.get(key) ?? []), f]);
  }
  for (const [mob, fs] of by) {
    const n = fs.length;
    const dur = fs.reduce((a, f) => a + f.dur, 0) / n;
    const taken = fs.reduce((a, f) => a + f.taken / f.maxHp, 0) / n;
    const c = (r: FightRec['result']) => fs.filter((f) => f.result === r).length;
    out.push(`${mob}: ${n} | ${dur.toFixed(1)}с | ${Math.round(taken * 100)}% | ${c('kill')}/${c('reset')}/${c('death')}`);
  }
  out.push('', '== Боссы: время | босс итог | длит. | нанесено получено | удары комбо | слэмы попало | HP героя | сила');
  for (const f of log.fights.filter((x) => x.boss)) {
    out.push(`${mmss(f.t)} | ${f.mob} ${f.result} | ${f.dur.toFixed(0)}с | ${f.dealt} ${f.taken} (${pct(f.taken, f.maxHp)}) | ${f.hits} ${f.combos} | ${f.slams} ${f.slamHits} | ${Math.round(f.hpStart)}→${Math.round(f.hpEnd)}/${f.maxHp} | ${Math.round(f.power)}`);
  }
  return out.join('\n');
}
