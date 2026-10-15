// Balance page (balance.html): runs the simulator (src/simcore.ts) in a worker and charts its curves, benches the weapons,
// edits config numbers as what-ifs (the CLI's --set) and reads the game's balance log (same origin: localStorage).
import * as CONFIG from './config';
import { FACTIONS, MOBS, WEAPONS, type FactionId } from './config';
import { BOSSES, DEFAULT_OPTS, pct, simMap, type BenchRow, type RunOut, type SimMap, type SimOpts, type SimSummary, type Snap } from './simcore';
import { renderMap } from './balancemap';
import { load as loadGameLog, type Log } from './balancelog';
import { CLASSES, CLASS_IDS, type HeroClass } from './party';
import type { Job, JobMsg } from './balanceworker';

// ---------- small helpers ----------
const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (t: number | undefined) => (t === undefined || !Number.isFinite(t) ? '—' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
const fmt = (v: number | undefined, d = 0) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const KEY = { sets: 'warcry-balance-sets', opts: 'warcry-balance-opts', tab: 'warcry-balance-tab', overlay: 'warcry-balance-overlay' };

const BOSS_COLOR: Record<string, string> = { bandit_chief: '#e06a5f', death: '#a888d6' };
const STAT_COLOR = { power: '#e0a050', maxHp: '#6fcf7f', regen: '#6f9be0', defense: '#a888d6', kills: '#ecebe6', pulls: '#e0c050' };
const mobName = (def: string) => MOBS[def]?.name ?? def;
const weaponName = (id: string) => (WEAPONS[id] ? `${WEAPONS[id].icon ?? ''} ${WEAPONS[id].name}`.trim() : id);

// ---------- state ----------
let sets: Record<string, number> = store.get(KEY.sets, {});
let opts: SimOpts = { ...DEFAULT_OPTS, ...store.get<Partial<SimOpts>>(KEY.opts, {}) };
let tab = store.get(KEY.tab, 'sim');
let overlay = store.get(KEY.overlay, true);
type SimOut = Extract<JobMsg, { kind: 'sim' }>;
let sim: { cur: SimOut; base?: SimOut; opts: SimOpts } | null = null;
let benchOut: { cur: BenchRow[]; base?: BenchRow[] } | null = null;
let gameLog: LogView | null = null;
/** The map with the shipped config, until a sim brings its own (with the config edits). */
let layout: SimMap | null = null;
let busy = false;

const setList = () => Object.entries(sets) as [string, unknown][];
const editCount = () => Object.keys(sets).length;

// ---------- worker ----------
function runJob(job: Job, onProgress?: (done: number, total: number) => void): Promise<Exclude<JobMsg, { kind: 'progress' | 'error' }>> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./balanceworker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<JobMsg>) => {
      const m = e.data;
      if (m.kind === 'progress') { onProgress?.(m.done, m.total); return; }
      w.terminate();
      if (m.kind === 'error') reject(new Error(m.message));
      else resolve(m);
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'ошибка воркера')); };
    w.postMessage(job);
  });
}

// ---------- tabs ----------
const TABS: [string, string][] = [['sim', 'Сим'], ['map', 'Карта'], ['bench', 'Стенд оружий'], ['config', 'Конфиг'], ['log', 'Лог из игры']];
function renderTabs() {
  const n = editCount();
  $('#tabs').innerHTML = TABS.map(([id, name]) =>
    `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${name}${id === 'config' && n ? `<span class="badge">${n}</span>` : ''}</button>`).join('');
}
$('#tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  tab = b.dataset.tab!;
  store.set(KEY.tab, tab);
  render();
});
function render() {
  renderTabs();
  const root = $('#root');
  if (tab === 'map') renderMap(root, sim?.cur.map ?? (layout ??= simMap()), sim?.cur.runs ?? null, sim?.opts.until ?? opts.until);
  else if (tab === 'bench') renderBench(root);
  else if (tab === 'config') renderConfig(root);
  else if (tab === 'log') renderLog(root);
  else renderSim(root);
}

