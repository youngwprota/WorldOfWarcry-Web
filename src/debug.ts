// Debug panel. Floating, does not pause the game, so fights can be watched live. Open: ` (Backquote) or ⚙ → «Дебаг-меню».
import { sfx } from './audio';
import { SPAWN_PRESETS, ZONES } from './config';
import type { SpawnPreset, SpawnPresetId, ZoneId } from './config';
import { ARENA, FOREST_MINI, FORT, GATES, ISLAND, LAND_BOSSES } from './island';
import type { Game } from './game';
import { CLASSES, CLASS_IDS, type HeroClass } from './party';
import { CLASS_SET } from './items';

const pct = (x: number) => `${Math.round(x * 100)}%`;

type Action = [label: string, run: (g: Game, arg: string) => void, cls?: string, arg?: string];

const zoneName = (id: ZoneId) => ZONES.find((z) => z.id === id)!.name;

/** `arg`: 'door:<gateId>' | 'mini:<zone>:<i>' | 'boss:<zone>' | 'fmini' | 'fort' | 'arena'; positions are read at click time (FORT moves). */
function teleport(g: Game, arg: string) {
  const [kind, id, i] = arg.split(':');
  const gate = GATES.find((t) => t.id === id) ?? GATES.find((t) => t.to === id);
  if (kind === 'door') {
    if (gate) g.debugTeleportTo(gate.x - gate.tx * 4, gate.z - gate.tz * 4);
    return;
  }
  let at: [number, number] | undefined;
  if (kind === 'fort') at = [FORT.x, FORT.z];
  else if (kind === 'fmini') at = FOREST_MINI;
  else if (kind === 'arena') at = [ARENA.x, ARENA.z];
  else {
    const lb = LAND_BOSSES.find((b) => b.zone === id);
    at = kind === 'boss' ? lb?.boss : lb?.minis[Number(i)];
  }
  if (!at) return;
  // Stand 5 m towards the island centre so the hero lands in front of the target, not inside it.
  const dx = ISLAND.cx - at[0];
  const dz = ISLAND.cz - at[1];
  const l = Math.hypot(dx, dz) || 1;
  g.debugTeleportTo(at[0] + (dx / l) * 5, at[1] + (dz / l) * 5, kind === 'fort' || kind === 'arena' || kind === 'fmini' ? undefined : gate?.id);
}

/** `arg`: SpawnPresetId; the pack centre is read at click time (World.presets is filled when the world is built). */
function teleportPreset(g: Game, arg: string) {
  let p: (typeof g.world.presets)[number] | undefined;
  for (const e of g.world.presets) if (e.id === arg) p = e;
  if (!p) return;
  // into the middle of a horde, 6 m short of the other packs
  const off = (SPAWN_PRESETS[p.id] as SpawnPreset).horde ? 0 : 6;
  const dx = ISLAND.cx - p.x;
  const dz = ISLAND.cz - p.z;
  const l = Math.hypot(dx, dz) || 1;
  g.debugTeleportTo(p.x + (dx / l) * off, p.z + (dz / l) * off, 'swamp-dunes');
}

/** Gear a player plausibly has by each boss: armour rarity (the class set), weapon rarity, ring and amulet. */
const BOSS_GEAR: Partial<Record<ZoneId, { rarity: number; weapon: number; jewels: boolean }>> = {
  forest: { rarity: 0, weapon: 0, jewels: false },
  cemetery: { rarity: 1, weapon: 1, jewels: true },
  peaks: { rarity: 1, weapon: 2, jewels: true },
  hills: { rarity: 2, weapon: 2, jewels: true },
  grove: { rarity: 2, weapon: 3, jewels: true },
  swamp: { rarity: 3, weapon: 4, jewels: true },
  dunes: { rarity: 4, weapon: 4, jewels: true },
};

