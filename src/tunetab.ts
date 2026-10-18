// balance.html → «Цели»: the tuner's targets (src/tunetargets.ts, kept in localStorage, JSON in/out), a tuning run in a
// worker (the whole src/tuner.ts there, its runs in nested workers), the table «цель / было / стало», charts and the
// picked numbers: as the page's what-if edits, or written into src/config.ts by the dev server (vite.config.ts).
import { MOBS, ZONES, type ZoneId } from './config';
import { DEFAULT_OPTS, type SimOpts } from './simcore';
import { CHAIN, type Metrics, type TuneOut } from './tuner';
import { DEFAULT_TARGETS, type FightRank, type TuneTargets } from './tunetargets';
import type { Job, JobMsg } from './balanceworker';

interface Series { label: string; color: string; pts: [number, number][]; dash?: boolean; faint?: boolean; dots?: boolean }
/** What the page lends this tab (no import back into balancepage.ts: it is the entry). */
export interface TuneCtx {
  esc: (s: unknown) => string;
  chart: (title: string, series: Series[], o: { xMax: number; yMax?: number; yFmt?: (v: number) => string; xLabel?: (x: number) => string }) => HTMLElement;
  runJob: (job: Job, onProgress?: (done: number, total: number) => void, onLog?: (line: string) => void) => Promise<Exclude<JobMsg, { kind: 'progress' | 'error' | 'log' }>>;
  /** The page's config edits (the tuner starts from them) and a way to add the picked numbers to them. */
  sets: () => [string, unknown][];
  addSets: (s: Record<string, number>) => void;
  opts: () => SimOpts;
}

const KEY = { targets: 'warcry-balance-targets', tune: 'warcry-balance-tune' };
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const RANKS: FightRank[] = ['normal', 'elite', 'mini'];
const RANK_NAME: Record<FightRank, string> = { normal: 'моб', elite: 'элитка', mini: 'мини' };
/** Column hints (title on hover, dotted underline). */
const HINT = {
  boss: 'Главный босс локации: его первое убийство открывает следующие локации',
  zone: 'Локация, чьи мобы и босс подбираются в этой строке',
  at: 'Минута первого убийства босса, считая от начала игры (не от входа в локацию)',
  fight: 'Сколько секунд длится победный бой с боссом: отсюда его HP',
  gacha: 'Какая доля общей мощи героя (урон в секунду × живучесть) приходится на гача-предметы в момент убийства босса. 0 — гача не нужна, 30 — треть силы из гачи',
  normal: 'Средняя длина боя с обычным мобом этой локации (пачка — один бой), с: отсюда HP мобов',
  elite: 'Средняя длина боя с элиткой этой локации, с',
  mini: 'Средняя длина боя с мини-боссом этой локации, с',
  pick: 'Подбирать числа этой локации. Снято — её числа не меняются, но бот всё равно проходит её по цепочке',
} as const;
const th = (label: string, hint: string, cls = '') => `<th class="${cls}" title="${hint}"><span class="hint">${label}</span></th>`;
const rankTh = (r: FightRank) => th(`${RANK_NAME[r]}, с`, HINT[r]);
const zoneName = (id: string) => ZONES.find((z) => z.id === id)?.name ?? id;
const $ = <T extends HTMLElement>(sel: string, root: ParentNode) => root.querySelector(sel) as T;

let targets: TuneTargets = store.get(KEY.targets, structuredClone(DEFAULT_TARGETS));
let run = store.get(KEY.tune, { runs: 8, iters: 6, zones: CHAIN.map((c) => c.zone) as ZoneId[] });
let result: { out: TuneOut; ms: number } | null = null;
let log: string[] = [];
let busy = false;

const saveTargets = () => store.set(KEY.targets, targets);