// ---------- charts (inline SVG) ----------
interface Series { label: string; color: string; pts: [number, number][]; band?: [number, number, number][]; dash?: boolean; faint?: boolean }
interface ChartOpts { xMax: number; yMax?: number; yFmt?: (v: number) => string; marks?: { x: number; label: string; color: string }[]; xLabel?: (x: number) => string }
const W = 420, H = 190, ML = 42, MR = 10, MT = 10, MB = 22;
/** A round axis top: 4 grid steps, each 1 / 2 / 2.5 / 5 × 10ⁿ. */
function niceMax(v: number) {
  const step = v > 0 ? v / 4 : 0.25;
  const p = 10 ** Math.floor(Math.log10(step));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= step) return 4 * m * p;
  return 40 * p;
}
const axisNum = (v: number, d = 0) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(Math.max(d, v % 1 ? 2 : 0))}`);
function chart(title: string, series: Series[], o: ChartOpts): HTMLElement {
  const box = document.createElement('div');
  box.className = 'chart';
  const all = series.flatMap((s) => [...s.pts.map((p) => p[1]), ...(s.band ?? []).map((b) => b[2])]);
  const yMax = o.yMax ?? niceMax(Math.max(0, ...all) * 1.05);
  const X = (x: number) => ML + (x / Math.max(1e-9, o.xMax)) * (W - ML - MR);
  const Y = (y: number) => H - MB - (y / yMax) * (H - MT - MB);
  const yFmt = o.yFmt ?? ((v: number) => axisNum(v));
  const xLabel = o.xLabel ?? ((x: number) => `${x}`);
  const xStep = o.xMax > 40 ? 10 : o.xMax > 12 ? 5 : o.xMax > 4 ? 2 : 1;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    g += `<line x1="${ML}" x2="${W - MR}" y1="${Y(v)}" y2="${Y(v)}" stroke="#3a3833" stroke-width="1"/>`;
    g += `<text x="${ML - 6}" y="${Y(v) + 4}" fill="#a5a093" font-size="10" text-anchor="end">${esc(yFmt(v))}</text>`;
  }
  for (let x = 0; x <= o.xMax; x += xStep) g += `<text x="${X(x)}" y="${H - 6}" fill="#a5a093" font-size="10" text-anchor="middle">${esc(xLabel(x))}</text>`;
  for (const m of o.marks ?? []) {
    if (m.x > o.xMax) continue;
    g += `<line x1="${X(m.x)}" x2="${X(m.x)}" y1="${MT}" y2="${H - MB}" stroke="${m.color}" stroke-dasharray="3 3" stroke-width="1" opacity=".8"/>`;
    g += `<text x="${X(m.x) + 3}" y="${MT + 9}" fill="${m.color}" font-size="9">${esc(m.label)}</text>`;
  }
  for (const s of series) {
    if (s.band?.length) {
      const top = s.band.map(([x, , hi]) => `${X(x)},${Y(hi)}`);
      const bot = [...s.band].reverse().map(([x, lo]) => `${X(x)},${Y(lo)}`);
      g += `<polygon points="${[...top, ...bot].join(' ')}" fill="${s.color}" opacity="${s.faint ? 0.06 : 0.14}"/>`;
    }
    if (s.pts.length) {
      g += `<polyline points="${s.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.faint ? 1.5 : 2}"
        opacity="${s.faint ? 0.45 : 1}" ${s.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>`;
    }
  }
  g += `<line class="guide" x1="0" x2="0" y1="${MT}" y2="${H - MB}" stroke="#ecebe6" stroke-width="1" opacity="0"/>`;
  const legend = series.map((s) => `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color};color:${s.color};opacity:${s.faint ? 0.5 : 1}"></i>${esc(s.label)}</span>`).join('');
  box.innerHTML = `<h3>${esc(title)}</h3><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${g}</svg><div class="legend">${legend}</div>`;
  // hover: nearest x of every series
  const svg = $('svg', box) as unknown as SVGSVGElement;
  const guide = svg.querySelector('.guide') as SVGLineElement;
  const tip = $('#tip');
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const x = Math.max(0, Math.min(o.xMax, ((vx - ML) / (W - ML - MR)) * o.xMax));
    const rows: string[] = [];
    let gx = x;
    for (const s of series) {
      if (!s.pts.length) continue;
      let best = s.pts[0];
      for (const p of s.pts) if (Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
      if (s === series[0]) gx = best[0];
      rows.push(`<span style="color:${s.color}">●</span> ${esc(s.label)}: <b>${esc(yFmt(best[1]))}</b>`);
    }
    guide.setAttribute('x1', String(X(gx)));
    guide.setAttribute('x2', String(X(gx)));
    guide.setAttribute('opacity', '0.35');
    tip.innerHTML = `<div class="muted">${esc(xLabel(Math.round(gx * 10) / 10))}</div>${rows.join('<br>')}`;
    tip.style.display = 'block';
    const tx = e.clientX + 14 + tip.offsetWidth > innerWidth ? e.clientX - tip.offsetWidth - 14 : e.clientX + 14;
    tip.style.left = `${tx}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; guide.setAttribute('opacity', '0'); });
  return box;
}

// ---------- sim: per-minute aggregate over runs ----------
type StatKey = 'power' | 'maxHp' | 'regen' | 'defense' | 'kills' | 'pulls';
interface Agg { mins: number[]; med: Record<StatKey, number[]>; lo: Record<StatKey, number[]>; hi: Record<StatKey, number[]>; win: Record<string, number[]> }
const KEYS: StatKey[] = ['power', 'maxHp', 'regen', 'defense', 'kills', 'pulls'];
function aggregate(runs: Omit<RunOut, 'fights'>[], untilMin: number): Agg {
  const mins = Array.from({ length: Math.floor(untilMin) + 1 }, (_, i) => i);
  // the state at each minute mark: the last snapshot at or before it
  const at = runs.map((r) => {
    const snaps = [...r.snaps].sort((a, b) => a.t - b.t);
    let i = 0;
    let cur: Snap = snaps[0];
    return mins.map((m) => { while (i < snaps.length && snaps[i].t <= m * 60 + 1e-6) cur = snaps[i++]; return cur; });
  });
  const mk = () => Object.fromEntries(KEYS.map((k) => [k, [] as number[]])) as Record<StatKey, number[]>;
  const agg: Agg = { mins, med: mk(), lo: mk(), hi: mk(), win: Object.fromEntries(BOSSES.map((b) => [b.id, [] as number[]])) };
  mins.forEach((_, mi) => {
    const col = at.map((r) => r[mi]).filter(Boolean);
    for (const k of KEYS) {
      const v = col.map((s) => s[k]);
      agg.med[k].push(pct(v, 0.5) ?? 0);
      agg.lo[k].push(pct(v, 0.1) ?? 0);
      agg.hi[k].push(pct(v, 0.9) ?? 0);
    }
    for (const b of BOSSES) agg.win[b.id].push(col.length ? (100 * col.reduce((a, s) => a + (s.win[b.id] ?? 0), 0)) / col.length : 0);
  });
  return agg;
}

function renderSim(root: HTMLElement) {
  const fac = Object.keys(FACTIONS) as FactionId[];
  const mains = Object.keys(WEAPONS).filter((w) => !WEAPONS[w].guard && !WEAPONS[w].orb);
  const offs = Object.keys(WEAPONS).filter((w) => WEAPONS[w].guard || WEAPONS[w].orb);
  const n = editCount();
  const num = (k: keyof SimOpts, label: string, step: number, v: number, title = '') =>
    `<label class="f" title="${esc(title)}">${label}<input type="number" data-o="${k}" step="${step}" value="${v}"></label>`;
  root.innerHTML = `
    <div class="panel">
      <div class="form">
        <label class="f">Фракция<select data-o="faction">${fac.map((f) => `<option value="${f}" ${opts.faction === f ? 'selected' : ''}>${esc(FACTIONS[f].name)}</option>`).join('')}</select></label>
        <label class="f" title="Партия: бот отправляет на каждую цель лучший класс">Классы<select data-o="cls"><option value="party">партия (все три)</option>${CLASS_IDS.map((c) => `<option value="${c}" ${opts.cls === c ? 'selected' : ''}>${esc(CLASSES[c].name)}</option>`).join('')}</select></label>
        <label class="f" title="Стартовое оружие своего класса">Оружие<select data-o="weapon"><option value="">стартовые наборы</option>${mains.map((w) => `<option value="${w}" ${opts.weapon === w ? 'selected' : ''}>${esc(weaponName(w))}</option>`).join('')}</select></label>
        <label class="f" title="Щит воина или сфера мага на старте">Второй слот<select data-o="off"><option value="">из набора</option>${offs.map((w) => `<option value="${w}" ${opts.off === w ? 'selected' : ''}>${esc(weaponName(w))}</option>`).join('')}</select></label>
        ${num('runs', 'Прогонов', 1, opts.runs)}
        ${num('until', 'До минуты', 1, opts.until / 60)}
        ${num('dodge', 'Увороты слэмов', 0.05, opts.dodge, 'Доля увёрнутых спецударов босса')}
        ${num('uptime', 'Uptime', 0.05, opts.uptime, 'Доля боя, когда герой реально бьёт')}
        ${num('combo', 'Шанс комбо', 0.05, opts.combo, 'Шанс, что удар продолжает цепочку')}
        ${num('bossWin', 'Порог босса', 0.05, opts.bossWin, 'Бот идёт к боссу, если оценка победы не ниже')}
        ${num('seed', 'Seed', 1, opts.seed)}
        <label class="c"><input type="checkbox" data-o="keep" ${opts.keep ? 'checked' : ''}> не менять оружие</label>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="run" ${busy ? 'disabled' : ''}>Запустить</button>
        ${n ? `<label class="c"><input type="checkbox" id="cmp" checked> сравнить с конфигом без правок</label><span class="muted">правок конфига: ${n}</span>` : `<span class="muted">без правок конфига</span>`}
        <div class="bar"><i id="prog"></i></div><span id="status" class="muted"></span>
      </div>
    </div>
    <div id="out"></div>`;
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-o]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.o as keyof SimOpts;
    const o = opts as unknown as Record<string, unknown>;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') o[k] = el.checked;
    else if (el instanceof HTMLSelectElement) o[k] = el.value;
    else o[k] = k === 'until' ? +el.value * 60 : +el.value;
    store.set(KEY.opts, opts);
    if (k === 'faction') renderSim(root);
  }));
  $('#run', root).addEventListener('click', () => void startSim(root));
  if (sim) renderSimOut($('#out', root));
}

async function startSim(root: HTMLElement) {
  if (busy) return;
  busy = true;
  const cmp = editCount() > 0 && ($('#cmp', root) as HTMLInputElement | null)?.checked;
  const runBtn = $('#run', root) as HTMLButtonElement;
  runBtn.disabled = true;
  const status = $('#status', root), prog = $('#prog', root);
  const done = [0, 0];
  const total = opts.runs * (cmp ? 2 : 1);
  const tick = (i: number) => (d: number) => { done[i] = d; const s = done[0] + done[1]; prog.style.width = `${(100 * s) / total}%`; status.textContent = `${s}/${total}`; };
  const job = (withSets: boolean): Job => ({ kind: 'sim', opts: { ...opts }, sets: withSets ? setList() : [] });
  try {
    const [cur, base] = await Promise.all([runJob(job(true), tick(0)), cmp ? runJob(job(false), tick(1)) : Promise.resolve(undefined)]);
    sim = { cur: cur as SimOut, base: base as SimOut | undefined, opts: { ...opts } };
    status.textContent = `готово за ${((cur as SimOut).ms / 1000).toFixed(1)} с`;
    renderSimOut($('#out', root));
  } catch (err) {
    $('#out', root).innerHTML = `<p class="err">${esc((err as Error).message)}</p>`;
    status.textContent = 'ошибка';
  } finally {
    busy = false;
    runBtn.disabled = false;
  }
}

function bossCard(b: SimSummary['bosses'][number], runs: number, base?: SimSummary['bosses'][number]) {
  // the chief's target: he falls at the end of one forest cycle (≥ 80% of it spent), not before
  const cls = b.p50 === undefined ? 'no' : b.id !== 'bandit_chief' ? '' : (b.cycle ?? 0) >= 0.8 ? 'ok' : (b.cycle ?? 0) >= 0.65 ? 'meh' : 'no';
  let delta = '';
  if (base) {
    if (b.p50 !== undefined && base.p50 !== undefined) { const d = b.p50 - base.p50; delta = `<span class="delta muted">${d >= 0 ? '+' : '−'}${mmss(Math.abs(d))} к базе</span>`; }
    else delta = `<span class="delta muted">база ${mmss(base.p50)}</span>`;
  }
  return `<div class="card" style="--c:${BOSS_COLOR[b.id] ?? '#e0a050'}">
    <h3>${esc(b.name)}</h3>
    <div class="big ${cls}">${mmss(b.p50)}${delta}</div>
    <div class="sub">p10–p90: ${mmss(b.p10)} – ${mmss(b.p90)} · побеждён в ${b.won}/${runs}<br>
    бой ${fmt(b.dur)} с${b.cycle !== undefined ? ` · выбито цикла леса: <b style="color:var(--fg)">${Math.round(b.cycle * 100)}%</b>` : ''}</div></div>`;
}

function renderSimOut(out: HTMLElement) {
  if (!sim) return;
  const { cur, base } = sim;
  const s = cur.summary, bs = base?.summary;
  const untilMin = sim.opts.until / 60;
  const pd = (a?: number, b?: number) => (bs && a !== undefined && b !== undefined && a !== b ? ` <span class="muted">(${a - b > 0 ? '+' : ''}${a - b})</span>` : '');
  out.innerHTML = `
    <h2>Боссы и прогресс <span class="muted" style="font-weight:400;font-size:.8rem">${s.runs} прогонов · ${esc(FACTIONS[sim.opts.faction].name)}, ${sim.opts.cls === 'party' ? 'партия' : esc(CLASSES[sim.opts.cls].name)}${sim.opts.weapon ? ', ' + esc(weaponName(sim.opts.weapon)) : ''}${sim.opts.off ? ' + ' + esc(weaponName(sim.opts.off)) : ''}${base ? ' · бледные линии: без правок' : ''}</span></h2>
    <div class="cards">
      ${s.bosses.map((b) => bossCard(b, s.runs, bs?.bosses.find((x) => x.id === b.id))).join('')}
      <div class="card"><h3>Крутки (медиана)</h3>
        <div class="sub" style="font-size:.9rem;color:var(--fg)">10 мин: <b>${fmt(s.pulls[10])}</b>${pd(s.pulls[10], bs?.pulls[10])} ·
        20 мин: <b>${fmt(s.pulls[20])}</b>${pd(s.pulls[20], bs?.pulls[20])} · 30 мин: <b>${fmt(s.pulls[30])}</b>${pd(s.pulls[30], bs?.pulls[30])}</div>
        <div class="sub" style="margin-top:6px">смертей за прогон: <b style="color:var(--fg)">${fmt(s.deaths)}</b>${pd(s.deaths, bs?.deaths)}</div>
        <div class="sub" style="margin-top:6px">время в боях: ${(Object.entries(s.classShare) as [HeroClass, number][]).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${esc(CLASSES[c].name)} <b style="color:var(--fg)">${Math.round(v * 100)}%</b>`).join(' · ') || '—'}</div></div>
    </div>
    <h2>Кривые по минутам <span class="muted" style="font-weight:400;font-size:.8rem">медиана, полоса p10–p90${gameLog && overlay ? ' · пунктир: лог из игры' : ''}</span></h2>
    <div class="charts" id="charts"></div>
    <details><summary>Прогон 1 по минутам</summary><div class="scroll" id="run1"></div></details>
    <details open><summary>Мобы: бои в симе</summary><div class="scroll" id="mobs"></div></details>`;
  const agg = aggregate(cur.runs, untilMin), bagg = base ? aggregate(base.runs, untilMin) : null;
  const marks = s.bosses.filter((b) => b.p50 !== undefined).map((b) => ({ x: b.p50! / 60, label: b.name, color: BOSS_COLOR[b.id] ?? '#e0a050' }));
  const xLabel = (x: number) => `${x} мин`;
  const line = (a: Agg, k: StatKey) => a.mins.map((m, i) => [m, a.med[k][i]] as [number, number]);
  const band = (a: Agg, k: StatKey) => a.mins.map((m, i) => [m, a.lo[k][i], a.hi[k][i]] as [number, number, number]);
  const logSeries = (k: 'power' | 'maxHp' | 'regen' | 'kills'): Series[] =>
    gameLog && overlay && gameLog.snaps.length ? [{ label: 'игра', color: STAT_COLOR[k], dash: true, pts: gameLog.snaps.map((x) => [x.t / 60, x[k]] as [number, number]).filter(([x]) => x <= untilMin) }] : [];
  const statChart = (k: StatKey, title: string, d = 0) => chart(title, [
    ...(bagg ? [{ label: 'без правок', color: STAT_COLOR[k], faint: true, pts: line(bagg, k) }] : []),
    { label: base ? 'с правками' : 'сим', color: STAT_COLOR[k], pts: line(agg, k), band: band(agg, k) },
    ...(k === 'power' || k === 'maxHp' || k === 'regen' || k === 'kills' ? logSeries(k) : []),
  ], { xMax: untilMin, marks, xLabel, yFmt: (v) => axisNum(v, d) });
  const charts = $('#charts', out);
  charts.append(
    chart('Шанс победы над боссами, %', BOSSES.flatMap((b) => [
      ...(bagg ? [{ label: `${b.name} без правок`, color: BOSS_COLOR[b.id] ?? '#e0a050', faint: true, pts: bagg.mins.map((m, i) => [m, bagg.win[b.id][i]] as [number, number]) }] : []),
      { label: b.name, color: BOSS_COLOR[b.id] ?? '#e0a050', pts: agg.mins.map((m, i) => [m, agg.win[b.id][i]] as [number, number]) },
    ]), { xMax: untilMin, yMax: 100, marks, xLabel, yFmt: (v) => `${Math.round(v)}%` }),
    statChart('power', 'Урон (очки)'), statChart('maxHp', 'HP'), statChart('regen', 'Реген, HP/с', 1), statChart('defense', 'Защита'),
    statChart('kills', 'Убийств'), statChart('pulls', 'Круток'),
  );
  // run 1 table
  const r1 = cur.runs[0];
  $('#run1', out).innerHTML = r1 ? `<table><tr><th>время</th><th class="l">зона</th><th>урон</th><th>HP</th><th>реген</th><th>защ</th><th>убийств</th><th>смертей</th><th>круток</th><th class="l">оружие</th>${BOSSES.map((b) => `<th>${esc(b.name)}</th>`).join('')}</tr>
    ${r1.snaps.map((x) => `<tr><td>${mmss(x.t)}</td><td class="l">${x.zone}</td><td>${fmt(x.power)}</td><td>${x.maxHp}</td><td>${fmt(x.regen, 1)}</td><td>${fmt(x.defense)}</td><td>${x.kills}</td><td>${x.deaths}</td><td>${x.pulls}</td><td class="l mono">${esc(x.weapons)}</td>${BOSSES.map((b) => `<td>${Math.round((x.win[b.id] ?? 0) * 100)}%</td>`).join('')}</tr>`).join('')}</table>` : '';
  // mobs table
  $('#mobs', out).innerHTML = s.mobs.length ? `<table><tr><th class="l">моб</th><th>боёв</th><th>1-й бой: когда</th><th>ударов</th><th>с</th><th>урон % HP</th><th>все: ударов</th><th>с</th><th>урон % HP</th><th>поражений</th></tr>
    ${s.mobs.map((m) => { const [def, depth] = m.key.split('@'); const hot = (p: number) => (p >= 70 ? 'no' : p >= 50 ? 'meh' : ''); return `<tr><td class="l">${esc(mobName(def))}${depth ? ` <span class="muted">глуб. ${depth}</span>` : ''}</td><td>${m.n}</td><td>${mmss(m.first.t)}</td><td>${fmt(m.first.swings, 1)}</td><td>${fmt(m.first.dur, 1)}</td><td class="${hot(m.first.takenPct)}">${Math.round(m.first.takenPct)}%</td><td>${fmt(m.all.swings, 1)}</td><td>${fmt(m.all.dur, 1)}</td><td class="${hot(m.all.takenPct)}">${Math.round(m.all.takenPct)}%</td><td class="${m.losses ? 'no' : ''}">${m.losses}</td></tr>`; }).join('')}</table>`
    : '<div class="empty">Бот не провёл ни одного боя</div>';
}

// ---------- bench ----------
function renderBench(root: HTMLElement) {
  const n = editCount();
  root.innerHTML = `
    <div class="panel row">
      <button class="btn primary" id="bench" ${busy ? 'disabled' : ''}>Прогнать стенд</button>
      <span class="muted">Время убийства цели 4000 HP: редкое оружие ур. 1, урон 0, без резистов, uptime и комбо 100%. Лук — с вепрем, посохи — с горением и вихрем (заморозка урона по цели не меняет).
      ${n ? `Правок конфига: ${n} — серые засечки показывают базу.` : ''}</span>
      <span id="status" class="muted"></span>
    </div>
    <div id="out" style="margin-top:14px"></div>`;
  $('#bench', root).addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    ($('#bench', root) as HTMLButtonElement).disabled = true;
    $('#status', root).textContent = 'считаю…';
    try {
      const [cur, base] = await Promise.all([runJob({ kind: 'bench', sets: setList() }), n ? runJob({ kind: 'bench', sets: [] }) : Promise.resolve(undefined)]);
      benchOut = { cur: (cur as Extract<JobMsg, { kind: 'bench' }>).rows, base: (base as Extract<JobMsg, { kind: 'bench' }> | undefined)?.rows };
      $('#status', root).textContent = '';
      renderBenchOut($('#out', root));
    } catch (err) {
      $('#out', root).innerHTML = `<p class="err">${esc((err as Error).message)}</p>`;
    } finally {
      busy = false;
      ($('#bench', root) as HTMLButtonElement).disabled = false;
    }
  });
  if (benchOut) renderBenchOut($('#out', root));
}
function renderBenchOut(out: HTMLElement) {
  if (!benchOut) return;
  const rows = [...benchOut.cur].sort((a, b) => a.ttk - b.ttk);
  const max = Math.max(...rows.map((r) => r.ttk), ...(benchOut.base ?? []).map((r) => r.ttk));
  const best = rows[0]?.ttk ?? 1;
  const label = (l: string) => l.split('+').map(weaponName).join(' + ');
  const color = (l: string) => (l.includes('+orb') ? '#a888d6' : l.includes('+') ? '#6f9be0' : '#e0a050');
  out.innerHTML = `<div class="panel"><table>
    <tr><th class="l">связка</th><th class="l" style="width:55%"></th><th>с</th><th>к лучшему</th>${benchOut.base ? '<th>база</th>' : ''}</tr>
    ${rows.map((r) => {
      const b = benchOut!.base?.find((x) => x.label === r.label);
      const d = b ? r.ttk - b.ttk : 0;
      return `<tr><td class="l">${esc(label(r.label))}</td>
      <td class="l"><div style="position:relative;height:12px;background:var(--panel2);border-radius:3px">
        <div style="width:${(100 * r.ttk) / max}%;height:100%;background:${color(r.label)};border-radius:3px"></div>
        ${b ? `<div style="position:absolute;top:-2px;left:${(100 * b.ttk) / max}%;width:2px;height:16px;background:#a5a093"></div>` : ''}</div></td>
      <td>${r.ttk.toFixed(0)}</td><td class="${r.ttk / best > 1.25 ? 'no' : ''}">${r.ttk === best ? '—' : `+${Math.round((100 * r.ttk) / best - 100)}%`}</td>
      ${benchOut!.base ? `<td class="muted">${b ? `${b.ttk.toFixed(0)}${Math.abs(d) >= 0.5 ? ` (${d > 0 ? '+' : ''}${d.toFixed(0)})` : ''}` : '—'}</td>` : ''}</tr>`;
    }).join('')}</table>
    <div class="legend" style="margin-top:8px"><span><i style="background:#e0a050"></i>одно оружие</span><span><i style="background:#6f9be0"></i>меч + щит</span><span><i style="background:#a888d6"></i>посох + сфера</span><span class="muted">план: оружия отличаются не больше ±25% — красным, что медленнее лучшего больше чем на 25%</span></div></div>`;
}

