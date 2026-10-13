// "Горнило судьбы" window (docs/features/ludka): the banner with the legendary weapon, the forge reveal and the result.
import { art } from './art';
import { GACHA, RARITY } from './config';
import { bannerItem } from './gacha';
import type { Game } from './game';
import { itemLines } from './items';
import type { UI } from './ui';

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

export class GachaView {
  private openNow = false;

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

  private forge() {
    // Steps 4–6: the forge reveal.
  }
}
