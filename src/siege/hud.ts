import './siege.css';
import type { UI } from '../ui';
import type { Wearer } from '../looks';
import { cellHtml } from '../items';
import { art } from '../art';
import { sfx } from '../audio';
import type { SiegePhase, SiegeResult, SiegeReward } from './types';

const CASTLE = `<svg class="svgi art" width="44" height="44" viewBox="0 0 64 64" stroke="#1d120b" stroke-width="5.5" stroke-linejoin="round" paint-order="stroke">
<path d="M32 24V6" fill="none"/><path d="M32 6L45 10.5L32 15Z" fill="#b8473a"/>
<path d="M4 26V11H11V16H17V11H24V26Z" fill="#aab5c2"/><path d="M40 26V11H47V16H53V11H60V26Z" fill="#aab5c2"/>
<path d="M6 26H22V58H6Z M42 26H58V58H42Z" fill="#717c8b"/>
<path d="M20 32V25H26V29H30V25H34V29H38V25H44V58H20Z" fill="#8a95a3"/>
<path d="M26 58V45Q32 36 38 45V58Z" fill="#82492a"/>
<path d="M16 28H22V58H16Z M52 28H58V58H52Z" fill="#4f5866" stroke="none"/></svg>`;
const FLAG = `<svg class="svgi" width="34" height="34" viewBox="0 0 64 64" stroke="#1d120b" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke">
<path d="M16 58V7" fill="none" stroke-width="7"/><path d="M16 58V7" fill="none" stroke="#b5733f" stroke-width="2.5"/>
<path d="M18 9C28 4 36 15 46 10C50 8 54 9 56 10V34C50 31 44 38 34 35C26 33 22 30 18 32Z" fill="#f2ead8"/>
<path d="M34 35C26 33 22 30 18 32V26C24 24 28 28 36 29C44 31 50 26 56 28V34C50 31 44 38 34 35Z" fill="#c9bea4" stroke="none"/></svg>`;
const CLOCK = `<svg class="sg-clock" width="22" height="22" viewBox="0 0 24 24" stroke="#1d120b" stroke-width="2.6" paint-order="stroke" stroke-linejoin="round"><circle cx="12" cy="13" r="9" fill="#ffe9b0"/><path d="M12 7.5V13L16 15.5" fill="none" stroke-linecap="round"/><path d="M9 2.5H15" stroke-width="3" stroke-linecap="round"/></svg>`;
const SKULL = `<svg width="20" height="20" viewBox="0 0 24 24" stroke="#1d120b" stroke-width="2.4" paint-order="stroke" stroke-linejoin="round"><path d="M12 2.5C6.6 2.5 4 6.3 4 10.6c0 3 1.5 4.7 3 5.6V20h10v-3.8c1.5-.9 3-2.6 3-5.6C20 6.3 17.4 2.5 12 2.5Z" fill="#fff4dc"/><circle cx="8.6" cy="11.2" r="2.3" fill="#1d120b" stroke="none"/><circle cx="15.4" cy="11.2" r="2.3" fill="#1d120b" stroke="none"/><path d="M10 20V16.5M12 20V16.5M14 20V16.5" stroke-width="1.6" fill="none"/></svg>`;

const PHASE_LABEL: Record<SiegePhase, string> = { forest: 'Лесная дорога', gate: 'Штурм ворот', yard: 'Оборона двора', done: '' };
// kill counts where the number changes colour tier (t1..t4)
const TIERS = [10, 25, 50, 100];
const MILES: [number, string][] = [[10, 'РАЗОГРЕВ!'], [25, 'РЕЗНЯ!'], [50, 'БОЙНЯ!'], [100, 'НЕУДЕРЖИМ!'], [150, 'ЛЕГЕНДА!']];
const CHAIN_WINDOW = 1200;
const CHAIN_RESET = 1800;