// ---------- config editor ----------
const GROUPS = ['HERO', 'STAT_CURVE', 'RESIST_MULT', 'WEAPONS', 'COMBOS', 'MOBS', 'ORBS', 'BREAKABLES', 'GACHA', 'DEPTH', 'SHARPEN', 'ZONE_TIER', 'PETS'];
const SKIP = /^(color|css|tint|bolt|scale|model|icon|anim|swing|knock|arc|rangeAdd|range|shape)$/;
interface Leaf { path: string; def: number }
const LEAVES: Record<string, Leaf[]> = {};
for (const g of GROUPS) {
  const root = (CONFIG as unknown as Record<string, unknown>)[g];
  const out: Leaf[] = [];
  const walk = (o: unknown, path: string, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    for (const [k, v] of Object.entries(o)) {
      if (SKIP.test(k)) continue;
      const p = `${path}.${k}`;
      if (typeof v === 'number' && Number.isFinite(v)) out.push({ path: p, def: v });
      else if (v && typeof v === 'object') walk(v, p, depth + 1);
    }
  };
  walk(root, g, 0);
  if (out.length) LEAVES[g] = out;
}
const DEFAULTS = new Map(Object.values(LEAVES).flat().map((l) => [l.path, l.def]));
// drop stored edits the config no longer has
for (const p of Object.keys(sets)) if (!DEFAULTS.has(p)) delete sets[p];
let cfgGroup = store.get('warcry-balance-group', 'HERO');
let cfgQuery = '';