export function renderTune(root: HTMLElement, c: TuneCtx) {
  const { esc } = c;
  const num = (path: string, v: number | undefined, step: number) => `<input type="number" data-t="${path}" step="${step}" value="${v ?? ''}" style="width:80px">`;
  root.innerHTML = `
    <div class="panel">
      <p class="muted" style="margin:0 0 10px">Цели баланса: когда (минута от начала) и за сколько секунд падает каждый босс, какая доля мощи героя
        от гача-предметов в этот момент, сколько длятся бои с мобами по локациям. «Подобрать» гоняет бота по цепочке локаций и подбирает
        HP и урон мобов и боссов (ZONE_SCALE, MOBS) и шанс круток (GACHA.token), начиная с правок вкладки «Конфиг».</p>
      <div class="scroll" style="max-height:none">
        <table><tr>${th('босс', HINT.boss, 'l')}${th('локация', HINT.zone, 'l')}${th('минута', HINT.at)}${th('бой, с', HINT.fight)}${th('гача, %', HINT.gacha)}${RANKS.map(rankTh).join('')}${th('подбирать', HINT.pick)}</tr>
        ${CHAIN.map(({ zone, boss }) => { const b = targets.bosses[boss]; const f = targets.fights[zone] ?? {}; return `<tr>
          <td class="l">${esc(MOBS[boss].name)}</td><td class="l">${esc(zoneName(zone))}</td>
          <td>${num(`bosses.${boss}.at`, b?.at, 1)}</td><td>${num(`bosses.${boss}.fight`, b?.fight, 5)}</td><td>${num(`bosses.${boss}.gacha%`, b ? Math.round(b.gacha * 100) : undefined, 1)}</td>
          ${RANKS.map((r) => `<td>${num(`fights.${zone}.${r}`, f[r], 1)}</td>`).join('')}
          <td><input type="checkbox" data-z="${zone}" ${run.zones.includes(zone) ? 'checked' : ''}></td></tr>`; }).join('')}
        </table>
      </div>
      <div class="form" style="margin-top:12px">
        <label class="f" title="Допустимый промах: 0.1 = ±10% (доля гачи — ±10 пунктов)">Допуск<input type="number" id="tol" step="0.01" value="${targets.tol}"></label>
        <label class="f" title="Сколько прогонов бота (разные seed) на каждую проверку: больше — точнее, но дольше">Прогонов<input type="number" id="runs" step="1" value="${run.runs}"></label>
        <label class="f" title="Сколько кругов подбора на локацию максимум: круг = мобы → HP и урон босса → проверочный прогон. Сошлось раньше — дальше не крутит">Кругов<input type="number" id="iters" step="1" value="${run.iters}"></label>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="go" ${busy ? 'disabled' : ''}>Подобрать</button>
        <button class="btn" id="reset">Цели по умолчанию</button>
        <span class="muted" id="status">${busy ? 'идёт подбор…' : ''}</span>
      </div>
      <details><summary>JSON целей (экспорт / импорт, для npm run tune -- --targets file.json)</summary>
        <textarea id="json" rows="8">${esc(JSON.stringify(targets, null, 2))}</textarea>
        <div class="row" style="margin-top:6px"><button class="btn" id="import">Взять из JSON</button><span class="err" id="jerr"></span></div>
      </details>
    </div>
    <details ${log.length ? 'open' : ''}><summary>Ход подбора</summary><pre class="scroll mono" id="log" style="padding:8px;max-height:260px;margin:0">${esc(log.join('\n'))}</pre></details>
    <div id="tout"></div>`;

  root.querySelectorAll<HTMLInputElement>('[data-t]').forEach((el) => el.addEventListener('change', () => {
    const [group, id, key] = el.dataset.t!.split('.');
    const v = el.value === '' ? undefined : +el.value;
    if (group === 'bosses') {
      const b = (targets.bosses[id] ??= { at: 0, fight: 0, gacha: 0 });
      if (v !== undefined) (key === 'gacha%' ? (b.gacha = v / 100) : (b[key as 'at' | 'fight'] = v));
    } else {
      const f = (targets.fights[id as ZoneId] ??= {});
      if (v === undefined) delete f[key as FightRank]; else f[key as FightRank] = v;
    }
    saveTargets();
    $<HTMLTextAreaElement>('#json', root).value = JSON.stringify(targets, null, 2);
  }));
  root.querySelectorAll<HTMLInputElement>('[data-z]').forEach((el) => el.addEventListener('change', () => {
    const z = el.dataset.z as ZoneId;
    run.zones = el.checked ? [...new Set([...run.zones, z])] : run.zones.filter((x) => x !== z);
    store.set(KEY.tune, run);
  }));
  $('#tol', root).addEventListener('change', (e) => { targets.tol = +(e.target as HTMLInputElement).value; saveTargets(); });
  $('#runs', root).addEventListener('change', (e) => { run.runs = Math.max(1, +(e.target as HTMLInputElement).value); store.set(KEY.tune, run); });
  $('#iters', root).addEventListener('change', (e) => { run.iters = Math.max(1, +(e.target as HTMLInputElement).value); store.set(KEY.tune, run); });
  $('#reset', root).addEventListener('click', () => { targets = structuredClone(DEFAULT_TARGETS); saveTargets(); renderTune(root, c); });
  $('#import', root).addEventListener('click', () => {
    try {
      const t = JSON.parse($<HTMLTextAreaElement>('#json', root).value) as TuneTargets;
      if (typeof t.tol !== 'number' || !t.bosses || !t.fights) throw new Error('нужны поля tol, bosses, fights');
      targets = t; saveTargets(); renderTune(root, c);
    } catch (err) { $('#jerr', root).textContent = (err as Error).message; }
  });
  $('#go', root).addEventListener('click', () => void start(root, c));
  if (result) renderOut($('#tout', root), c);
}

