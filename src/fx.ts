import * as THREE from 'three';
import { ORBS, RARITY, type OrbKind } from './config';
import type { Item } from './items';

const tmp = new THREE.Vector3();

/** Pooled DOM labels projected from world space (damage numbers, pickups, barks). */
export class FloatingText {
  private pool: { el: HTMLDivElement; pos: THREE.Vector3; t: number; life: number; vy: number; lift: number; active: boolean }[] = [];

  constructor(layer: HTMLElement, private camera: THREE.Camera) {
    for (let i = 0; i < 60; i++) {
      const el = document.createElement('div');
      el.className = 'ftext';
      layer.appendChild(el);
      this.pool.push({ el, pos: new THREE.Vector3(), t: 0, life: 1, vy: 0, lift: 0, active: false });
    }
  }

  /** `lift`: extra screen px upwards, to start above an over-head block (HP bar, reward chips). */
  spawn(pos: THREE.Vector3, text: string, cls: string, life = 0.8, opts: { html?: boolean; color?: string; lift?: number } = {}) {
    let p = this.pool.find((x) => !x.active);
    if (!p) p = this.pool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    p.active = true;
    p.t = 0;
    p.life = life;
    p.vy = 1.6;
    p.lift = opts.lift ?? 0;
    p.pos.copy(pos);
    p.pos.x += (Math.random() - 0.5) * 0.6;
    p.el.className = 'ftext show ' + cls;
    if (opts.html) p.el.innerHTML = text; else p.el.textContent = text;
    p.el.style.color = opts.color ?? '';
  }

