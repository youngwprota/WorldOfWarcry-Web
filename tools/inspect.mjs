// Dev helper: prints scale, meshes, bones and animations of FBX files.
// Usage: node tools/inspect.mjs public/assets/models/Idle.fbx ...
import { readFileSync } from 'node:fs';

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, setAttribute() {} }) };
const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const fmt = (a) => a.map((v) => v.toFixed(3)).join(',');
const L = new FBXLoader();
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  const g = L.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const meshes = [];
  const bones = [];
  g.traverse((o) => {
    if (o.isMesh) meshes.push(`${o.name}${o.isSkinnedMesh ? '(skin)' : ''}[${[].concat(o.material).map((m) => m.name).join(',')}]`);
    if (o.isBone) bones.push(o.name);
  });
  console.log('==', f.split('/').pop(), 'scale', fmt(g.scale.toArray()), 'box', fmt(box.min.toArray()), '..', fmt(box.max.toArray()));
  console.log('  meshes', meshes.join(' '));
  if (bones.length) console.log('  bones', bones.length, bones.join(' '));
  for (const c of g.animations) console.log('  anim', c.name, c.duration.toFixed(2), c.tracks.length, c.tracks.slice(0, 4).map((t) => t.name).join(' '));
  for (const bn of ['root', 'pelvis', 'spine_01', 'upperarm_r', 'hand_r', 'Character1_RightHand']) {
    const h = g.getObjectByName(bn);
    if (!h) continue;
    const p = new THREE.Vector3();
    h.getWorldPosition(p);
    console.log('   ', bn, 'parent', h.parent.name, 'world', fmt(p.toArray()), 'q', fmt(h.quaternion.toArray()), 'pos', fmt(h.position.toArray()), 's', fmt(h.scale.toArray()));
  }
}
