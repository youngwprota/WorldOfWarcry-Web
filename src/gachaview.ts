// "Горнило судьбы" window (docs/features/ludka): the banner with the legendary weapon, the forge reveal and the result.
import { art } from './art';
import { sfx } from './audio';
import { GACHA, RARITY } from './config';
import { bannerItem, pull } from './gacha';
import type { Game } from './game';
import { itemLines, type Item } from './items';
import type { UI } from './ui';

/** Hammer angle (deg): raised before a blow, resting on the anvil at the strike. */
const HAMMER_UP = -58, HAMMER_DOWN = 8;

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

export class GachaView {
  private openNow = false;
  private raf = 0;
  private last = 0;
  /** Forge state: time since the first frame, blows done, rarity shown after each blow, the pulled item. */
  private t = 0;
  private struck = 0;
  private stages = [0, 0, 0];
  private strikeAt = [0, 0, 0];
  private revealAt = 0;
  private item: Item | null = null;
  private where = '';
  private hammer: HTMLElement | null = null;
  private forgeEl: HTMLElement | null = null;

  constructor(private ui: UI, private game: Game) {}

  get isOpen() { return this.openNow; }

  open() {
    this.game.paused = true;
    this.openNow = true;
    this.ui.open(`<div class="gacha" id="g-root">
      <div class="g-head"><div class="g-title">Горнило судьбы</div><button class="xbtn" id="g-close" title="Закрыть">✕</button></div>
      <div class="g-body" id="g-body"></div>
    </div>`);
    this.ui.on('#g-close', () => this.close());
    this.renderBanner();
  }

  close() {
    this.stop();
    this.openNow = false;
    this.ui.close();
    this.game.paused = false;
    this.game.refreshHud(true);
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string) { return this.ui.modal.querySelector<T>(sel)!; }

  private renderBanner() {
    const it = bannerItem(this.game.itemLevel);
    const left = GACHA.pity - this.game.save.gachaPity;
    const rates = GACHA.rates.map((r, i) => `<span style="color:${RARITY[i].color}">${RARITY[i].name} ${+(r * 100).toFixed(1)}%</span>`).join('');
    this.q('#g-body').innerHTML = `
      <div class="g-banner">
        <div class="g-rays"></div>
        <div class="g-tag">Легендарное</div>
        <div class="g-weapon">${art(it.def, 170)}</div>
        <div class="g-name">${GACHA.banner.name}</div>
        <div class="g-sub">${GACHA.banner.subtitle}</div>
        <div class="g-lines">${itemLines(it).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      </div>
      <div class="g-rates">${rates}</div>
      <div class="g-pity">Легендарка гарантирована через <b>${left}</b> ${plural(left, 'крутку', 'крутки', 'круток')}</div>
      <button class="btn primary g-pull" id="g-pull">Ковать</button>`;
    this.ui.on('#g-pull', () => this.forge());
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.hammer = this.forgeEl = null;
  }

  /** Pull right away (the item is granted even if the window is closed mid-animation), then play the forge. */
  private forge() {
    const s = this.game.save;
    const res = pull(s.gachaPity, this.game.itemLevel);
    s.gachaPity = res.pity;
    this.item = res.item;
    this.where = this.game.lootItem(res.item);
    const r = res.item.rarity;
    // Rarity climbs blow by blow and never goes down; legendary only shows on the last blow.
    const s1 = r >= 1 && Math.random() < 0.5 ? 1 : 0;
    const s2 = Math.max(s1, r >= 2 ? (Math.random() < 0.6 ? 2 : 1) : r);
    this.stages = [s1, s2, r];
    const g = GACHA.strikeGap;
    // Suspense: a rare-or-better result waits a little longer before the last blow.
    this.strikeAt = [0.5, 0.5 + g, 0.5 + g * 2 + (r >= 2 ? g * 0.6 : 0)];
    this.revealAt = this.strikeAt[2] + GACHA.revealHold + (r >= 3 ? 0.5 : 0);
    this.t = 0;
    this.struck = 0;

    this.q('#g-body').innerHTML = `
      <div class="g-forge" id="g-forge">
        <div class="g-glow"></div>
        <div class="g-stage">
          <div class="g-hammer" id="g-hammer">${art('hammer', 150)}</div>
          <div class="g-anvil"><div class="g-ingot"></div>${art('anvil', 230)}</div>
        </div>
        <div class="g-hint">Тап — пропустить</div>
      </div>`;
    this.forgeEl = this.q('#g-forge');
    this.hammer = this.q('#g-hammer');
    this.setStage(0);
    this.forgeEl.addEventListener('click', () => this.skip());
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private skip() {
    if (this.struck >= 3) { this.t = this.revealAt; return; }
    // Jump straight to the last blow: it still plays its burst, then the result.
    this.struck = 2;
    this.t = this.strikeAt[2] - 0.12;
  }

  private update(dt: number) {
    this.t += dt;
    const t = this.t;
    if (this.struck < 3 && t >= this.strikeAt[this.struck]) this.strike(this.struck++);
    if (t >= this.revealAt) { this.reveal(); return; }
    // Hammer: swings down over the last 0.16 s before a blow, then lifts back over 0.45 s.
    let a = HAMMER_UP;
    if (this.struck < 3) {
      const k = 1 - (this.strikeAt[this.struck] - t) / 0.16;
      if (k > 0) a = HAMMER_UP + (HAMMER_DOWN - HAMMER_UP) * k * k;
    }
    if (this.struck > 0) {
      const since = t - this.strikeAt[this.struck - 1];
      if (since < 0.45) a = Math.max(a, HAMMER_DOWN + (HAMMER_UP - HAMMER_DOWN) * Math.min(1, since / 0.45) ** 0.6);
    }
    if (this.struck >= 3) a = HAMMER_UP;
    this.hammer!.style.transform = `rotate(${a}deg)`;
  }

  /** Colour of the ingot and the glow = rarity stage. */
  private setStage(stage: number) {
    const c = RARITY[stage].color;
    this.forgeEl!.style.setProperty('--rc', c);
    this.forgeEl!.dataset.stage = String(stage);
  }

  private strike(i: number) {
    const stage = this.stages[i];
    this.setStage(stage);
    sfx.anvil(stage);
    const shake = 4 + stage * 3 + (i === 2 ? 4 : 0);
    this.forgeEl!.querySelector('.g-stage')!.animate(
      [{ transform: `translate(${shake}px, ${shake * 0.6}px)` }, { transform: `translate(-${shake}px, -${shake * 0.4}px)` }, { transform: 'none' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  private reveal() {
    this.stop();
    sfx.reveal(this.item!.rarity);
    this.ui.toast(this.where);
    this.renderBanner();
  }
}
