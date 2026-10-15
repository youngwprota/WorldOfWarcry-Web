// Dev helper: compares two animation-only FBX clips track by track (max quaternion angle difference in degrees).
// Usage: node tools/compare-clips.mjs <a.fbx> <b.fbx>
import { readFileSync } from 'node:fs';

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, setAttribute() {} }) };
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const load = (f) => {
  const b = readFileSync(f);
  return new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '').animations[0];
};
const [a, b] = process.argv.slice(2).map(load);
const tb = new Map(b.tracks.map((t) => [t.name, t]));
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
for (const t of a.tracks) {
  const u = tb.get(t.name);
  if (!u) { console.log('only in A:', t.name); continue; }
  if (t.times.length !== u.times.length) { console.log(t.name, 'key count', t.times.length, u.times.length); continue; }
  let worst = 0;
  const n = t.name.endsWith('quaternion') ? 4 : 3;
  for (let i = 0; i < t.times.length; i++) {
    if (n === 4) {
      qa.fromArray(t.values, i * 4); qb.fromArray(u.values, i * 4);
      worst = Math.max(worst, THREE.MathUtils.radToDeg(qa.angleTo(qb)));
    } else {
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(t.values[i * 3 + k] - u.values[i * 3 + k]));
    }
  }
  console.log(t.name.padEnd(24), worst.toFixed(2), n === 4 ? 'deg' : 'cm');
}
for (const t of b.tracks) if (!a.tracks.find((x) => x.name === t.name)) console.log('only in B:', t.name);