async function start(root: HTMLElement, c: TuneCtx) {
  if (busy || !run.zones.length) return;
  busy = true;
  log = [];
  result = null;
  renderTune(root, c);
  const pre = $('#log', root), status = $('#status', root);
  ($('#log', root).parentElement as HTMLDetailsElement).open = true;
  const o = c.opts();
  const job: Job = {
    kind: 'tune', targets, runs: run.runs, iters: run.iters, zones: run.zones, sets: c.sets(),
    sim: { faction: o.faction, cls: o.cls, weapon: o.weapon, off: o.off, dodge: o.dodge, uptime: o.uptime, combo: o.combo, seed: o.seed ?? DEFAULT_OPTS.seed },
    threads: Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8)),
  };
  try {
    const m = await c.runJob(job, undefined, (line) => { log.push(line); pre.textContent = log.join('\n'); pre.scrollTop = pre.scrollHeight; status.textContent = line; });
    if (m.kind !== 'tune') throw new Error('не тот ответ воркера');
    result = { out: m.out, ms: m.ms };
    status.textContent = `готово за ${(m.ms / 60000).toFixed(1)} мин`;
  } catch (err) {
    status.textContent = 'ошибка';
    $('#tout', root).innerHTML = `<p class="err">${c.esc((err as Error).message)}</p>`;
  } finally {
    busy = false;
    ($('#go', root) as HTMLButtonElement).disabled = false;
  }
  if (result) renderOut($('#tout', root), c);
}

