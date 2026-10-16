import * as THREE from 'three';
import { Character } from './character';
import { Creature } from './creature';
import {
  COMBOS, DAMAGE_TYPE_NAME, DEFENSE_CAP, FACTIONS, HERO, RARITY, STAT_CURVE, STAT_SOURCE_NAME, STAVES, WEAPONS, isPctStat, type PetDef, type StatId,
} from './config';
import { armorMul, statBreakdown } from './balance';
import {
  ARMOR, ARMOR_SLOTS, BAG_SIZE, EQUIP_BAR, SLOT_NAME, cellHtml, itemLines, itemName, orbLine, petCellHtml, slotOf, weaponBase,
  type ArmorSlot, type Item, type VisualPart,
} from './items';
import { sfx } from './audio';
import { DAMAGE_TYPE_ICON, fmtK, icon } from './icons';
import { art } from './art';
import type { Game } from './game';
import type { UI } from './ui';
import { CLASSES, classSlot, weaponClass } from './party';

/** 0.237 → "24%". */
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** 0.1634 → "16.3%". */
const pct1 = (x: number) => `${+(x * 100).toFixed(1)}%`;

/** Stat window titles, icons and a line on how the stat works. */
const STAT_UI: Record<StatId, { name: string; icon: string; note: string }> = {
  power: { name: 'Урон', icon: 'hit', note: 'складывается с уроном оружия, проценты умножают сумму' },
  hp: { name: 'Здоровье', icon: 'heart', note: 'сумма × проценты' },
  regen: { name: 'Реген здоровья', icon: 'regen', note: 'хп/с: сумма × проценты' },
  speed: { name: 'Скорость передвижения', icon: 'run', note: `100 очков = ${HERO.baseSpeed} м/с, предел ${HERO.baseSpeed * (1 + STAT_CURVE.speed.max)} м/с` },
  defense: { name: 'Защита', icon: 'defense', note: `урон × 100 / (100 + защита), предел −${pct(DEFENSE_CAP)}` },
  crit: { name: 'Шанс крита', icon: 'crit', note: `предел ${pct(STAT_CURVE.crit.base + STAT_CURVE.crit.max)}` },
  critDmg: { name: 'Урон крита', icon: 'critdmg', note: `предел ${pct(STAT_CURVE.critDmg.base + STAT_CURVE.critDmg.max)}` },
  dodge: { name: 'Уклонение', icon: 'dodge', note: `от любых ударов, предел ${pct(STAT_CURVE.dodge.max)}` },
};

/** Where the pet stands beside the hero on the preview stage (hero-local, m); the hero steps aside for it. */
const PET_AT = new THREE.Vector3(0.75, 0, -0.35);
const HERO_AT_WITH_PET = new THREE.Vector3(-0.4, 0, 0.2);

/**
 * Rotatable 3D hero for the character sheet (own small renderer, disposed on close): the class on the field and,
 * for the hunter, his pet beside him; both turn together on one stage.
 */
class HeroPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  private stage = new THREE.Group();
  private ch: Character;
  private pet: Creature | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  yaw = 0.4;
  private vel = 0;
  private dragX: number | null = null;

  constructor(private canvas: HTMLCanvasElement, model: string, pet: PetDef | null = null) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3a3348, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 4, 4);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    rim.position.set(-3, 2, -3);
    this.scene.add(key, rim);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(pet ? 1.5 : 0.9, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
    );
    this.stage.add(floor);
    this.ch = new Character(model, null, 1);
    this.stage.add(this.ch.root);
    if (pet) {
      this.pet = new Creature(pet.model, pet.scale);
      this.pet.position.copy(PET_AT);
      this.stage.add(this.pet.root);
      this.ch.position.copy(HERO_AT_WITH_PET);
    }
    this.scene.add(this.stage);
    // with a pet: further back and a bit lower, so both fit
    if (pet) {
      this.camera.position.set(0, 1.25, 5.6);
      this.camera.lookAt(0, 0.65, 0);
    } else {
      this.camera.position.set(0, 1.05, 4.4);
      this.camera.lookAt(0, 0.85, 0);
    }

    canvas.addEventListener('pointerdown', (e) => { this.dragX = e.clientX; this.vel = 0; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      const dx = e.clientX - this.dragX;
      this.dragX = e.clientX;
      this.yaw += dx * 0.012;
      this.vel = dx * 0.012 * 60;
    });
    const up = () => { this.dragX = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.loop();
  }

  /**
   * `mainLeft`: the main weapon in the left hand (the mage's staff); `orb`: the mage's orb model over the shoulder;
   * `trims`: armour quality pieces (Game.trims).
   */
  setGear(weapon: string | null, left: string | null, outfit: Partial<Record<VisualPart, string>>, mainLeft = false, orb: string | null = null, trims: string[] = []) {
    this.ch.setWeapon(weapon, left, mainLeft);
    this.ch.setOrb(orb);
    this.ch.setOutfit(outfit);
    this.ch.setTrims(trims);
  }

  nudge(dir: number) { this.vel = dir * 5; }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.dragX === null) {
      this.yaw += this.vel * dt;
      this.vel *= Math.max(0, 1 - dt * 3);
    }
    this.stage.rotation.y = this.yaw;
    this.ch.update(dt, false);
    this.pet?.update(dt, false);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()))) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    // dispose() keeps the WebGL context alive until GC; past the browser's limit the oldest one,
    // the game's own, is lost and the world goes blank. Release it now.
    this.renderer.forceContextLoss();
  }
}

type BagFilter = 'all' | 'weapon' | 'armor';
type Source = { at: 'bag'; index: number } | { at: 'armor'; slot: ArmorSlot } | { at: 'weapon'; slot: 0 | 1 };

/** Inventory window: stats, the hero preview, the bag and the equipped slots. */


export class Inventory {
  private preview: HeroPreview | null = null;
  private opened = false;
  private bagFilter: BagFilter = 'all';

  constructor(private ui: UI, private game: Game) {}

  get isOpen() { return this.opened; }

  private cell(it: Item | null | undefined, attrs: string, placeholder = '', extra = '', cls = '') {
    return cellHtml(it, attrs, placeholder, extra, cls, this.game.wearer);
  }

  close() {
    this.ui.modal.removeEventListener('click', this.onClick);
    this.preview?.dispose();
    this.preview = null;
    this.opened = false;
    this.ui.close();
    this.game.refreshHud(true);
  }

  /** "Характеристики" panel of the inventory window: at the top of the screen, above the hero; "i" opens the full list. */
  private statsPanel() {
    return `<div class="top-stats">
      <div class="sc-title">Характеристики</div>
      <button class="info-btn" id="i-info" title="Все характеристики">i</button>
      <button class="xbtn" id="i-close" title="Закрыть">✕</button>
      <div class="big-stats" id="i-big"></div>
      <div class="chips" id="i-stats"></div>
    </div>`;
  }

  private renderStats() {
    const g = this.game;
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    const s = g.stats;
    const hit = g.itemDamage(g.weaponItem);
    const big = (ic: string, v: string, label: string) => `<div>${art(ic, 46)}<b>${v}</b><span>${label}</span></div>`;
    q('#i-big').innerHTML = big('dps', fmtK(g.heroDps()), 'урон/с') + big('heart', fmtK(g.maxHp), 'хп') +
      big('regen', fmtK(g.regen), 'хп/с');
    // a chip with `k` opens that stat's breakdown
    const chip = (ic: string, v: string, title: string, k?: StatId) =>
      `<div class="chip" title="${title}"${k ? ` data-stat="${k}"` : ''}>${art(ic, 28)}<b>${v}</b></div>`;
    q('#i-stats').innerHTML = chip('hit', fmtK(Math.round(hit)), 'Урон за удар', 'power') +
      chip('defense', `${g.defense} <small>−${pct(1 - armorMul(g.defense))}</small>`, 'Защита', 'defense') +
      chip('run', `${g.speed.toFixed(1)} <small>м/с</small>`, 'Скорость', 'speed') +
      chip('crit', pct(s.crit), 'Шанс крита', 'crit') +
      chip('critdmg', `×${s.critMul.toFixed(2)}`, 'Урон крита', 'critDmg') +
      chip('dodge', pct(s.dodge), 'Уклонение', 'dodge');
  }

