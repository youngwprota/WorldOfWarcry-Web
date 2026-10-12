import * as THREE from 'three';
import {
  DAMAGE_TYPE_COLOR, DAMAGE_TYPE_NAME, FACTIONS, ORBS, RARITY, SHARPEN, WEAPONS, WORLD, ZONES,
  type FactionId, type OrbKind, type ZoneDef,
} from './config';
import { scrapValue, type Item } from './items';
import { resistIcons, rewardChips } from './icons';
import type { MobDef } from './config';
import { sfx } from './audio';
import type { World } from './world';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();

export interface HudState {
  hp: number; maxHp: number; shield: number; shieldMax: number; gold: number;
  stats: { power: number; hp: number; regen: number; speed: number };
  goal: string;
  buffs: string[];
}

/** One line of a dialogue; a line with choices waits for an answer (GDD 4.2: no wrong answers). */
export interface DialogueLine {
  who: string;
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
  private swapCb: () => void = () => {};
  private mm = $<HTMLCanvasElement>('minimap').getContext('2d')!;

  constructor() {
    $('btn-smith').addEventListener('click', () => { sfx.click(); this.onSmith(); });
    $('btn-settings').addEventListener('click', () => { sfx.click(); this.onSettings(); });
    $('btn-char').addEventListener('click', () => { sfx.click(); this.onCharacter(); });
    $('btn-bag').addEventListener('click', () => { sfx.click(); this.onBag(); });
    $('minimap').addEventListener('click', () => { sfx.click(); this.onMap(); });
    const stats = $('stats');
    stats.innerHTML = (['power', 'hp', 'regen', 'speed'] as OrbKind[])
      .map((k) => `<div class="st" data-k="${k}"><i style="background:${ORBS[k].css}"></i><span></span></div>`)
      .join('');
  }

  size() { return { w: this.app.clientWidth, h: this.app.clientHeight }; }
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
    $('gold').textContent = String(s.gold);
    const st = s.stats;
    const vals: Record<OrbKind, string> = {
      power: `Урон ${st.power}`, hp: `HP ${st.hp}`, regen: `Реген ${fmt1(st.regen)}%/с`, speed: `Бег ${fmt1(st.speed)} м/с`,
    };
    $('stats').querySelectorAll<HTMLElement>('.st').forEach((el) => {
      (el.querySelector('span') as HTMLElement).textContent = vals[el.dataset.k as OrbKind];
    });
    $('goal').innerHTML = s.goal;
    $('buffs').innerHTML = s.buffs.map((b) => `<div>${b}</div>`).join('');
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

  weapons(items: (Item | null)[], active: number, dmg: (it: Item) => number) {
    const box = $('weapons');
    box.innerHTML = '';
    // inactive slot first so the active one sits in the corner under the thumb
    const order = active === 0 ? [1, 0] : [0, 1];
    for (const i of order) {
      const it = items[i];
      const b = document.createElement('button');
      b.className = 'wslot' + (i === active ? ' active' : '') + (it ? '' : ' empty');
      if (it) {
        const w = WEAPONS[it.def];
        b.style.borderColor = RARITY[it.rarity].color;
        b.innerHTML = `${w.icon}<span class="t" style="color:${DAMAGE_TYPE_COLOR[w.type]}">${DAMAGE_TYPE_NAME[w.type]}</span>` +
          (it.sharpen ? `<span class="lvl">+${it.sharpen}</span>` : '') + (i !== active ? '<span class="swap">⇄</span>' : '');
        b.title = `${w.name}: ${Math.round(dmg(it))} урона`;
      } else {
        b.textContent = 'пусто';
      }
      if (i !== active && it) b.addEventListener('click', () => this.swapCb());
      box.appendChild(b);
    }
  }

  zoneBanner(z: ZoneDef) {
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

  smithPanel(items: (Item | null)[], gold: number, dmg: (it: Item) => number,
    sharpen: (slot: number) => void, scrap: (slot: number) => void, close: () => void) {
    const count = items.filter(Boolean).length;
    const rows = items.map((it, i) => {
      if (!it) return '';
      const w = WEAPONS[it.def];
      const max = it.sharpen >= SHARPEN.max;
      const cost = SHARPEN.cost(it.sharpen);
      return `<div class="smith-item" style="border-color:${RARITY[it.rarity].color}">
        <div class="ic">${w.icon}</div>
        <div class="info"><b>${w.name} ${it.sharpen ? '+' + it.sharpen : ''}</b><br>${RARITY[it.rarity].name} · ${DAMAGE_TYPE_NAME[w.type]} · урон ${Math.round(dmg(it))}</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="btn primary" data-sharpen="${i}" ${max || gold < cost ? 'disabled' : ''}>${max ? 'Максимум' : `Заточить +8%<br>${cost} 🪙`}</button>
          ${count > 1 ? `<button class="btn" data-scrap="${i}">Разобрать +${scrapValue(it)}</button>` : ''}
        </div></div>`;
    }).join('');
    this.open(`<div class="panel"><h2>⚒ Кузнец</h2><p>Золото: <b style="color:var(--gold)">${gold}</b></p>${rows}
      <div class="row"><button class="btn" id="m-close">Готово</button></div></div>`);
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

  settings(muted: boolean, lowGfx: boolean, toggleMute: () => void, toggleGfx: () => void, reset: () => void, close: () => void) {
    this.open(`<div class="panel"><h2>Настройки</h2>
      <p>Управление: тяни палец в любом месте экрана (или WASD). Атака — автоматически. Смена оружия — кнопка ⇄ или Q.</p>
      <div class="row"><button class="btn" id="m-mute">${muted ? '🔇 Звук выкл' : '🔊 Звук вкл'}</button>
      <button class="btn" id="m-gfx">${lowGfx ? '🖥 Графика: низкая' : '🖥 Графика: высокая'}</button></div>
      <div class="row"><button class="btn danger" id="m-reset">Сбросить прогресс</button></div>
      <div class="row"><button class="btn primary" id="m-close">Продолжить</button></div></div>`);
    this.on('#m-mute', () => { toggleMute(); this.close(); this.settings(!muted, lowGfx, toggleMute, toggleGfx, reset, close); });
    this.on('#m-gfx', () => { toggleGfx(); this.close(); this.settings(muted, !lowGfx, toggleMute, toggleGfx, reset, close); });
    this.on('#m-reset', () => {
      this.confirm('Сбросить весь прогресс?', 'Герой, фракция и снаряжение будут удалены.', reset, () => this.settings(muted, lowGfx, toggleMute, toggleGfx, reset, close));
    });
    this.on('#m-close', () => { this.close(); close(); });
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
    box.innerHTML = `<button class="dlg-skip">Пропустить ⏭</button>
      <div class="dlg-who"><div class="dlg-portrait"></div><b></b></div>
      <div class="dlg-text"></div><div class="dlg-choices"></div><div class="dlg-next">▼</div>`;
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
      choicesEl.innerHTML = line.choices.map((c, i) => `<button class="btn" data-i="${i}">${c.text}</button>`).join('');
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
      portrait.textContent = line.portrait;
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
        <div class="pas">Старт: ${w.icon} ${w.name}</div></div>`;
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
    const px = (x * 0.5 + 0.5) * w;
    const py = (-y * 0.5 + 0.5) * h;
    el.style.display = 'block';
    el.style.transform = `translate(${px - 13}px, ${py - 13}px) rotate(${Math.atan2(-y, x)}rad)`;
  }
}
