// Models built in code: the gun's pellet. Registered in `assets` under the name WEAPONS uses (`pellet_mock`), so it is
// cloned and flown like a loaded arrow model.
import * as THREE from 'three';
import { assets } from './assets';

/** A glowing pellet (m: it flies in world space, src/arrows.ts). */
function pellet() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe27a })));
  return g;
}

export function registerMocks() {
  assets.register('pellet_mock', pellet());
}
