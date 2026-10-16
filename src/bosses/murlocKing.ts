import * as THREE from 'three';
import { MOBS, type MobDef } from '../config';
import type { Mob } from '../mobs/mob';
import type { BossHost, BossKit, BossKitFactory } from './kit';

// ---- tunables ----
/** Share of a non-crit hit that lands through the slippery scales. */
const SLIP_MUL = 0.3;
const GLOW_EVERY = 15;
const GLOW_FOR = 4;
const FIRST_GLOW = 9;
const WAVE_EVERY = 20;
const WAVE_EVERY_P2 = 16;
const FIRST_WAVE = 6;
const WAVE_SIZE = 3;
const WAVE_SIZE_P2 = 4;
/** Mini-boss: slip share and the HP fraction at which it calls its one wave. */
const MINI_SLIP_MUL = 0.6;
const MINI_WAVE_AT = 0.5;
/** Living minions at which the king stops calling more. */
const MAX_MINIONS = 8;
const SHELL_EVERY = 22;
const FIRST_SHELL = 4;
/** Seconds the hero has to crack the shell. */
const SHELL_WINDOW = 5;
/** Crit damage inside the window that cracks it, as a share of the king's max HP. */
const SHELL_CRACK = 0.06;
/** Heal on a failed shell, share of max HP. */
const SHELL_HEAL = 0.05;
/** After a crack every hit lands in full for this long. */
const EXPOSED_FOR = 4;

/** Small swamp murloc: weak, but numerous (ZONE_TIER scales hp and dmg as for any swamp mob). */
const MURLOC_MINION: MobDef = {
  id: 'murloc_minion', name: 'Мурлок-прислужник', creature: true,
  model: { human: ['human_murloc', null], orc: ['human_murloc', null] },
  anim: 'SwordAttack', hp: 90, dmg: 1.2, aps: 0.85, range: 1.4, speed: 3.6, aggro: 30, regen: 0, scale: 0.7,
  resist: MOBS.murloc_king.resist, reward: { hp: 0 }, respawn: 0,
};

const SHELL_PEARL = new THREE.Color(0xcfeee4);
const SHELL_CRACKED = new THREE.Color(0xff6a4a);
const GEO = new THREE.SphereGeometry(1, 20, 14);
const tmp = new THREE.Vector3();

/** The "Мрглглгл!" cry: up to `want` small murlocs in a ring around the boss, capped by MAX_MINIONS alive. */
function callWave(host: BossHost, boss: Mob, want: number) {
  let alive = 0;
  for (const m of host.mobs()) if (m.owner === boss && !m.removed && m.alive) alive++;
  const n = Math.min(want, MAX_MINIONS - alive);
  if (n <= 0) return;
  host.bark(boss, 'Мрглглгл!');
  const a0 = Math.random() * Math.PI * 2;
  const r = 1.5 * boss.def.scale;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    host.spawnMinion(boss, MURLOC_MINION, new THREE.Vector3(boss.pos.x + Math.cos(a) * r, 0, boss.pos.z + Math.sin(a) * r));
    host.particles.burst(tmp.set(boss.pos.x + Math.cos(a) * r, 0.3, boss.pos.z + Math.sin(a) * r), 0x5fb8a0, 6, 0.14, 3, 0.6);
  }
  host.waves.add(boss.pos, 4, 0x5fb8a0, 0.5);
}

const enum Mode { Normal, Shell, Exposed }

