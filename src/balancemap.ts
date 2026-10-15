// The sim's map on the balance page (balance.html): every spawner with what it gives for a kill, and the bot's way
// through one run, played back on a timeline with the list of whom it fought.
import { MOBS, ORBS, ZONES, type OrbKind } from './config';
import { PATH_W, walkable, zoneIdAt } from './island';
import { CLASSES } from './party';
import type { BotEvent, MapUnit, RunOut, SimMap } from './simcore';

type Run = Omit<RunOut, 'fights'>;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const PROP_NAME: Record<string, string> = {
  barrel: 'Бочка', orc_barrel: 'Бочка', box: 'Ящик', orc_box: 'Ящик', box_large: 'Большой ящик', bush: 'Куст', coffin: 'Гроб',
  tomb1: 'Надгробие', tomb2: 'Надгробие', tomb3: 'Надгробие', tomb4: 'Надгробие', fort_tower_orc: 'Башня форта', fort_tower_human: 'Башня форта',
};
const RANK_R: Record<string, number> = { prop: 2.6, normal: 4, elite: 6, mini: 8, boss: 10 };
const RANK_NAME: Record<string, string> = { prop: 'разрушаемый', normal: 'обычный', elite: 'элитный', mini: 'мини-босс', boss: 'босс' };
const RES_NAME: Record<BotEvent['res'], string> = { kill: 'убит', death: 'смерть героя', break: 'разбит', rest: 'отдых' };
const unitName = (u: MapUnit) => (u.kind === 'prop' ? PROP_NAME[u.def] ?? u.def : u.name);
const defName = (def: string) => (def === 'camp' ? 'Лагерь' : MOBS[def]?.name ?? PROP_NAME[def] ?? def);
const mainOrb = (r: Partial<Record<OrbKind, number>>) => (Object.keys(r)[0] as OrbKind | undefined) ?? 'hp';
const fmtGain = (r?: Partial<Record<OrbKind, number>>, direct = false) =>
  Object.entries(r ?? {}).map(([k, n]) => `<span style="color:${ORBS[k as OrbKind].css}">+${Math.round((direct ? 1 : ORBS[k as OrbKind].value) * n!)} ${ORBS[k as OrbKind].label}</span>`).join(' ');
const fmtCd = (s: number) => (!Number.isFinite(s) ? 'никогда' : s >= 3600 ? `${+(s / 3600).toFixed(1)} ч` : s >= 60 ? `${+(s / 60).toFixed(1)} мин` : `${s} с`);

// ---------- view state (kept across re-renders and reloads) ----------
const ui = {
  run: 0, t: 0, path: store.get('warcry-balance-map-path', true), props: store.get('warcry-balance-map-props', true),
  speed: store.get('warcry-balance-map-speed', 60), playing: false, focus: null as string | null,
};
let raf = 0;
let bgCache: { key: string; img: HTMLCanvasElement } | null = null;

