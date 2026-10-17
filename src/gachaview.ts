// "Горнило судьбы" window (docs/features/ludka): the banner with the legendary weapon, the 3D forge reveal
// (src/forge3d.ts) and the result card on top of it.
import { art } from './art';
import { GACHA, RARITY } from './config';
import { Forge3D } from './forge3d';
import { Showcase3D } from './showcase3d';
import { bannerItem, gachaTier, pull } from './gacha';
import type { Game } from './game';
import { cellHtml, itemIconId, itemLines, itemName, type Item } from './items';
import type { UI } from './ui';

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

const linesHtml = (it: Item) => `<div class="g-lines">${itemLines(it).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;

export class GachaView {
  private openNow = false;
  private forge3d: Forge3D | null = null;
  /** The banner's live 3D jewel (one WebGL context at a time: dropped while the forge plays). */
  private show3d: Showcase3D | null = null;
  private item: Item | null = null;
  private where = '';

  constructor(private ui: UI, private game: Game) {}

  get isOpen() { return this.openNow; }

  open() {
    this.game.paused = true;
    // The window covers the whole screen: skip rendering the world meanwhile.
    this.game.offscreen = true;
    this.openNow = true;
    this.ui.open(`<div class="gacha" id="g-root">
      <canvas class="g-3d hidden" id="g-3d"></canvas>
      <div class="g-head"><div class="g-title">Горнило судьбы</div><button class="xbtn" id="g-close" title="Закрыть">✕</button></div>
      <div class="g-body" id="g-body"></div>
    </div>`);
    this.ui.on('#g-close', () => this.close());
    this.q('#g-root').addEventListener('click', (e) => {
      if (this.forge3d?.busy && !(e.target as HTMLElement).closest('button')) this.forge3d.skip();
    });
    this.renderBanner();
  }

  close() {
    this.dropShowcase();
    this.forge3d?.dispose();
    this.forge3d = null;
    this.openNow = false;
    this.ui.close();
    this.game.offscreen = false;
    this.game.paused = false;
    this.game.refreshHud(true);
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string) { return this.ui.modal.querySelector<T>(sel)!; }

  private renderBanner() {
    this.forge3d?.pause();
    this.q('#g-3d').classList.add('hidden');
    const it = bannerItem(1);
    const done = this.game.save.gachaPity;
    const left = GACHA.pity - done;
    const pulls = this.game.save.pulls ?? 0;
    const rates = GACHA.rates.map((r, i) => `<span style="--c:${RARITY[GACHA.tiers[i]].color}">${RARITY[GACHA.tiers[i]].name} <b>${+(r * 100).toFixed(1)}%</b></span>`).join('');
    this.q('#g-body').className = 'g-body';
    this.q('#g-body').innerHTML = `
      <div class="g-banner">
        <canvas class="g-show" id="g-show"></canvas>
        <div class="g-weapon" id="g-icon">${art(itemIconId(it, this.game.wearer), 200)}</div>
        <div class="g-corner tl"></div><div class="g-corner tr"></div><div class="g-corner bl"></div><div class="g-corner br"></div>
        <div class="g-ribbon">Шанс повышен!</div>
        <div class="g-info">
          <div class="g-tag">Легендарное</div>
          <div class="g-name">${GACHA.banner.name}</div>
          <div class="g-sub">${GACHA.banner.subtitle}</div>
          ${linesHtml(it)}
        </div>
      </div>
      <div class="g-rates">${rates}</div>
      <div class="g-pitybar"><div class="g-pitytext">Гарантия легендарки через <b>${left}</b> ${plural(left, 'крутку', 'крутки', 'круток')}</div>
        <div class="g-track"><i style="width:${(100 * done) / GACHA.pity}%"></i></div></div>
      <button class="btn primary g-pull" id="g-pull"${pulls ? '' : ' disabled'}>Ковать <span class="g-have">· ${pulls ? `крутки: ${pulls}` : 'нет круток'}</span></button>
      ${pulls ? '' : '<div class="g-pity">Крутки выпадают с врагов: элитки, мини-боссы и боссы — чаще</div>'}`;
    this.ui.on('#g-pull', () => this.forge());
    // the live 3D jewel replaces the icon once it is up (low graphics too, just without bloom)
    this.dropShowcase();
    const show = new Showcase3D(this.q<HTMLCanvasElement>('#g-show'), !!this.game.save.lowGfx, it);
    this.show3d = show;
    void show.ready.then((ok) => {
      if (this.show3d !== show) return;
      if (ok) this.ui.modal.querySelector('.g-banner')?.classList.add('live');
      else this.dropShowcase();
    });
  }

  private dropShowcase() {
    this.show3d?.dispose();
    this.show3d = null;
  }

  /** Pull right away (the item is granted even if the window is closed mid-animation), then play the forge. */
  private forge() {
    const s = this.game.save;
    if (!s.pulls) return;
    s.pulls--;
    const res = pull(s.gachaPity, 1);
    s.gachaPity = res.pity;
    this.item = res.item;
    this.where = this.game.lootItem(res.item);

    this.dropShowcase();
    const canvas = this.q<HTMLCanvasElement>('#g-3d');
    canvas.classList.remove('hidden');
    this.forge3d ??= new Forge3D(canvas, !!s.lowGfx, this.game.faction);
    this.forge3d.resume();
    const body = this.q('#g-body');
    body.className = 'g-body g-over';
    body.innerHTML = '<div class="g-hint">Тап — пропустить</div>';
    const item = res.item;
    const forge = this.forge3d;
    void Promise.all([forge.ready, forge.prepare(item)]).then(() => {
      if (this.openNow && this.item === item) this.forge3d?.play(item, () => this.showResult());
    });
  }

  private showResult() {
    const it = this.item!;
    const rar = RARITY[it.rarity];
    const body = this.q('#g-body');
    body.innerHTML = `
      <div class="g-result r${gachaTier(it.rarity)}" style="--rc:${rar.color}">
        <div class="g-tag">${rar.name}</div>
        <div class="g-name">${itemName(it, this.game.faction)}</div>
        <div class="g-got">${cellHtml(it, 'disabled', '', '', '', this.game.wearer)}${linesHtml(it)}</div>
        <div class="g-where">${this.where}</div>
        <div class="g-btns"><button class="btn" id="g-back">Назад</button><button class="btn primary" id="g-again"${this.game.save.pulls ? '' : ' disabled'}>Ещё раз${this.game.save.pulls ? ` · ${this.game.save.pulls}` : ''}</button></div>
      </div>`;
    this.ui.on('#g-back', () => this.renderBanner());
    this.ui.on('#g-again', () => this.forge());
  }
}