  /** The window over the inventory (#i-sw): the full stat list or one stat's breakdown. */
  private get statWrap() { return this.ui.modal.querySelector<HTMLElement>('#i-sw')!; }

  private showWin(title: string, sub: string, body: string, onClose: () => void, icon = '') {
    const wrap = this.statWrap;
    wrap.innerHTML = `<div class="stats-win">
      <div class="sw-head"><h2>${icon ? art(icon, 44) : ''}${title}</h2>${sub ? `<small>${sub}</small>` : ''}<button class="xbtn" id="i-sw-x">✕</button></div>
      <div class="sw-list">${body}</div>
    </div>`;
    wrap.classList.remove('hidden');
    wrap.querySelector('#i-sw-x')!.addEventListener('click', (e) => { e.stopPropagation(); sfx.click(); onClose(); });
  }

  /**
   * One stat taken apart: "Базовое" — the flat parts by source, "Процент" — the percents (hp, regen, damage),
   * then the formula: sum × percents = value, and for the curve stats `points >>> effect`.
   * `fromList`: ✕ goes back to the full stat list.
   */
  private showStat(k: StatId, fromList: boolean) {
    const g = this.game;
    const s = g.stats;
    const b = statBreakdown(g.save, k);
    // damage: the main weapon's own damage is one of the flat parts
    if (k === 'power') {
      b.flat.splice(1, 0, ['weapon', weaponBase(g.weaponItem)]);
      b.sum += weaponBase(g.weaponItem);
      b.value = b.sum * b.mult;
    }
    const line = (name: string, v: string) => `<div class="sd-row"><span>${name}</span><b>${v}</b></div>`;
    const sign = (n: number) => (n < 0 ? `−${fmtK(-n)}` : `+${fmtK(n)}`);
    const flat = `<div class="sd-sec"><div class="sd-top"><span>Базовое</span><b>${sign(b.sum)}</b></div>` +
      b.flat.map(([src, v]) => line(STAT_SOURCE_NAME[src], sign(v))).join('') + '</div>';
    const pcts = isPctStat(k) && b.pct.length
      ? `<div class="sd-sec"><div class="sd-top"><span>Процент</span><b>×${b.mult.toFixed(2)}</b></div>` +
        b.pct.map(([src, v]) => line(STAT_SOURCE_NAME[src], `${sign(v)} (×${(1 + v / 100).toFixed(2)})`)).join('') + '</div>'
      : '';
    const w = g.weapon;
    const effect: Partial<Record<StatId, string>> = {
      power: `${fmtK(Math.round(g.itemDamage(g.weaponItem)))} за удар <small>(×${w.dmgMul} ${w.name.toLowerCase()})</small>`,
      speed: `${s.speed.toFixed(2)} м/с`,
      defense: `−${pct1(1 - armorMul(s.defense))} урона`,
      crit: pct1(s.crit),
      critDmg: pct1(s.critMul),
      dodge: pct1(s.dodge),
    };
    const total = isPctStat(k)
      ? `${fmtK(b.sum)} × ${b.mult.toFixed(2)} = <b>${fmtK(k === 'hp' ? Math.round(b.value) : b.value)}${k === 'regen' ? ' хп/с' : ''}</b>`
      : `${fmtK(b.sum)} = <b>${fmtK(b.sum)}</b>`;
    const formula = `<div class="sd-formula">${total}${effect[k] ? ` <i>&gt;&gt;&gt;</i> <b>${effect[k]}</b>` : ''}</div>`;
    const ui = STAT_UI[k];
    this.showWin(ui.name, ui.note, flat + pcts + formula, () => (fromList ? this.showInfo() : this.statWrap.classList.add('hidden')), ui.icon);
  }

