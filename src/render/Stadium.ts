import * as THREE from 'three';
import {
  PITCH_WIDTH,
  PITCH_HEIGHT,
  HALF_W,
  HALF_H,
  GOAL_WIDTH,
  GOAL_HEIGHT,
  GOAL_DEPTH
} from '../sim/constants';
import { createStripedGrassTexture } from './textures';

export interface GoalPostCollider {
  x: number;
  z: number;
  r: number;
  height: number;
}

export const goalPostsColliders: GoalPostCollider[] = [];

function surroundMeshMaterial(hex: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95 });
}

function buildGoal(
  parent: THREE.Group,
  xLine: number,
  dirToCenter: number,
  accentColor: number
): void {
  const goalGroup = new THREE.Group();
  const postRadius = 0.16;
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.4 });

  const zLeft = -GOAL_WIDTH / 2;
  const zRight = GOAL_WIDTH / 2;
  const backX = xLine - dirToCenter * GOAL_DEPTH;

  // Dos postes principales verticales
  [zLeft, zRight].forEach(zPos => {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(postRadius, postRadius, GOAL_HEIGHT, 16),
      postMat
    );
    post.position.set(xLine, GOAL_HEIGHT / 2, zPos);
    post.castShadow = true;
    goalGroup.add(post);

    // Anillo de color en la base del poste
    const baseRing = new THREE.Mesh(
      new THREE.CylinderGeometry(postRadius * 1.25, postRadius * 1.25, 0.4, 16),
      accentMat
    );
    baseRing.position.set(xLine, 0.2, zPos);
    goalGroup.add(baseRing);

    // Registrar colisionador de poste vertical
    goalPostsColliders.push({ x: xLine, z: zPos, r: postRadius, height: GOAL_HEIGHT });
  });

  // Travesaño horizontal superior
  const crossbar = new THREE.Mesh(
    new THREE.CylinderGeometry(postRadius, postRadius, GOAL_WIDTH + postRadius * 2, 16),
    postMat
  );
  crossbar.rotation.x = Math.PI / 2;
  crossbar.position.set(xLine, GOAL_HEIGHT, 0);
  crossbar.castShadow = true;
  goalGroup.add(crossbar);

  // Soportes traseros metálicos
  const supportMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.4, metalness: 0.5 });
  [zLeft, zRight].forEach(zPos => {
    const backPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, GOAL_HEIGHT, 10), supportMat);
    backPost.position.set(backX, GOAL_HEIGHT / 2, zPos);
    goalGroup.add(backPost);

    const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, GOAL_DEPTH, 10), supportMat);
    topBar.rotation.z = Math.PI / 2;
    topBar.position.set((xLine + backX) / 2, GOAL_HEIGHT, zPos);
    goalGroup.add(topBar);
  });

  // Red semitransparente (Fondo, Techo y Laterales)
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xf1f5f9,
    transparent: true,
    opacity: 0.30,
    side: THREE.DoubleSide,
    wireframe: false
  });

  const netWireMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.45,
    wireframe: true
  });

  // Red Trasera
  const backNetGeo = new THREE.PlaneGeometry(GOAL_WIDTH, GOAL_HEIGHT, 14, 6);
  const backNet = new THREE.Mesh(backNetGeo, netMat);
  backNet.rotation.y = Math.PI / 2;
  backNet.position.set(backX, GOAL_HEIGHT / 2, 0);
  goalGroup.add(backNet);

  const backWire = new THREE.Mesh(backNetGeo, netWireMat);
  backWire.rotation.y = Math.PI / 2;
  backWire.position.set(backX, GOAL_HEIGHT / 2, 0);
  goalGroup.add(backWire);

  // Red Superior
  const topNetGeo = new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_WIDTH, 5, 14);
  const topNet = new THREE.Mesh(topNetGeo, netMat);
  topNet.rotation.x = Math.PI / 2;
  topNet.position.set((xLine + backX) / 2, GOAL_HEIGHT, 0);
  goalGroup.add(topNet);

  const topWire = new THREE.Mesh(topNetGeo, netWireMat);
  topWire.rotation.x = Math.PI / 2;
  topWire.position.set((xLine + backX) / 2, GOAL_HEIGHT, 0);
  goalGroup.add(topWire);

  // Redes Laterales
  [zLeft, zRight].forEach(zPos => {
    const sideNetGeo = new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HEIGHT, 5, 6);
    const sideNet = new THREE.Mesh(sideNetGeo, netMat);
    sideNet.position.set((xLine + backX) / 2, GOAL_HEIGHT / 2, zPos);
    goalGroup.add(sideNet);

    const sideWire = new THREE.Mesh(sideNetGeo, netWireMat);
    sideWire.position.set((xLine + backX) / 2, GOAL_HEIGHT / 2, zPos);
    goalGroup.add(sideWire);
  });

  parent.add(goalGroup);
}