/** Draws into `root`; `runs` / `until` from the last sim (null: the layout only). */
export function renderMap(root: HTMLElement, map: SimMap, runs: Run[] | null, until: number) {
  cancelAnimationFrame(raf);
  ui.playing = false;
  if (runs && ui.run >= runs.length) ui.run = 0;
  const run = runs?.[ui.run] ?? null;
  const end = run ? Math.max(until, ...run.events.map((e) => e.t + e.dur)) : until;
  ui.t = Math.min(ui.t || end, end);
  const byId = new Map(map.units.map((u) => [u.id, u]));
  const orbs = (Object.keys(ORBS) as OrbKind[]);
  root.innerHTML = `
    <div class="mapwrap">
      <div class="mapbox"><canvas id="mapc"></canvas></div>
      <aside class="mapside">
        <div class="panel">
          ${runs ? `<div class="row">
            <label class="f" style="flex:1">Прогон<select id="mrun">${runs.map((_, i) => `<option value="${i}" ${i === ui.run ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
            <label class="c"><input type="checkbox" id="mpath" ${ui.path ? 'checked' : ''}> путь бота</label></div>
          <div class="row" style="margin-top:8px"><button class="btn" id="mplay">▶</button>
            <input type="range" id="mt" min="0" max="${Math.ceil(end)}" step="1" value="${Math.round(ui.t)}" style="flex:1">
            <span class="mono" id="mtl" style="min-width:42px;text-align:right">${mmss(ui.t)}</span></div>
          <div class="row" style="margin-top:6px"><label class="c">скорость<select id="mspeed">${[10, 30, 60, 120, 300].map((s) => `<option value="${s}" ${s === ui.speed ? 'selected' : ''}>×${s}</option>`).join('')}</select></label>
            <label class="c"><input type="checkbox" id="mprops" ${ui.props ? 'checked' : ''}> разрушаемые</label></div>`
          : `<p class="muted" style="margin:0">Запустите сим на вкладке «Сим», чтобы посмотреть путь бота. Сейчас показаны спавны с текущим конфигом.</p>
             <label class="c" style="margin-top:8px"><input type="checkbox" id="mprops" ${ui.props ? 'checked' : ''}> разрушаемые</label>`}
          <div class="legend" style="margin-top:10px">${orbs.map((k) => `<span><i style="background:${ORBS[k].css};height:8px;width:8px;border-radius:50%"></i>${ORBS[k].label}</span>`).join('')}</div>
          <div class="legend">кружок: моб (больше — сильнее ранг) · квадрат: разрушаемый · пунктир: место примерное · цвет: что выпадает</div>
        </div>
        <div class="panel" id="mstat" style="margin-top:10px"></div>
        <div class="scroll" id="mev" style="margin-top:10px;max-height:62vh"></div>
      </aside>
    </div>`;

  const canvas = root.querySelector<HTMLCanvasElement>('#mapc')!;
  const g = canvas.getContext('2d')!;
  // bounds: everything on the map, 12 m around
  const xs = [...map.units.map((u) => u.x), ...map.trail.map((p) => p[0])];
  const zs = [...map.units.map((u) => u.z), ...map.trail.map((p) => p[1])];
  const box = { x0: Math.min(...xs) - 12, x1: Math.max(...xs) + 12, z0: Math.min(...zs) - 12, z1: Math.max(...zs) + 12 };
  let W = 0, H = 0, k = 1;
  const X = (x: number) => (x - box.x0) * k;
  const Z = (z: number) => (z - box.z0) * k;
  const size = () => {
    const w = canvas.parentElement!.clientWidth;
    const ratio = (box.z1 - box.z0) / (box.x1 - box.x0);
    W = w;
    H = Math.min(w * ratio, innerHeight * 0.78);
    k = Math.min(W / (box.x1 - box.x0), H / (box.z1 - box.z0));
    W = (box.x1 - box.x0) * k;
    H = (box.z1 - box.z0) * k;
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  /** The ground: zones in their colours (dimmed), off-island dark — sampled once per layout. */
  const background = () => {
    const key = `${box.x0},${box.z0},${box.x1},${box.z1}`;
    if (bgCache?.key === key) return bgCache.img;
    const step = 0.8; // m per pixel
    const w = Math.ceil((box.x1 - box.x0) / step), h = Math.ceil((box.z1 - box.z0) / step);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(w, h);
    const col = new Map(ZONES.map((zd) => [zd.id, zd.ground]));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = box.x0 + (i + 0.5) * step, z = box.z0 + (j + 0.5) * step;
      const o = (j * w + i) * 4;
      if (!walkable(x, z)) { img.data[o] = 22; img.data[o + 1] = 30; img.data[o + 2] = 38; img.data[o + 3] = 255; continue; }
      const n = col.get(zoneIdAt(x, z)) ?? 0x444444;
      // dimmed so the dots stand out
      img.data[o] = ((n >> 16) & 255) * 0.42 + 14;
      img.data[o + 1] = ((n >> 8) & 255) * 0.42 + 14;
      img.data[o + 2] = (n & 255) * 0.42 + 14;
      img.data[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    bgCache = { key, img: c };
    return c;
  };

  // ---------- the run up to time t ----------
  const evs = run?.events ?? [];
  const pathAtT = (t: number) => {
    const p = run!.path;
    if (!p.length) return null;
    let lo = 0, hi = p.length - 1;
    if (t <= p[0][0]) return { i: 0, x: p[0][1], z: p[0][2] };
    if (t >= p[hi][0]) return { i: hi, x: p[hi][1], z: p[hi][2] };
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m][0] <= t) lo = m; else hi = m; }
    const a = p[lo], b = p[hi];
    const f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
    return { i: lo, x: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f };
  };
  const killsTo = (t: number) => {
    const n = new Map<string, number>();
    for (const e of evs) if ((e.res === 'kill' || e.res === 'break') && e.t + e.dur <= t) n.set(e.unit, (n.get(e.unit) ?? 0) + 1);
    return n;
  };

  const draw = () => {
    g.clearRect(0, 0, W, H);
    g.drawImage(background(), 0, 0, W, H);
    // trail
    g.strokeStyle = '#cfae80';
    g.globalAlpha = 0.75;
    g.lineWidth = Math.max(2, PATH_W * 2 * k);
    g.lineJoin = 'round';
    g.beginPath();
    map.trail.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.stroke();
    g.globalAlpha = 1;
    const showRun = !!run && ui.path;
    const kills = showRun ? killsTo(ui.t) : null;
    // units
    for (const u of map.units) {
      if (u.kind === 'prop' && !ui.props) continue;
      const r = RANK_R[u.rank] ?? 4;
      const done = kills?.get(u.id) ?? 0;
      g.globalAlpha = showRun && !done ? 0.4 : 1;
      if (ui.focus && ui.focus !== u.id) g.globalAlpha *= 0.5;
      g.fillStyle = ORBS[mainOrb(u.reward)].css;
      g.strokeStyle = u.rank === 'boss' ? '#fff' : '#111';
      g.lineWidth = u.rank === 'boss' ? 2 : 1;
      g.setLineDash(u.approx ? [2, 2] : []);
      g.beginPath();
      if (u.kind === 'prop') g.rect(X(u.x) - r, Z(u.z) - r, r * 2, r * 2);
      else g.arc(X(u.x), Z(u.z), r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.setLineDash([]);
      if (done) {
        g.globalAlpha = 1;
        g.font = 'bold 10px system-ui';
        g.fillStyle = '#fff';
        g.strokeStyle = '#000';
        g.lineWidth = 3;
        g.strokeText(String(done), X(u.x) + r + 1, Z(u.z) - r + 2);
        g.fillText(String(done), X(u.x) + r + 1, Z(u.z) - r + 2);
      }
    }
    g.globalAlpha = 1;
    // landmarks
    g.font = '600 11px system-ui';
    for (const m of map.marks) {
      g.fillStyle = '#ecebe6';
      g.beginPath();
      g.moveTo(X(m.x), Z(m.z) - 5); g.lineTo(X(m.x) + 5, Z(m.z)); g.lineTo(X(m.x), Z(m.z) + 5); g.lineTo(X(m.x) - 5, Z(m.z));
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 3;
      g.strokeText(m.label, X(m.x) + 8, Z(m.z) + 4);
      g.fillText(m.label, X(m.x) + 8, Z(m.z) + 4);
    }
    // the bot's way: the last minutes bright, older ones faint
    if (showRun) {
      const p = run!.path;
      const cur = pathAtT(ui.t);
      if (cur) {
        g.lineWidth = 2;
        for (let i = 1; i <= cur.i; i++) {
          const age = ui.t - p[i][0];
          g.strokeStyle = `rgba(255,255,255,${Math.max(0.12, 0.9 - age / 300)})`;
          g.beginPath();
          g.moveTo(X(p[i - 1][1]), Z(p[i - 1][2]));
          g.lineTo(X(p[i][1]), Z(p[i][2]));
          g.stroke();
        }
        g.strokeStyle = 'rgba(255,255,255,.9)';
        g.beginPath();
        g.moveTo(X(p[cur.i][1]), Z(p[cur.i][2]));
        g.lineTo(X(cur.x), Z(cur.z));
        g.stroke();
        const now = evs.find((e) => e.t <= ui.t && ui.t < e.t + e.dur);
        g.fillStyle = now?.res === 'death' ? '#e06a5f' : now && now.res !== 'rest' ? '#e0a050' : '#fff';
        g.strokeStyle = '#000';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(X(cur.x), Z(cur.z), 6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
  };

  // ---------- side panel: totals and the list ----------
  const statEl = root.querySelector<HTMLElement>('#mstat')!;
  const evEl = root.querySelector<HTMLElement>('#mev')!;
  const drawSide = () => {
    if (!run) {
      const byOrb: Partial<Record<OrbKind, number>> = {};
      for (const u of map.units) if (u.kind === 'mob') byOrb[mainOrb(u.reward)] = (byOrb[mainOrb(u.reward)] ?? 0) + 1;
      statEl.innerHTML = `<h3>На карте</h3><div class="sub">мобов: ${map.units.filter((u) => u.kind === 'mob').length}, разрушаемых: ${map.units.filter((u) => u.kind === 'prop').length}</div>
        <div class="sub">мобы по награде: ${(Object.entries(byOrb) as [OrbKind, number][]).map(([kk, n]) => `<span style="color:${ORBS[kk].css}">${ORBS[kk].label} ${n}</span>`).join(' · ')}</div>`;
      evEl.style.display = 'none';
      return;
    }
    const past = evs.filter((e) => e.t + e.dur <= ui.t);
    const got: Partial<Record<OrbKind, number>> = {};
    for (const e of past) for (const [kk, n] of Object.entries(e.gain ?? {}) as [OrbKind, number][]) got[kk] = (got[kk] ?? 0) + n;
    const kills = past.filter((e) => e.res === 'kill').length;
    const deaths = past.filter((e) => e.res === 'death').length;
    const rest = past.filter((e) => e.res === 'rest').reduce((a, e) => a + e.dur, 0);
    statEl.innerHTML = `<h3>Прогон ${ui.run + 1} к ${mmss(ui.t)}</h3>
      <div class="sub">убито: <b>${kills}</b> · смертей: <b>${deaths}</b> · отдых в лагере: <b>${mmss(rest)}</b></div>
      <div class="sub">собрано: ${fmtGain(got) || '—'}</div>`;
    const list = ui.focus ? evs.filter((e) => e.unit === ui.focus) : evs;
    evEl.style.display = '';
    evEl.innerHTML = `${ui.focus ? `<div class="row" style="padding:6px 8px"><span class="muted">только: ${esc(byId.get(ui.focus) ? unitName(byId.get(ui.focus)!) : ui.focus)}</span><button class="btn" id="mfoc" style="padding:2px 8px">все</button></div>` : ''}
      <table><tr><th>время</th><th class="l">цель</th><th class="l">итог</th><th class="l">класс</th><th class="l">получил</th></tr>
      ${list.map((e) => {
        const on = e.t <= ui.t && ui.t < e.t + e.dur;
        const fut = e.t > ui.t;
        const u = byId.get(e.unit);
        return `<tr data-t="${e.t + e.dur}" data-u="${esc(e.unit)}" class="ev ${on ? 'cur' : ''}" style="cursor:pointer;${fut ? 'opacity:.4' : ''}">
          <td>${mmss(e.t)}</td><td class="l">${esc(u ? unitName(u) : defName(e.def))}${e.res === 'rest' ? '' : ` <span class="muted">${Math.round(e.dur)} с</span>`}</td>
          <td class="l ${e.res === 'death' ? 'no' : ''}">${e.res === 'rest' ? `отдых ${Math.round(e.dur)} с` : RES_NAME[e.res]}${e.taken !== undefined ? ` <span class="muted">−${Math.round(e.taken * 100)}% HP</span>` : ''}</td>
          <td class="l muted">${e.res === 'rest' ? '' : esc(CLASSES[e.cls].name)}</td>
          <td class="l">${fmtGain(e.gain)}${e.bonus ? ' ' + fmtGain(e.bonus, true) : ''}${e.item ? ` <span class="muted">${esc(e.item)}</span>` : ''}${e.pull ? ' <span class="meh">+крутка</span>' : ''}</td></tr>`;
      }).join('')}</table>`;
    const cur = evEl.querySelector('.cur');
    if (cur && ui.playing) cur.scrollIntoView({ block: 'nearest' });
  };

  const setT = (t: number) => {
    ui.t = Math.max(0, Math.min(end, t));
    const r = root.querySelector<HTMLInputElement>('#mt');
    if (r) r.value = String(Math.round(ui.t));
    const l = root.querySelector('#mtl');
    if (l) l.textContent = mmss(ui.t);
    draw();
    drawSide();
  };

  // ---------- controls ----------
  root.querySelector('#mrun')?.addEventListener('change', (e) => { ui.run = +(e.target as HTMLSelectElement).value; ui.focus = null; renderMap(root, map, runs, until); });
  root.querySelector('#mpath')?.addEventListener('change', (e) => { ui.path = (e.target as HTMLInputElement).checked; store.set('warcry-balance-map-path', ui.path); setT(ui.t); });
  root.querySelector('#mprops')?.addEventListener('change', (e) => { ui.props = (e.target as HTMLInputElement).checked; store.set('warcry-balance-map-props', ui.props); draw(); });
  root.querySelector('#mspeed')?.addEventListener('change', (e) => { ui.speed = +(e.target as HTMLSelectElement).value; store.set('warcry-balance-map-speed', ui.speed); });
  root.querySelector('#mt')?.addEventListener('input', (e) => { ui.playing = false; playBtn(); setT(+(e.target as HTMLInputElement).value); });
  const playBtn = () => { const b = root.querySelector('#mplay'); if (b) b.textContent = ui.playing ? '❚❚' : '▶'; };
  root.querySelector('#mplay')?.addEventListener('click', () => {
    ui.playing = !ui.playing;
    if (ui.playing) {
      if (!ui.path) { ui.path = true; const c = root.querySelector<HTMLInputElement>('#mpath'); if (c) c.checked = true; }
      if (ui.t >= end) ui.t = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (!ui.playing || !root.isConnected) return;
        setT(ui.t + ((now - last) / 1000) * ui.speed);
        last = now;
        if (ui.t >= end) { ui.playing = false; playBtn(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    playBtn();
  });
  evEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'mfoc') { ui.focus = null; drawSide(); draw(); return; }
    const row = (e.target as HTMLElement).closest<HTMLElement>('tr.ev');
    if (!row) return;
    ui.playing = false;
    playBtn();
    if (!ui.path) { ui.path = true; const c = root.querySelector<HTMLInputElement>('#mpath'); if (c) c.checked = true; }
    setT(+row.dataset.t!);
  });

  // hover: what the spawner is and gives; click: its fights in this run
  const tip = document.getElementById('tip')!;
  const pick = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: MapUnit | null = null, bd = 12;
    for (const u of map.units) {
      if (u.kind === 'prop' && !ui.props) continue;
      const d = Math.hypot(X(u.x) - mx, Z(u.z) - my) - (RANK_R[u.rank] ?? 4);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  };
  canvas.addEventListener('mousemove', (e) => {
    const u = pick(e);
    canvas.style.cursor = u ? 'pointer' : '';
    if (!u) { tip.style.display = 'none'; return; }
    const mine = evs.filter((x) => x.unit === u.id && (x.res === 'kill' || x.res === 'break'));
    const lost = evs.filter((x) => x.unit === u.id && x.res === 'death').length;
    tip.innerHTML = `<b>${esc(unitName(u))}</b> <span class="muted">${RANK_NAME[u.rank] ?? u.rank}${u.depth ? `, глубина ${u.depth.toFixed(2)}` : ''}${u.approx ? ', место примерное' : ''}</span><br>
      ${u.kind === 'prop' ? `прочность: ${u.hp} уд.` : `HP ${Math.round(u.hp)} · урон ${Math.round(u.dmg)}`}<br>
      за убийство: ${fmtGain(u.reward) || '—'}${u.bonus ? ` · сразу ${fmtGain(u.bonus, true)}` : ''}${u.drop ? `<br>предмет: ${esc(u.drop)}` : ''}${u.token ? `<br>крутка: ${Math.round(u.token * 100)}%` : ''}<br>
      <span class="muted">респаун: ${u.charges.map(fmtCd).join(' → ')}${u.charges.length > 1 ? ' (по кругу)' : ''}</span>
      ${run ? `<br>в прогоне ${ui.run + 1}: ${mine.length ? `${u.kind === 'prop' ? 'разбит' : 'убит'} ${mine.length}× (первый раз ${mmss(mine[0].t + mine[0].dur)})` : 'не трогал'}${lost ? `, герой погиб ${lost}×` : ''}` : ''}`;
    tip.style.display = 'block';
    const tx = e.clientX + 14 + tip.offsetWidth > innerWidth ? e.clientX - tip.offsetWidth - 14 : e.clientX + 14;
    tip.style.left = `${tx}px`;
    tip.style.top = `${e.clientY + 12}px`;
  });
  canvas.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  canvas.addEventListener('click', (e) => {
    const u = pick(e);
    ui.focus = u && ui.focus !== u.id ? u.id : null;
    draw();
    drawSide();
  });
  const onResize = () => { if (!root.isConnected) { removeEventListener('resize', onResize); return; } size(); draw(); };
  addEventListener('resize', onResize);
  size();
  setT(ui.t);
}