function mmss(s: number) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export class SiegeHud {
  onButton: () => void = () => {};
  private readonly btn: HTMLElement;
  private readonly quit: HTMLElement;
  private readonly root: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly timeTxt: HTMLElement;
  private readonly phaseTxt: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly num: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly chainEl: HTMLElement;
  private readonly miniEl: HTMLElement;
  private readonly miniTxt: HTMLElement;
  private readonly ann: HTMLElement;
  private readonly mile: HTMLElement;
  private readonly mileTxt: HTMLElement;
  private readonly mileRays: HTMLElement;
  private annAnim: Animation | null = null;
  private mileAnim: Animation | null = null;
  private mileRayAnim: Animation | null = null;
  private lastTime = '';
  private lastPhase: SiegePhase | '' = '';
  private tier = -1;
  private lastTotal = -1;
  private lastMini = 0;
  private lastMile = 0;
  private chain = 0;
  private lastKillAt = 0;
  private chainT = 0;
  private lastChainTxt = '';
  private countRaf = 0;

  constructor(private readonly ui: UI) {
    const hud = document.getElementById('hud')!;
    this.btn = document.createElement('button');
    this.btn.id = 'btn-siege';
    this.btn.className = 'ui-block round-btn nav siege';
    this.btn.setAttribute('aria-label', 'Осада');
    this.btn.innerHTML = `${CASTLE}${art('lock', 26, 'sg-lock')}<span>Осада</span>`;
    this.btn.addEventListener('click', () => { sfx.click(); this.onButton(); });
    document.getElementById('btn-bag')!.after(this.btn);
    this.quit = document.createElement('button');
    this.quit.id = 'btn-siege-quit';
    this.quit.className = 'ui-block round-btn';
    this.quit.setAttribute('aria-label', 'Сдаться');
    this.quit.innerHTML = FLAG;
    this.quit.addEventListener('click', () => { sfx.click(); this.onButton(); });
    document.getElementById('btn-settings')!.after(this.quit);

    hud.insertAdjacentHTML('beforeend', `<div id="siege-hud">
      <div class="sg-timer idle"><i class="sg-glow"></i><small></small><div class="sg-row">${CLOCK}<b>5:00</b></div></div>
      <div class="sg-mini">${SKULL}<b>0/3</b></div>
      <div id="siege-combo" class="t0"><i class="sc-aura"></i><i class="sc-ring"></i><div class="sc-num">0</div><div class="sc-cap">убийств</div><div class="sc-chain"></div></div>
      <div class="sg-ann"></div>
      <div class="sg-mile"><i class="sg-rays"></i><b></b></div>
    </div>`);
    const q = (s: string) => hud.querySelector(`#siege-hud ${s}`) as HTMLElement;
    this.root = hud.querySelector('#siege-hud') as HTMLElement;
    this.timerEl = q('.sg-timer');
    this.timeTxt = q('.sg-timer b');
    this.phaseTxt = q('.sg-timer small');
    this.combo = q('#siege-combo');
    this.num = q('.sc-num');
    this.ring = q('.sc-ring');
    this.chainEl = q('.sc-chain');
    this.miniEl = q('.sg-mini');
    this.miniTxt = q('.sg-mini b');
    this.ann = q('.sg-ann');
    this.mile = q('.sg-mile');
    this.mileTxt = q('.sg-mile b');
    this.mileRays = q('.sg-rays');
  }

  setRunning(on: boolean): void {
    this.btn.classList.toggle('run', on);
    this.quit.classList.toggle('run', on);
    this.root.classList.toggle('on', on);
    clearTimeout(this.chainT);
    this.annAnim?.cancel();
    this.mileAnim?.cancel();
    this.mileRayAnim?.cancel();
    this.ann.style.opacity = this.mile.style.opacity = '0';
    if (!on) return;
    this.lastTime = '';
    this.lastPhase = '';
    this.tier = -1;
    this.lastTotal = -1;
    this.lastMini = 0;
    this.lastMile = 0;
    this.chain = 0;
    this.lastChainTxt = '';
    this.combo.classList.remove('on');
    this.chainEl.classList.remove('on');
    this.miniTxt.textContent = '0/3';
    this.alignRow();
    this.num.textContent = '0';
    this.phaseTxt.textContent = '';
    this.timer(null);
    this.setTier(0);
  }

  /** Surrender, the mini chip and the kill number share one row: the row is the surrender button's centre (it sits in the
   * top-left flex column, so its height depends on the safe area); the chip goes halfway between the button and the number. */
  private alignRow() {
    const box = this.quit.offsetParent as HTMLElement;
    const row = box.offsetTop + this.quit.offsetTop + this.quit.offsetHeight / 2;
    const quitRight = box.offsetLeft + this.quit.offsetLeft + this.quit.offsetWidth;
    const comboLeft = this.root.offsetWidth / 2 - this.combo.offsetWidth / 2;
    this.root.style.setProperty('--row', `${row}px`);
    this.miniEl.style.left = `${(quitRight + comboLeft) / 2 - this.miniEl.offsetWidth / 2}px`;
  }

  confirmLeave(yes: () => void, no: () => void): void {
    this.ui.confirm('Сдаться?', 'Осада будет прервана. Награда — за тех, кого уже победил.', yes, no);
  }

  timer(s: number | null): void {
    const t = s === null ? '5:00' : mmss(s);
    if (t !== this.lastTime) {
      this.lastTime = t;
      this.timeTxt.textContent = t;
    }
    this.timerEl.classList.toggle('idle', s === null);
    this.timerEl.classList.toggle('low', s !== null && s <= 30);
  }

  phase(p: SiegePhase): void {
    if (p === this.lastPhase) return;
    this.lastPhase = p;
    this.phaseTxt.textContent = PHASE_LABEL[p];
  }

  // the director's chain arg is ignored: the streak is timed here, on the HUD clock
  kill(total: number, _chain: number): void {
    if (total === this.lastTotal) return;
    const now = performance.now();
    this.chain = now - this.lastKillAt <= CHAIN_WINDOW ? this.chain + 1 : 1;
    this.lastKillAt = now;
    this.lastTotal = total;
    this.combo.classList.add('on');
    this.num.textContent = String(total);
    let t = 0;
    while (t < TIERS.length && total >= TIERS[t]) t++;
    this.setTier(t);

    const c = this.chain;
    const heat = Math.min(c, 10);
    this.num.animate(
      [{ transform: `scale(${1.4 + heat * 0.035}) rotate(-6deg)` }, { transform: 'scale(0.92) rotate(1deg)', offset: 0.55 }, { transform: 'scale(1) rotate(0)' }],
      { duration: 220, easing: 'cubic-bezier(.2,1.6,.4,1)' });
    this.ring.animate([{ transform: 'scale(0.6)', opacity: 0.9 }, { transform: `scale(${1.7 + heat * 0.03})`, opacity: 0 }], { duration: 320, easing: 'ease-out' });

    const txt = c >= 3 ? `x${c}` : '';
    if (txt !== this.lastChainTxt) {
      this.lastChainTxt = txt;
      this.chainEl.textContent = txt;
      this.chainEl.classList.toggle('on', !!txt);
    }
    if (txt) this.chainEl.animate([{ transform: 'scale(1.5) rotate(10deg)' }, { transform: 'scale(1) rotate(8deg)' }], { duration: 180, easing: 'cubic-bezier(.2,1.6,.4,1)' });
    clearTimeout(this.chainT);
    this.chainT = window.setTimeout(this.chainEnd, CHAIN_RESET);

    // a jump over several milestones shows only the highest
    let ms = -1;
    for (let i = 0; i < MILES.length; i++) if (total >= MILES[i][0] && MILES[i][0] > this.lastMile) ms = i;
    if (ms >= 0) {
      this.lastMile = MILES[ms][0];
      this.milestone(MILES[ms][1]);
    }
  }

  mini(n: number, of: number): void {
    this.miniTxt.textContent = `${n}/${of}`;
    const gained = n > this.lastMini;
    this.lastMini = n;
    if (!gained) return;
    this.miniEl.animate([{ transform: 'scale(1.5) rotate(-8deg)' }, { transform: 'scale(0.92)', offset: 0.55 }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,1.6,.4,1)' });
    this.announce('Страж повержен!', 'mini');
  }

  announce(t: string, k: 'mini' | 'wave' | 'gate'): void {
    const el = this.ann;
    el.textContent = t;
    el.className = `sg-ann ${k}`;
    this.annAnim?.cancel();
    this.annAnim = el.animate([
      { transform: 'scale(1.6)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.1 },
      { transform: 'scale(1)', opacity: 1, offset: 0.78 },
      { transform: 'translateY(-14px) scale(0.96)', opacity: 0 },
    ], { duration: 2400, easing: 'ease-out', fill: 'both' });
  }

  results(r: SiegeResult, rw: SiegeReward, w: Wearer, onClose: () => void): void {
    const pct = Math.round(r.pct * 100);
    const loot = rw.items.map((it, i) => `<span class="sg-loot" style="animation-delay:${0.5 + i * 0.12}s">${cellHtml(it, '', '', '', '', w)}</span>`).join('');
    const pulls = rw.pulls > 0 ? `<span class="sg-pull" style="animation-delay:${0.5 + rw.items.length * 0.12}s">${art('anvil', 40)}<b>×${rw.pulls}</b></span>` : '';
    this.ui.open(`<div class="panel sg-res ${r.completed ? 'win' : 'lose'}">
      <h2>${r.completed ? 'Осада выдержана!' : 'Осада провалена'}</h2>
      <div class="sg-pct"><b>0</b><i>%</i></div>
      <div class="sg-meter"><i></i><u style="left:25%"></u><u style="left:50%"></u><u style="left:75%"></u></div>
      <div class="sg-stats">
        <span>Убито<b>${r.kills}/${r.maxKills}</b></span>
        <span>Стражи<b>${r.minis}/${r.maxMinis}</b></span>
        <span>Время<b>${mmss(r.time)}</b></span>
      </div>
      <div class="sg-reward"><small>Награда</small>
        <div class="sg-loots">${loot}${pulls}${loot || pulls ? '' : '<em>Не продержался — награды нет</em>'}</div>
      </div>
      <div class="row"><button class="btn primary" id="sg-close">В лагерь</button></div></div>`);
    this.ui.on('#sg-close', () => { cancelAnimationFrame(this.countRaf); this.ui.close(); onClose(); });

    const pctEl = this.ui.modal.querySelector('.sg-pct b') as HTMLElement;
    const bar = this.ui.modal.querySelector('.sg-meter i') as HTMLElement;
    const DUR = 1000;
    bar.animate([{ transform: 'scaleX(0)' }, { transform: `scaleX(${r.pct})` }], { duration: DUR, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
    const t0 = performance.now();
    let shown = -1;
    const step = (now: number) => {
      if (!pctEl.isConnected) return;
      const k = Math.min(1, (now - t0) / DUR);
      const v = Math.round(pct * (1 - (1 - k) ** 3));
      if (v !== shown) { shown = v; pctEl.textContent = String(v); }
      if (k < 1) this.countRaf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.countRaf);
    this.countRaf = requestAnimationFrame(step);
  }

  private chainEnd = () => {
    this.chain = 0;
    this.lastChainTxt = '';
    this.chainEl.classList.remove('on');
  };

  private setTier(t: number) {
    if (t === this.tier) return;
    this.tier = t;
    this.combo.className = `t${t}${this.combo.classList.contains('on') ? ' on' : ''}`;
  }

  private milestone(text: string) {
    this.mileTxt.textContent = text;
    this.mile.className = `sg-mile t${this.tier}`;
    this.mileAnim?.cancel();
    this.mileRayAnim?.cancel();
    this.mileAnim = this.mile.animate([
      { transform: 'scale(0.4) rotate(-6deg)', opacity: 0 },
      { transform: 'scale(1.25) rotate(2deg)', opacity: 1, offset: 0.14 },
      { transform: 'scale(1) rotate(0)', opacity: 1, offset: 0.24 },
      { transform: 'scale(1)', opacity: 1, offset: 0.78 },
      { transform: 'translateY(-16px) scale(1.04)', opacity: 0 },
    ], { duration: 1800, easing: 'ease-out', fill: 'both' });
    this.mileRayAnim = this.mileRays.animate([{ transform: 'rotate(0)', opacity: 0.9 }, { transform: 'rotate(50deg)', opacity: 0 }], { duration: 1800, easing: 'ease-out', fill: 'both' });
    sfx.combo();
  }
}