/**
 * ============================================================================
 * CONSTRUCCIÓN DEL ESTADIO, CANCHA, LÍNEAS, VALLAS Y PORTERÍAS
 * ============================================================================
 */
export function buildStadium(scene: THREE.Scene): THREE.Group {
  goalPostsColliders.length = 0;
  const stadiumGroup = new THREE.Group();

  // 1. Plataforma exterior del estadio
  const surroundGeo = new THREE.PlaneGeometry(PITCH_WIDTH + 28, PITCH_HEIGHT + 24);
  const surroundMesh = new THREE.Mesh(surroundGeo, surroundMeshMaterial(0x132a1c));
  surroundMesh.rotation.x = -Math.PI / 2;
  surroundMesh.position.y = -0.05;
  surroundMesh.receiveShadow = true;
  stadiumGroup.add(surroundMesh);

  // 2. Césped principal con textura procedural a franjas
  const pitchGeo = new THREE.PlaneGeometry(PITCH_WIDTH, PITCH_HEIGHT);
  const pitchMat = new THREE.MeshStandardMaterial({
    map: createStripedGrassTexture(),
    roughness: 0.88,
    metalness: 0.05
  });
  const pitchMesh = new THREE.Mesh(pitchGeo, pitchMat);
  pitchMesh.rotation.x = -Math.PI / 2;
  pitchMesh.receiveShadow = true;
  stadiumGroup.add(pitchMesh);

  // 3. Demarcación de líneas blancas
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lineY = 0.025;
  const lineW = 0.28;

  function addRectLine(x: number, z: number, w: number, h: number): void {
    // Superior e inferior
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, lineW), lineMat);
    top.rotation.x = -Math.PI / 2;
    top.position.set(x, lineY, z - h / 2);
    stadiumGroup.add(top);

    const bot = new THREE.Mesh(new THREE.PlaneGeometry(w, lineW), lineMat);
    bot.rotation.x = -Math.PI / 2;
    bot.position.set(x, lineY, z + h / 2);
    stadiumGroup.add(bot);

    // Izquierda y derecha
    const left = new THREE.Mesh(new THREE.PlaneGeometry(lineW, h), lineMat);
    left.rotation.x = -Math.PI / 2;
    left.position.set(x - w / 2, lineY, z);
    stadiumGroup.add(left);

    const right = new THREE.Mesh(new THREE.PlaneGeometry(lineW, h), lineMat);
    right.rotation.x = -Math.PI / 2;
    right.position.set(x + w / 2, lineY, z);
    stadiumGroup.add(right);
  }

  // Perímetro del campo
  addRectLine(0, 0, PITCH_WIDTH, PITCH_HEIGHT);

  // Línea central
  const midLine = new THREE.Mesh(new THREE.PlaneGeometry(lineW, PITCH_HEIGHT), lineMat);
  midLine.rotation.x = -Math.PI / 2;
  midLine.position.set(0, lineY, 0);
  stadiumGroup.add(midLine);

  // Círculo central y punto central
  const centerCircleGeo = new THREE.RingGeometry(5.8, 6.08, 64);
  const centerCircle = new THREE.Mesh(centerCircleGeo, lineMat);
  centerCircle.rotation.x = -Math.PI / 2;
  centerCircle.position.set(0, lineY, 0);
  stadiumGroup.add(centerCircle);

  const centerSpot = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), lineMat);
  centerSpot.rotation.x = -Math.PI / 2;
  centerSpot.position.set(0, lineY + 0.005, 0);
  stadiumGroup.add(centerSpot);

  // Áreas de penalti (Izquierda = Azul, Derecha = Rojo)
  const penW = 10.5;
  const penH = 21.0;
  addRectLine(-HALF_W + penW / 2, 0, penW, penH);
  addRectLine(HALF_W - penW / 2, 0, penW, penH);

  // Áreas chicas de meta
  const goalAreaW = 4.2;
  const goalAreaH = 12.2;
  addRectLine(-HALF_W + goalAreaW / 2, 0, goalAreaW, goalAreaH);
  addRectLine(HALF_W - goalAreaW / 2, 0, goalAreaW, goalAreaH);

  // Puntos de penalti y semicírculos de área
  [-HALF_W + 7.5, HALF_W - 7.5].forEach((px, idx) => {
    const pSpot = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), lineMat);
    pSpot.rotation.x = -Math.PI / 2;
    pSpot.position.set(px, lineY, 0);
    stadiumGroup.add(pSpot);

    const startAngle = idx === 0 ? -Math.PI * 0.35 : Math.PI * 0.65;
    const arcGeo = new THREE.RingGeometry(4.8, 5.05, 32, 1, startAngle, Math.PI * 0.7);
    const arcMesh = new THREE.Mesh(arcGeo, lineMat);
    arcMesh.rotation.x = -Math.PI / 2;
    arcMesh.position.set(px, lineY, 0);
    stadiumGroup.add(arcMesh);
  });

  // 4. Vallas perimetrales bajas y semitransparentes para rebotes arcade
  const wallHeight = 1.45;
  const wallMat = new THREE.MeshPhongMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.22,
    shininess: 90
  });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.6 });

  // Vallas laterales (Norte y Sur)
  [-HALF_H - 0.3, HALF_H + 0.3].forEach(zPos => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(PITCH_WIDTH + 0.8, wallHeight, 0.25), wallMat);
    wall.position.set(0, wallHeight / 2, zPos);
    stadiumGroup.add(wall);

    const topRail = new THREE.Mesh(new THREE.BoxGeometry(PITCH_WIDTH + 0.8, 0.14, 0.3), railMat);
    topRail.position.set(0, wallHeight, zPos);
    stadiumGroup.add(topRail);
  });

  // Vallas de fondo (divididas a cada lado de las porterías para permitir que el balón entre al arco)
  const sideSegmentLen = (PITCH_HEIGHT - GOAL_WIDTH) / 2;
  const zOffsetSegment = GOAL_WIDTH / 2 + sideSegmentLen / 2;

  [-HALF_W - 0.15, HALF_W + 0.15].forEach(xPos => {
    [-zOffsetSegment, zOffsetSegment].forEach(zPos => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.25, wallHeight, sideSegmentLen), wallMat);
      wall.position.set(xPos, wallHeight / 2, zPos);
      stadiumGroup.add(wall);

      const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, sideSegmentLen), railMat);
      topRail.position.set(xPos, wallHeight, zPos);
      stadiumGroup.add(topRail);
    });
  });

  // 5. Construcción de las dos Porterías (Izquierda: Roja, Derecha: Azul)
  buildGoal(stadiumGroup, -HALF_W, 1, 0xf43f5e);
  buildGoal(stadiumGroup, HALF_W, -1, 0x3b82f6);

  // 6. Gradas del estadio y público con InstancedMesh (alto rendimiento)
  buildInstancedBleachers(stadiumGroup);

  scene.add(stadiumGroup);
  return stadiumGroup;
}

