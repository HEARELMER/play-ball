import * as THREE from 'three';

export interface PlayerConfig {
  id: string;
  team: 'blue' | 'red';
  role: 'gk' | 'field';
  homePos: THREE.Vector3;
  kitColor: number;
  shortColor: number;
  skinColor: number;
}

export interface ActiveSelectorVisual {
  group: THREE.Group;
  ringMesh: THREE.Mesh;
  coneMesh: THREE.Mesh;
}

export function createActiveSelector(scene: THREE.Scene): ActiveSelectorVisual {
  const group = new THREE.Group();
  const selectorRingGeo = new THREE.RingGeometry(1.05, 1.38, 32);
  const selectorRingMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92
  });
  const ringMesh = new THREE.Mesh(selectorRingGeo, selectorRingMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.04;
  group.add(ringMesh);

  // Cono invertido flotante sobre la cabeza del jugador activo
  const pointerConeGeo = new THREE.ConeGeometry(0.32, 0.55, 4);
  const pointerConeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const coneMesh = new THREE.Mesh(pointerConeGeo, pointerConeMat);
  coneMesh.rotation.x = Math.PI;
  coneMesh.position.y = 3.55;
  group.add(coneMesh);

  scene.add(group);
  return { group, ringMesh, coneMesh };
}

/**
 * ============================================================================
 * CLASE JUGADOR LOW-POLY CON EXTREMIDADES ANIMADAS
 * ============================================================================
 */
export class FootballPlayer {
  public id: string;
  public team: 'blue' | 'red';
  public role: 'gk' | 'field';
  public homePos: THREE.Vector3;
  public pos: THREE.Vector3;
  public vel: THREE.Vector3;
  public facingAngle: number;
  public baseSpeed: number;
  public stamina: number;
  public animPhase: number;
  public kickTimer: number;
  public mesh: THREE.Group;

  private leftArm!: THREE.Group;
  private rightArm!: THREE.Group;
  private leftLeg!: THREE.Group;
  private rightLeg!: THREE.Group;

  constructor(config: PlayerConfig, scene: THREE.Scene) {
    this.id = config.id;
    this.team = config.team;
    this.role = config.role;
    this.homePos = config.homePos.clone();
    this.pos = config.homePos.clone();
    this.vel = new THREE.Vector3();
    this.facingAngle = config.team === 'blue' ? 0 : Math.PI;

    this.baseSpeed = config.role === 'gk' ? 9.5 : 10.6;
    this.stamina = 100;
    this.animPhase = Math.random() * Math.PI * 2;
    this.kickTimer = 0;

    this.mesh = this.buildLowPolyCharacter(config.kitColor, config.shortColor, config.skinColor);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facingAngle;
    scene.add(this.mesh);
  }

