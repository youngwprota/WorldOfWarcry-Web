import * as THREE from 'three';
import {
  DAMAGE_TYPE_NAME, FACTIONS, SHARPEN, UI_BASE, WEAPONS, WORLD, ZONES,
  type FactionId, type OrbKind, type ZoneDef,
} from './config';
import { ARMOR_SLOTS, cellHtml, scrapValue, type ArmorSlot, type Item } from './items';
import { DAMAGE_TYPE_ICON, fmtK, icon, resistIcons, rewardChips } from './icons';
import { art } from './art';
import type { MobDef } from './config';
import { sfx } from './audio';
import type { World } from './world';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();
export const STAT_ICON: Record<OrbKind, string> = { power: 'sword', hp: 'heart', regen: 'regen', speed: 'boot' };

export interface HudState {
  hp: number; maxHp: number; shield: number; shieldMax: number; gold: number;
  stats: { power: number; hp: number; regen: number; speed: number };
  goal: string;
  buffs: string[];
  /** Boss widgets on the left: seconds until respawn, 0 = alive. */
  bosses: { name: string; left: number }[];
}

/** Butcher-style timer: 9h 23m, 4m 05s, 12s. */
function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** One line of a dialogue; a line with choices waits for an answer (GDD 4.2: no wrong answers). */
export interface DialogueLine {
  who: string;
  /** Art icon id (src/art.ts) shown in the round portrait. */
  portrait: string;
  text: string;
  choices?: { text: string; then?: DialogueLine[] }[];
}

export class UI {
  readonly app = $('app');
  readonly modal = $('modal');
  private bannerT = 0;
  private hintT = 0;
  private lastHud = '';
  onSmith: () => void = () => {};
  onSettings: () => void = () => {};
  onCharacter: () => void = () => {};
  onBag: () => void = () => {};
  onMap: () => void = () => {};
  onArmor: () => void = () => {};
  onTalents: () => void = () => {};
  onDebug: () => void = () => {};
  private lastProgress = '';
  private lastSkills = '';
  private swapCb: () => void = () => {};
  private mm = $<HTMLCanvasElement>('minimap').getContext('2d')!;