function buildInstancedBleachers(parent: THREE.Group): void {
  const rows = 4;
  const cols = 28;
  const stepGeo = new THREE.BoxGeometry(PITCH_WIDTH + 6, 1.1, 1.8);
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
  const stepsInst = new THREE.InstancedMesh(stepGeo, stepMat, rows * 2);
  stepsInst.receiveShadow = true;

  const fanGeo = new THREE.BoxGeometry(0.65, 0.95, 0.55);
  const fanMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const fansInst = new THREE.InstancedMesh(fanGeo, fanMat, rows * cols * 2);

  const dummy = new THREE.Object3D();
  const palette = [0xef4444, 0x3b82f6, 0xfacc15, 0x22c55e, 0xf8fafc, 0xa855f7];
  const color = new THREE.Color();
  let stepIdx = 0;
  let fanIdx = 0;

  for (const side of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const z = side * (HALF_H + 3.2 + r * 1.85);
      const y = 0.55 + r * 0.95;
      dummy.position.set(0, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      stepsInst.setMatrixAt(stepIdx++, dummy.matrix);

      for (let c = 0; c < cols; c++) {
        const x = -HALF_W + 2 + (c / (cols - 1)) * (PITCH_WIDTH - 4);
        dummy.position.set(x, y + 0.85, z);
        dummy.updateMatrix();
        fansInst.setMatrixAt(fanIdx, dummy.matrix);
        color.setHex(palette[(r * 7 + c * 3 + (side > 0 ? 1 : 0)) % palette.length]);
        fansInst.setColorAt(fanIdx, color);
        fanIdx++;
      }
    }
  }
  stepsInst.instanceMatrix.needsUpdate = true;
  fansInst.instanceMatrix.needsUpdate = true;
  if (fansInst.instanceColor) fansInst.instanceColor.needsUpdate = true;
  parent.add(stepsInst);
  parent.add(fansInst);
}