  private buildLowPolyCharacter(kitHex: number, shortHex: number, skinHex: number): THREE.Group {
    const root = new THREE.Group();

    const kitMat = new THREE.MeshStandardMaterial({ color: kitHex, roughness: 0.5 });
    const shortMat = new THREE.MeshStandardMaterial({ color: shortHex, roughness: 0.6 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.55 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4 });
    const hairMat = new THREE.MeshStandardMaterial({
      color: this.team === 'blue' ? 0x1e293b : 0x451a03,
      roughness: 0.8
    });

    // Torso (Cilindro estilizado)
    const torsoGeo = new THREE.CylinderGeometry(0.46, 0.38, 1.15, 12);
    const torso = new THREE.Mesh(torsoGeo, kitMat);
    torso.position.y = 1.38;
    torso.castShadow = true;
    torso.receiveShadow = true;
    root.add(torso);

    // Franja dorsal en el pecho/espalda
    const stripeGeo = new THREE.CylinderGeometry(0.47, 0.43, 0.28, 12);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 1.45;
    root.add(stripe);

    // Pantalón corto
    const hipsGeo = new THREE.CylinderGeometry(0.39, 0.36, 0.38, 12);
    const hips = new THREE.Mesh(hipsGeo, shortMat);
    hips.position.y = 0.72;
    hips.castShadow = true;
    root.add(hips);

    // Cabeza esférica + cabello
    const headGroup = new THREE.Group();
    headGroup.position.y = 2.32;

    const headGeo = new THREE.SphereGeometry(0.38, 16, 16);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.castShadow = true;
    headGroup.add(head);

    const hairGeo = new THREE.SphereGeometry(0.395, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.rotation.x = -0.15;
    headGroup.add(hair);

    // Ojos para indicar claramente hacia dónde mira el jugador
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    [-0.13, 0.13].forEach(zEye => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), eyeMat);
      eye.position.set(0.34, 0.04, zEye);
      headGroup.add(eye);
    });

    root.add(headGroup);

    // Brazos articulados
    this.leftArm = this.createLimb(0.13, 0.65, kitMat, skinMat);
    this.leftArm.position.set(0, 1.82, -0.56);
    root.add(this.leftArm);

    this.rightArm = this.createLimb(0.13, 0.65, kitMat, skinMat);
    this.rightArm.position.set(0, 1.82, 0.56);
    root.add(this.rightArm);

    // Piernas articuladas
    this.leftLeg = this.createLeg(0.15, 0.68, skinMat, bootMat);
    this.leftLeg.position.set(0, 0.68, -0.2);
    root.add(this.leftLeg);

    this.rightLeg = this.createLeg(0.15, 0.68, skinMat, bootMat);
    this.rightLeg.position.set(0, 0.68, 0.2);
    root.add(this.rightLeg);

    return root;
  }

  private createLimb(
    radius: number,
    len: number,
    upperMat: THREE.Material,
    lowerMat: THREE.Material
  ): THREE.Group {
    const pivot = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.9, len, 8), upperMat);
    upper.position.y = -len / 2;
    upper.castShadow = true;
    pivot.add(upper);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.95, 8, 8), lowerMat);
    hand.position.y = -len;
    pivot.add(hand);
    return pivot;
  }

  private createLeg(
    radius: number,
    len: number,
    skinMat: THREE.Material,
    bootMat: THREE.Material
  ): THREE.Group {
    const pivot = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, len, 8), skinMat);
    leg.position.y = -len / 2;
    leg.castShadow = true;
    pivot.add(leg);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.24), bootMat);
    boot.position.set(0.06, -len + 0.08, 0);
    boot.castShadow = true;
    pivot.add(boot);
    return pivot;
  }

  public updateAnimation(dt: number, ballPos: THREE.Vector3): void {
    const speed = Math.hypot(this.vel.x, this.vel.z);

    if (this.kickTimer > 0) {
      this.kickTimer -= dt;
      this.rightLeg.rotation.z = 0.85;
      this.leftLeg.rotation.z = -0.35;
      this.leftArm.rotation.z = 0.5;
      this.rightArm.rotation.z = -0.5;
    } else if (speed > 0.4) {
      this.animPhase += dt * (speed * 1.45);
      const swing = Math.sin(this.animPhase) * 0.68;
      this.leftLeg.rotation.z = swing;
      this.rightLeg.rotation.z = -swing;
      this.leftArm.rotation.z = -swing * 0.75;
      this.rightArm.rotation.z = swing * 0.75;
    } else {
      // Postura de reposo respirando suavemente
      this.animPhase += dt * 3.0;
      this.leftLeg.rotation.z *= 0.85;
      this.rightLeg.rotation.z *= 0.85;
      this.leftArm.rotation.z = Math.sin(this.animPhase) * 0.06;
      this.rightArm.rotation.z = -Math.sin(this.animPhase) * 0.06;
    }

    // Orientación suave hacia la dirección de movimiento
    if (speed > 0.35) {
      const targetAngle = Math.atan2(-this.vel.z, this.vel.x);
      let diff = targetAngle - this.facingAngle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.facingAngle += diff * Math.min(1, dt * 14);
    } else {
      // Si está quieto (ej. portero), mira hacia el balón
      const toBallAngle = Math.atan2(-(ballPos.z - this.pos.z), ballPos.x - this.pos.x);
      let diff = toBallAngle - this.facingAngle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.facingAngle += diff * Math.min(1, dt * 8);
    }

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facingAngle;
  }
}
