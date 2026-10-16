import * as THREE from 'three';
import {
  FACTIONS, fmtOrb, UI_REF, WEAPONS, ZONE_FOES,
  type FactionId, type OrbKind, type PetDef, type ZoneDef,
} from './config';
import { ARMOR_SLOTS, EQUIP_BAR, cellHtml, petCellHtml, type ArmorSlot, type Item } from './items';
import { CLASS_DAMAGE_ICON, fmtK, hasIcon, icon, iconImage, resistIcons, rewardChips } from './icons';
import { STAT_ICON, art, hasPng, mini, tintedArt, whiteArt } from './art';
import type { MobDef } from './config';
import { sfx } from './audio';
import type { World } from './world';
import { CLASSES, CLASS_IDS, type HeroClass } from './party';
import type { Wearer } from './looks';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
/** Seconds a "+N stat" line stays under the buffs after the last orb of that stat. */
const GAIN_SHOW = 2.5;

export interface HudState {
  hp: number; maxHp: number;
  stats: { power: number; hp: number; regen: number; speed: number };
  buffs: string[];
  /** Boss widgets on the left: seconds until respawn, 0 = alive. */
  bosses: { name: string; left: number }[];
}

/** Butcher-style timer: 9ч 23м, 4м 05с, 12с. */
function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${String(s).padStart(2, '0')}с`;
  return `${s}с`;
}

/** One line of a dialogue; a line with choices waits for an answer (GDD 4.2: no wrong answers). */
export interface DialogueLine {
  who: string;
  /** Art icon id (src/art.ts) shown in the round portrait. */
  portrait: string;
  text: string;
  choices?: { text: string; then?: DialogueLine[] }[];
}

/** A special unit on the map (see Game.mapMarks). */
export interface MapMark {
  x: number; z: number;
  kind: 'boss' | 'mini' | 'elite';
  alive: boolean;
  color: string;
  /** icons.ts id: skull, or the elite's drop (weapon id / armour slot) */
  icon: string;
  /** The class the elite's drop is for: its badge at the tile's corner. */
  cls?: HeroClass;
  name: string;
  respawnIn: number;
  /** Dead: how far its respawn has come, 0..1 (the ring loader around the faded mark). */
  respawnP: number;
  /** A main boss's drop: a small framed item badge at the skull's corner. */
  drop?: { icon: string; color: string; cls?: HeroClass };
}

/** An item icon on a tile of its quality colour (elites and bosses' drops on the maps); `cls`: whose item, a badge at the corner. */
function framedItem(g: CanvasRenderingContext2D, x: number, y: number, r: number, id: string, color: string, s: number, cls?: HeroClass) {
  // the tile is filled with the quality colour (thin dark edge), the item's own icon on it in white
  g.fillStyle = color;
  g.strokeStyle = '#000';
  g.lineWidth = 1.5 * s;
  g.beginPath();
  g.roundRect(x - r, y - r, r * 2, r * 2, 5 * s);
  g.fill();
  g.stroke();
  // the bow has no plain icon: its common-quality one
  const png = hasPng(id) ? id : !hasIcon(id) && hasPng(`${id}_common`) ? `${id}_common` : null;
  const img = png ? whiteArt(png) : iconImage(id, '#fff', Math.max(8, Math.ceil(r * 1.6 * g.getTransform().a)));
  const h = r * 0.8;
  if (img && (!(img instanceof HTMLImageElement) || img.complete)) g.drawImage(img, x - h, y - h, h * 2, h * 2);
  if (cls) classBadge(g, x + r * 0.85, y - r * 0.85, r * 0.55, cls, s);
}

/** Respawn loader on the map: a dark ring, filled clockwise from the top by `p` (0..1); no numbers. */
function respawnRing(g: CanvasRenderingContext2D, x: number, y: number, r: number, p: number, s: number) {
  g.lineWidth = 3.5 * s;
  g.strokeStyle = '#000a';
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.2 * s;
  g.strokeStyle = '#7dff6a';
  g.beginPath();
  g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.max(0, p)));
  g.stroke();
}

/** Whose item it is: a round badge in the class colour with the class icon (the warrior's shield). */
function classBadge(g: CanvasRenderingContext2D, x: number, y: number, r: number, cls: HeroClass, s: number) {
  const d = CLASSES[cls];
  g.fillStyle = d.color[1];
  g.strokeStyle = '#000';
  g.lineWidth = 1.5 * s;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  if (!hasIcon(d.icon)) return;
  const img = iconImage(d.icon, '#fff', Math.max(8, Math.ceil(r * 1.6 * g.getTransform().a)));
  if (img.complete) g.drawImage(img, x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
}

/**
 * Map marks on a canvas (minimap and the big map): a big red skull for the main boss (an hourglass while
 * it is dead), a smaller orange skull for a micro-boss, the drop's icon in a quality-coloured frame for an elite.
 */
export function drawMarks(g: CanvasRenderingContext2D, marks: MapMark[], X: (x: number) => number, Y: (z: number) => number, s = 1) {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // bosses on top
  const order = { elite: 0, mini: 1, boss: 2 };
  for (const m of [...marks].sort((a, b) => order[a.kind] - order[b.kind])) {
    const x = X(m.x);
    const y = Y(m.z);
    const r = (m.kind === 'boss' ? 19 : 13) * s;
    // dead: the mark stays at the spawn point, faded, inside a ring that fills up until the respawn
    g.globalAlpha = m.alive ? 1 : 0.45;
    if (m.kind === 'elite') framedItem(g, x, y, r, m.icon, m.color, s, m.cls);
    else {
      // the main boss: the horned skull in red; a micro-boss: the round skull in orange
      const img = tintedArt(m.kind === 'boss' ? 'boss' : 'skull', m.color);
      if (img) g.drawImage(img, x - r, y - r, r * 2, r * 2);
      if (m.drop) framedItem(g, x + r * 0.8, y + r * 0.7, 8 * s, m.drop.icon, m.drop.color, s * 0.7, m.drop.cls);
    }
    g.globalAlpha = 1;
    if (!m.alive) respawnRing(g, x, y, r * 1.35, m.respawnP, s);
  }
  g.restore();
}

/** A drop flying into a HUD button (UI.fly). */
export type FlyEl = HTMLDivElement & { to: 'btn-bag' | 'btn-gacha'; item?: Item };
const removeSelf = (e: Event) => (e.currentTarget as HTMLElement).remove();

export class UI {
  readonly app = $('app');
  readonly modal = $('modal');
  private bannerT = 0;
  private hintT = 0;
  private lastHud = '';
  /** Location clear bar: the location on it, its share (0..1), the number shown (counts up) and that count's frame. */
  private clr = { zone: '', p: 0, shown: 0, raf: 0, bannerT: 0 };
  onSettings: () => void = () => {};
  onBag: () => void = () => {};
  onGacha: () => void = () => {};
  onMap: () => void = () => {};
  onArmor: () => void = () => {};
  onDebug: () => void = () => {};
  onClass: (c: HeroClass) => void = () => {};
  /** A flying drop (fly) has reached its button. */
  onFlyEnd: (el: FlyEl) => void = () => {};
  private gains = new Map<OrbKind, { el: HTMLDivElement; n: number; until: number }>();
  private mm = $<HTMLCanvasElement>('minimap').getContext('2d')!;

  constructor() {
    $('btn-settings').addEventListener('click', () => { sfx.click(); this.onSettings(); });
    $('btn-bag').addEventListener('click', () => { sfx.click(); this.onBag(); });
    $('btn-gacha').addEventListener('click', () => { sfx.click(); this.onGacha(); });
    $('minimap').addEventListener('click', () => { sfx.click(); this.onMap(); });
    $('bosses').addEventListener('click', () => { sfx.click(); this.onMap(); });
    $('btn-settings').innerHTML = art('gear', 40);
    $('btn-bag').insertAdjacentHTML('afterbegin', art('bag', 48));
    $('btn-gacha').insertAdjacentHTML('afterbegin', art('anvil', 44));
    $('equipbar').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-armor]')) return;
      sfx.click();
      this.onArmor();
    });
    const party = $('party');
    party.innerHTML = CLASS_IDS.map((c, i) => {
      const d = CLASSES[c];
      return `<button class="ui-block round-btn cls${d.locked ? ' locked' : ''}" data-cls="${c}" style="--c1:${d.color[0]};--c2:${d.color[1]}" aria-label="${d.name} (${i + 1})">${art(d.icon, 40)}<b>${i + 1}</b></button>`;
    }).join('');
    party.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cls]');
      if (b) this.onClass(b.dataset.cls as HeroClass);
    });
    const stats = $('stats');
    stats.innerHTML = (['power', 'hp', 'regen', 'speed'] as OrbKind[])
      .map((k) => `<div class="st" data-k="${k}">${art(STAT_ICON[k], 26)}<span></span></div>`)
      .join('');
  }

  size() { return { w: this.app.clientWidth, h: this.app.clientHeight }; }
  /** HUD scale: #hud / #pro-hud are a UI_REF.hud rectangle centred on the screen and scaled by --hs (windows: --ms). */
  scale = 1;
  fit() {
    const { w, h } = this.size();
    const { hud, modal } = UI_REF;
    this.scale = Math.min(w / hud.w, h / hud.h);
    const st = this.app.style;
    st.setProperty('--hs', String(this.scale));
    st.setProperty('--ms', String(Math.min(w / modal.w, h / modal.h)));
    st.setProperty('--hw', `${hud.w}px`);
    st.setProperty('--hh', `${hud.h}px`);
    st.setProperty('--mw', `${modal.w}px`);
    st.setProperty('--mh', `${modal.h}px`);
  }

  /** Screen px of #app → px inside the centred, scaled HUD rectangle. */
  toHud(x: number, y: number) {
    const { w, h } = this.size();
    const s = this.scale;
    return { x: (x - (w - UI_REF.hud.w * s) / 2) / s, y: (y - (h - UI_REF.hud.h * s) / 2) / s };
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
    (hp.querySelector('.fill') as HTMLElement).style.width = `${(s.hp / s.maxHp) * 100}%`;
    (hp.querySelector('span') as HTMLElement).textContent = `${fmtK(Math.ceil(s.hp))} / ${fmtK(s.maxHp)}`;
    const st = s.stats;
    const vals: Record<OrbKind, string> = {
      power: fmtK(st.power), hp: fmtK(st.hp), regen: fmtK(st.regen), speed: fmtK(st.speed),
    };
    $('stats').querySelectorAll<HTMLElement>('.st').forEach((el) => {
      (el.querySelector('span') as HTMLElement).textContent = vals[el.dataset.k as OrbKind];
    });
    $('buffs').innerHTML = s.buffs.map((b) => `<div>${b}</div>`).join('');
    $('bosses').innerHTML = s.bosses.map((b) => `<div class="bw ui-block" title="${b.name}">
      ${b.left > 0 ? '' : '<div class="bw-ready">Готово!</div>'}${art('skull', 62, b.left > 0 ? 'dim' : '')}
      ${b.left > 0 ? `<div class="bw-time">${art('hourglass', 20)}${fmtTime(b.left)}</div>` : `<div class="bw-name">${b.name}</div>`}</div>`).join('');
  }

  popStat(k: OrbKind) {
    const el = $('stats').querySelector<HTMLElement>(`[data-k="${k}"]`);
    if (!el) return;
    el.classList.add('pop');
    setTimeout(() => el.classList.remove('pop'), 150);
  }


  combo(n: number, max: number) {
    const el = $('combo');
    el.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    el.classList.toggle('live', n > 0);
  }

  /** Kill rewards centred under the minimap's level: one line per stat, summing kills in a row. */
  gain(k: OrbKind, now: number) {
    let g = this.gains.get(k);
    if (!g) {
      const el = document.createElement('div');
      el.className = 'gain';
      const box = $('gains');
      // #hud is scaled by --hs: the minimap's screen bottom back in HUD pixels
      box.style.top = `${($('minimap').getBoundingClientRect().bottom - $('hud').getBoundingClientRect().top) / this.scale + 12}px`;
      box.appendChild(el);
      g = { el, n: 0, until: 0 };
      this.gains.set(k, g);
    }
    g.n++;
    g.until = now + GAIN_SHOW;
    g.el.innerHTML = `${mini(STAT_ICON[k], 22)}${fmtOrb(k, g.n)}`;
    g.el.classList.remove('pop');
    void g.el.offsetWidth; // restart the pop animation
    g.el.classList.add('pop');
  }

  tickGains(now: number) {
    for (const [k, g] of this.gains) if (now > g.until) { g.el.remove(); this.gains.delete(k); }
  }

  /**
   * A drop's icon glowing in `color` flies from (x, y) (#app pixels) into the bag or forge button;
   * on arrival the button pulses, a "+1" pops out of it and onFlyEnd gets the element (its `item` / `to`).
   */
  fly(html: string, color: string, x: number, y: number, to: FlyEl['to'], item?: Item) {
    const el = document.createElement('div') as FlyEl;
    el.className = 'fly';
    el.innerHTML = html;
    el.to = to;
    el.item = item;
    el.style.setProperty('--glow', color);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--s', String(this.scale));
    this.app.appendChild(el);
    const a = this.app.getBoundingClientRect();
    const b = $(to).getBoundingClientRect();
    el.style.setProperty('--dx', `${b.left + b.width / 2 - a.left - x}px`);
    el.style.setProperty('--dy', `${b.top + b.height / 2 - a.top - y}px`);
    el.addEventListener('animationend', this.flyEnd);
  }

  private flyEnd = (e: AnimationEvent) => {
    const el = e.currentTarget as FlyEl;
    el.remove();
    const btn = $(el.to);
    btn.classList.remove('pulse');
    void btn.offsetWidth; // restart the pulse
    btn.classList.add('pulse');
    const plus = document.createElement('div');
    plus.className = 'plus1';
    plus.textContent = '+1';
    plus.addEventListener('animationend', removeSelf);
    btn.appendChild(plus);
    sfx.orb();
    this.onFlyEnd(el);
  };

  /** Pulls the hero can spend in the forge. */
  gachaBadge(n: number) {
    $('btn-gacha').dataset.badge = n > 0 ? String(n) : '';
  }

  /** Greys out the party buttons of the closed classes. */
  lockClasses(closed: (c: HeroClass) => boolean) {
    $('party').querySelectorAll<HTMLElement>('[data-cls]').forEach((b) => b.classList.toggle('locked', closed(b.dataset.cls as HeroClass)));
  }

  /** Party buttons bottom-right: the class on the field is lit; `charge` is its staff counter badge ('' = none). */
  party(active: HeroClass, charge = '', color = '') {
    $('party').querySelectorAll<HTMLElement>('[data-cls]').forEach((b) => {
      const on = b.dataset.cls === active;
      b.classList.toggle('on', on);
      b.dataset.charge = on ? charge : '';
      if (on && color) b.style.setProperty('--cc', color);
    });
  }

  bagBadge(n: number, full: boolean) {
    const b = $('btn-bag');
    b.dataset.badge = full ? '!' : n > 0 ? String(n) : '';
  }

  /**
   * Bottom "equipped" bar: armour left, the weapon and the class item (shield, or the hunter's `pet`) in the centre,
   * gloves and jewellery right.
   */
  weapons(items: (Item | null)[], dmg: (it: Item) => number, equip: Partial<Record<ArmorSlot, Item>>, w: Wearer, pet: PetDef | null = null) {
    const box = $('weapons');
    box.innerHTML = [0, 1].map((i) => {
      if (i === 1 && pet) return petCellHtml(pet, `data-pet title="Питомец: ${pet.name}"`, 'wslot active');
      const it = items[i];
      const title = !it ? '' : WEAPONS[it.def].guard ? `title="${WEAPONS[it.def].name}"` : `title="${WEAPONS[it.def].name}: ${Math.round(dmg(it))} урона"`;
      return cellHtml(it, `data-w="${i}" ${title}`, i ? 'shield' : 'sword', '', it ? 'wslot active' : 'wslot', w);
    }).join('');
    const side = (ids: ArmorSlot[]) => ids.map((id) => {
      const x = ARMOR_SLOTS.find((s) => s.id === id)!;
      return cellHtml(equip[id], `data-armor="${id}" title="${x.name}"`, x.icon, '', '', w);
    }).join('');
    $('armor-l').innerHTML = side(EQUIP_BAR.left);
    $('armor-r').innerHTML = side(EQUIP_BAR.right);
  }

  /** A one-off line in the zone banner's place (the gate cutscene). */
  banner(text: string) {
    const el = $('zone-banner');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  zoneBanner(z: ZoneDef) {
    const f = ZONE_FOES[z.id];
    // over the minimap: which classes the location's enemies are weak to (green)
    // both halves of the Snow Pass (ZoneFoes.alt)
    const weak = [...new Set([...(f?.weak ?? []), ...(f?.alt?.weak ?? [])])];
    const resist = [...new Set([...(f?.resist ?? []), ...(f?.alt?.resist ?? [])])];
    const names = (cs: HeroClass[]) => cs.map((c) => CLASSES[c].name.toLowerCase()).join(', ');
    $('zone-foes').innerHTML = weak
      .map((c) => `<i class="foe weak" title="Слабость врагов: ${CLASSES[c].name}">${icon(CLASS_DAMAGE_ICON[c], '#fff', 22)}</i>`).join('');
    const el = $('zone-banner');
    const tags = [weak.length ? `Слабость: ${names(weak)}` : '', resist.length ? `Сопротивление: ${names(resist)}` : ''].filter(Boolean);
    el.innerHTML = z.name + (tags.length ? `<small>${tags.join(' · ')}</small>` : f || z.id === 'forest' ? '' : '<small>Безопасная зона</small>');
    el.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  /**
   * Top bar: how much of the location is cleared (`dead` of its `total` enemies). A gain fills it with a catch-up
   * (a bright ghost jumps ahead, the fill springs after it), a counting-up number, a "+N%" pop, a shine sweep and
   * the 25/50/75% ticks lighting up; reaching 100% plays the "cleared" banner and confetti. A new location sets the
   * bar at once; respawns take it down quietly.
   */
  clearProgress(zone: string, name: string, dead: number, total: number) {
    const el = $('clear');
    el.classList.toggle('hidden', total === 0);
    if (!total) return;
    const c = this.clr;
    const p = dead / total;
    const fill = el.querySelector<HTMLElement>('.cl-fill')!;
    const ghost = el.querySelector<HTMLElement>('.cl-ghost')!;
    const pct = (v: number) => Math.round(v * 100);
    if (zone !== c.zone) {
      c.zone = zone;
      c.p = p;
      el.querySelector('.cl-zone')!.textContent = name;
      el.querySelector('.cl-badge')!.innerHTML = art('skull', 30);
      for (const b of [fill, ghost]) {
        b.style.transition = 'none';
        b.style.width = `${p * 100}%`;
        void b.offsetWidth;
        b.style.transition = '';
      }
      el.classList.toggle('done', p >= 1);
      this.clearTicks(p, false);
      this.countClear(pct(p), true);
      return;
    }
    if (p === c.p) return;
    const was = c.p;
    c.p = p;
    el.classList.toggle('down', p < was);
    ghost.style.width = fill.style.width = `${p * 100}%`;
    el.classList.toggle('done', p >= 1);
    this.clearTicks(p, p > was);
    if (p < was) { this.countClear(pct(p), true); return; }
    this.countClear(pct(p), false);
    // the hit: number pop, shine sweep and badge bounce restart; "+N%" rises from the end of the fill
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
    const pop = document.createElement('div');
    pop.className = 'cl-plus';
    pop.textContent = `+${Math.max(1, pct(p) - pct(was))}%`;
    pop.style.left = `${p * 100}%`;
    pop.addEventListener('animationend', () => pop.remove());
    el.querySelector('.cl-main')!.appendChild(pop);
    sfx.clearTick(p);
    if (p >= 1 && was < 1) this.clearedBanner(name);
  }

  /** The number on the clear bar: counts up to `n` (or jumps there). */
  private countClear(n: number, instant: boolean) {
    const c = this.clr;
    const out = $('clear').querySelector<HTMLElement>('.cl-pct')!;
    cancelAnimationFrame(c.raf);
    if (instant) { c.shown = n; out.textContent = `${n}%`; return; }
    const from = c.shown;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 550);
      c.shown = Math.round(from + (n - from) * (1 - (1 - k) ** 3));
      out.textContent = `${c.shown}%`;
      if (k < 1) c.raf = requestAnimationFrame(step);
    };
    step();
  }

  /** Milestone ticks at 25/50/75%: lit once passed, a flash for the ones just crossed. */
  private clearTicks(p: number, flash: boolean) {
    $('clear').querySelectorAll<HTMLElement>('.cl-ticks i').forEach((t, i) => {
      const on = p >= (i + 1) * 0.25;
      if (on && flash && !t.classList.contains('on')) {
        t.classList.remove('flash');
        void t.offsetWidth;
        t.classList.add('flash');
      }
      t.classList.toggle('on', on);
    });
  }

  /** 100%: the "location cleared" banner with rays, confetti from the bar and a fanfare. */
  private clearedBanner(name: string) {
    const b = $('clear-banner');
    b.querySelector('.cb-sub')!.textContent = name;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.clr.bannerT);
    this.clr.bannerT = window.setTimeout(() => b.classList.remove('show'), 3000);
    const box = $('clear');
    const colors = ['#ffe14a', '#ff8a30', '#7dff8e', '#6ad8ff', '#ff6aa8', '#ffffff'];
    for (let i = 0; i < 26; i++) {
      const f = document.createElement('i');
      f.className = 'cl-confetti';
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.3;
      const d = 60 + Math.random() * 90;
      f.style.cssText = `--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d * 0.7 + 30}px;--r:${Math.random() * 720 - 360}deg;--c:${colors[i % colors.length]};left:${30 + Math.random() * 40}%`;
      f.addEventListener('animationend', () => f.remove());
      box.appendChild(f);
    }
    sfx.cleared();
  }

  toast(text: string, ms = 3200) {
    const el = $('hint');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.hintT);
    this.hintT = window.setTimeout(() => el.classList.remove('show'), ms);
  }


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
    (el.querySelector('span') as HTMLElement).textContent = `${fmtK(Math.ceil(hp))} / ${fmtK(max)}`;
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

  settings(muted: boolean, lowGfx: boolean, toggleMute: () => void, toggleGfx: () => void, reset: () => void, close: () => void, showLog: () => void) {
    this.open(`<div class="panel"><h2>Настройки</h2>
      <p>Управление: тяни палец в любом месте экрана (или WASD). Атака — автоматически. Смена класса — кнопки справа внизу или 1 / 2 / 3.</p>
      <div class="row"><button class="btn" id="m-mute">${muted ? '🔇 Звук выкл' : '🔊 Звук вкл'}</button>
      <button class="btn" id="m-gfx">${lowGfx ? '🖥 Графика: низкая' : '🖥 Графика: высокая'}</button></div>
      <div class="row"><button class="btn purple" id="m-debug">🛠 Дебаг-меню</button></div>
      <div class="row"><button class="btn" id="m-log">📊 Лог баланса</button><button class="btn danger" id="m-reset">Сбросить прогресс</button></div>
      <div class="row"><button class="btn primary" id="m-close">Продолжить</button></div></div>`);
    this.on('#m-debug', () => { this.close(); close(); this.onDebug(); });
    this.on('#m-mute', () => { toggleMute(); this.close(); this.settings(!muted, lowGfx, toggleMute, toggleGfx, reset, close, showLog); });
    this.on('#m-gfx', () => { toggleGfx(); this.close(); this.settings(muted, !lowGfx, toggleMute, toggleGfx, reset, close, showLog); });
    this.on('#m-reset', () => {
      this.confirm('Сбросить весь прогресс?', 'Герой, фракция и снаряжение будут удалены.', reset, () => this.settings(muted, lowGfx, toggleMute, toggleGfx, reset, close, showLog));
    });
    this.on('#m-log', () => { this.close(); showLog(); });
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

  // ---------- minimap ----------
  minimap(hero: THREE.Vector3, facing: number, units: THREE.Vector3[], world: World, marks: MapMark[]) {
    const g = this.mm;
    const S = 220;
    // the backing store follows the on-screen size (HUD scale, expanded map) × the pixel ratio, so nothing is
    // stretched; the drawing itself stays in S × S units
    const c = g.canvas;
    const px = Math.round(c.getBoundingClientRect().width * Math.min(devicePixelRatio, 2)) || S;
    if (c.width !== px) c.width = c.height = px;
    g.setTransform(px / S, 0, 0, px / S, 0, 0);
    const scale = S / 70; // ~70 m across
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.clip();
    const tx = (x: number) => S / 2 + (x - hero.x) * scale;
    const tz = (z: number) => S / 2 + (z - hero.z) * scale;
    world.drawMap(g, tx, tz, scale);
    world.fog.drawOnMap(g, tx, tz, scale);
    g.fillStyle = '#ff3b3b';
    for (const u of units) g.fillRect(tx(u.x) - 3, tz(u.z) - 3, 6, 6); // mobs and props alike
    drawMarks(g, marks, tx, tz, 1.15);
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
}