const setsCommand = () => (editCount() ? `npm run sim -- ${Object.entries(sets).map(([p, v]) => `--set ${p}=${v}`).join(' ')}` : '');
function saveSets() { store.set(KEY.sets, sets); renderTabs(); }

function renderConfig(root: HTMLElement) {
  if (!LEAVES[cfgGroup]) cfgGroup = Object.keys(LEAVES)[0];
  const count = (g: string) => LEAVES[g].filter((l) => l.path in sets).length;
  root.innerHTML = `
    <div class="cfg">
      <div class="groups" id="groups">${Object.keys(LEAVES).map((g) => `<button data-g="${g}" class="${g === cfgGroup && !cfgQuery ? 'on' : ''}"><span>${g}</span>${count(g) ? `<b>${count(g)}</b>` : ''}</button>`).join('')}</div>
      <div>
        <div class="panel" style="margin-bottom:12px">
          <div class="row"><input id="q" placeholder="Поиск по всем группам: hp, bandit_chief, token…" style="flex:1;min-width:200px" value="${esc(cfgQuery)}">
            <button class="btn" id="copy">Скопировать для CLI</button><button class="btn" id="reset">Сбросить все</button></div>
          <textarea id="cmd" rows="2" style="margin-top:8px" placeholder="Правок нет. Можно вставить сюда --set path=value … и нажать «Применить текст»">${esc(setsCommand())}</textarea>
          <div class="row" style="margin-top:6px"><button class="btn" id="import">Применить текст</button>
            <span class="muted" id="cfgmsg">Правки применяются к симу и стенду этой страницы как <code>--set</code>. Значения, которые игра читает при загрузке модуля, сим может не увидеть — как и в CLI.</span></div>
        </div>
        <div class="panel" id="leaves"></div>
      </div>
    </div>`;
  const leavesEl = $('#leaves', root);
  const drawLeaves = () => {
    const q = cfgQuery.trim().toLowerCase();
    const list = q ? Object.values(LEAVES).flat().filter((l) => l.path.toLowerCase().includes(q) || (l.path.split('.')[0] === 'MOBS' && mobName(l.path.split('.')[1]).toLowerCase().includes(q))) : LEAVES[cfgGroup];
    const shown = list.slice(0, 600);
    let lastHead = '';
    let html = '';
    for (const l of shown) {
      const parts = l.path.split('.');
      const head = parts.length > 2 ? parts.slice(0, 2).join('.') : parts[0];
      if (head !== lastHead) {
        lastHead = head;
        const nm = parts[0] === 'MOBS' ? mobName(parts[1]) : parts[0] === 'WEAPONS' || parts[0] === 'COMBOS' ? weaponName(parts[1]) : '';
        html += `<div class="sub-h">${esc(head)}${nm ? ` <span class="muted">${esc(nm)}</span>` : ''}</div>`;
      }
      const rel = parts.length > 2 ? parts.slice(2).join('.') : parts.slice(1).join('.');
      const mod = l.path in sets;
      html += `<div class="leaf ${mod ? 'mod' : ''}" data-p="${esc(l.path)}"><div class="p" title="${esc(l.path)}">${esc(rel)}</div>
        <input type="number" step="any" value="${mod ? sets[l.path] : l.def}"><div class="d">${mod ? `было ${l.def}` : ''}</div><button title="Вернуть">↺</button></div>`;
    }
    if (list.length > shown.length) html += `<div class="empty">ещё ${list.length - shown.length}… уточните поиск</div>`;
    leavesEl.innerHTML = html || '<div class="empty">Ничего не найдено</div>';
  };
  drawLeaves();
  const refreshMeta = () => {
    ($('#cmd', root) as HTMLTextAreaElement).value = setsCommand();
    root.querySelectorAll<HTMLButtonElement>('#groups button').forEach((b) => {
      const c = count(b.dataset.g!);
      b.innerHTML = `<span>${b.dataset.g}</span>${c ? `<b>${c}</b>` : ''}`;
    });
  };
  const setLeaf = (row: HTMLElement, v: number | null) => {
    const p = row.dataset.p!;
    const def = DEFAULTS.get(p)!;
    if (v === null || !Number.isFinite(v) || v === def) delete sets[p];
    else sets[p] = v;
    const mod = p in sets;
    row.classList.toggle('mod', mod);
    ($('input', row) as HTMLInputElement).value = String(mod ? sets[p] : def);
    $('.d', row).textContent = mod ? `было ${def}` : '';
    saveSets();
    refreshMeta();
  };
  leavesEl.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    const row = inp.closest<HTMLElement>('.leaf');
    if (row && inp.tagName === 'INPUT') setLeaf(row, inp.value === '' ? null : +inp.value);
  });
  leavesEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    const row = b?.closest<HTMLElement>('.leaf');
    if (row) setLeaf(row, null);
  });
  $('#groups', root).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    cfgGroup = b.dataset.g!;
    cfgQuery = '';
    store.set('warcry-balance-group', cfgGroup);
    renderConfig(root);
  });
  $('#q', root).addEventListener('input', (e) => {
    cfgQuery = (e.target as HTMLInputElement).value;
    root.querySelectorAll('#groups button').forEach((b) => b.classList.toggle('on', !cfgQuery && (b as HTMLElement).dataset.g === cfgGroup));
    drawLeaves();
  });
  $('#copy', root).addEventListener('click', () => {
    const t = setsCommand();
    if (!t) return;
    navigator.clipboard?.writeText(t).then(() => { $('#cfgmsg', root).textContent = 'Скопировано.'; }, () => { ($('#cmd', root) as HTMLTextAreaElement).select(); });
  });
  $('#reset', root).addEventListener('click', () => {
    if (!editCount() || !confirm(`Сбросить все правки (${editCount()})?`)) return;
    sets = {};
    saveSets();
    renderConfig(root);
  });
  $('#import', root).addEventListener('click', () => {
    const text = ($('#cmd', root) as HTMLTextAreaElement).value;
    const found = [...text.matchAll(/--set\s+([\w.]+)=(\S+)/g)];
    const bad: string[] = [];
    const next: Record<string, number> = {};
    for (const [, p, raw] of found) {
      const v = Number(raw);
      if (!DEFAULTS.has(p) || !Number.isFinite(v)) bad.push(p);
      else if (v !== DEFAULTS.get(p)) next[p] = v;
    }
    sets = next;
    saveSets();
    renderConfig(root);
    $('#cfgmsg', root).innerHTML = bad.length ? `<span class="no">Пропущено (нет такого числового поля): ${esc(bad.join(', '))}</span>` : `Применено правок: ${editCount()}.`;
  });
}

