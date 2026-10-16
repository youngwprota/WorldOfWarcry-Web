// Stand-in models built in code until the art exists: the hunter's gun and its pellet. Registered in `assets`
// under the names WEAPONS uses (`gun_mock`, `pellet_mock`), so they are held, cloned and shown like loaded models.
import * as THREE from 'three';
import { assets } from './assets';

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });

/** A double-barrelled shotgun along +Y like the other weapons (cm): butt at the bottom, the barrels up. */
function gun() {
  const g = new THREE.Group();
  const wood = lambert(0x7a4a26);
  const metal = lambert(0x3a3d44);
  const brass = lambert(0xc8a040);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.BoxGeometry(5, 26, 8), wood, 0, 13, -1, 0.12); // butt
  add(new THREE.BoxGeometry(4, 14, 5), wood, 0, 31, 0); // grip
  add(new THREE.BoxGeometry(4.6, 10, 6), metal, 0, 41, 0.5); // receiver
  add(new THREE.CylinderGeometry(1.6, 1.6, 48, 10), metal, -1.3, 70, 1.6); // barrels
  add(new THREE.CylinderGeometry(1.6, 1.6, 48, 10), metal, 1.3, 70, 1.6);
  add(new THREE.BoxGeometry(4, 30, 3), wood, 0, 56, -1.2); // fore-end under the barrels
  add(new THREE.TorusGeometry(2.2, 0.5, 6, 12), brass, 0, 36, -3.5, Math.PI / 2); // trigger guard
  return g;
}

/** A glowing pellet (m: it flies in world space, src/arrows.ts). */
function pellet() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe27a })));
  return g;
}

export function registerMocks() {
  assets.register('gun_mock', gun());
  assets.register('pellet_mock', pellet());
}