  /** Full list of the hero's stats ("i" on the stats panel). */
  private showInfo() {
    const g = this.game;
    const f = FACTIONS[g.faction];
    const w = g.weapon;
    const s = g.stats;
    // each row opens its stat's breakdown (showStat)
    const stat = (k: StatId, value: string, note = '') =>
      `<div class="sw-row link" data-stat="${k}" data-from="list">${art(STAT_UI[k].icon, 40)}<div class="sw-name">${STAT_UI[k].name}${note ? `<small>${note}</small>` : ''}</div><b>${value}</b><span class="sw-go">›</span></div>`;
    const rows = [
      // the same total as the breakdown: (weapon + power) × percents
      stat('power', fmtK((weaponBase(g.weaponItem) + s.power) * s.powerMul), 'вместе с оружием'),
      stat('hp', fmtK(g.maxHp)),
      stat('regen', `${fmtK(g.regen)} хп/с`),
      stat('defense', String(g.defense), `−${pct(1 - armorMul(g.defense))} входящего урона`),
      stat('speed', `${g.speed.toFixed(2)} м/с`, `${g.speedStat} очков`),
      stat('crit', pct1(s.crit), `${s.critPts} очков`),
      stat('critDmg', pct1(s.critMul), `${s.critDmgPts} очков`),
      stat('dodge', pct1(s.dodge), `${s.dodgePts} очков`),
    ].join('');
    this.showWin('Характеристики', `${f.name} · ${w.name}`, rows, () => this.statWrap.classList.add('hidden'));
  }