/** `arg`: '<zone> <teleport arg>'; equips BOSS_GEAR, teleports to the boss, then balances the hero against it (Game.debugBalanceBoss). */
function balanceTp(g: Game, arg: string) {
  const [zone, at] = arg.split(' ');
  const gear = BOSS_GEAR[zone as ZoneId];
  if (gear) g.debugEquipFor(zone as ZoneId, gear);
  teleport(g, at);
  if (!g.debugBalanceBoss(zone as ZoneId)) g.ui.toast('Баланс: нет босса или оружия');
}

/** One row per location: [entrance] [mini-boss] [boss]; the forest starts at the settlement instead of a door. */
function locationRows(): [string, Action[]][] {
  const rows: [string, Action[]][] = [
    [zoneName('forest'), [['Лагерь', (g) => g.debugTeleport('camp')], ['Мини', teleport, '', 'fmini'], ['Босс', teleport, '', 'fort'], ['Баланс+ТП', balanceTp, '', 'forest fort']]],
  ];
  const seen = new Set<ZoneId>();
  // the Snow Pass right under the cemetery, the rest in map order
  const first: ZoneId[] = ['cemetery', 'peaks'];
  const rank = (z: ZoneId) => (first.indexOf(z) + 3) % 3;
  for (const gt of [...GATES].sort((a, b) => rank(a.to) - rank(b.to))) {
    if (seen.has(gt.to)) continue;
    seen.add(gt.to);
    const row: Action[] = [['Вход', teleport, '', `door:${gt.id}`]];
    const lb = LAND_BOSSES.find((b) => b.zone === gt.to);
    if (lb?.minis.length) row.push(['Мини', teleport, '', `mini:${gt.to}:0`]);
    const boss = gt.to === 'cemetery' ? 'arena' : lb?.boss ? `boss:${gt.to}` : null;
    if (boss) row.push(['Босс', teleport, '', boss], ['Баланс+ТП', balanceTp, '', `${gt.to} ${boss}`]);
    rows.push([zoneName(gt.to), row]);
  }
  return rows;
}

/** Class looks by quality (Game.debugSet; models load on the first pick); "База" = the equipped armour. */
function setRows(): [string, Action[]][] {
  return (['warrior', 'hunter', 'mage'] as HeroClass[]).map((c): [string, Action[]] => [`Сет: ${CLASSES[c].name.toLowerCase()}`,
    ['База', 'Об', 'Необ', 'Ред', 'Эпик', 'Лег', 'Миф'].map((label, i): Action => [label, (g) => g.debugSet(c, i - 1), `set ${c} r${i - 1}`])]);
}

