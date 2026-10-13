import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = import.meta.env.BASE_URL + 'assets/';

/** Texture used by each model (models reference Bitgem's absolute TGA paths, so we remap). */
const TEXTURE_OF: Record<string, string> = {
  human_knight: 'human_knight', sword_human_knight: 'human_knight',
  peasant: 'human_peasant_color', axe: 'proto_human_RTS_color',
  soldier: 'human_soldier_texture', sword_soldier: 'human_soldier_texture', shield_soldier: 'human_soldier_texture',
  paladin: 'human_paladin_texture', hammer_human_paladin: 'human_paladin_texture',
  orc_grunt: 'orc_grunt_albedo', axe_orc_grunt: 'orc_grunt_albedo',
  orc_peon: 'orc_peon_albedo', axe_orc_peon: 'proto_orc_RTS_albedo',
  orc_warrior: 'orc_warrior_albedo', sword_orc_warrior: 'orc_warrior_albedo',
  orc_chieftain: 'orc_chieftain_albedo', axe_orc_chieftain: 'orc_chieftain_albedo',
  undead_worker: 'undead_units_texture', undead_warrior: 'undead_units_texture',
  spear_undead_warrior: 'undead_units_texture', undead_assassin: 'undead_units_texture',
  undead_king: 'undead_units_texture', sword_undead_king: 'undead_units_texture',
};
const EMISSIVE_OF: Record<string, string> = { undead_units_texture: 'undead_units_glow' };

function textureFor(name: string): string {
  if (TEXTURE_OF[name]) return TEXTURE_OF[name];
  if (name.startsWith('orc_')) return 'proto_orc_RTS_color';
  if (name.startsWith('undead_')) return 'proto_undead_RTS_texture';
  if (name.startsWith('elf_')) return 'proto_elf_RTS_texture';
  return 'proto_human_RTS_color';
}

export const ANIMS = ['Idle', 'Walk', 'SwordAttack', 'AxeAttack', 'Hit', 'Death'] as const;
export type AnimName = (typeof ANIMS)[number];

/** Bones that belong to the upper-body layer (spine_01 and its descendants). */
export const upperBones = new Set<string>();

export interface CharacterClips {
  full: Record<AnimName, THREE.AnimationClip>;
  upper: Record<AnimName, THREE.AnimationClip>;
  lower: Record<AnimName, THREE.AnimationClip>;
}

class Assets {
  private manager = new THREE.LoadingManager();
  private fbx = new FBXLoader(this.manager);
  private texLoader = new THREE.TextureLoader();
  private sources = new Map<string, THREE.Group>();
  private textures = new Map<string, THREE.Texture>();
  private materials = new Map<string, THREE.Material>();
  clips!: CharacterClips;

  constructor() {
    // The FBX files point at the artist's local TGA files; we assign textures ourselves.
    this.manager.setURLModifier((url) => (/\.(tga|png|jpg)$/i.test(url) ? 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' : url));
  }

  async loadAll(names: string[], onProgress: (p: number) => void) {
    const all = [...ANIMS, ...names];
    let done = 0;
    await Promise.all(
      all.map(async (n) => {
        const g = await this.fbx.loadAsync(`${BASE}models/${n}.fbx`);
        this.sources.set(n, g);
        onProgress(++done / all.length);
      }),
    );
    this.prepareClips();
    for (const n of names) this.prepareModel(n);
  }

  texture(name: string): THREE.Texture {
    let t = this.textures.get(name);
    if (!t) {
      t = this.texLoader.load(`${BASE}textures/${name}.png`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.textures.set(name, t);
    }
    return t;
  }

  material(texName: string): THREE.Material {
    let m = this.materials.get(texName);
    if (!m) {
      const emissive = EMISSIVE_OF[texName];
      m = new THREE.MeshLambertMaterial({
        map: this.texture(texName),
        emissive: emissive ? 0xffffff : 0x000000,
        emissiveMap: emissive ? this.texture(emissive) : null,
      });
      m.name = texName;
      this.materials.set(texName, m);
    }
    return m;
  }

  private prepareClips() {
    const idle = this.sources.get('Idle')!;
    idle.getObjectByName('spine_01')!.traverse((o) => upperBones.add(o.name));
    const full = {} as Record<AnimName, THREE.AnimationClip>;
    const upper = {} as Record<AnimName, THREE.AnimationClip>;
    const lower = {} as Record<AnimName, THREE.AnimationClip>;
    for (const n of ANIMS) {
      const src = this.sources.get(n)!.animations[0];
      const tracks = src.tracks
        .filter((t) => !t.name.endsWith('.scale'))
        .map((t) => {
          if (t.name === 'root.position' || t.name === 'pelvis.position') {
            // Strip horizontal root motion: the game moves characters itself.
            const c = t.clone();
            const v = c.values;
            const x0 = v[0], z0 = v[2];
            for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
            return c;
          }
          return t;
        });
      full[n] = new THREE.AnimationClip(n, src.duration, tracks);
      upper[n] = new THREE.AnimationClip(n + '_U', src.duration, tracks.filter((t) => upperBones.has(t.name.split('.')[0])));
      lower[n] = new THREE.AnimationClip(n + '_L', src.duration, tracks.filter((t) => !upperBones.has(t.name.split('.')[0])));
    }
    this.clips = { full, upper, lower };
  }

  private prepareModel(name: string) {
    const g = this.sources.get(name)!;
    g.animations = [];
    // Normalize units: characters/buildings are authored in cm, some props in m.
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    if (box.max.y - box.min.y > 20) g.scale.setScalar(0.01);
    const mat = this.material(textureFor(name));
    g.traverse((o) => {
      if (o.name === 'Character1_RightHand') o.name = 'hand_r';
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = Array.isArray(m.material) ? m.material.map(() => mat) : mat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
  }

  private clipCache = new Map<string, CharacterClips>();

  /** Shared clips without tracks for bones this model lacks (capes, book chains…). */
  clipsFor(model: string): CharacterClips {
    let c = this.clipCache.get(model);
    if (c) return c;
    const bones = new Set<string>();
    this.sources.get(model)!.traverse((o) => bones.add(o.name));
    const filter = (set: Record<AnimName, THREE.AnimationClip>) => {
      const out = {} as Record<AnimName, THREE.AnimationClip>;
      for (const n of ANIMS) {
        const clip = set[n];
        out[n] = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => bones.has(t.name.split('.')[0])));
      }
      return out;
    };
    c = { full: filter(this.clips.full), upper: filter(this.clips.upper), lower: filter(this.clips.lower) };
    this.clipCache.set(model, c);
    return c;
  }

  /** Deep clone (skinned meshes get their own skeletons). Materials stay shared. */
  clone(name: string): THREE.Group {
    const src = this.sources.get(name);
    if (!src) throw new Error('asset not loaded: ' + name);
    return SkeletonUtils.clone(src) as THREE.Group;
  }

  /** Merged, static geometry for props (cheap to instance). */
  has(name: string) { return this.sources.has(name); }
}

export const assets = new Assets();