  constructor() {
    $('btn-smith').addEventListener('click', () => { sfx.click(); this.onSmith(); });
    $('btn-settings').addEventListener('click', () => { sfx.click(); this.onSettings(); });
    $('btn-char').addEventListener('click', () => { sfx.click(); this.onCharacter(); });
    $('btn-bag').addEventListener('click', () => { sfx.click(); this.onBag(); });
    $('minimap').addEventListener('click', () => { sfx.click(); this.onMap(); });
    $('bosses').addEventListener('click', () => { sfx.click(); this.onMap(); });
    $('btn-settings').innerHTML = art('gear', 40);
    $('lvl').addEventListener('click', () => { sfx.click(); this.onTalents(); });
    $('btn-char').insertAdjacentHTML('afterbegin', art('hero', 46));
    $('btn-bag').insertAdjacentHTML('afterbegin', art('bag', 48));
    $('btn-smith').insertAdjacentHTML('afterbegin', art('anvil', 32) + ' ');
    $('gold').querySelector('i')!.outerHTML = art('coin', 28);
    $('armorbar').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-armor]')) return;
      sfx.click();
      this.onArmor();
    });
    const stats = $('stats');
    stats.innerHTML = (['power', 'hp', 'regen', 'speed'] as OrbKind[])
      .map((k) => `<div class="st" data-k="${k}">${art(STAT_ICON[k], 26)}<span></span></div>`)
      .join('');
  }

  size() { return { w: this.app.clientWidth, h: this.app.clientHeight }; }
  /** UI scale for small screens: #hud, #modal and friends are scale(--ui), their px are virtual (screen px / scale). */
  scale = 1;
  fit() {
    const { w, h } = this.size();
    this.scale = Math.min(1, w / UI_BASE.w, h / UI_BASE.h);
    this.app.style.setProperty('--ui', String(this.scale));
  }
  get modalOpen() { return this.modal.classList.contains('show'); }

  showHud(on: boolean) { $('hud').classList.toggle('hidden', !on); }

  loading(p: number, text?: string) {
    ($('loading').querySelector('.fill') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
    if (text) ($('loading').querySelector('.pct') as HTMLElement).textContent = text;
  }
  hideLoading() { $('loading').classList.add('hidden'); }

  hud(s: HudState) {
    const key = JSON.stringify(s);
    if (key === this.lastHud) return;
    this.lastHud = key;
    const hp = $('hp');
    const total = s.maxHp + s.shieldMax;
    (hp.querySelector('.fill') as HTMLElement).style.width = `${(s.hp / s.maxHp) * 100}%`;
    (hp.querySelector('.shield') as HTMLElement).style.width = `${(s.shield / Math.max(1, total)) * 100}%`;
    (hp.querySelector('span') as HTMLElement).textContent = `${Math.ceil(s.hp)} / ${s.maxHp}${s.shield > 0 ? `  +${Math.ceil(s.shield)}🛡` : ''}`;
    ($('gold').querySelector('span') as HTMLElement).textContent = fmtK(s.gold);
    const st = s.stats;
    const vals: Record<OrbKind, string> = {
      power: fmtK(st.power), hp: fmtK(st.hp), regen: `${fmt1(st.regen)}%`, speed: fmt1(st.speed),
    };
    $('stats').querySelectorAll<HTMLElement>('.st').forEach((el) => {
      (el.querySelector('span') as HTMLElement).textContent = vals[el.dataset.k as OrbKind];
    });
    $('goal').innerHTML = s.goal;
    $('buffs').innerHTML = s.buffs.map((b) => `<div>${b}</div>`).join('');
    $('bosses').innerHTML = s.bosses.map((b) => `<div class="bw ui-block" title="${b.name}">
      ${b.left > 0 ? '' : '<div class="bw-ready">Готово!</div>'}${art('skull', 62, b.left > 0 ? 'dim' : '')}
      ${b.left > 0 ? `<div class="bw-time">${art('hourglass', 20)}${fmtTime(b.left)}</div>` : `<div class="bw-name">${b.name}</div>`}</div>`).join('');
  }

  /** Level badge + XP bar under the gold; "+N" when talent points are waiting. */
  progress(level: number, xp: number, need: number, free: number) {
    const key = `${level}|${xp}|${need}|${free}`;
    if (key === this.lastProgress) return;
    this.lastProgress = key;
    const el = $('lvl');
    (el.querySelector('.lv-badge') as HTMLElement).textContent = String(level);
    (el.querySelector('.fill') as HTMLElement).style.width = `${need ? Math.min(100, (xp / need) * 100) : 100}%`;
    (el.querySelector('span') as HTMLElement).textContent = need ? `${fmtK(xp)} / ${fmtK(need)}` : 'MAX';
    el.dataset.badge = free > 0 ? `+${free}` : '';
  }

  /** The two equipped auto-cast skills with a cooldown sweep. */
  skills(list: ({ id: string; icon: string; name: string; cd: number } | null)[]) {
    const box = $('skills');
    const key = list.map((x) => x?.id ?? '-').join('|');
    if (key !== this.lastSkills) {
      this.lastSkills = key;
      box.innerHTML = list.map((x) => (x
        ? `<div class="skill ui-block" data-skill="${x.id}" title="${x.name}">${art(x.icon, 40)}<i class="cd"></i></div>`
        : '')).join('');
      box.querySelectorAll('.skill').forEach((b) => b.addEventListener('click', () => { sfx.click(); this.onTalents(); }));
    }
    list.forEach((x) => {
      if (!x) return;
      const el = box.querySelector<HTMLElement>(`[data-skill="${x.id}"]`);
      el?.style.setProperty('--cd', `${x.cd * 360}deg`);
      el?.classList.toggle('ready', x.cd <= 0);
    });
  }

  skillFlash(id: string) {
    const el = $('skills').querySelector<HTMLElement>(`[data-skill="${id}"]`);
    if (!el) return;
    el.classList.remove('fire');
    void el.offsetWidth;
    el.classList.add('fire');
  }

  popStat(k: OrbKind) {
    const el = $('stats').querySelector<HTMLElement>(`[data-k="${k}"]`);
    if (!el) return;
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 150);
  }

  bindWeapons(swap: () => void) { this.swapCb = swap; }

  combo(n: number, max: number, name: string) {
    const el = $('combo');
    el.innerHTML = `<span>${name}</span>` + Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    el.classList.toggle('live', n > 0);
  }

  bagBadge(n: number, full: boolean) {
    const b = $('btn-bag');
    b.dataset.badge = full ? '!' : n > 0 ? String(n) : '';
  }

  /** Bottom "equipped" bar: two weapons (tap the other one to swap) and the six armour slots. */
  weapons(items: (Item | null)[], active: number, dmg: (it: Item) => number, equip: Partial<Record<ArmorSlot, Item>>) {
    const box = $('weapons');
    box.innerHTML = [0, 1].map((i) => {
      const it = items[i];
      const on = i === active;
      const tag = !on && it ? '<span class="swap">⇄</span>' : '';
      const title = it ? `title="${WEAPONS[it.def].name}: ${Math.round(dmg(it))} урона"` : '';
      return cellHtml(it, `data-w="${i}" ${title}`, 'sword', tag, on ? 'wslot active' : 'wslot');
    }).join('');
    box.querySelectorAll<HTMLElement>('[data-w]').forEach((b) => {
      if (+b.dataset.w! !== active && items[+b.dataset.w!]) b.addEventListener('click', () => this.swapCb());
    });
    $('armorbar').innerHTML = ARMOR_SLOTS.map((x) => cellHtml(equip[x.id], `data-armor="${x.id}" title="${x.name}"`, x.icon)).join('');
  }

  zoneBanner(z: ZoneDef) {
    $('zone-label').textContent = z.name;
    const el = $('zone-banner');
    el.innerHTML = z.name + (z.recommend ? `<small>Рекомендуемый урон: ${DAMAGE_TYPE_NAME[z.recommend]}</small>` : '<small>Безопасная зона</small>');
    el.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  toast(text: string, ms = 3200) {
    const el = $('hint');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.hintT);
    this.hintT = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  showSmithButton(on: boolean) { $('btn-smith').classList.toggle('hidden', !on); }

  updateBoss(name: string, hp: number, max: number, show: boolean, color: string, def: MobDef) {
    const el = $('bossbar');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const n = el.querySelector('.name') as HTMLElement;
    if (n.dataset.boss !== def.id) {
      n.dataset.boss = def.id;
      (el.querySelector('.binfo') as HTMLElement).innerHTML = `<span class="ris">${resistIcons(def, 18)}</span><span class="rws">${rewardChips(def)}</span>`;
    }
    n.textContent = name;
    n.style.color = color;
    (el.querySelector('.fill') as HTMLElement).style.width = `${(hp / max) * 100}%`;
    (el.querySelector('span') as HTMLElement).textContent = `${Math.ceil(hp)} / ${max}`;
  }
  hideBoss() { $('bossbar').classList.add('hidden'); }

  hurtFlash() {
    this.app.animate([{ boxShadow: 'inset 0 0 60px #ff000099' }, { boxShadow: 'inset 0 0 0 #ff000000' }], { duration: 300 });
  }

  flash() {
    const f = $('flash');
    f.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }

  // ---------- modals ----------
  open(html: string, clear = false) {
    this.modal.innerHTML = html;
    this.modal.classList.add('show');
    this.modal.classList.toggle('clear', clear);
  }
  close() { this.modal.classList.remove('show', 'clear'); this.modal.innerHTML = ''; }
  on(sel: string, fn: () => void) {
    this.modal.querySelector(sel)?.addEventListener('click', () => { sfx.click(); fn(); });
  }

  /** Smith styled as the Butcher Hero shop: ribbon header, item cards with a price button. */
  smithPanel(items: (Item | null)[], gold: number, dmg: (it: Item) => number,
    sharpen: (slot: number) => void, scrap: (slot: number) => void, close: () => void) {
    const count = items.filter(Boolean).length;
    const cards = items.map((it, i) => {
      if (!it) return '';
      const w = WEAPONS[it.def];
      const max = it.sharpen >= SHARPEN.max;
      const cost = SHARPEN.cost(it.sharpen);
      const now = dmg(it);
      const next = (now * (1 + SHARPEN.perLevel * (it.sharpen + 1))) / (1 + SHARPEN.perLevel * it.sharpen);
      return `<div class="shop-card">
        <div class="sc-name">${w.name}${it.sharpen ? ` +${it.sharpen}` : ''}</div>
        <div class="sc-sub">${max ? 'максимум' : `${icon(DAMAGE_TYPE_ICON[w.type], '#9fe3ff', 14)} ${fmtK(now)} <em>›</em> <b>${fmtK(next)}</b>`}</div>
        ${cellHtml(it, 'disabled')}
        <button class="btn primary price" data-sharpen="${i}" ${max || gold < cost ? 'disabled' : ''}>${max ? 'MAX' : `${art('coin', 26)} ${fmtK(cost)}`}</button>
        ${count > 1 ? `<button class="link" data-scrap="${i}">разобрать +${fmtK(scrapValue(it))}</button>` : ''}
      </div>`;
    }).join('');
    this.open(`<div class="panel shop">
      <div class="shop-head"><div class="pill">${art('coin', 28)}<span>${fmtK(gold)}</span></div><h2>Кузнец</h2><button class="xbtn" id="m-close">✕</button></div>
      <div class="ribbon">Заточка +8% урона</div>
      <div class="shop-grid">${cards}</div>
      <p>Заточка до +${SHARPEN.max}. Лишнее оружие можно разобрать на золото.</p></div>`);
    this.modal.querySelectorAll<HTMLButtonElement>('[data-sharpen]').forEach((b) => b.addEventListener('click', () => sharpen(+b.dataset.sharpen!)));
    this.modal.querySelectorAll<HTMLButtonElement>('[data-scrap]').forEach((b) => b.addEventListener('click', () => scrap(+b.dataset.scrap!)));
    this.on('#m-close', () => { this.close(); close(); });
  }

  showDeath(atFire: () => void, ad: () => void) {
    this.open(`<div class="panel"><h2>Ты пал</h2>
      <p>Страж Грани шепчет: «Ещё не время… Вернись.»</p>
      <p>Предметы и прокачка сохранены.</p>
      <div class="row"><button class="btn" id="m-fire">🔥 У костра</button>
      <button class="btn ad" id="m-ad">▶ Здесь<br><small>за рекламу</small></button></div></div>`);
    this.on('#m-fire', () => { this.close(); atFire(); });
    this.on('#m-ad', () => {
      this.close();
      this.fakeAd(ad);
    });
  }

  /** Rewarded-ad stub: the real SDK is out of scope for the web prototype. */
  fakeAd(done: () => void) {
    const el = document.createElement('div');
    el.className = 'ad-overlay';
    el.innerHTML = '<div>Здесь будет rewarded-реклама</div><div class="n">3</div>';
    this.app.appendChild(el);
    let n = 3;
    const t = setInterval(() => {
      n--;
      (el.querySelector('.n') as HTMLElement).textContent = String(n);
      if (n <= 0) { clearInterval(t); el.remove(); done(); }
    }, 1000);
  }

  settings(muted: boolean, lowGfx: boolean, toggleMute: () => void, toggleGfx: () => void, reset: () => void, close: () => void, showLog: () => void, kite: { label: string; cycle: () => void }) {
    this.open(`<div class="panel"><h2>Настройки</h2>
      <p>Управление: тяни палец в любом месте экрана (или WASD). Атака — автоматически. Смена оружия — тап по второму оружию внизу или Q.</p>
      <div class="row"><button class="btn" id="m-mute">${muted ? '🔇 Звук выкл' : '🔊 Звук вкл'}</button>
      <button class="btn" id="m-gfx">${lowGfx ? '🖥 Графика: низкая' : '🖥 Графика: высокая'}</button></div>
      <div class="row"><button class="btn purple" id="m-debug">🛠 Дебаг-меню</button><button class="btn" id="m-kite">🐞 Анти-кайт: ${kite.label}</button></div>
      <div class="row"><button class="btn" id="m-log">📊 Лог баланса</button><button class="btn danger" id="m-reset">Сбросить прогресс</button></div>
      <div class="row"><button class="btn primary" id="m-close">Продолжить</button></div></div>`);
    this.on('#m-debug', () => { this.close(); close(); this.onDebug(); });
    this.on('#m-mute', () => { toggleMute(); this.close(); this.settings(!muted, lowGfx, toggleMute, toggleGfx, reset, close, showLog, kite); });
    this.on('#m-gfx', () => { toggleGfx(); this.close(); this.settings(muted, !lowGfx, toggleMute, toggleGfx, reset, close, showLog, kite); });
    this.on('#m-reset', () => {
      this.confirm('Сбросить весь прогресс?', 'Герой, фракция и снаряжение будут удалены.', reset, () => this.settings(muted, lowGfx, toggleMute, toggleGfx, reset, close, showLog, kite));
    });
    this.on('#m-log', () => { this.close(); showLog(); });
    this.on('#m-kite', () => { this.close(); kite.cycle(); });
    this.on('#m-close', () => { this.close(); close(); });
  }

  /** Balance playtest report (src/balancelog.ts): read here, copy to paste into chat. */
  balanceLog(text: string, back: () => void) {
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.open(`<div class="panel"><h2>Лог баланса</h2>
      <pre class="ballog">${esc || 'Пока пусто: поиграй минуту.'}</pre>
      <div class="row"><button class="btn" id="m-back">Назад</button><button class="btn primary" id="m-copy">Копировать</button></div></div>`);
    this.on('#m-copy', () => {
      // No clipboard API over plain http (phone on the LAN): select the text for a manual copy instead.
      const selectAll = () => {
        const pre = this.modal.querySelector('.ballog');
        if (pre) getSelection()?.selectAllChildren(pre);
        this.toast('Текст выделен — скопируй вручную');
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => this.toast('Лог скопирован'), selectAll);
      else selectAll();
    });
    this.on('#m-back', () => { this.close(); back(); });
  }

  confirm(title: string, text: string, yes: () => void, no: () => void) {
    this.open(`<div class="panel"><h2>${title}</h2><p>${text}</p>
      <div class="row"><button class="btn" id="m-no">Назад</button><button class="btn primary" id="m-yes">Да</button></div></div>`);
    this.on('#m-yes', () => { this.close(); yes(); });
    this.on('#m-no', () => { this.close(); no(); });
  }

  /**
   * Bottom dialogue box: portrait, name, typed text (tap shows it at once), 1–3 answers and an
   * always-visible "Пропустить" (GDD 4.2 / 6.2). `done` fires once, after the last line or a skip.
   */
  dialogue(lines: DialogueLine[], done: () => void) {
    const queue = [...lines];
    const box = document.createElement('div');
    box.id = 'dialogue';
    box.className = 'ui-block';
    box.innerHTML = `<button class="btn dlg-skip">Пропустить</button>
      <div class="dlg-who"><div class="dlg-portrait"></div><b></b></div>
      <div class="dlg-text"></div><div class="dlg-choices"></div><div class="dlg-next"></div>`;
    this.app.appendChild(box);
    const who = box.querySelector('b')!;
    const portrait = box.querySelector<HTMLElement>('.dlg-portrait')!;
    const textEl = box.querySelector<HTMLElement>('.dlg-text')!;
    const choicesEl = box.querySelector<HTMLElement>('.dlg-choices')!;
    let line: DialogueLine | null = null;
    let shown = 0;
    let timer = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      box.remove();
      done();
    };
    const reveal = () => {
      clearInterval(timer);
      if (!line) return;
      shown = line.text.length;
      textEl.textContent = line.text;
      box.classList.add('ready');
      if (!line.choices) return;
      choicesEl.innerHTML = line.choices.map((c, i) => `<button class="btn blue" data-i="${i}">${c.text}</button>`).join('');
      choicesEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.click();
        queue.unshift(...(line!.choices![+b.dataset.i!].then ?? []));
        next();
      }));
    };
    const next = () => {
      line = queue.shift() ?? null;
      if (!line) { finish(); return; }
      who.textContent = line.who;
      portrait.innerHTML = art(line.portrait, 54);
      choicesEl.innerHTML = '';
      box.classList.toggle('ask', !!line.choices);
      box.classList.remove('ready');
      shown = 0;
      textEl.textContent = '';
      clearInterval(timer);
      timer = window.setInterval(() => {
        if (!line) return;
        shown += 2;
        textEl.textContent = line.text.slice(0, shown);
        if (shown >= line.text.length) reveal();
      }, 28);
    };
    box.addEventListener('click', () => {
      if (!line) return;
      if (shown < line.text.length) reveal();
      else if (!line.choices) { sfx.click(); next(); }
    });
    box.querySelector('.dlg-skip')!.addEventListener('click', (e) => { e.stopPropagation(); sfx.click(); finish(); });
    next();
  }

  factionSelect(onPick: (f: FactionId) => void, onConfirm: (f: FactionId) => void, lead = '') {
    let sel: FactionId | null = null;
    const card = (f: FactionId) => {
      const d = FACTIONS[f];
      const w = WEAPONS[d.startWeapon];
      return `<div class="fcard ui-block" data-f="${f}" style="border-top:5px solid ${d.color}">
        <h3>${d.name}</h3><div class="fan">${d.fantasy}</div>
        <div class="pas">${d.passiveName}</div><div>${d.passiveText}</div>
        <div class="pas">Старт: ${art(w.id, 22)} ${w.name}</div></div>`;
    };
    this.open(`<div class="factions ui-block">${lead ? `<p class="lead">${lead}</p>` : ''}<h1>Выбери, чьим воином вернёшься</h1>
      <div class="fcards">${card('human')}${card('orc')}</div>
      <button class="btn primary" id="m-go" disabled>Воскреснуть</button></div>`, true);
    const go = this.modal.querySelector<HTMLButtonElement>('#m-go')!;
    this.modal.querySelectorAll<HTMLElement>('.fcard').forEach((c) => c.addEventListener('click', () => {
      sfx.click();
      sel = c.dataset.f as FactionId;
      this.modal.querySelectorAll('.fcard').forEach((x) => x.classList.toggle('sel', x === c));
      go.disabled = false;
      onPick(sel);
    }));
    go.addEventListener('click', () => {
      if (!sel) return;
      const f = sel;
      this.confirm(`${FACTIONS[f].name}?`, 'Выбор делается один раз и навсегда.', () => onConfirm(f), () => this.factionSelect(onPick, onConfirm, lead));
    });
  }

  // ---------- minimap & goal arrow ----------
  minimap(hero: THREE.Vector3, facing: number, mobs: THREE.Vector3[], world: World, bosses: { pos: THREE.Vector3; alive: boolean }[]) {
    const g = this.mm;
    const S = 220;
    const scale = S / 70; // ~70 m across
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.clip();
    const tx = (x: number) => S / 2 + (x - hero.x) * scale;
    const tz = (z: number) => S / 2 + (z - hero.z) * scale;
    for (const z of ZONES) {
      g.fillStyle = '#' + z.ground.toString(16).padStart(6, '0');
      const y0 = tz(z.z[1]);
      const y1 = tz(z.z[0]);
      g.fillRect(tx(-WORLD.halfWidth), y0, WORLD.halfWidth * 2 * scale, y1 - y0);
    }
    g.fillStyle = '#0005';
    g.fillRect(0, 0, tx(-WORLD.halfWidth), S);
    g.fillRect(tx(WORLD.halfWidth), 0, S, S);
    if (!world.barrierOpen) {
      g.fillStyle = '#b06bff';
      g.fillRect(tx(-WORLD.halfWidth), tz(WORLD.barrierZ) - 3, WORLD.halfWidth * 2 * scale, 6);
    }
    for (const c of world.campfires) { g.fillStyle = '#ffa020'; g.beginPath(); g.arc(tx(c.x), tz(c.z), 7, 0, 7); g.fill(); }
    g.fillStyle = '#ff3b3b';
    for (const m of mobs) g.fillRect(tx(m.x) - 3, tz(m.z) - 3, 6, 6);
    g.font = 'bold 26px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const b of bosses) g.fillText(b.alive ? '💀' : '⏳', tx(b.pos.x), tz(b.pos.z));
    g.restore();
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(-facing + Math.PI);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(-8, 9); g.closePath();
    g.fill();
    g.restore();
  }

  edgeArrow(target: THREE.Vector3 | null, camera: THREE.Camera) {
    const el = $('edge-arrow');
    if (!target) { el.style.display = 'none'; return; }
    const v = target.clone().setY(1).project(camera);
    const { w, h } = this.size();
    const on = Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && v.z < 1;
    if (on) { el.style.display = 'none'; return; }
    let x = v.x;
    let y = v.y;
    if (v.z > 1) { x = -x; y = -y; }
    // keep clear of the HUD corners
    const m = Math.max(Math.abs(x) / 0.85, y > 0 ? y / 0.55 : -y / 0.62);
    x /= m;
    y /= m;
    // #hud is scaled by --ui: its px are screen px / scale
    const px = ((x * 0.5 + 0.5) * w) / this.scale;
    const py = ((-y * 0.5 + 0.5) * h) / this.scale;
    el.style.display = 'block';
    el.style.transform = `translate(${px - 13}px, ${py - 13}px) rotate(${Math.atan2(-y, x)}rad)`;
  }
}
