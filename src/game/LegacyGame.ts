/**
 * ============================================================================
 * JUEGO ORIGINAL 3v3 (FASE 1: migración modularizada tal cual)
 * ============================================================================
 * Port fiel de la lógica del HTML original. En la Fase 2/3 esta lógica se
 * separa en `sim/` (simulación pura) y `render/`, y este archivo desaparece.
 */
import * as THREE from 'three';
import { sfx } from '../audio/SoundEffects';
import { InputManager } from '../input/InputManager';
import { createBall } from '../render/BallMesh';
import { FootballPlayer, createActiveSelector } from '../render/PlayerMesh';
import { buildStadium, goalPostsColliders } from '../render/Stadium';
import {
  AIR_DRAG, BALL_RADIUS, BOUNCE_DAMPING, GOAL_DEPTH, GOAL_HEIGHT, GOAL_WIDTH,
  GRASS_FRICTION, GRAVITY, HALF_H, HALF_W, PLAYER_RADIUS, STEAL_COOLDOWN_TIME
} from '../sim/constants';
import { HUDController, type MatchState } from '../ui/HUD';

const MATCH_SECONDS = 180;

export function startLegacyGame(): void {
  const container = document.getElementById('canvas-container') as HTMLElement;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1324);
  scene.fog = new THREE.FogExp2(0x0b1324, 0.0065);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 250);
  camera.position.set(0, 34, 42);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Luces (intensidades ajustadas a Three.js moderno; ver DECISIONS.md #2)
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const hemi = new THREE.HemisphereLight(0xdbeafe, 0x14532d, 0.6);
  hemi.position.set(0, 50, 0);
  scene.add(hemi);
  const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.6);
  dirLight.position.set(22, 48, 28);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 130;
  const d = 44;
  Object.assign(dirLight.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);

  scene.add(buildStadium(scene));
  const ball = createBall(scene);
  const selector = createActiveSelector(scene);

  // ---------------------------------------------------------------- equipos
  const mk = (id: string, team: 'blue' | 'red', role: 'gk' | 'field', x: number, z: number,
    kit: number, shorts: number, skin: number) =>
    new FootballPlayer({ id, team, role, homePos: new THREE.Vector3(x, 0, z), kitColor: kit, shortColor: shorts, skinColor: skin }, scene);

  const players: FootballPlayer[] = [
    mk('blue_gk', 'blue', 'gk', -HALF_W + 2.2, 0, 0x10b981, 0x064e3b, 0xfde68a),
    mk('blue_1', 'blue', 'field', -10, -7.5, 0x2563eb, 0x1e3a8a, 0xfcd34d),
    mk('blue_2', 'blue', 'field', -8, 7.5, 0x3b82f6, 0x1e3a8a, 0xf59e0b),
    mk('red_gk', 'red', 'gk', HALF_W - 2.2, 0, 0xfacc15, 0x713f12, 0xfde68a),
    mk('red_1', 'red', 'field', 10, -7.5, 0xe11d48, 0x881337, 0xfcd34d),
    mk('red_2', 'red', 'field', 8, 7.5, 0xf43f5e, 0x881337, 0xd97706)
  ];
  let activePlayer: FootballPlayer | null = players[1];

  // ---------------------------------------------------------------- estado
  const matchState: MatchState = {
    scoreBlue: 0, scoreRed: 0, timeRemaining: MATCH_SECONDS,
    isGoalPause: false, isGameOver: false,
    shotsBlue: 0, shotsRed: 0, stealsCount: 0, savesCount: 0
  };
  let isChargingShot = false;
  let shotCharge = 0;

  const hud = new HUDController(() => {
    Object.assign(matchState, {
      scoreBlue: 0, scoreRed: 0, timeRemaining: MATCH_SECONDS, isGoalPause: false, isGameOver: false,
      shotsBlue: 0, shotsRed: 0, stealsCount: 0, savesCount: 0
    });
    hud.updateScoreUI(0, 0);
    hud.hideMatchOver();
    hud.hideGoalBanner();
    resetPositionsToKickoff();
    hud.updateTimerUI(matchState.timeRemaining);
    sfx.playWhistle(false);
  });

  const input = new InputManager({
    onPassOrTackle: () => handlePassOrTackleAction(),
    onStartChargingShot: () => { isChargingShot = true; },
    onShootRelease: () => { if (isChargingShot) executePlayerShot(); },
    onSwitchPlayer: () => switchToClosestBluePlayer()
  });
  const keys = input.keys;

  // ---------------------------------------------------------------- acciones
  function switchToClosestBluePlayer(): void {
    if (matchState.isGoalPause || matchState.isGameOver) return;
    const field = players.filter(p => p.team === 'blue' && p.role === 'field');
    let closest: FootballPlayer | null = null;
    let minDist = Infinity;
    field.forEach(p => {
      const dist = p.pos.distanceTo(ball.pos);
      if (dist < minDist) { minDist = dist; closest = p; }
    });
    if (closest === activePlayer && field.length > 1) {
      closest = field.find(p => p !== activePlayer) || closest;
    }
    if (closest) {
      activePlayer = closest;
      isChargingShot = false;
      shotCharge = 0;
      hud.updatePowerBarUI(0);
    }
  }

  function handlePassOrTackleAction(): void {
    if (matchState.isGoalPause || matchState.isGameOver || !activePlayer) return;
    const distToBall = activePlayer.pos.distanceTo(ball.pos);
    if (ball.owner === activePlayer || (ball.owner === null && distToBall < 2.2)) {
      let targetMate: FootballPlayer | null = null;
      let bestScore = Infinity;
      players.filter(p => p.team === 'blue' && p !== activePlayer).forEach(mate => {
        const dd = activePlayer!.pos.distanceTo(mate.pos);
        const penalty = mate.role === 'gk' ? 18 : 0;
        if (dd + penalty < bestScore) { bestScore = dd + penalty; targetMate = mate; }
      });
      const mate = targetMate as FootballPlayer | null;
      if (mate) {
        const dir = new THREE.Vector3().subVectors(mate.pos, activePlayer.pos);
        dir.y = 0;
        const dist = dir.length();
        dir.normalize();
        dir.addScaledVector(mate.vel, 0.035).normalize();
        const passSpeed = Math.min(27, Math.max(17, dist * 1.15));
        ball.owner = null;
        ball.stealCooldown = 0.28;
        ball.vel.set(dir.x * passSpeed, 1.2, dir.z * passSpeed);
        ball.lastTouchTeam = 'blue';
        activePlayer.facingAngle = Math.atan2(-dir.z, dir.x);
        activePlayer.kickTimer = 0.25;
        sfx.playPass();
        if (mate.role === 'field') activePlayer = mate;
      }
    } else {
      const dirToBall = new THREE.Vector3().subVectors(ball.pos, activePlayer.pos);
      dirToBall.y = 0;
      if (dirToBall.lengthSq() > 0.01) {
        dirToBall.normalize();
        activePlayer.vel.addScaledVector(dirToBall, 5.5);
        activePlayer.kickTimer = 0.2;
      }
    }
  }

  function executePlayerShot(): void {
    isChargingShot = false;
    const powerRatio = Math.max(0.2, shotCharge / 100);
    shotCharge = 0;
    hud.updatePowerBarUI(0);
    if (matchState.isGoalPause || matchState.isGameOver || !activePlayer) return;

    const distToBall = activePlayer.pos.distanceTo(ball.pos);
    if (ball.owner === activePlayer || (ball.owner === null && distToBall < 2.35)) {
      const facingDir = new THREE.Vector3(Math.cos(activePlayer.facingAngle), 0, -Math.sin(activePlayer.facingAngle));
      const goalTarget = new THREE.Vector3(HALF_W, 0,
        THREE.MathUtils.clamp(activePlayer.pos.z * 0.4, -GOAL_WIDTH * 0.38, GOAL_WIDTH * 0.38));
      const toGoalDir = new THREE.Vector3().subVectors(goalTarget, activePlayer.pos).normalize();
      const shotDir = facingDir.clone();
      if (facingDir.x > -0.2) shotDir.lerp(toGoalDir, 0.55).normalize();

      const shotSpeed = 20 + powerRatio * 22;
      const shotLoft = 3.2 + powerRatio * 8.2;
      ball.owner = null;
      ball.stealCooldown = 0.35;
      ball.vel.set(shotDir.x * shotSpeed, shotLoft, shotDir.z * shotSpeed);
      ball.lastTouchTeam = 'blue';
      activePlayer.kickTimer = 0.32;
      matchState.shotsBlue++;
      sfx.playKick(powerRatio);
    }
  }

  // ---------------------------------------------------------------- control + IA
  function updateHumanPlayer(dt: number): void {
    if (!activePlayer) return;
    let moveX = 0;
    let moveZ = 0;
    if (keys.up) moveZ -= 1;
    if (keys.down) moveZ += 1;
    if (keys.left) moveX -= 1;
    if (keys.right) moveX += 1;
    const isMoving = moveX !== 0 || moveZ !== 0;

    let speedMultiplier = 1.0;
    if (keys.sprint && isMoving && activePlayer.stamina > 2) {
      speedMultiplier = 1.44;
      activePlayer.stamina = Math.max(0, activePlayer.stamina - dt * 28);
    } else {
      activePlayer.stamina = Math.min(100, activePlayer.stamina + dt * 16);
    }
    if (ball.owner === activePlayer) speedMultiplier *= 0.94;

    if (isMoving) {
      const len = Math.hypot(moveX, moveZ);
      moveX /= len;
      moveZ /= len;
      const targetSpeed = activePlayer.baseSpeed * speedMultiplier;
      activePlayer.vel.x = THREE.MathUtils.lerp(activePlayer.vel.x, moveX * targetSpeed, dt * 12);
      activePlayer.vel.z = THREE.MathUtils.lerp(activePlayer.vel.z, moveZ * targetSpeed, dt * 12);
    } else {
      activePlayer.vel.x = THREE.MathUtils.lerp(activePlayer.vel.x, 0, dt * 10);
      activePlayer.vel.z = THREE.MathUtils.lerp(activePlayer.vel.z, 0, dt * 10);
    }

    if (isChargingShot && keys.shootHold) {
      shotCharge = Math.min(100, shotCharge + dt * 115);
      hud.updatePowerBarUI(shotCharge);
      if (shotCharge >= 100) executePlayerShot();
    }
  }

  function steerTowards(player: FootballPlayer, target: THREE.Vector3, maxSpeed: number, dt: number): void {
    const dx = target.x - player.pos.x;
    const dz = target.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.25) {
      player.vel.x = THREE.MathUtils.lerp(player.vel.x, (dx / dist) * maxSpeed, dt * 9);
      player.vel.z = THREE.MathUtils.lerp(player.vel.z, (dz / dist) * maxSpeed, dt * 9);
    } else {
      player.vel.x *= 0.85;
      player.vel.z *= 0.85;
    }
  }

  function updateAIPlayers(dt: number): void {
    const redField = players.filter(p => p.team === 'red' && p.role === 'field');
    let closestRedToBall = redField[0];
    if (redField.length > 1) {
      const d0 = redField[0].pos.distanceTo(ball.pos);
      const d1 = redField[1].pos.distanceTo(ball.pos);
      closestRedToBall = d0 <= d1 ? redField[0] : redField[1];
    }

    players.forEach(p => {
      if (p !== activePlayer) p.stamina = Math.min(100, p.stamina + dt * 18);
      if (p === activePlayer) return;

      // 1. Porteros
      if (p.role === 'gk') {
        const goalX = p.team === 'blue' ? -HALF_W + 1.8 : HALF_W - 1.8;
        const maxZ = GOAL_WIDTH * 0.43;
        const targetZ = THREE.MathUtils.clamp(ball.pos.z * 0.82, -maxZ, maxZ);
        let targetX = goalX;
        if (Math.abs(ball.pos.x - goalX) < 9.5 && ball.owner === null) {
          targetX = THREE.MathUtils.lerp(goalX, ball.pos.x, 0.25);
        }
        p.vel.x = THREE.MathUtils.clamp((targetX - p.pos.x) * 6.5, -p.baseSpeed, p.baseSpeed);
        p.vel.z = THREE.MathUtils.clamp((targetZ - p.pos.z) * 7.5, -p.baseSpeed, p.baseSpeed);

        if (ball.owner === p) {
          const clearDirX = p.team === 'blue' ? 1 : -1;
          const mates = players.filter(m => m.team === p.team && m.role === 'field');
          const targetMate = mates[Math.floor(Math.random() * mates.length)];
          const dir = new THREE.Vector3(clearDirX, 0, (Math.random() - 0.5) * 0.7).normalize();
          if (targetMate) dir.subVectors(targetMate.pos, p.pos).normalize();
          ball.owner = null;
          ball.stealCooldown = 0.45;
          ball.vel.set(dir.x * 26, 6.2, dir.z * 22);
          p.kickTimer = 0.3;
          matchState.savesCount++;
          sfx.playKick(0.8);
        }
        return;
      }

      // 2. Compañero azul sin control
      if (p.team === 'blue' && p.role === 'field') {
        const blueHasBall = ball.owner && ball.owner.team === 'blue';
        const targetPos = new THREE.Vector3();
        if (blueHasBall) {
          const attackX = THREE.MathUtils.clamp(ball.pos.x + 10, -8, HALF_W - 6);
          const attackZ = activePlayer && activePlayer.pos.z > 0 ? -9.5 : 9.5;
          targetPos.set(attackX, 0, attackZ);
        } else {
          const defX = THREE.MathUtils.clamp(ball.pos.x - 9, -HALF_W + 7, 4);
          const defZ = p.homePos.z * 0.75 + ball.pos.z * 0.25;
          targetPos.set(defX, 0, defZ);
        }
        steerTowards(p, targetPos, p.baseSpeed * 0.92, dt);
        return;
      }

      // 3. CPU roja
      if (p.team === 'red' && p.role === 'field') {
        if (ball.owner === p) {
          if (p.pos.x < -HALF_W + 17.5 && Math.abs(p.pos.z) < 12.5) {
            const aimZ = THREE.MathUtils.randFloatSpread(GOAL_WIDTH * 0.7);
            const shotDir = new THREE.Vector3().subVectors(new THREE.Vector3(-HALF_W, 0, aimZ), p.pos).normalize();
            const power = 26 + Math.random() * 10;
            ball.owner = null;
            ball.stealCooldown = 0.4;
            ball.vel.set(shotDir.x * power, 4.2 + Math.random() * 3.5, shotDir.z * power);
            ball.lastTouchTeam = 'red';
            p.kickTimer = 0.3;
            matchState.shotsRed++;
            sfx.playKick(0.75);
            return;
          }

          let nearestBlue: { pl: FootballPlayer | null; dist: number } = { pl: null, dist: Infinity };
          players.filter(b => b.team === 'blue' && b.role === 'field').forEach(b => {
            const dd = b.pos.distanceTo(p.pos);
            if (dd < nearestBlue.dist) nearestBlue = { pl: b, dist: dd };
          });

          const otherRed = redField.find(r => r !== p);
          if (nearestBlue.dist < 3.6 && otherRed && otherRed.pos.x < p.pos.x + 3 && Math.random() < 0.08) {
            const passDir = new THREE.Vector3().subVectors(otherRed.pos, p.pos).normalize();
            ball.owner = null;
            ball.stealCooldown = 0.35;
            ball.vel.set(passDir.x * 22, 1.0, passDir.z * 22);
            ball.lastTouchTeam = 'red';
            p.kickTimer = 0.25;
            sfx.playPass();
            return;
          }

          const evadeZ = nearestBlue.pl ? Math.sign(p.pos.z - nearestBlue.pl.pos.z) * 3.5 : 0;
          const dribbleTarget = new THREE.Vector3(-HALF_W + 4, 0, THREE.MathUtils.clamp(p.pos.z * 0.5 + evadeZ, -13, 13));
          steerTowards(p, dribbleTarget, p.baseSpeed * 0.94, dt);
          return;
        }

        if (ball.owner && ball.owner.team === 'red') {
          const supportX = THREE.MathUtils.clamp(ball.pos.x - 9, -HALF_W + 7, 12);
          const supportZ = ball.owner.pos.z > 0 ? -9 : 9;
          steerTowards(p, new THREE.Vector3(supportX, 0, supportZ), p.baseSpeed * 0.95, dt);
          return;
        }

        if (p === closestRedToBall) {
          steerTowards(p, ball.pos, p.baseSpeed * 1.02, dt);
        } else {
          const coverX = THREE.MathUtils.clamp(ball.pos.x + 10, -4, HALF_W - 6);
          const coverZ = THREE.MathUtils.clamp(-ball.pos.z * 0.55, -10, 10);
          steerTowards(p, new THREE.Vector3(coverX, 0, coverZ), p.baseSpeed * 0.92, dt);
        }
      }
    });
  }

  // ---------------------------------------------------------------- físicas
  function performBallSteal(newOwner: FootballPlayer, previousOwner: FootballPlayer): void {
    ball.owner = newOwner;
    ball.stealCooldown = STEAL_COOLDOWN_TIME;
    ball.lastTouchTeam = newOwner.team;
    newOwner.kickTimer = 0.22;
    const pushAngle = Math.atan2(previousOwner.pos.z - newOwner.pos.z, previousOwner.pos.x - newOwner.pos.x);
    previousOwner.vel.x = Math.cos(pushAngle) * 6.5;
    previousOwner.vel.z = Math.sin(pushAngle) * 6.5;
    if (newOwner.team === 'blue') {
      matchState.stealsCount++;
      if (newOwner.role === 'field') activePlayer = newOwner;
    }
    sfx.playPass();
  }

  function checkGoalAndWallCollisions(): void {
    if (ball.pos.z < -HALF_H + BALL_RADIUS) {
      ball.owner = null;
      ball.pos.z = -HALF_H + BALL_RADIUS;
      ball.vel.z = Math.abs(ball.vel.z) * 0.78;
      sfx.playPass();
    } else if (ball.pos.z > HALF_H - BALL_RADIUS) {
      ball.owner = null;
      ball.pos.z = HALF_H - BALL_RADIUS;
      ball.vel.z = -Math.abs(ball.vel.z) * 0.78;
      sfx.playPass();
    }

    const inGoalZ = Math.abs(ball.pos.z) < (GOAL_WIDTH / 2 - BALL_RADIUS * 0.45);
    const underCrossbar = ball.pos.y < (GOAL_HEIGHT - BALL_RADIUS * 0.25);

    if (ball.pos.x < -HALF_W + BALL_RADIUS) {
      if (inGoalZ && underCrossbar) {
        if (ball.pos.x < -HALF_W - BALL_RADIUS * 0.4 && !matchState.isGoalPause) triggerGoalScored('red');
        if (ball.pos.x < -HALF_W - GOAL_DEPTH + BALL_RADIUS) {
          ball.pos.x = -HALF_W - GOAL_DEPTH + BALL_RADIUS;
          ball.vel.x = Math.abs(ball.vel.x) * 0.25;
          ball.vel.z *= 0.4;
        }
      } else {
        ball.owner = null;
        ball.pos.x = -HALF_W + BALL_RADIUS;
        ball.vel.x = Math.abs(ball.vel.x) * 0.78;
        sfx.playPass();
      }
    }

    if (ball.pos.x > HALF_W - BALL_RADIUS) {
      if (inGoalZ && underCrossbar) {
        if (ball.pos.x > HALF_W + BALL_RADIUS * 0.4 && !matchState.isGoalPause) triggerGoalScored('blue');
        if (ball.pos.x > HALF_W + GOAL_DEPTH - BALL_RADIUS) {
          ball.pos.x = HALF_W + GOAL_DEPTH - BALL_RADIUS;
          ball.vel.x = -Math.abs(ball.vel.x) * 0.25;
          ball.vel.z *= 0.4;
        }
      } else {
        ball.owner = null;
        ball.pos.x = HALF_W - BALL_RADIUS;
        ball.vel.x = -Math.abs(ball.vel.x) * 0.78;
        sfx.playPass();
      }
    }
  }

  function updatePhysics(dt: number): void {
    if (ball.stealCooldown > 0) ball.stealCooldown = Math.max(0, ball.stealCooldown - dt);

    players.forEach(p => {
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      const maxX = p.role === 'gk' ? HALF_W - 0.8 : HALF_W - 0.9;
      p.pos.x = THREE.MathUtils.clamp(p.pos.x, -maxX, maxX);
      p.pos.z = THREE.MathUtils.clamp(p.pos.z, -HALF_H + 0.9, HALF_H - 0.9);
    });

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const p1 = players[i];
        const p2 = players[j];
        const dx = p2.pos.x - p1.pos.x;
        const dz = p2.pos.z - p1.pos.z;
        const dist = Math.hypot(dx, dz);
        const minDist = PLAYER_RADIUS * 1.85;
        if (dist < minDist && dist > 0.0001) {
          const overlap = (minDist - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          p1.pos.x -= nx * overlap;
          p1.pos.z -= nz * overlap;
          p2.pos.x += nx * overlap;
          p2.pos.z += nz * overlap;
          if (ball.stealCooldown <= 0 && p1.team !== p2.team) {
            if (ball.owner === p1) performBallSteal(p2, p1);
            else if (ball.owner === p2) performBallSteal(p1, p2);
          }
        }
      }
    }

    if (ball.owner) {
      const owner = ball.owner;
      const dribbleDist = PLAYER_RADIUS + BALL_RADIUS * 0.85;
      const forwardX = Math.cos(owner.facingAngle);
      const forwardZ = -Math.sin(owner.facingAngle);
      const speed = Math.hypot(owner.vel.x, owner.vel.z);
      const bobOffset = Math.sin(owner.animPhase * 2) * 0.12 * (speed / owner.baseSpeed);
      ball.pos.x = THREE.MathUtils.lerp(ball.pos.x, owner.pos.x + forwardX * (dribbleDist + bobOffset), dt * 22);
      ball.pos.z = THREE.MathUtils.lerp(ball.pos.z, owner.pos.z + forwardZ * (dribbleDist + bobOffset), dt * 22);
      ball.pos.y = BALL_RADIUS;
      ball.vel.copy(owner.vel);
      ball.lastTouchTeam = owner.team;
      ball.mesh.rotation.z -= owner.vel.x * dt * 1.6;
      ball.mesh.rotation.x += owner.vel.z * dt * 1.6;
    } else {
      ball.pos.x += ball.vel.x * dt;
      ball.pos.y += ball.vel.y * dt;
      ball.pos.z += ball.vel.z * dt;

      if (ball.pos.y > BALL_RADIUS) {
        ball.vel.y -= GRAVITY * dt;
        ball.vel.x *= (1 - AIR_DRAG * dt);
        ball.vel.z *= (1 - AIR_DRAG * dt);
      } else {
        ball.pos.y = BALL_RADIUS;
        if (ball.vel.y < -2.2) {
          ball.vel.y = -ball.vel.y * BOUNCE_DAMPING;
          sfx.playPass();
        } else {
          ball.vel.y = 0;
        }
        const horizSpeed = Math.hypot(ball.vel.x, ball.vel.z);
        if (horizSpeed > 0.05) {
          const drop = Math.max(0, horizSpeed - GRASS_FRICTION * Math.max(4.5, horizSpeed * 0.45) * dt);
          ball.vel.x = (ball.vel.x / horizSpeed) * drop;
          ball.vel.z = (ball.vel.z / horizSpeed) * drop;
        } else {
          ball.vel.x = 0;
          ball.vel.z = 0;
        }
      }

      ball.mesh.rotation.z -= ball.vel.x * dt * 1.5;
      ball.mesh.rotation.x += ball.vel.z * dt * 1.5;

      if (ball.stealCooldown <= 0 && ball.pos.y < 1.95) {
        for (const p of players) {
          const dist = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
          const catchRadius = p.role === 'gk' ? PLAYER_RADIUS + BALL_RADIUS + 0.35 : PLAYER_RADIUS + BALL_RADIUS + 0.15;
          if (dist < catchRadius) {
            const ballSpeed = Math.hypot(ball.vel.x, ball.vel.z);
            if (ballSpeed > 30 && p.role !== 'gk') {
              const nx = (ball.pos.x - p.pos.x) / (dist || 1);
              const nz = (ball.pos.z - p.pos.z) / (dist || 1);
              ball.vel.x = nx * ballSpeed * 0.55;
              ball.vel.z = nz * ballSpeed * 0.55;
              ball.stealCooldown = 0.2;
              sfx.playPass();
            } else {
              ball.owner = p;
              ball.lastTouchTeam = p.team;
              ball.vel.y = 0;
              if (p.team === 'blue' && p.role === 'field') activePlayer = p;
            }
            break;
          }
        }
      }
    }

    // Postes
    goalPostsColliders.forEach(post => {
      if (ball.pos.y <= post.height + BALL_RADIUS) {
        const dx = ball.pos.x - post.x;
        const dz = ball.pos.z - post.z;
        const dist = Math.hypot(dx, dz);
        const minDist = BALL_RADIUS + post.r;
        if (dist < minDist && dist > 0.0001) {
          ball.owner = null;
          const nx = dx / dist;
          const nz = dz / dist;
          ball.pos.x = post.x + nx * minDist;
          ball.pos.z = post.z + nz * minDist;
          const dot = ball.vel.x * nx + ball.vel.z * nz;
          if (dot < 0) {
            ball.vel.x = (ball.vel.x - 2 * dot * nx) * 0.85;
            ball.vel.z = (ball.vel.z - 2 * dot * nz) * 0.85;
            sfx.playPostHit();
          }
        }
      }
    });

    // Travesaño
    [-HALF_W, HALF_W].forEach(goalX => {
      if (Math.abs(ball.pos.z) <= GOAL_WIDTH / 2 + BALL_RADIUS) {
        const dx = ball.pos.x - goalX;
        const dy = ball.pos.y - GOAL_HEIGHT;
        const dist = Math.hypot(dx, dy);
        const minDist = BALL_RADIUS + 0.16;
        if (dist < minDist && dist > 0.0001) {
          ball.owner = null;
          ball.pos.x = goalX + (dx / dist) * minDist;
          ball.pos.y = GOAL_HEIGHT + (dy / dist) * minDist;
          ball.vel.x = -ball.vel.x * 0.8;
          ball.vel.y = Math.abs(ball.vel.y) * 0.75 + 2.0;
          sfx.playPostHit();
        }
      }
    });

    checkGoalAndWallCollisions();

    ball.mesh.position.copy(ball.pos);
    ball.shadowMarker.position.set(ball.pos.x, 0.03, ball.pos.z);
    const shadowScale = THREE.MathUtils.clamp(1.15 - (ball.pos.y - BALL_RADIUS) * 0.1, 0.45, 1.15);
    ball.shadowMarker.scale.set(shadowScale, shadowScale, 1);

    players.forEach(p => p.updateAnimation(dt, ball.pos));
  }

  // ---------------------------------------------------------------- eventos
  function resetPositionsToKickoff(): void {
    ball.pos.set(0, BALL_RADIUS + 0.5, 0);
    ball.vel.set(0, 0, 0);
    ball.owner = null;
    ball.stealCooldown = 0.4;
    ball.mesh.position.copy(ball.pos);
    players.forEach(p => {
      p.pos.copy(p.homePos);
      p.vel.set(0, 0, 0);
      p.facingAngle = p.team === 'blue' ? 0 : Math.PI;
      p.stamina = 100;
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.y = p.facingAngle;
    });
    activePlayer = players.find(p => p.id === 'blue_1') || players[1];
  }

  function triggerGoalScored(scoringTeam: 'blue' | 'red'): void {
    matchState.isGoalPause = true;
    ball.owner = null;
    isChargingShot = false;
    shotCharge = 0;
    hud.updatePowerBarUI(0);
    if (scoringTeam === 'blue') matchState.scoreBlue++;
    else matchState.scoreRed++;
    hud.updateScoreUI(matchState.scoreBlue, matchState.scoreRed);
    hud.showGoalBanner(scoringTeam, matchState.scoreBlue, matchState.scoreRed);
    sfx.playWhistle(false);
    sfx.playGoalFanfare();

    setTimeout(() => {
      hud.hideGoalBanner();
      if (!matchState.isGameOver) {
        resetPositionsToKickoff();
        matchState.isGoalPause = false;
        sfx.playWhistle(false);
      }
    }, 2000);
  }

  function triggerMatchOver(): void {
    matchState.isGameOver = true;
    sfx.playWhistle(true);
    hud.showMatchOver(matchState);
  }

  // ---------------------------------------------------------------- cámara
  const cameraTargetLook = new THREE.Vector3(0, 0, 0);
  function updateBroadcastCamera(dt: number): void {
    const targetCamX = THREE.MathUtils.clamp(ball.pos.x * 0.68, -18, 18);
    const targetCamZ = 38 + ball.pos.z * 0.32;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, dt * 4.5);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 31, dt * 4.5);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, dt * 4.5);
    const lookX = THREE.MathUtils.clamp(ball.pos.x * 0.55, -22, 22);
    const lookZ = THREE.MathUtils.clamp(ball.pos.z * 0.4, -10, 10);
    cameraTargetLook.x = THREE.MathUtils.lerp(cameraTargetLook.x, lookX, dt * 6.5);
    cameraTargetLook.y = 0.8;
    cameraTargetLook.z = THREE.MathUtils.lerp(cameraTargetLook.z, lookZ, dt * 6.5);
    camera.lookAt(cameraTargetLook);
  }

  // ---------------------------------------------------------------- bucle
  let lastFrameTime = performance.now();
  let totalElapsedTime = 0;

  function gameLoop(now: number): void {
    requestAnimationFrame(gameLoop);
    const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;
    totalElapsedTime += dt;

    if (!matchState.isGameOver) {
      if (!matchState.isGoalPause) {
        matchState.timeRemaining -= dt;
        hud.updateTimerUI(matchState.timeRemaining);
        if (matchState.timeRemaining <= 0) {
          matchState.timeRemaining = 0;
          hud.updateTimerUI(0);
          triggerMatchOver();
        } else {
          updateHumanPlayer(dt);
          updateAIPlayers(dt);
          updatePhysics(dt);
        }
      } else {
        updatePhysics(dt * 0.35);
      }
    }

    hud.updateHUDAndVisualIndicators(dt, totalElapsedTime, activePlayer, selector, ball);
    updateBroadcastCamera(dt);
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  resetPositionsToKickoff();
  hud.updateTimerUI(matchState.timeRemaining);
  lastFrameTime = performance.now();
  requestAnimationFrame(gameLoop);
}