  // ---------- inventory window: stats on top, then the hero with the equipped slots, the bag sheet at the bottom ----------
  open() {
    if (this.opened) return;
    this.opened = true;
    const tab = (bf: BagFilter, ic: string) => `<button class="tab ${this.bagFilter === bf ? 'on' : ''}" data-filter="${bf}">${art(ic, 34)}</button>`;
    this.ui.open(`${this.statsPanel()}
    <div class="inv-equipped"><div class="eq-title">Экипировано</div>
      <div class="eq-doll">
        <div class="eq-side" id="i-eq-l"></div>
        <div class="eq-stage"><canvas id="i-canvas"></canvas><div class="eq-rot"><button id="i-rl">↶</button><button id="i-rr">↷</button></div></div>
        <div class="eq-w" id="i-eq-w"></div>
        <div class="eq-side" id="i-eq-r"></div>
      </div>
    </div>
    <div class="sheet inv">
      <div class="sheet-head"><div class="sheet-title">Инвентарь</div></div>
      <div class="tabs">${tab('all', 'bag')}${tab('weapon', 'sword')}${tab('armor', 'chest')}<span class="cap" id="b-sub"></span></div>
      <div class="sheet-body"><div id="b-grid"></div></div>
      <p class="hint-line">Нажми на предмет: надеть, сравнить или выбросить</p>
    </div>`);
    this.preview = new HeroPreview(this.ui.modal.querySelector('#i-canvas')!, this.game.heroModel(), this.game.petDef);
    this.ui.on('#i-close', () => this.close());
    this.ui.on('#i-info', () => this.showInfo());
    this.ui.modal.querySelector('#i-rl')!.addEventListener('click', () => this.preview?.nudge(-1));
    this.ui.modal.querySelector('#i-rr')!.addEventListener('click', () => this.preview?.nudge(1));
    this.ui.modal.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      sfx.click();
      this.bagFilter = b.dataset.filter as BagFilter;
      this.ui.modal.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
      this.renderBag();
    }));
    this.ui.modal.insertAdjacentHTML('beforeend', '<div class="tip-wrap hidden" id="i-tip"><div class="tip"></div></div><div class="tip-wrap hidden" id="i-sw"></div>');
    const sw = this.ui.modal.querySelector<HTMLElement>('#i-sw')!;
    sw.addEventListener('click', (e) => { if (e.target === sw) sw.classList.add('hidden'); });
    this.ui.modal.addEventListener('click', this.onClick);
    this.rerender();
  }

  /** "Экипировано", laid out like the Warcraft character frame: armour in columns on both sides of the hero, weapons under him. */
  private renderChar() {
    const g = this.game;
    const s = g.save;
    const armor = (ids: ArmorSlot[]) => ids.map((id) => {
      const x = ARMOR_SLOTS.find((a) => a.id === id)!;
      return this.cell(s.equip[id], `data-armor="${id}" title="${x.name}"`, x.icon);
    }).join('');
    const pet = g.petDef;
    const weapons = ([0, 1] as const).map((i) => {
      if (i === 1 && pet) return petCellHtml(pet, `title="Питомец: ${pet.name}"`, 'active', '<span class="wtag on">питомец</span>');
      const tag = `<span class="wtag ${s.weapons[i] ? 'on' : ''}">${g.slotName(i).toLowerCase()}</span>`;
      return this.cell(s.weapons[i], `data-weapon="${i}"`, i ? 'shield' : 'sword', tag, s.weapons[i] ? 'active' : '');
    }).join('');
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    q('#i-eq-l').innerHTML = armor(EQUIP_BAR.left);
    q('#i-eq-w').innerHTML = weapons;
    q('#i-eq-r').innerHTML = armor(EQUIP_BAR.right);
    this.preview?.setGear(...g.heldModels(), g.outfit(), g.staffInHand(), g.orbModel(), g.trims());
    g.newItems = 0;
  }

  private renderBag() {
    const g = this.game;
    const s = g.save;
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    // only what the class on the field can use; the rest stays in the bag (and takes room) for the others
    const hidden = s.bag.filter((it) => !g.canUse(it)).length;
    q('#b-sub').innerHTML = `<span>${s.bag.length}/${BAG_SIZE}</span>${hidden ? `<small class="b-other">ещё ${hidden} для других классов</small>` : ''}`;
    const section = (kind: 'weapon' | 'armor', title: string) => {
      const cells = s.bag.map((it, i) => (it.kind === kind && g.canUse(it) ? this.cell(it, `data-bag="${i}"`) : '')).join('');
      return cells ? `<div class="divider"><span>${title}</span></div><div class="grid">${cells}</div>` : '';
    };
    const f = this.bagFilter;
    const html = (f !== 'armor' ? section('weapon', 'Оружие') : '') + (f !== 'weapon' ? section('armor', 'Броня') : '');
    q('#b-grid').innerHTML = html || '<div class="none">Пусто. Предметы падают с мобов, боссов и из разрушаемых объектов</div>';
    this.game.newItems = 0;
  }

  private rerender() {
    if (!this.opened) return;
    this.renderStats();
    this.renderChar();
    this.renderBag();
  }

  // ---------- item tooltip ----------
  private onClick = (e: Event) => {
    const st = (e.target as HTMLElement).closest<HTMLElement>('[data-stat]');
    if (st) {
      sfx.click();
      this.showStat(st.dataset.stat as StatId, st.dataset.from === 'list');
      return;
    }
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bag],[data-armor],[data-weapon],[data-act]');
    if (!t) {
      if (!(e.target as HTMLElement).closest('.tip')) this.hideTip();
      return;
    }
    if (t.dataset.act) return;
    if (t.dataset.bag !== undefined) this.showTip({ at: 'bag', index: +t.dataset.bag });
    else if (t.dataset.armor) this.showTip({ at: 'armor', slot: t.dataset.armor as ArmorSlot });
    else if (t.dataset.weapon !== undefined) this.showTip({ at: 'weapon', slot: +t.dataset.weapon as 0 | 1 });
  };

  private itemOf(src: Source): Item | null {
    const s = this.game.save;
    if (src.at === 'bag') return s.bag[src.index] ?? null;
    if (src.at === 'armor') return s.equip[src.slot] ?? null;
    return s.weapons[src.slot];
  }

  private hideTip() {
    this.ui.modal.querySelector('#i-tip')?.classList.add('hidden');
  }

  private showTip(src: Source) {
    const wrap = this.ui.modal.querySelector<HTMLElement>('#i-tip');
    if (!wrap) return;
    const tip = wrap.querySelector<HTMLElement>('.tip')!;
    const g = this.game;
    const s = g.save;
    const it = this.itemOf(src);
    sfx.click();
    const x = '<button class="xbtn" data-act="close">✕</button>';
    wrap.classList.remove('hidden');
    if (!it) {
      const off = src.at === 'weapon' && src.slot === 1;
      const name = src.at === 'armor' ? SLOT_NAME[src.slot] : g.slotName(off ? 1 : 0);
      const ph = src.at === 'armor' ? ARMOR_SLOTS.find((a) => a.id === src.slot)!.icon : off ? 'shield' : 'sword';
      tip.innerHTML = `<div class="card-head">${cellHtml(null, 'disabled', ph, '', 'big')}<div class="card-title"><h3>${name}</h3></div>${x}</div>
        <div class="ability well"><p>Слот пуст. Подходящие предметы лежат в сумке.</p></div>`;
      this.bindTip(tip, src);
      return;
    }
    const r = RARITY[it.rarity];
    const slot = slotOf(it);
    // Compare a bag item with what is equipped in the same slot.
    let cur: Item | null = null;
    const hand = it.kind === 'weapon' ? classSlot(g.heroClass, it.def) : null;
    if (src.at === 'bag') cur = slot === 'weapon' ? (hand !== null ? s.weapons[hand] : null) : (s.equip[slot] ?? null);
    const theirs = cur ? Object.fromEntries(itemLines(cur)) : {};
    const cmp = (k: string, v: string) => {
      const o = theirs[k];
      const nv = parseFloat(v.replace('+', ''));
      const ov = o !== undefined ? parseFloat(String(o).replace('+', '')) : NaN;
      const cls = Number.isNaN(nv) || Number.isNaN(ov) ? '' : nv > ov ? 'up' : nv < ov ? 'down' : '';
      return cur && o !== undefined && o !== v ? `<i>${o}</i><em>›</em><b class="${cls}">${v}</b>` : `<b>${v}</b>`;
    };
    const [main, ...rest] = itemLines(it).filter(([k]) => k !== 'Тип');
    // the stat's own icon: the coloured sword for damage, the coloured shield for defense (and a shield's block)
    const mainIcon = it.kind === 'weapon' && !WEAPONS[it.def].guard ? art('dps', 30) : art('defense', 30);
    const sub = rest.map(([k, v]) => `<div><span>${k}</span>${cmp(k, v)}</div>`).join('');
    let ability: string;
    const orb = it.kind === 'weapon' ? WEAPONS[it.def].orb : undefined;
    if (orb) {
      const v = orbLine(orb)[1];
      const what = orb.pull ? `<b>${v}</b> шанс выбить крутку в горнило с каждого моба`
        : orb.critDmg ? `каждый удар получает случайно <b>${v}</b> к крит. урону`
        : `<b>${v}</b> ${orb.regen ? 'к регену здоровья' : orb.speed ? 'к скорости бега' : orb.defense ? 'к защите' : 'к урону'}`;
      ability = `<div class="ab-title">Сфера</div><p>Второй слот мага, парит над правым плечом. Пока надета: ${what}.</p>`;
    } else if (it.kind === 'weapon') {
      const c = COMBOS[it.def];
      ability = !c ? '' : `<div class="ab-title">Добивание: ${c.name}</div><p>Третий удар комбо подряд бьёт ${c.shape === 'circle' ? '<b>по кругу</b>' : `<b>дугой ${c.arc}°</b>`} с уроном <b>×${c.mult}</b>${c.stun ? ` и оглушает на <b>${c.stun} с</b>` : ''}.</p>`;
      const w = WEAPONS[it.def];
      if (w.staff === 'fire') {
        const f = STAVES.fire;
        ability = `<div class="ab-title">Поджог</div><p>Бьёт на <b>${w.range} м</b>. Враги в <b>${f.splash.radius} м</b> от цели получают <b>×${f.splash.mul}</b> урона. Задетые горят <b>${f.burn.time} с</b> и получают <b>+${Math.round(f.burn.vuln * 100)}%</b> урона от всего.</p>` + ability;
      }
      if (w.staff === 'ice') {
        const f = STAVES.ice;
        ability = `<div class="ab-title">Стужа</div><p>Бьёт на <b>${w.range} м</b>, одну цель. Замедляет врага на <b>${Math.round((1 - f.slow.mul) * 100)}%</b> на <b>${f.slow.time} с</b>. Каждый <b>${f.freeze.every}-й</b> удар подряд по одному врагу замораживает его на <b>${f.freeze.time} с</b> (кроме мини-боссов и боссов).</p>` + ability;
      }
      if (w.staff === 'wind') {
        const o = STAVES.wind.orb;
        ability = `<div class="ab-title">Вихрь</div><p>Бьёт на <b>${w.range} м</b> и отбрасывает врагов. Каждый <b>${o.every}-й</b> удар бросает вихрь: <b>×${o.dmg}</b> урона в радиусе <b>${o.radius} м</b>, враги (и боссы) стягиваются к центру.</p>` + ability;
      }
      if (w.guard) ability = `<div class="ab-title">Защита</div><p>−${Math.round(w.guard.reduce * 100)}% входящего урона. Удар по герою с шансом <b>${Math.round(w.guard.counter.normal * 100)}–${Math.round(w.guard.counter.boss * 100)}%</b> (чем сильнее враг, тем выше) вызывает контратаку оружием.${w.guard.reflect ? ` <b>${Math.round(w.guard.reflect * 100)}%</b> полученного урона возвращается атакующему.` : ''} Сам не бьёт.</p>`;
    } else {
      ability = `<div class="ab-title">Комплект</div><p>${it.rarity > 0 || rest.length ? 'Бонус к стату действует, пока предмет надет.' : 'У обычных предметов нет бонуса. Ищи <b>необычные</b> и выше.'}</p>`;
    }
    const btn = (act: string, label: string, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
    let actions = '';
    if (src.at === 'bag') {
      actions = btn('discard', 'Выбросить');
      if (g.canUse(it)) actions += btn('equip', 'Экипировать', 'primary');
      else actions += `<span class="none">Не для класса «${CLASSES[g.heroClass].name}»</span>`;
    } else if (src.at === 'armor') {
      actions = btn('unequip', 'Снять', 'red');
    } else {
      if (src.slot === 1) actions += btn('unequip', 'Снять', 'red');
    }
    // a class item (shield, orb) shows its slot's name instead of a damage type
    const offOf = it.kind === 'weapon' && (WEAPONS[it.def].guard || WEAPONS[it.def].orb) ? weaponClass(it.def) : null;
    const type = offOf ? CLASSES[offOf].offName : slot === 'weapon' ? `${icon(DAMAGE_TYPE_ICON[WEAPONS[it.def].type], '#fff', 14)} ${DAMAGE_TYPE_NAME[WEAPONS[it.def].type]}` : SLOT_NAME[ARMOR[it.def].slot];
    tip.innerHTML = `<div class="card-head">${cellHtml(it, 'disabled', '', '', 'big', this.game.wearer)}
        <div class="card-title"><h3>${itemName(it, g.faction)}${it.sharpen ? ` +${it.sharpen}` : ''}</h3>
          <div class="pills"><span class="rar" style="color:${r.color}">${r.name}</span><span class="typ">${type}</span></div></div>${x}</div>
      <div class="card-main well"><span>${main[0]}</span><span class="v">${mainIcon}${cmp(main[0], main[1])}</span></div>
      <div class="card-sub">${sub}<div><span>Уровень</span><b>${it.lvl}</b></div></div>
      ${cur ? '<div class="cmp-note">сравнение с надетым</div>' : ''}
      <div class="ability well">${ability}</div>
      <div class="row">${actions}</div>`;
    this.bindTip(tip, src);
  }

  private bindTip(tip: HTMLElement, src: Source) {
    tip.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (b.dataset.act === 'close') { sfx.click(); this.hideTip(); return; }
      this.act(b.dataset.act!, src);
    }));
  }

  private act(action: string, src: Source) {
    const g = this.game;
    let ok = true;
    if (src.at === 'bag') {
      if (action === 'equip') g.equipFromBag(src.index);
      else if (action === 'discard') g.discardFromBag(src.index);
    } else if (src.at === 'armor') {
      ok = g.unequipArmor(src.slot);
    } else if (action === 'unequip') {
      ok = g.unequipWeapon(src.slot);
    }
    if (!ok) this.ui.toast('Сумка полна');
    this.hideTip();
    this.rerender();
  }
}