// ---------- game balance log ----------
interface LogSnap { t: number; zone: string; power: number; maxHp: number; regen: number; kills: number; deaths: number; weapon: string; ttk: Record<string, number> }
interface LogMob { mob: string; n: number; dur: number; takenPct: number; kill: number; reset: number; death: number }
interface LogBoss { t: number; mob: string; result: string; dur: number; dealt: number; taken: number; maxHp: number; hits: number; combos: number; slams: number; slamHits: number; hpStart: number; hpEnd: number; power: number }
interface LogView { snaps: LogSnap[]; mobs: LogMob[]; bosses: LogBoss[]; source: string }

function fromJson(log: Log, source: string): LogView {
  const by = new Map<string, Log['fights']>();
  for (const f of log.fights) if (!f.boss) by.set(f.mob, [...(by.get(f.mob) ?? []), f]);
  const mobs = [...by].map(([mob, fs]): LogMob => ({
    mob, n: fs.length, dur: fs.reduce((a, f) => a + f.dur, 0) / fs.length, takenPct: (100 * fs.reduce((a, f) => a + f.taken / f.maxHp, 0)) / fs.length,
    kill: fs.filter((f) => f.result === 'kill').length, reset: fs.filter((f) => f.result === 'reset').length, death: fs.filter((f) => f.result === 'death').length,
  }));
  return { snaps: log.snaps.map((s) => ({ ...s, ttk: s.ttk ?? {} })), mobs, bosses: log.fights.filter((f) => f.boss), source };
}
/** The text report ⚙ → «Лог баланса» copies (balancelog.report). */
function fromText(text: string): LogView {
  const v: LogView = { snaps: [], mobs: [], bosses: [], source: 'вставленный отчёт' };
  const sec = (l: string) => (l.startsWith('== Минуты') ? 'snaps' : l.startsWith('== Мобы') ? 'mobs' : l.startsWith('== Боссы') ? 'bosses' : null);
  let mode: string | null = null;
  const t = (m: string, s: string) => +m * 60 + +s;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    const s = sec(l);
    if (s) { mode = s; continue; }
    let m: RegExpMatchArray | null;
    if (mode === 'snaps' && (m = l.match(/^(\d+):(\d\d) (\S+) \| ([\d.]+) (\d+) ([\d.]+) \| (\d+) (\d+) \| (.*?) \| ?(.*)$/))) {
      const ttk: Record<string, number> = {};
      for (const p of m[10].split(', ')) { const q = p.match(/^(\S+) (\d+)с$/); if (q) ttk[q[1]] = +q[2]; }
      v.snaps.push({ t: t(m[1], m[2]), zone: m[3], power: +m[4], maxHp: +m[5], regen: +m[6], kills: +m[7], deaths: +m[8], weapon: m[9], ttk });
    } else if (mode === 'mobs' && (m = l.match(/^(\S+): (\d+) \| ([\d.]+)с \| (\d+)% \| (\d+)\/(\d+)\/(\d+)$/))) {
      v.mobs.push({ mob: m[1], n: +m[2], dur: +m[3], takenPct: +m[4], kill: +m[5], reset: +m[6], death: +m[7] });
    } else if (mode === 'bosses' && (m = l.match(/^(\d+):(\d\d) \| (\S+) (\S+) \| (\d+)с \| (\d+) (\d+) \(\d+%\) \| (\d+) (\d+) \| (\d+) (\d+) \| (\d+)→(\d+)\/(\d+) \| (\d+)$/))) {
      v.bosses.push({ t: t(m[1], m[2]), mob: m[3], result: m[4], dur: +m[5], dealt: +m[6], taken: +m[7], hits: +m[8], combos: +m[9], slams: +m[10], slamHits: +m[11], hpStart: +m[12], hpEnd: +m[13], maxHp: +m[14], power: +m[15] });
    }
  }
  return v;
}
function readGame() {
  const log = loadGameLog();
  gameLog = log.snaps.length || log.fights.length ? fromJson(log, 'игра в этом браузере') : null;
}