const SECTIONS: [string, Action[]][] = [
  ['Бой', [
    ['ХП 10%', (g) => g.debugSetHp(0.1)],
    ['ХП 40%', (g) => g.debugSetHp(0.4)],
    ['ХП 100%', (g) => g.debugSetHp(1)],
    ['Бессмертие', (g) => { g.god = !g.god; }, 'god'],
    ['Убить рядом', (g) => g.debugKillNearby(), 'wide'],
    ['Уничтожить всех', (g) => g.debugKillAll(), 'wide'],
    ['Сбросить таймеры', (g) => g.debugResetTimers(), 'wide'],
    ['Восстановить всех', (g) => g.debugRestoreAll(), 'wide'],
  ]],
  ['Пресеты спавнов', (Object.keys(SPAWN_PRESETS) as SpawnPresetId[]).map((id): Action => [SPAWN_PRESETS[id].name, teleportPreset, '', id])],
  ['Предметы', [
    // a set's 4 pieces + ring + amulet; pressing the same set again raises the quality (common → mythic → common)
    ['Сет класса', (g) => g.debugGiveArmor(CLASS_SET[g.heroClass]), 'wide'],
    ['Выдать все', (g) => g.debugGiveAll(), 'wide'],
    ['Сменить расу', (g) => g.debugSwitchFaction(), 'wide'],
  ]],
  ['Статы (+очки)', [
    ['+10 урон', (g) => g.debugAddStat('power', 10)],
    ['+50 хп', (g) => g.debugAddStat('hp', 50)],
    ['+5 реген', (g) => g.debugAddStat('regen', 5)],
    ['+25 скор.', (g) => g.debugAddStat('speed', 25)],
    ['+25 защ.', (g) => g.debugAddStat('defense', 25)],
    ['+25 уклон', (g) => g.debugAddStat('dodge', 25)],
    ['+25 крит', (g) => g.debugAddStat('crit', 25)],
    ['+25 к.урон', (g) => g.debugAddStat('critDmg', 25)],
    ['+10% урон', (g) => g.debugAddStat('power', 10, true)],
    ['+10% хп', (g) => g.debugAddStat('hp', 10, true)],
    ['+10% реген', (g) => g.debugAddStat('regen', 10, true)],
    ['Сбросить дебаг-статы', (g) => g.debugClearStats(), 'wide'],
  ]],
  ...setRows(),
  ['Горнило', [
    ['+5 круток', (g) => g.debugAddPulls(5), 'wide'],
  ]],
  ['Скейл героя', [
    ['−0.1', (g) => g.debugSetHeroScale(g.heroScale - 0.1)],
    ['×1', (g) => g.debugSetHeroScale(1)],
    ['+0.1', (g) => g.debugSetHeroScale(g.heroScale + 0.1)],
  ]],
  ['Скейл врагов', [
    ['−0.1', (g) => g.debugSetMobScale(g.mobScale - 0.1)],
    ['×1', (g) => g.debugSetMobScale(1)],
    ['+0.1', (g) => g.debugSetMobScale(g.mobScale + 0.1)],
  ]],
  ['Угол обзора камеры', [
    ['−5', (g) => g.debugSetFov(g.camera.fov - 5)],
    ['54', (g) => g.debugSetFov(54)],
    ['+5', (g) => g.debugSetFov(g.camera.fov + 5)],
  ]],
  ['Ворота и туман войны', [
    ['Открыть все ворота', (g) => g.debugOpenGates(), 'wide'],
    ['Убрать туман войны', (g) => g.debugFog(true), 'wide'],
    ['Вернуть туман', (g) => g.debugFog(false), 'wide'],
  ]],
  ['Мир', [
    ['Посёлок', (g) => g.debugTeleport('camp')],
    ['Лес', (g) => g.debugTeleport('forest')],
    ['Босс 1', (g) => g.debugTeleport('boss1')],
    ['Кладбище', (g) => g.debugTeleport('cemetery')],
    ['Босс 2', (g) => g.debugTeleport('boss2')],
  ]],
  ...locationRows(),
];

export class DebugPanel {
  private el = document.createElement('div');
  private info: HTMLElement;
  private timer = 0;

