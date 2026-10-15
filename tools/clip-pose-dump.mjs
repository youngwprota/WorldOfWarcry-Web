// Dev helper: applies a clip to a character FBX and prints world positions of key bones at the given frames.
// Usage: node tools/clip-pose-dump.mjs <character.fbx> <clip.fbx> <frame,frame,...>
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
const [charFile, clipFile, frames] = process.argv.slice(2);
const model = load(charFile);
const clip = load(clipFile).animations[0];
const mixer = new THREE.AnimationMixer(model);
mixer.clipAction(clip).play();
const p = new THREE.Vector3();
for (const f of frames.split(',').map(Number)) {
  mixer.setTime(f / 30);
  model.updateMatrixWorld(true);
  const pos = (n) => model.getObjectByName(n).getWorldPosition(p).toArray().map((v) => v.toFixed(0)).join(',');
  const r = model.getObjectByName('clavicle_r').getWorldPosition(new THREE.Vector3());
  const l = model.getObjectByName('clavicle_l').getWorldPosition(new THREE.Vector3());
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(l.z - r.z, l.x - r.x));
  console.log(`f${f} shoulder-line yaw ${yaw.toFixed(0)} deg | hand_r ${pos('hand_r')} hand_l ${pos('hand_l')} foot_l ${pos('foot_l')} foot_r ${pos('foot_r')} head ${pos('head')}`);
}
