import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ARCHER_TEXTURES } from './archerTextures';
import { floatMaterial, markFloaters } from './floaters';

const BASE = import.meta.env.BASE_URL + 'assets/';
/** 1×1 white: stands in for textures we don't have. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

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
  mage: 'human_mage_col', orc_shaman: 'orc_shaman_albedo', staff_orc_shaman: 'orc_shaman_albedo',
  elf_warrior: 'elf_warrior_tex', sword_elf_warrior: 'elf_warrior_tex', elf_assassin: 'elf_assassin_tex', elf_worker: 'elf_worker_tex',
  elf_queen: 'elf_queen_tex', glaive_elf_queen: 'elf_queen_tex', elf_priestess: 'elf_priestess_tex', magic_ball: 'elf_priestess_tex',
  // party classes from the newer Unity kit (tools/import-warcry.mjs): one shared atlas per race
  human_archer: 'human_albedo', bow_human_archer: 'human_albedo', arrow_human_archer: 'human_albedo',
  orc_archer: 'orc_albedo', bow_orc_archer: 'orc_albedo', arrow_orc_archer: 'orc_albedo',
};
/** Recolours (MobDef.skin): body texture → its recoloured copy. */
export const SKINS: Record<string, Record<string, string>> = {
  tauren: {
    orc_peon_albedo: 'tauren_peon_albedo', orc_grunt_albedo: 'tauren_grunt_albedo', orc_warrior_albedo: 'tauren_warrior_albedo',
    orc_chieftain_albedo: 'tauren_chieftain_albedo', orc_shaman_albedo: 'tauren_shaman_albedo',
  },
};

const EMISSIVE_OF: Record<string, string> = {
  undead_units_texture: 'undead_units_glow', elf_queen_tex: 'elf_queen_glow', elf_priestess_tex: 'elf_priestess_glow',
};

function textureFor(name: string): string {
  if (TEXTURE_OF[name]) return TEXTURE_OF[name];
  if (name.startsWith('orc_')) return 'proto_orc_RTS_color';
  if (name.startsWith('undead_')) return 'proto_undead_RTS_texture';
  if (name.startsWith('elf_')) return 'proto_elf_RTS_texture';
  return 'proto_human_RTS_color';
}

/**
 * Caster armour (models/casters): the mage's cloth materials by name prefix → [texture, tinted]. A tinted one keeps its
 * FBX colour as a multiplier of the (gray) texture; the others are the plain texture, shared like the race atlas.
 */
const CASTER_TEXTURES: [string, string, boolean][] = [
  ['human_mage_mat', 'human_mage_col', false], ['orc_shaman_mat', 'orc_shaman_albedo', false],
  ['orc_shaman_tint_', 'orc_shaman_albedo_gray', true], ['orc_shaman_belt_', 'orc_shaman_albedo_gray', true],
  ['orc_head_mythic_skull_tex', 'orc_shaman_albedo_gray', false],
];