function renderLog(root: HTMLElement) {
  root.innerHTML = `
    <div class="panel">
      <div class="row"><button class="btn primary" id="game">Загрузить из игры</button>
        <label class="c"><input type="checkbox" id="ov" ${overlay ? 'checked' : ''}> показывать на графиках сима</label>
        <span class="muted" id="src">${gameLog ? `Источник: ${esc(gameLog.source)}` : 'Лог не загружен'}</span></div>
      <details><summary>Вставить отчёт или JSON</summary>
        <textarea id="paste" rows="6" placeholder="Текст из ⚙ → «Лог баланса» → Копировать, или JSON из localStorage (warcry-balance-log)"></textarea>
        <div class="row" style="margin-top:6px"><button class="btn" id="parse">Разобрать</button><span id="pmsg" class="muted"></span></div></details>
    </div>
    <div id="out"></div>`;
  $('#game', root).addEventListener('click', () => {
    readGame();
    if (!gameLog) $('#src', root).textContent = 'В этом браузере лог пуст: сыграйте в игру (index.html) на этом же адресе.';
    else renderLog(root);
  });
  $('#ov', root).addEventListener('change', (e) => { overlay = (e.target as HTMLInputElement).checked; store.set(KEY.overlay, overlay); });
  $('#parse', root).addEventListener('click', () => {
    const text = ($('#paste', root) as HTMLTextAreaElement).value.trim();
    let v: LogView | null = null;
    try { const j = JSON.parse(text) as Log; if (Array.isArray(j.snaps) && Array.isArray(j.fights)) v = fromJson(j, 'вставленный JSON'); } catch { v = fromText(text); }
    if (!v || (!v.snaps.length && !v.mobs.length && !v.bosses.length)) { $('#pmsg', root).innerHTML = '<span class="no">Не нашёл ни минут, ни боёв — это точно лог баланса?</span>'; return; }
    gameLog = v;
    renderLog(root);
  });
  if (!gameLog) { $('#out', root).innerHTML = '<div class="empty">Нажмите «Загрузить из игры» или вставьте отчёт.</div>'; return; }
  const L = gameLog;
  const last = L.snaps[L.snaps.length - 1];
  const out = $('#out', root);
  out.innerHTML = `
    <h2>Сводка</h2>
    <div class="cards">
      <div class="card"><h3>Время игры</h3><div class="big">${mmss(last?.t)}</div><div class="sub">снимков: ${L.snaps.length}</div></div>
      <div class="card"><h3>Убийств / смертей</h3><div class="big">${last?.kills ?? '—'} / ${last?.deaths ?? '—'}</div><div class="sub">боёв с мобами: ${L.mobs.reduce((a, m) => a + m.n, 0)}</div></div>
      ${BOSSES.map((b) => { const k = L.bosses.find((f) => f.mob === b.id && f.result === 'kill'); const tries = L.bosses.filter((f) => f.mob === b.id).length;
        return `<div class="card" style="--c:${BOSS_COLOR[b.id] ?? '#e0a050'}"><h3>${esc(b.name)}</h3><div class="big ${k ? 'ok' : ''}">${k ? mmss(k.t) : '—'}</div>
        <div class="sub">попыток: ${tries}${sim ? ` · в симе ${mmss(sim.cur.summary.bosses.find((x) => x.id === b.id)?.p50)}` : ''}</div></div>`; }).join('')}
    </div>
    <h2>Кривые <span class="muted" style="font-weight:400;font-size:.8rem">${sim ? 'пунктир: медиана сима' : 'запустите сим, чтобы сравнить'}</span></h2>
    <div class="charts" id="charts"></div>
    <h2>Мобы</h2><div class="scroll" id="mobs"></div>
    <h2>Бои с боссами</h2><div class="scroll" id="bosses"></div>`;
  const xMax = Math.max(1, Math.ceil((last?.t ?? 60) / 60));
  const agg = sim ? aggregate(sim.cur.runs, sim.opts.until / 60) : null;
  const simLine = (k: StatKey): Series[] => (agg ? [{ label: 'сим', color: STAT_COLOR[k], dash: true, pts: agg.mins.filter((m) => m <= xMax).map((m) => [m, agg.med[k][m]] as [number, number]) }] : []);
  const gl = (k: 'power' | 'maxHp' | 'regen' | 'kills', title: string, d = 0) => chart(title, [
    { label: 'игра', color: STAT_COLOR[k], pts: L.snaps.map((s) => [s.t / 60, s[k]] as [number, number]) }, ...simLine(k),
  ], { xMax, xLabel: (x) => `${x} мин`, yFmt: (v) => axisNum(v, d) });
  const ttkIds = [...new Set(L.snaps.flatMap((s) => Object.keys(s.ttk)))];
  $('#charts', out).append(gl('power', 'Урон (очки)'), gl('maxHp', 'HP'), gl('regen', 'Реген, HP/с', 1), gl('kills', 'Убийств'));
  if (ttkIds.length) {
    $('#charts', out).append(chart('Бумажный TTK боссов, с', ttkIds.map((id) => ({
      label: mobName(id), color: BOSS_COLOR[id] ?? '#e0a050', pts: L.snaps.filter((s) => s.ttk[id] !== undefined).map((s) => [s.t / 60, s.ttk[id]] as [number, number]),
    })), { xMax, xLabel: (x) => `${x} мин` }));
  }
  $('#mobs', out).innerHTML = L.mobs.length ? `<table><tr><th class="l">моб</th><th>боёв</th><th>ср. длит., с</th><th>ср. урон % HP</th><th>убит</th><th>сброс</th><th>смерть</th></tr>
    ${L.mobs.map((m) => `<tr><td class="l">${esc(mobName(m.mob))}</td><td>${m.n}</td><td>${m.dur.toFixed(1)}</td><td class="${m.takenPct >= 70 ? 'no' : m.takenPct >= 50 ? 'meh' : ''}">${Math.round(m.takenPct)}%</td><td>${m.kill}</td><td>${m.reset}</td><td class="${m.death ? 'no' : ''}">${m.death}</td></tr>`).join('')}</table>` : '<div class="empty">Нет боёв</div>';
  $('#bosses', out).innerHTML = L.bosses.length ? `<table><tr><th>время</th><th class="l">босс</th><th class="l">итог</th><th>длит., с</th><th>нанесено</th><th>получено</th><th>ударов</th><th>комбо</th><th>слэмы</th><th>попало</th><th>HP героя</th><th>урон</th></tr>
    ${L.bosses.map((f) => `<tr><td>${mmss(f.t)}</td><td class="l">${esc(mobName(f.mob))}</td><td class="l ${f.result === 'kill' ? 'ok' : f.result === 'death' ? 'no' : 'meh'}">${f.result}</td><td>${f.dur.toFixed(0)}</td><td>${Math.round(f.dealt)}</td><td>${Math.round(f.taken)} <span class="muted">(${Math.round((100 * f.taken) / Math.max(1, f.maxHp))}%)</span></td><td>${f.hits}</td><td>${f.combos}</td><td>${f.slams}</td><td>${f.slamHits}</td><td>${Math.round(f.hpStart)}→${Math.round(f.hpEnd)}/${f.maxHp}</td><td>${Math.round(f.power)}</td></tr>`).join('')}</table>` : '<div class="empty">Боёв с боссами нет</div>';
}

// ---------- boot ----------
readGame();
saveSets();
render();
