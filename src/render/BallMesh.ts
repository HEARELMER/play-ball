import * as THREE from 'three';
import { BALL_RADIUS } from '../sim/constants';
import { createSoccerBallTexture } from './textures';
import type { FootballPlayer } from './PlayerMesh';

export interface BallEntity {
  mesh: THREE.Mesh;
  shadowMarker: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: FootballPlayer | null;
  lastTouchTeam: 'blue' | 'red' | null;
  stealCooldown: number;
}

export function createBall(scene: THREE.Scene): BallEntity {
  const pos = new THREE.Vector3(0, BALL_RADIUS, 0);
  const geo = new THREE.SphereGeometry(BALL_RADIUS, 28, 28);
  const mat = new THREE.MeshStandardMaterial({
    map: createSoccerBallTexture(),
    roughness: 0.35,
    metalness: 0.1
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(pos);
  scene.add(mesh);

  // Indicador circular proyectado en el césped bajo el balón para facilitar lectura de altura
  const ringGeo = new THREE.RingGeometry(0.45, 0.65, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide
  });
  const shadowMarker = new THREE.Mesh(ringGeo, ringMat);
  shadowMarker.rotation.x = -Math.PI / 2;
  shadowMarker.position.set(0, 0.03, 0);
  scene.add(shadowMarker);

  return {
    mesh,
    shadowMarker,
    pos,
    vel: new THREE.Vector3(0, 0, 0),
    owner: null,
    lastTouchTeam: null,
    stealCooldown: 0
  };
}