  update(dt: number, w: number, h: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) { p.active = false; p.el.className = 'ftext'; continue; }
      p.pos.y += p.vy * dt;
      p.vy *= 0.92;
      tmp.copy(p.pos).project(this.camera);
      const k = p.t / p.life;
      const pop = k < 0.12 ? 0.6 + k * 5 : 1.2 - Math.min(0.2, (k - 0.12));
      p.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h - p.lift}px) translate(-50%,-50%) scale(${pop})`;
      p.el.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
    }
  }
}

interface Particle { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; t: number; life: number; active: boolean; }

/** Debris chunks and sparks (instanced would be cheaper; pooled meshes are enough here). */
export class Particles {
  private pool: Particle[] = [];
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private mats = new Map<number, THREE.MeshLambertMaterial>();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 160; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat(0xffffff));
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, life: 1, active: false });
    }
  }

  private mat(color: number) {
    let m = this.mats.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); this.mats.set(color, m); }
    return m;
  }

  burst(pos: THREE.Vector3, color: number, count: number, size: number, speed: number, life = 0.9) {
    for (let i = 0; i < count; i++) {
      const p = this.pool.find((x) => !x.active);
      if (!p) return;
      p.active = true;
      p.t = 0;
      p.life = life * (0.7 + Math.random() * 0.6);
      p.mesh.material = this.mat(color);
      p.mesh.visible = true;
      p.mesh.position.copy(pos);
      const s = size * (0.5 + Math.random());
      p.mesh.scale.set(s, s, s);
      const a = Math.random() * Math.PI * 2;
      const up = 0.5 + Math.random();
      p.vel.set(Math.cos(a) * speed * Math.random(), up * speed, Math.sin(a) * speed * Math.random());
      p.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      if (p.t >= p.life) { p.active = false; p.mesh.visible = false; continue; }
      p.vel.y -= 18 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < p.mesh.scale.y * 0.5) {
        p.mesh.position.y = p.mesh.scale.y * 0.5;
        p.vel.y *= -0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      const k = 1 - Math.max(0, (p.t - p.life * 0.6) / (p.life * 0.4));
      p.mesh.scale.setScalar(Math.max(0.001, p.mesh.scale.x * (k < 1 ? 0.95 : 1)));
    }
  }
}

/** Red ground warnings for boss attacks (GDD 10.6: 1–1.5 s, just run out of it). */
export class Telegraphs {
  private items: {
    outer: THREE.Mesh; inner: THREE.Mesh; t: number; dur: number; r: number; cb: (tag?: unknown) => void; tag?: unknown;
    ball?: THREE.Mesh; from?: THREE.Vector3; to?: THREE.Vector3;
  }[] = [];
  private ringGeo = new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2);
  private discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private ballGeo = new THREE.SphereGeometry(0.25, 8, 6);
  private sectors = new Map<number, { fill: THREE.BufferGeometry; arc: THREE.BufferGeometry }>();
  private outerMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, depthWrite: false });
  private fillMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.28, depthWrite: false });
  private innerMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.45, depthWrite: false });
  private ballMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });

  constructor(private scene: THREE.Scene) {}

  /** A circle; `from` makes a ball fly from that point and land in it when the time is up. */
  add(pos: THREE.Vector3, r: number, dur: number, cb: (tag?: unknown) => void, tag?: unknown, from?: THREE.Vector3) {
    const outer = new THREE.Mesh(this.ringGeo, this.outerMat);
    const fill = new THREE.Mesh(this.discGeo, this.fillMat);
    outer.add(fill);
    const inner = new THREE.Mesh(this.discGeo, this.innerMat);
    this.push(outer, inner, pos, r, dur, cb, tag);
    if (!from) return;
    const it = this.items[this.items.length - 1];
    it.ball = new THREE.Mesh(this.ballGeo, this.ballMat);
    it.from = from.clone();
    it.to = pos.clone().setY(0.3);
    this.scene.add(it.ball);
  }

  /** A sector of radius `len` around the direction `yaw` (0 = +Z), `half` rad to each side. */
  addCone(pos: THREE.Vector3, yaw: number, half: number, len: number, dur: number, cb: (tag?: unknown) => void, tag?: unknown) {
    let g = this.sectors.get(half);
    if (!g) {
      g = {
        fill: new THREE.CircleGeometry(1, 24, -half, half * 2).rotateX(-Math.PI / 2),
        arc: new THREE.RingGeometry(0.97, 1, 24, 1, -half, half * 2).rotateX(-Math.PI / 2),
      };
      this.sectors.set(half, g);
    }
    const outer = new THREE.Mesh(g.arc, this.outerMat);
    outer.add(new THREE.Mesh(g.fill, this.fillMat));
    const inner = new THREE.Mesh(g.fill, this.innerMat);
    // the sector geometry points along +X; rotation.y = yaw - pi/2 turns it to the (sin yaw, cos yaw) direction
    outer.rotation.y = inner.rotation.y = yaw - Math.PI / 2;
    this.push(outer, inner, pos, len, dur, cb, tag);
  }

  private push(outer: THREE.Mesh, inner: THREE.Mesh, pos: THREE.Vector3, r: number, dur: number, cb: (tag?: unknown) => void, tag?: unknown) {
    outer.position.set(pos.x, 0.04, pos.z);
    inner.position.set(pos.x, 0.05, pos.z);
    outer.scale.setScalar(r);
    inner.scale.setScalar(0.001);
    this.scene.add(outer, inner);
    this.items.push({ outer, inner, t: 0, dur, r, cb, tag });
  }

  clear() {
    for (const it of this.items) this.remove(it);
    this.items.length = 0;
  }

  private remove(it: Telegraphs['items'][number]) {
    this.scene.remove(it.outer, it.inner);
    if (it.ball) this.scene.remove(it.ball);
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.inner.scale.setScalar(Math.max(0.001, it.r * k));
      if (it.ball) {
        it.ball.position.lerpVectors(it.from!, it.to!, k);
        it.ball.position.y += Math.sin(Math.PI * k) * 3;
      }
      if (it.t >= it.dur) {
        this.remove(it);
        this.items.splice(i, 1);
        it.cb(it.tag);
      }
    }
  }
}

export type PickupKind = OrbKind | 'item';
interface Pickup { mesh: THREE.Mesh; kind: PickupKind; vel: THREE.Vector3; t: number; active: boolean; item?: Item; }

/** Stat orbs: burst out, then home in on the hero (GDD 4: "сами притягиваются"). */
export class Pickups {
  private pool: Pickup[] = [];
  private orbGeo = new THREE.IcosahedronGeometry(0.2, 1);
  private mats: Record<PickupKind, THREE.Material>;
  onCollect: (kind: PickupKind, item?: Item) => void = () => {};
  private items: Pickup[] = [];
  private itemGeo = new THREE.OctahedronGeometry(0.32, 0);
  private beamGeo = new THREE.CylinderGeometry(0.08, 0.08, 3, 6, 1, true).translate(0, 1.5, 0);

  constructor(private scene: THREE.Scene) {
    this.mats = {
      item: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      power: this.orbMat('power'), hp: this.orbMat('hp'), regen: this.orbMat('regen'), speed: this.orbMat('speed'),
    };
  }

  private orbMat(k: OrbKind) {
    return new THREE.MeshBasicMaterial({ color: ORBS[k].color });
  }

  spawn(pos: THREE.Vector3, kind: PickupKind) {
    let p = this.pool.find((x) => !x.active);
    if (!p) {
      if (this.pool.length > 220) return;
      const mesh = new THREE.Mesh(this.orbGeo, this.mats.power);
      this.scene.add(mesh);
      p = { mesh, kind, vel: new THREE.Vector3(), t: 0, active: false };
      this.pool.push(p);
    }
    p.active = true;
    p.kind = kind;
    p.t = 0;
    p.mesh.geometry = this.orbGeo;
    p.mesh.material = this.mats[kind];
    p.mesh.visible = true;
    p.mesh.position.copy(pos).setY(0.8);
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 3;
    p.vel.set(Math.cos(a) * s, 5 + Math.random() * 3, Math.sin(a) * s);
  }

  /** Equipment drop: a gem with a light beam in the rarity colour; flies to the hero like orbs. */
  spawnItem(pos: THREE.Vector3, item: Item) {
    const color = new THREE.Color(RARITY[item.rarity].color);
    const mesh = new THREE.Mesh(this.itemGeo, new THREE.MeshBasicMaterial({ color }));
    const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    beam.position.y = -0.5;
    mesh.add(beam);
    mesh.position.copy(pos).setY(0.8);
    this.scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    this.items.push({ mesh, kind: 'item', vel: new THREE.Vector3(Math.cos(a) * 2, 6, Math.sin(a) * 2), t: 0, active: true, item });
  }

  update(dt: number, hero: THREE.Vector3) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      const m = p.mesh;
      p.t += dt;
      m.rotation.y += dt * 2.5;
      if (p.t < 0.6) {
        p.vel.y -= 20 * dt;
        m.position.addScaledVector(p.vel, dt);
        if (m.position.y < 0.6) { m.position.y = 0.6; p.vel.set(0, 0, 0); }
        continue;
      }
      m.position.y = 0.7 + Math.sin(p.t * 3) * 0.12;
      tmp.set(hero.x, 0.9, hero.z).sub(m.position);
      const d = tmp.length();
      m.position.addScaledVector(tmp.normalize(), Math.min(d, (8 + p.t * 10) * dt));
      if (d < 0.6) {
        this.scene.remove(m);
        this.items.splice(i, 1);
        this.onCollect('item', p.item);
      }
    }
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      const m = p.mesh;
      m.rotation.y += dt * 4;
      if (p.t < 0.45) {
        p.vel.y -= 20 * dt;
        m.position.addScaledVector(p.vel, dt);
        if (m.position.y < 0.3) { m.position.y = 0.3; p.vel.y *= -0.4; p.vel.x *= 0.5; p.vel.z *= 0.5; }
        continue;
      }
      tmp.set(hero.x, 1, hero.z).sub(m.position);
      const d = tmp.length();
      m.position.addScaledVector(tmp.normalize(), Math.min(d, (6 + p.t * 10) * dt));
      if (d < 0.5) {
        p.active = false;
        m.visible = false;
        this.onCollect(p.kind);
      }
    }
  }
}

/** Expanding ground ring for combo finishers. */
export class Shockwaves {
  private items: { mesh: THREE.Mesh; t: number; dur: number; r: number }[] = [];
  private geo = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);

  constructor(private scene: THREE.Scene) {}

  add(pos: THREE.Vector3, radius: number, color: number, dur = 0.35) {
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    mesh.position.set(pos.x, 0.08, pos.z);
    this.scene.add(mesh);
    this.items.push({ mesh, t: 0, dur, r: radius });
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.mesh.scale.setScalar(0.3 + it.r * (1 - (1 - k) * (1 - k)));
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.scene.remove(it.mesh);
        (it.mesh.material as THREE.Material).dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
