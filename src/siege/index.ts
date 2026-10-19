import { GFX } from '../config';
import { Game } from '../game';
import type { GameMode } from '../gameworld';
import type { Input } from '../input';
import { Inventory } from '../inventory';
import type { UI } from '../ui';
import { SiegeDirector } from './director';
import { SiegeHud } from './hud';
import { START } from './layout';
import { siegeSave } from './loadout';
import { grantReward, siegeReward } from './rewards';
import type { DirectorEvents } from './types';
import { SiegeWorld } from './world';

export interface SiegeHost {
  ui: UI;
  input: Input;
  labels: HTMLElement;
  game: () => Game | null;
  setActive(g: Game): void;
  lowGfx(): boolean;
}

interface Run {
  main: Game;
  g: Game | null;
  director: SiegeDirector | null;
  inv: Inventory | null;
  /** The main game's floating labels, taken out of #labels for the run. */
  parked: DocumentFragment;
  ui: Pick<UI, 'onBag' | 'onMap' | 'onGacha' | 'onFlyEnd' | 'onArmor'>;
  keys: (e: KeyboardEvent) => void;
  finished: boolean;
}

export function installSiege(h: SiegeHost): void {
  const { ui, input, labels } = h;
  const app = document.getElementById('app')!;
  const hud = new SiegeHud(ui);
  let run: Run | null = null;

  const events: DirectorEvents = {
    kill: (total, chain) => hud.kill(total, chain),
    mini: (n, of) => hud.mini(n, of),
    phase: (p) => hud.phase(p),
    timer: (s) => hud.timer(s),
    announce: (t, k) => hud.announce(t, k),
    done: (completed) => finish(completed),
  };

  function restore(r: Run) {
    r.g?.dispose();
    if (r.inv?.isOpen) r.inv.close();
    removeEventListener('keydown', r.keys);
    labels.replaceChildren(r.parked);
    // the siege Game's constructor overwrote onFlyEnd as well
    ui.onBag = r.ui.onBag; ui.onMap = r.ui.onMap; ui.onGacha = r.ui.onGacha; ui.onFlyEnd = r.ui.onFlyEnd; ui.onArmor = r.ui.onArmor;
    app.classList.remove('in-siege');
    h.setActive(r.main);
    r.main.setLowGfx(h.lowGfx());
    ui.lockClasses((c) => !r.main.classOpen(c));
    r.main.refreshHud(true);
    input.reset();
    hud.setRunning(false);
  }

  function enter() {
    const main = h.game();
    if (run || !main || main.paused || ui.modalOpen) return;
    if (!main.classOpen('mage')) { ui.toast('Осада будет доступна при сборе полного отряда'); return; }
    main.persist();
    input.reset();
    ui.flash();

    const parked = document.createDocumentFragment();
    while (labels.firstChild) parked.appendChild(labels.firstChild);
    const r: Run = {
      main, g: null, director: null, inv: null, parked, finished: false,
      ui: { onBag: ui.onBag, onMap: ui.onMap, onGacha: ui.onGacha, onFlyEnd: ui.onFlyEnd, onArmor: ui.onArmor },
      keys: (e) => { if (r.inv?.isOpen && (e.code === 'Escape' || e.code === 'KeyI' || e.code === 'KeyC' || e.code === 'KeyB')) r.inv.close(); },
    };
    run = r;
    try {
      const world = new SiegeWorld(main.faction);
      const director = new SiegeDirector(world, events, GFX.mobile || h.lowGfx() ? 16 : 24);
      const mode: GameMode = {
        world, start: START, ambient: 'forest',
        tick: (dt) => director.tick(dt),
        heroDied: () => finish(false),
        regenMul: () => director.regenMul(),
      };
      const g = new Game(siegeSave(main.save), input, ui, labels, mode);
      r.g = g;
      r.director = director;
      g.camera.aspect = app.clientWidth / app.clientHeight;
      g.camera.updateProjectionMatrix();
      g.setLowGfx(h.lowGfx());
      director.bind(g);

      const inv = r.inv = new Inventory(ui, g);
      ui.onBag = ui.onArmor = g.onOpenCharacter = g.onOpenBag = () => { input.reset(); inv.open(); };
      ui.onMap = g.onOpenMap = () => ui.toast('Карта недоступна в осаде');
      ui.onGacha = g.onOpenGacha = () => {};
      addEventListener('keydown', r.keys);
      app.classList.add('in-siege');
      hud.setRunning(true);
      h.setActive(g);
    } catch (e) {
      console.error(e);
      run = null;
      restore(r);
      ui.toast('Осада недоступна');
    }
  }

  function finish(completed: boolean) {
    const r = run;
    if (!r || r.finished || !r.g || !r.director) return;
    r.finished = true;
    r.g.paused = true;
    if (r.inv?.isOpen) r.inv.close();
    input.reset();
    const result = r.director.result();
    if (!completed) result.completed = false;
    const reward = siegeReward(result, r.main.save);
    grantReward(r.main, reward);
    hud.results(result, reward, r.main.wearer, () => { run = null; restore(r); });
  }

  hud.onButton = () => {
    if (!run) enter();
    else if (!run.finished) hud.confirmLeave(() => finish(false));
  };
}