  constructor(app: HTMLElement, private game: Game) {
    this.el.id = 'debug';
    this.el.className = 'ui-block hidden';
    // the hero build fields open the first section (Бой)
    const build = '<div class="dbg-build"><label>Атака <input data-build="power" type="number" min="0"></label>' +
      '<label>HP <input data-build="hp" type="number" min="1"></label><button data-apply>Применить</button></div>';
    this.el.innerHTML = `<div class="dbg-head"><b>🛠 Дебаг</b><span><button data-min title="Свернуть">–</button> <button data-close>✕</button></span></div><pre class="dbg-info"></pre>` +
      SECTIONS.map(([title, actions], si) => `<div class="dbg-sec"><span>${title}</span>${si ? '' : build}<div class="dbg-btns">` +
        actions.map(([label, , cls], ai) => `<button class="${cls ?? ''}" data-a="${si}:${ai}">${label}</button>`).join('') +
        '</div></div>').join('');
    app.appendChild(this.el);
    this.info = this.el.querySelector('.dbg-info')!;
    this.el.addEventListener('pointerdown', this.dragStart);
    addEventListener('pointermove', this.dragMove);
    addEventListener('pointerup', this.dragEnd);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || this.dragged) return;
      sfx.click();
      if (b.dataset.close !== undefined) { this.toggle(false); return; }
      if (b.dataset.apply !== undefined) { this.applyBuild(); return; }
      if (b.dataset.min !== undefined) { this.el.classList.toggle('min'); b.textContent = this.el.classList.contains('min') ? '+' : '–'; return; }
      const [si, ai] = b.dataset.a!.split(':').map(Number);
      const a = SECTIONS[si][1][ai];
      a[1](this.game, a[3] ?? '');
      this.render();
    });
    addEventListener('keydown', (e) => { if (e.code === 'Backquote') this.toggle(); });
  }

  /** Drag-to-scroll with the mouse too (touch scrolls natively); a drag past a few px swallows the click. */
  private dragY = NaN;
  private dragTop = 0;
  private dragged = false;
  private dragStart = (e: PointerEvent) => {
    // Keep taps on the panel away from the joystick and the world.
    e.stopPropagation();
    this.dragged = false;
    if (e.pointerType !== 'mouse' || (e.target as HTMLElement).closest('input')) return;
    this.dragY = e.clientY;
    this.dragTop = this.el.scrollTop;
  };
  private dragMove = (e: PointerEvent) => {
    if (Number.isNaN(this.dragY)) return;
    const dy = e.clientY - this.dragY;
    if (Math.abs(dy) > 4) this.dragged = true;
    if (this.dragged) this.el.scrollTop = this.dragTop - dy;
  };
  private dragEnd = () => { this.dragY = NaN; };

  get isOpen() { return !this.el.classList.contains('hidden'); }

  toggle(on = !this.isOpen) {
    this.el.classList.toggle('hidden', !on);
    clearInterval(this.timer);
    if (on) {
      this.fillBuild();
      this.render();
      this.timer = window.setInterval(() => this.render(), 250);
    }
  }

  private inputs() { return [...this.el.querySelectorAll<HTMLInputElement>('[data-build]')]; }

  private fillBuild() {
    const s = this.game.stats;
    for (const i of this.inputs()) i.value = String(Math.round(i.dataset.build === 'hp' ? s.maxHp : s.power));
  }

  private applyBuild() {
    for (const i of this.inputs()) {
      const v = Number(i.value);
      if (i.value !== '' && Number.isFinite(v)) this.game.debugSetStat(i.dataset.build as 'power' | 'hp', Math.max(i.dataset.build === 'hp' ? 1 : 0, v));
    }
    this.fillBuild();
    this.render();
  }

  /** The strip spans from the gap between the bag and the class buttons down to the weapon slots, left of the class buttons (both move with the HUD scale). */
  private fit() {
    const app = this.el.parentElement!.getBoundingClientRect();
    const bag = document.getElementById('btn-bag')!.getBoundingClientRect();
    const party = document.getElementById('party')!.getBoundingClientRect();
    const weapons = document.getElementById('weapons')!.getBoundingClientRect();
    this.el.style.setProperty('--dbg-top', `${(bag.bottom + party.top) / 2 - app.top}px`);
    this.el.style.setProperty('--dbg-bottom', `${app.bottom - weapons.top + 4}px`);
    this.el.style.setProperty('--dbg-right', `${app.right - party.left + 4}px`);
  }

  private render() {
    this.fit();
    const d = this.game.debugInfo();
    this.el.querySelector('.god')?.classList.toggle('on', d.god);
    const looks = this.game.debugLooks;
    this.el.querySelectorAll<HTMLElement>('.set').forEach((b) =>
      b.classList.toggle('on', CLASS_IDS.some((c) => b.classList.contains(c) && b.classList.contains(`r${looks[c]}`))));
    this.info.textContent = [
      `ХП ${d.hp}/${d.maxHp}${d.god ? '  [бессмертие]' : ''}`,
      `Крит ${pct(d.crit)} ×${d.critMul.toFixed(2)}  уклон ${pct(d.dodge)}  ${d.speed.toFixed(2)} м/с`,
      `Скейл: герой ×${d.heroScale.toFixed(2)}  враги ×${d.mobScale.toFixed(2)}  обзор ${d.fov}°`,
    ].join('\n');
  }
}
