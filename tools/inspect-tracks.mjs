// Dev helper: prints clips, track names (key counts) and sample values of FBX files.
// Usage: node tools/inspect-tracks.mjs [--names] public/assets/models/SwordAttack.fbx ...
import { readFileSync } from 'node:fs';

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, setAttribute() {} }) };
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const fmt = (a) => Array.from(a).map((v) => v.toFixed(3)).join(',');
const args = process.argv.slice(2);
const names = args.includes('--names');
for (const f of args.filter((a) => !a.startsWith('--'))) {
  const buf = readFileSync(f);
  const g = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  g.updateMatrixWorld(true);
  console.log('==', f, 'top', g.children.map((c) => c.name).join(','), 'scale', fmt(g.scale.toArray()));
  for (const bn of ['root', 'pelvis', 'hand_r', 'foot_l']) {
    const o = g.getObjectByName(bn);
    if (o) console.log('  rest', bn, 'pos', fmt(o.position.toArray()), 'q', fmt(o.quaternion.toArray()));
  }
  for (const c of g.animations) {
    console.log(' clip', c.name, c.duration, 'tracks', c.tracks.length);
    if (names) console.log('  ', c.tracks.map((t) => `${t.name}#${t.times.length}`).join(' '));
    for (const tn of ['root.position', 'root.quaternion', 'spine_02.quaternion', 'upperarm_r.quaternion']) {
      const t = c.tracks.find((x) => x.name === tn);
      if (t) console.log('  ', tn, 'k0', fmt(t.values.slice(0, tn.endsWith('position') ? 3 : 4)), 'mid', fmt(t.values.slice(Math.floor(t.times.length / 2) * (tn.endsWith('position') ? 3 : 4)).slice(0, tn.endsWith('position') ? 3 : 4)));
    }
  }
}