export const murlocKing: BossKitFactory = (host, boss: Mob): BossKit => {
  const scale = boss.def.scale;
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x7affd0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const shellMat = new THREE.MeshBasicMaterial({ color: 0xcfeee4, transparent: true, opacity: 0.6, depthWrite: false });
  const glow = new THREE.Mesh(GEO, glowMat);
  const shell = new THREE.Mesh(GEO, shellMat);
  glow.scale.setScalar(0.95 * scale);
  shell.scale.setScalar(0.85 * scale);
  glow.visible = shell.visible = false;
  host.scene.add(glow, shell);

  let armed = false;
  let mode = Mode.Normal;
  let modeUntil = 0;
  let nextGlow = 0;
  let glowUntil = 0;
  let nextWave = 0;
  let nextShell = 0;
  let shellDmg = 0;
  let lastSlipText = 0;

  const hideFx = () => { glow.visible = shell.visible = false; };

  function wave() {
    callWave(host, boss, boss.phase2 ? WAVE_SIZE_P2 : WAVE_SIZE);
  }

  function startShell(now: number) {
    mode = Mode.Shell;
    modeUntil = now + SHELL_WINDOW;
    shellDmg = 0;
    glowUntil = 0;
    host.bark(boss, 'Ракушка!');
    host.waves.add(boss.pos, 5, 0xcfeee4, 0.5);
  }

  function endShell(now: number, cracked: boolean) {
    nextShell = now + SHELL_EVERY;
    nextGlow = Math.max(nextGlow, now + 4);
    if (cracked) {
      mode = Mode.Exposed;
      modeUntil = now + EXPOSED_FOR;
      host.fx.spawn(tmp.copy(boss.pos).setY(boss.barY + 0.6), 'Панцирь расколот!', 'dmg weak', 1.4);
      host.waves.add(boss.pos, 6, 0xffe14a, 0.6);
      host.particles.burst(tmp.copy(boss.pos).setY(1.8), 0xcfeee4, 22, 0.2, 7, 0.9);
    } else {
      mode = Mode.Normal;
      boss.hp = Math.min(boss.maxHp, boss.hp + boss.maxHp * SHELL_HEAL);
      host.fx.spawn(tmp.copy(boss.pos).setY(boss.barY + 0.6), 'Лечится!', 'dmg resist', 1.4, { color: '#7aff9a' });
      host.particles.burst(tmp.copy(boss.pos).setY(1.8), 0x7aff9a, 12, 0.16, 3, 0.9);
    }
    shell.visible = false;
  }

  function reset() {
    armed = false;
    mode = Mode.Normal;
    glowUntil = 0;
    shellDmg = 0;
    hideFx();
  }

  return {
    fight() {
      const now = host.time();
      if (!armed) {
        armed = true;
        nextGlow = now + FIRST_GLOW;
        nextWave = now + FIRST_WAVE;
        nextShell = 0;
      }
      if (boss.phase2 && nextShell === 0) nextShell = now + FIRST_SHELL;

      if (mode === Mode.Shell) {
        // stands still under the shell: no moves, no attacks
        boss.casting = Math.max(boss.casting, 0.2);
        boss.special = Math.max(boss.special, 1);
        if (now >= modeUntil) endShell(now, false);
      } else {
        if (mode === Mode.Exposed && now >= modeUntil) mode = Mode.Normal;
        if (now >= nextWave) {
          nextWave = now + (boss.phase2 ? WAVE_EVERY_P2 : WAVE_EVERY);
          wave();
        }
        if (mode === Mode.Normal) {
          if (now >= nextGlow) {
            nextGlow = now + GLOW_EVERY;
            glowUntil = now + GLOW_FOR;
            host.fx.spawn(tmp.copy(boss.pos).setY(boss.barY + 0.6), 'Чешуя сияет!', 'dmg weak', 1.2);
          }
          if (nextShell > 0 && now >= nextShell && now >= glowUntil) startShell(now);
        }
      }

      const glowing = mode === Mode.Normal && now < glowUntil;
      glow.visible = glowing;
      if (glowing) {
        glow.position.set(boss.pos.x, boss.pos.y + 0.85 * scale, boss.pos.z);
        glowMat.opacity = 0.22 + 0.1 * Math.sin(now * 9);
      }
      shell.visible = mode === Mode.Shell;
      if (shell.visible) {
        const k = Math.min(1, shellDmg / (boss.maxHp * SHELL_CRACK));
        shell.position.set(boss.pos.x, boss.pos.y + 0.85 * scale, boss.pos.z);
        shellMat.color.copy(SHELL_PEARL).lerp(SHELL_CRACKED, k);
        shellMat.opacity = 0.55 + 0.1 * Math.sin(now * 6);
      }
    },

    damageTaken(target, dmg, crit) {
      if (target !== boss) return dmg;
      const now = host.time();
      if (mode === Mode.Shell) {
        if (!crit) {
          if (now - lastSlipText > 0.4) { lastSlipText = now; host.fx.spawn(tmp.copy(boss.pos).setY(boss.barY), 'Панцирь', 'dmg resist', 0.6); }
          return 0;
        }
        shellDmg += dmg;
        const need = boss.maxHp * SHELL_CRACK;
        if (shellDmg >= need) endShell(now, true);
        else host.fx.spawn(tmp.copy(boss.pos).setY(boss.barY), `Трещина ${Math.floor((shellDmg / need) * 100)}%`, 'dmg weak', 0.7);
        return 0;
      }
      if (crit || mode === Mode.Exposed) return dmg;
      if (now < glowUntil) {
        if (now - lastSlipText > 0.4) { lastSlipText = now; host.fx.spawn(tmp.copy(boss.pos).setY(boss.barY), 'Блик!', 'dmg resist', 0.6); }
        return 0;
      }
      if (now - lastSlipText > 0.9) { lastSlipText = now; host.fx.spawn(tmp.copy(boss.pos).setY(boss.barY), 'Скользко', 'dmg resist', 0.6); }
      return dmg * SLIP_MUL;
    },

    reset,

    died() {
      reset();
      host.scene.remove(glow, shell);
      glowMat.dispose();
      shellMat.dispose();
    },
  };
};

/** Mini-boss: slippery scales plus one wave of 3 murlocs below half HP. */
export const murlocKingMini: BossKitFactory = (host, boss) => {
  let called = false;
  let lastText = 0;
  return {
    fight() {
      if (called || boss.hp >= boss.maxHp * MINI_WAVE_AT) return;
      called = true;
      callWave(host, boss, WAVE_SIZE);
    },
    damageTaken(target, dmg, crit) {
      if (target !== boss || crit) return dmg;
      const now = host.time();
      if (now - lastText > 0.9) { lastText = now; host.fx.spawn(tmp.copy(boss.pos).setY(boss.barY), 'Скользко', 'dmg resist', 0.6); }
      return dmg * MINI_SLIP_MUL;
    },
    reset() { called = false; },
  };
};
