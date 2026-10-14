// Debug panel. Floating, does not pause the game, so fights can be watched live. Open: ` (Backquote) or ⚙ → «Дебаг-меню».
import { sfx } from './audio';
import { ZONES } from './config';
import type { ZoneId } from './config';
import { ARENA, FOREST_MINI, FORT, GATES, ISLAND, LAND_BOSSES } from './island';
import type { Game } from './game';

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

/** One row per location: [entrance] [mini-boss] [boss]; the forest starts at the settlement instead of a door. */
function locationRows(): [string, Action[]][] {
  const rows: [string, Action[]][] = [
    [zoneName('forest'), [['Лагерь', (g) => g.debugTeleport('camp')], ['Мини', teleport, '', 'fmini'], ['Босс', teleport, '', 'fort']]],
  ];
  const seen = new Set<ZoneId>();
  for (const gt of GATES) {
    if (seen.has(gt.to)) continue;
    seen.add(gt.to);
    const row: Action[] = [['Вход', teleport, '', `door:${gt.id}`]];
    const lb = LAND_BOSSES.find((b) => b.zone === gt.to);
    if (lb?.minis.length) row.push(['Мини', teleport, '', `mini:${gt.to}:0`]);
    if (gt.to === 'cemetery') row.push(['Босс', teleport, '', 'arena']);
    else if (lb?.boss) row.push(['Босс', teleport, '', `boss:${gt.to}`]);
    rows.push([zoneName(gt.to), row]);
  }
  return rows;
}

const SECTIONS: [string, Action[]][] = [
  ['Бой', [
    ['HP 10%', (g) => g.debugSetHp(0.1)],
    ['HP 40%', (g) => g.debugSetHp(0.4)],
    ['HP 100%', (g) => g.debugSetHp(1)],
    ['Бессмертие', (g) => { g.god = !g.god; }, 'god'],
    ['Убить рядом', (g) => g.debugKillNearby(), 'wide'],
  ]],
  ['Оружие в руку', [
    ['Меч', (g) => g.debugGiveWeapon('sword')],
    ['Топор', (g) => g.debugGiveWeapon('axe')],
    ['Молот', (g) => g.debugGiveWeapon('hammer')],
    ['Кинжалы', (g) => g.debugGiveWeapon('dagger')],
    ['Жнец', (g) => g.debugGiveWeapon('reaper')],
    ['Нагамаки', (g) => g.debugGiveWeapon('nagamaki')],
    ['Коса', (g) => g.debugGiveWeapon('scythe')],
    ['Сковорода', (g) => g.debugGiveWeapon('pan')],
    ['Клинок', (g) => g.debugGiveWeapon('hidden_blade')],
  ]],
  ['Оружие в левую', [
    ['Меч', (g) => g.debugGiveWeapon('sword', 1)],
    ['Щит', (g) => g.debugGiveWeapon('shield', 1)],
    ['Кинжалы', (g) => g.debugGiveWeapon('dagger', 1)],
    ['Пусто', (g) => g.debugClearLeft(), 'wide'],
  ]],
  ['Статы (+очки)', [
    ['+10 урон', (g) => g.debugAddStat('power', 10)],
    ['+50 HP', (g) => g.debugAddStat('hp', 50)],
    ['+5 реген', (g) => g.debugAddStat('regen', 5)],
    ['+25 скор.', (g) => g.debugAddStat('speed', 25)],
    ['+25 защ.', (g) => g.debugAddStat('defense', 25)],
    ['+25 уклон', (g) => g.debugAddStat('dodge', 25)],
    ['+25 крит', (g) => g.debugAddStat('crit', 25)],
    ['+25 к.урон', (g) => g.debugAddStat('critDmg', 25)],
    ['+10% урон', (g) => g.debugAddStat('power', 10, true)],
    ['+10% HP', (g) => g.debugAddStat('hp', 10, true)],
    ['+10% реген', (g) => g.debugAddStat('regen', 10, true)],
    ['Сбросить дебаг-статы', (g) => g.debugClearStats(), 'wide'],
  ]],
  ['Горнило', [
    ['+5 круток', (g) => g.debugAddPulls(5), 'wide'],
  ]],
  ['Спавнеры', [
    ['Уничтожить всех', (g) => g.debugKillAll(), 'wide'],
    ['Сбросить таймеры', (g) => g.debugResetTimers(), 'wide'],
    ['Восстановить всех', (g) => g.debugRestoreAll(), 'wide'],
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
  ['FOV камеры', [
    ['−5', (g) => g.debugSetFov(g.camera.fov - 5)],
    ['54', (g) => g.debugSetFov(54)],
    ['+5', (g) => g.debugSetFov(g.camera.fov + 5)],
  ]],
  ['Ворота', [
    ['Открыть все ворота', (g) => g.debugOpenGates(), 'wide'],
  ]],
  ['Туман войны', [
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
    this.el.innerHTML = `<div class="dbg-head"><b>🛠 Дебаг</b><span><button data-min title="Свернуть">–</button> <button data-close>✕</button></span></div><pre class="dbg-info"></pre>` +
      '<div class="dbg-sec"><span>Билд героя</span><div class="dbg-build"><label>Атака <input data-build="power" type="number" min="0"></label>' +
      '<label>HP <input data-build="hp" type="number" min="1"></label><button data-apply>Применить</button></div></div>' +
      SECTIONS.map(([title, actions], si) => `<div class="dbg-sec"><span>${title}</span><div class="dbg-btns">` +
        actions.map(([label, , cls], ai) => `<button class="${cls ?? ''}" data-a="${si}:${ai}">${label}</button>`).join('') +
        '</div></div>').join('');
    app.appendChild(this.el);
    this.info = this.el.querySelector('.dbg-info')!;
    // Keep taps on the panel away from the joystick and the world.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
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

  private render() {
    const d = this.game.debugInfo();
    this.el.querySelector('.god')?.classList.toggle('on', d.god);
    this.info.textContent = [
      `HP ${d.hp}/${d.maxHp}${d.god ? '  [бессмертие]' : ''}`,
      `Крит ${pct(d.crit)} ×${d.critMul.toFixed(2)}  уклон ${pct(d.dodge)}  ${d.speed.toFixed(2)} м/с`,
      `Скейл: герой ×${d.heroScale.toFixed(2)}  враги ×${d.mobScale.toFixed(2)}  FOV ${d.fov}°`,
    ].join('\n');
  }
}