function renderOut(out: HTMLElement, c: TuneCtx) {
  const { esc } = c;
  const { reports, sets, was } = result!.out;
  const tol = targets.tol;
  /** A number against its goal: green within the tolerance, red outside. */
  const cell = (v: number | undefined, want: number | undefined, d = 0, rel = true) => {
    if (v === undefined) return '<td class="muted">—</td>';
    if (want === undefined) return `<td>${v.toFixed(d)}</td>`;
    const ok = rel ? Math.abs(v - want) <= tol * want : Math.abs(v - want) <= tol * 100;
    return `<td class="${ok ? 'ok' : 'no'}">${v.toFixed(d)}</td>`;
  };
  const row = (label: string, m: Metrics | undefined, zone: ZoneId, boss: string) => {
    const g = targets.bosses[boss], f = targets.fights[zone] ?? {};
    return `<tr><td class="l muted">${label}</td>${cell(m?.at, g.at, 1)}${cell(m?.fight, g.fight)}${cell(m?.gacha === undefined ? undefined : m.gacha * 100, g.gacha * 100, 0, false)}${RANKS.map((r) => cell(m?.fights[r], f[r])).join('')}</tr>`;
  };
  out.innerHTML = `
    <h2>Итог: цель / было / стало</h2>
    <div class="scroll" style="max-height:none"><table>
      <tr><th class="l"></th>${th('минута', HINT.at)}${th('бой, с', HINT.fight)}${th('гача, %', HINT.gacha)}${RANKS.map(rankTh).join('')}</tr>
      ${reports.map((r) => { const g = targets.bosses[r.boss], f = targets.fights[r.zone] ?? {}; return `
        <tr><th class="l" colspan="7" style="color:var(--fg)">${r.ok ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'} ${esc(MOBS[r.boss].name)} · ${esc(zoneName(r.zone))} · кругов ${r.iters}
          ${r.notes.map((n) => `<div class="muted" style="font-weight:400">${esc(n)}</div>`).join('')}</th></tr>
        <tr><td class="l muted">цель</td><td>${g.at}</td><td>${g.fight}</td><td>${Math.round(g.gacha * 100)}</td>${RANKS.map((rk) => `<td>${f[rk] ?? '—'}</td>`).join('')}</tr>
        ${row('было', r.before, r.zone, r.boss)}${row('стало', r.after, r.zone, r.boss)}`; }).join('')}
    </table></div>
    <div class="charts" id="tcharts" style="margin-top:12px"></div>
    <h2>Подобранные числа</h2>
    <div class="panel">
      <table><tr>${th('поле', 'Путь числа в src/config.ts: ZONE_SCALE.<локация>.hp/dmg.<ранг> — множитель HP/урона мобов ранга, .token — множитель шанса крутки, MOBS.<босс>.hp/dmg — числа босса', 'l')}${th('было', 'Значение в конфиге до подбора')}${th('стало', 'Подобранное значение')}</tr>
        ${Object.entries(sets).map(([p, v]) => `<tr><td class="l mono">${esc(p)}</td><td>${was[p]}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="apply" title="Добавить в правки вкладки «Конфиг» — «Сим» покажет их рядом с конфигом без правок">В правки страницы</button>
        ${import.meta.env.DEV ? '<button class="btn primary" id="write" title="Переписать блок // <tuned> в конце src/config.ts (только npm run dev)">Записать в config.ts</button>' : '<span class="muted">запись в config.ts — только из npm run dev</span>'}
        <span class="muted" id="wstatus"></span>
      </div>
    </div>`;
  // charts: by the boss's target minute, the target (a diagonal / the goal) against before and after
  const box = $('#tcharts', out);
  const xs = reports.map((r) => targets.bosses[r.boss].at);
  const xMax = Math.max(...xs) + 10;
  const pts = (f: (r: (typeof reports)[number]) => number | undefined) => reports.flatMap((r) => { const v = f(r); return v === undefined ? [] : [[targets.bosses[r.boss].at, v] as [number, number]]; });
  const three = (title: string, goal: (r: (typeof reports)[number]) => number, m: (x: Metrics | undefined) => number | undefined, yFmt?: (v: number) => string) =>
    box.append(c.chart(title, [
      { label: 'цель', color: '#ecebe6', pts: pts(goal), dash: true, dots: true },
      { label: 'было', color: '#a5a093', pts: pts((r) => m(r.before)), faint: true, dots: true },
      { label: 'стало', color: '#e0a050', pts: pts((r) => m(r.after)), dots: true },
    ], { xMax, yFmt, xLabel: (x) => `${x} мин` }));
  three('Минута убийства босса', (r) => targets.bosses[r.boss].at, (x) => x?.at);
  three('Бой с боссом, с', (r) => targets.bosses[r.boss].fight, (x) => x?.fight);
  three('Доля мощи от гачи', (r) => targets.bosses[r.boss].gacha, (x) => x?.gacha, (v) => `${Math.round(v * 100)}%`);
  three('Бой с мобом, с', (r) => targets.fights[r.zone]?.normal ?? 0, (x) => x?.fights.normal);

  $('#apply', out).addEventListener('click', () => { c.addSets(sets); $('#wstatus', out).textContent = 'добавлено в правки'; });
  $('#write', out)?.addEventListener('click', async () => {
    const st = $('#wstatus', out);
    try {
      const r = await fetch('/__tune-write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sets }) });
      if (!r.ok) throw new Error(await r.text());
      st.textContent = 'записано в src/config.ts — страница перезагрузится с новыми числами';
    } catch (err) { st.textContent = `ошибка: ${(err as Error).message}`; }
  });
}
