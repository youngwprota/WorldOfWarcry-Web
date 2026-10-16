import * as THREE from 'three';
import { ORBS, type OrbKind } from './config';

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

export type PickupKind = OrbKind;
interface Pickup { mesh: THREE.Mesh; kind: PickupKind; vel: THREE.Vector3; t: number; active: boolean; }

/** Stat orbs: burst out, then home in on the hero (GDD 4: "сами притягиваются"). */
export class Pickups {
  private pool: Pickup[] = [];
  private orbGeo = new THREE.IcosahedronGeometry(0.2, 1);
  private mats: Record<PickupKind, THREE.Material>;
  onCollect: (kind: PickupKind) => void = () => {};

  constructor(private scene: THREE.Scene) {
    this.mats = {
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

  update(dt: number, hero: THREE.Vector3) {
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

export interface Bolt { mesh: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3 | null; t: number; dur: number }
interface Glow { mesh: THREE.Mesh; vel: THREE.Vector3; t: number; dur: number; size: number }

/**
 * Mage staff effects, all pooled: gradient bolts flying from the hand to a target, the wind orb's swirl where it
 * lands, and flame licks rising from burning mobs. Additive unlit materials, one per colour.
 */
export class Spells {
  private ball = new THREE.SphereGeometry(1, 12, 8);
  private shell = new THREE.IcosahedronGeometry(1, 1);
  private flameGeo = new THREE.OctahedronGeometry(1, 0);
  private mats = new Map<string, THREE.MeshBasicMaterial>();
  private boltMats = new Map<string, THREE.SpriteMaterial>();
  private bolts: Bolt[] = [];
  private swirls: Glow[] = [];
  private flames: Glow[] = [];

  constructor(private scene: THREE.Scene) {}

  private mat(color: number, opacity = 0.9, wireframe = false) {
    const key = `${color}/${opacity}/${wireframe}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, wireframe, blending: THREE.AdditiveBlending, depthWrite: false });
      this.mats.set(key, m);
    }
    return m;
  }

  /** Bolt sprite: radial gradient from `inner` at the centre to `outer`, fading out at the rim. */
  private boltMat(inner: number, outer: number) {
    const key = `${inner}/${outer}`;
    let m = this.boltMats.get(key);
    if (!m) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
      grad.addColorStop(0, css(inner));
      grad.addColorStop(0.35, css(inner));
      grad.addColorStop(0.75, css(outer));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      this.boltMats.set(key, m);
    }
    return m;
  }

  /** A hidden pool entry, or `fresh` added to the pool and the scene. */
  private take<T extends { mesh: THREE.Object3D; t: number }>(pool: T[], fresh: T | null) {
    let it = fresh;
    if (it) { pool.push(it); this.scene.add(it.mesh); } else it = pool.find((x) => !x.mesh.visible)!;
    it.mesh.visible = true;
    it.t = 0;
    return it;
  }

  private static idle(pool: { mesh: THREE.Object3D }[]) { return pool.some((x) => !x.mesh.visible); }

  /** A sphere from `from` to `to` in `dur` s; `to` is followed live (a mob's position), aimed 1 m above it. */
  bolt(from: THREE.Vector3, to: THREE.Vector3, dur: number, colors: readonly [number, number], size = 0.16) {
    const b = this.take(this.bolts, Spells.idle(this.bolts) ? null
      : { mesh: new THREE.Sprite(), from: new THREE.Vector3(), to: null, t: 0, dur: 1 });
    b.mesh.material = this.boltMat(colors[0], colors[1]);
    b.mesh.scale.setScalar(size * 2.6);
    b.mesh.position.copy(from);
    b.from.copy(from);
    b.to = to;
    b.dur = Math.max(0.05, dur);
    return b;
  }

  /** Removes bolt `b` mid-flight. */
  drop(b: Bolt) { b.mesh.visible = false; b.to = null; }

  /** A spinning see-through sphere of `radius` m at `at` for `dur` s. */
  swirl(at: THREE.Vector3, radius: number, dur: number, color: number) {
    const s = this.take(this.swirls, Spells.idle(this.swirls) ? null
      : { mesh: new THREE.Mesh(this.shell).add(new THREE.Mesh(this.ball)) as THREE.Mesh, vel: new THREE.Vector3(), t: 0, dur: 1, size: 1 });
    s.mesh.material = this.mat(color, 0.8, true);
    (s.mesh.children[0] as THREE.Mesh).material = this.mat(color, 0.25);
    s.mesh.position.set(at.x, 0.6, at.z);
    s.dur = dur;
    s.size = radius;
  }

  /** One flame lick rising from `at`. */
  flame(at: THREE.Vector3, color: number) {
    const f = this.take(this.flames, Spells.idle(this.flames) ? null
      : { mesh: new THREE.Mesh(this.flameGeo), vel: new THREE.Vector3(), t: 0, dur: 1, size: 1 });
    f.mesh.material = this.mat(color);
    f.mesh.position.set(at.x + (Math.random() - 0.5) * 0.5, at.y + Math.random() * 0.6, at.z + (Math.random() - 0.5) * 0.5);
    f.vel.set((Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3);
    f.dur = 0.4 + Math.random() * 0.25;
    f.size = 0.07 + Math.random() * 0.06;
  }

  update(dt: number) {
    for (const b of this.bolts) {
      if (!b.mesh.visible) continue;
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      tmp.copy(b.to!).setY(b.to!.y + 1);
      b.mesh.position.lerpVectors(b.from, tmp, k);
      b.mesh.position.y += Math.sin(Math.PI * k) * 0.4;
      if (k >= 1) { b.mesh.visible = false; b.to = null; }
    }
    for (const s of this.swirls) {
      if (!s.mesh.visible) continue;
      s.t += dt;
      const k = s.t / s.dur;
      // grows in fast, holds, then collapses into its centre
      const grow = Math.min(1, k * 5) * (k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1);
      s.mesh.scale.setScalar(Math.max(0.001, s.size * 0.45 * grow));
      s.mesh.rotation.y += dt * 9;
      s.mesh.rotation.x = Math.sin(s.t * 5) * 0.3;
      if (k >= 1) s.mesh.visible = false;
    }
    for (const f of this.flames) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const k = f.t / f.dur;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.scale.set(f.size * (1 - k), f.size * 1.8 * (1 - k), f.size * (1 - k));
      if (k >= 1) f.mesh.visible = false;
    }
  }
}

let puffTex: THREE.Texture | null = null;
/** Soft round blob, white to transparent. */
function puffTexture() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

interface Puff { sprite: THREE.Sprite; vel: THREE.Vector3; t: number; life: number; size: number; peak: number; active: boolean }

/** Drifting fog puffs (sprites): swell, rise slowly and fade. */
export class FogPuffs {
  private pool: Puff[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, count = 140) {
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      sprite.renderOrder = 2;
      scene.add(sprite);
      this.pool.push({ sprite, vel: new THREE.Vector3(), t: 0, life: 1, size: 1, peak: 0.5, active: false });
    }
  }

  /** One puff of `size` m at `pos`, peak opacity `peak`. */
  spawn(pos: THREE.Vector3, color: number, size: number, life: number, peak = 0.5) {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.active = true;
    p.t = 0;
    p.life = life;
    p.size = size;
    p.peak = peak;
    p.vel.set((Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
    p.sprite.position.copy(pos);
    (p.sprite.material as THREE.SpriteMaterial).color.set(color);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
  }

  /** `count` puffs scattered over a disc of `radius` m around `pos`. */
  cloud(pos: THREE.Vector3, radius: number, color: number, count: number, life = 1.4) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      tmp.set(pos.x + Math.sin(a) * r, pos.y + 0.3 + Math.random() * 0.5, pos.z + Math.cos(a) * r);
      this.spawn(tmp, color, 1.2 + Math.random() * 1.2, life * (0.7 + Math.random() * 0.6), 0.45);
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { p.active = false; p.sprite.visible = false; continue; }
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.size * (0.6 + 0.6 * k));
      // fade in over the first fifth, out over the rest
      (p.sprite.material as THREE.SpriteMaterial).opacity = p.peak * (k < 0.2 ? k / 0.2 : (1 - k) / 0.8);
    }
  }
}

/**
 * Boss arena: a filled disc of drifting noise fog over `radius` m with no hard edge, plus wisps rising from it.
 * `set` fades it in or out, `flare` makes it brighter for a while.
 */
export class ArenaFog {
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private k = 0;
  private on = false;
  private wispT = 0;
  private boost = 0;

  constructor(scene: THREE.Scene, private puffs: FogPuffs, private center: THREE.Vector3, private radius: number, private color: number) {
    const w = radius * 0.35;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uBoost: { value: 0 }, uColor: { value: new THREE.Color(color) }, uR: { value: radius }, uW: { value: w } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uTime, uAlpha, uBoost, uR, uW; uniform vec3 uColor; varying vec2 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
        void main(){
          float disc = smoothstep(uR + uW, uR - uW, length(vP));
          vec2 q = vP * 0.18;
          float f = fbm(q + vec2(uTime * 0.12, -uTime * 0.2)) * fbm(q * 1.7 - vec2(uTime * 0.07, uTime * 0.1));
          float a = disc * mix(0.25, 1.0, smoothstep(0.05, 0.4, f)) * uAlpha * (0.5 + 0.5 * uBoost);
          gl_FragColor = vec4(uColor * (0.8 + f + uBoost * 0.8), min(1.0, a * 0.8));
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry((radius + w * 2) * 2, (radius + w * 2) * 2), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(center.x, 0.1, center.z);
    this.mesh.visible = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  set(on: boolean) { this.on = on; }

  flare() { this.boost = 1; }

  update(dt: number, time: number) {
    this.k = Math.max(0, Math.min(1, this.k + (this.on ? dt : -dt) * 0.8));
    this.mesh.visible = this.k > 0;
    if (!this.mesh.visible) return;
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uAlpha.value = this.k;
    // a flare holds for a moment, then fades over ~3 s
    this.boost = Math.max(0, this.boost - dt * 0.3);
    this.mat.uniforms.uBoost.value = Math.min(1, this.boost * 1.4);
    this.wispT -= dt;
    if (this.wispT > 0) return;
    this.wispT = 0.06 / (1 + this.boost * 2);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * this.radius;
    tmp.set(this.center.x + Math.sin(a) * r, 0.4, this.center.z + Math.cos(a) * r);
    this.puffs.spawn(tmp, this.color, 2 + Math.random() * 2, 2.5, (0.3 + 0.3 * this.boost) * this.k);
  }
}
