// Dev helper: applies a clip to a character FBX (three FBXLoader + AnimationMixer, like the game) and prints
// the right-hand path per frame: forward (+Z) / height (Y) in cm, and the most forward frame.
// Usage: node tools/clip-hand-path.mjs <character.fbx> <clip.fbx> [bone=hand_r]
import { readFileSync } from 'node:fs';

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, setAttribute() {} }) };
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const load = (f) => {
  const b = readFileSync(f);
  return new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const [charFile, clipFile, boneName = 'hand_r'] = process.argv.slice(2);
const model = load(charFile);
const src = load(clipFile).animations[0];
const tracks = src.tracks.filter((t) => !t.name.endsWith('.scale')).map((t) => {
  if (t.name === 'root.position' || t.name === 'pelvis.position') {
    const c = t.clone();
    const x0 = c.values[0], z0 = c.values[2];
    for (let i = 0; i < c.values.length; i += 3) { c.values[i] = x0; c.values[i + 2] = z0; }
    return c;
  }
  return t;
});
const clip = new THREE.AnimationClip('c', src.duration, tracks);
const mixer = new THREE.AnimationMixer(model);
mixer.clipAction(clip).play();
const bone = model.getObjectByName(boneName);
const p = new THREE.Vector3();
const frames = Math.round(src.duration * 30);
let best = { z: -1e9, t: 0 };
const rows = [];
for (let f = 0; f <= frames; f++) {
  const t = Math.min(f / 30, src.duration);
  mixer.setTime(t);
  model.updateMatrixWorld(true);
  bone.getWorldPosition(p);
  rows.push(`f${f} t=${t.toFixed(2)} frac=${(t / src.duration).toFixed(3)} fwd=${p.z.toFixed(1)} up=${p.y.toFixed(1)} side=${p.x.toFixed(1)}`);
  if (p.z > best.z) best = { z: p.z, t, f };
}
console.log(rows.join('\n'));
console.log(`duration ${src.duration.toFixed(3)} s; most forward ${boneName}: frame ${best.f} t=${best.t.toFixed(3)} s fraction ${(best.t / src.duration).toFixed(3)} fwd=${best.z.toFixed(1)}`);