export const ANIMS = ['Idle', 'Walk', 'SwordAttack', 'AxeAttack', 'MagicAttack', 'Hit', 'Death', 'SlashAdvance', 'MeleeHigh', 'MeleeLong', 'MeleeHorizontal'] as const;
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
  private gltf = new GLTFLoader();
  /** GLB creatures (own skeleton and clips, textures embedded). */
  private creatures = new Map<string, { scene: THREE.Group; clips: THREE.AnimationClip[] }>();
  private texLoader = new THREE.TextureLoader();
  private sources = new Map<string, THREE.Group>();
  private textures = new Map<string, THREE.Texture>();
  private materials = new Map<string, THREE.Material>();
  clips!: CharacterClips;

  constructor() {
    // The FBX files point at the artist's local TGA files; we assign textures ourselves. The hunter sets
    // (models/archers) point at `<model>.fbm/<name>_baked`: served from textures/archers when the import found
    // that texture, else a blank (the part keeps its own colour).
    this.manager.setURLModifier((url) => {
      const fbm = /\.fbm\/([^/]+?)(\.\w+)?$/.exec(url);
      if (fbm) return ARCHER_TEXTURES.has(fbm[1]) ? `${BASE}textures/archers/${fbm[1]}.png` : BLANK;
      return /\.(tga|png|jpg)$/i.test(url) ? BLANK : url;
    });
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

  /** Loads models on demand (the hunter sets: ~60 files, too many for the start-up load); already loaded ones are skipped. */
  async ensure(names: string[]) {
    const todo = names.filter((n) => !this.sources.has(n) && !this.pending.has(n));
    for (const n of todo) {
      this.pending.set(n, this.fbx.loadAsync(`${BASE}models/${n}.fbx`).then((g) => {
        this.sources.set(n, g);
        this.prepareModel(n);
        this.pending.delete(n);
      }));
    }
    await Promise.all(names.map((n) => this.pending.get(n)));
  }
  private pending = new Map<string, Promise<void>>();

  async loadCreatures(names: string[]) {
    await Promise.all(
      names.map(async (n) => {
        const g = await this.gltf.loadAsync(`${BASE}models/${n}.glb`);
        this.creatures.set(n, { scene: g.scene, clips: g.animations });
      }),
    );
  }

  /**
   * Per-quality weapons and shields (tools/blender/rarity_gear.py): static GLB with flat colours, vertex colours and
   * glowing gems; their PBR materials become Lambert like everything else (cheap on phones).
   */
  async loadGear(names: string[]) {
    await Promise.all(
      names.map(async (n) => {
        const g = await this.gltf.loadAsync(`${BASE}models/${n}.glb`);
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.material = Array.isArray(m.material) ? m.material.map((x) => this.lambert(x)) : this.lambert(m.material);
        });
        this.sources.set(n, g.scene);
      }),
    );
  }

  private gearLoads = new Map<string, Promise<void>>();

  /** One gear GLB on demand (armour trims): resolves when `name` is ready; loads it once. */
  gear(name: string): Promise<void> {
    if (this.sources.has(name)) return Promise.resolve();
    let p = this.gearLoads.get(name);
    if (!p) {
      p = this.loadGear([name]).catch((e) => { this.gearLoads.delete(name); throw e; });
      this.gearLoads.set(name, p);
    }
    return p;
  }

  /** Static GLB props (the mage's staff tiers, WeaponDef.tiers) that keep their own materials; cloned like FBX models. */
  async loadProps(names: string[]) {
    await Promise.all(
      names.map(async (n) => {
        const g = (await this.gltf.loadAsync(`${BASE}models/${n}.glb`)).scene;
        g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = false; });
        this.sources.set(n, g);
      }),
    );
  }

  private lambert(src: THREE.Material) {
    const s = src as THREE.MeshStandardMaterial;
    let m = this.materials.get('gear:' + s.name);
    if (!m) {
      // `*_glow` (armour gems and shards): unlit vertex colour reads as glowing without bloom
      m = s.name.endsWith('_glow') ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({
        color: s.color, vertexColors: s.vertexColors, emissive: s.emissive, emissiveIntensity: s.emissiveIntensity, flatShading: true,
      });
      m.name = s.name;
      this.materials.set('gear:' + s.name, m);
    }
    return m;
  }

  /** Creature clone with its own skeleton, plus its clips by name (idle, walk, attack, death). */
  cloneCreature(name: string): { model: THREE.Group; clips: Record<string, THREE.AnimationClip> } {
    const src = this.creatures.get(name);
    if (!src) throw new Error('creature not loaded: ' + name);
    return {
      model: SkeletonUtils.clone(src.scene) as THREE.Group,
      clips: Object.fromEntries(src.clips.map((c) => [c.name, c])),
    };
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
      // Mixamo exports on our rig also carry the bind pose as a 'Take 001' clip
      const anims = this.sources.get(n)!.animations;
      const src = anims.find((a) => a.name.includes('mixamo')) ?? anims[0];
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
    if (name.startsWith('archers/') || name.startsWith('casters/')) { this.prepareOwnMaterials(name, g); return; }
    const mat = this.material(textureFor(name));
    g.traverse((o) => {
      if (o.name === 'Character1_RightHand') o.name = 'hand_r';
      else if (o.name === 'Character1_LeftHand') o.name = 'hand_l';
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = Array.isArray(m.material) ? m.material.map(() => mat) : mat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
  }

  /**
   * Hunter set parts, bows and the mage's caster parts keep their own materials (a baked texture, plus flat "metal" and "glow" colours by
   * quality) as Lambert like the rest of the game; the race's base material becomes our shared atlas, glow emits.
   */
  private prepareOwnMaterials(name: string, g: THREE.Group) {
    const atlas = name.includes('orc_') ? 'orc_albedo' : 'human_albedo';
    const conv = new Map<THREE.Material, THREE.Material>();
    // `baked`: the mesh's own texture (`<mesh>_baked`) was imported
    const lambert = (src: THREE.Material, baked: boolean) => {
      let m = conv.get(src);
      if (m) return m;
      const p = src as THREE.MeshPhongMaterial;
      const cloth = CASTER_TEXTURES.find(([n]) => p.name.startsWith(n));
      if (/^(human|orc)_archer_mat$/.test(p.name)) m = this.material(atlas);
      else if (cloth && !cloth[2]) m = this.material(cloth[1]);
      else if (cloth) m = new THREE.MeshLambertMaterial({ name: p.name, map: this.texture(cloth[1]), color: p.color });
      else {
        const glow = p.name.endsWith('_glow');
        const map = p.map && baked ? p.map : null;
        if (map) map.colorSpace = THREE.SRGBColorSpace;
        // a texture shows as is (the FBX writes Blender's 0.8 colour factor, 0xcccccc, which only dims it);
        // without its baked texture a textured part is a light cloth colour
        m = new THREE.MeshLambertMaterial({
          name: p.name, map, color: map ? 0xffffff : !p.map ? p.color : new THREE.Color(0xd8d0c4),
          emissive: glow ? p.color : 0x000000, emissiveIntensity: glow ? 0.9 : 1,
        });
      }
      conv.set(src, m);
      return m;
    };
    g.traverse((o) => {
      if (o.name === 'Character1_RightHand') o.name = 'hand_r';
      else if (o.name === 'Character1_LeftHand') o.name = 'hand_l';
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const baked = ARCHER_TEXTURES.has(`${mesh.name}_baked`);
      if (!Array.isArray(mesh.material)) { mesh.material = lambert(mesh.material, baked); return; }
      const mats = mesh.material.map((m) => lambert(m, baked));
      // FBXLoader makes no groups when every face uses one material ("AllSame", the common chests), and an
      // array without groups draws nothing: take the mesh's own textured material (its baked one), else the first
      if (!mesh.geometry.groups.length) {
        const atlasMat = this.material(atlas);
        mesh.material = mats.find((m) => (m as THREE.MeshLambertMaterial).map && m !== atlasMat) ?? mats[0];
      } else mesh.material = mats;
      // floating crystals (the mythic set): their glow material bobs them (src/floaters.ts)
      if (markFloaters(mesh)) for (const m of [mesh.material].flat()) if (m.name.endsWith('_glow')) floatMaterial(m);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
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
