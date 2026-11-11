/**
 * ============================================================================
 * RENDERIZADOR 3D DEL MUNDO (Recibe `RenderState` puro y lo dibuja)
 * ============================================================================
 * Incluye: cámara en órbita para menú, cámara cenital con zoom dinámico,
 * sprites billboard con username y dorsal, estela del balón, partículas de gol,
 * repetición instantánea de los últimos 4 segundos y ajuste de calidad gráfica.
 */
import * as THREE from 'three';
import { BALL_RADIUS, HALF_W } from '../sim/constants';
import type { RenderPlayer, RenderState } from '../sim/types';
import type { GraphicsQuality } from '../ui/settings';
import { createBall, type BallEntity } from './BallMesh';
import { createActiveSelector, FootballPlayer, type ActiveSelectorVisual } from './PlayerMesh';
import { buildStadium } from './Stadium';

interface PlayerVisual {
  actor: FootballPlayer;
  labelSprite: THREE.Sprite;
  emoteSprite: THREE.Sprite | null;
  emoteExpire: number;
  labelKey: string;
  team: 0 | 1;
}

interface GoalParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

const EMOTES = ['⚽', '🔥', '👏', '😂', '😱', '🛡️'];

export class WorldRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private dirLight: THREE.DirectionalLight;
  private ball: BallEntity;
  private selector: ActiveSelectorVisual;
  private visuals = new Map<number, PlayerVisual>();

  // Estela del balón
  private trailCount = 14;
  private trailMeshes: THREE.Mesh[] = [];
  private trailHistory: THREE.Vector3[] = [];

  // Partículas de gol
  private particles: GoalParticle[] = [];
  private particleGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);

  // Buffer de repetición instantánea (~4s a 60fps = 240 cuadros)
  private replayHistory: RenderState[] = [];
  private replayPlayback: RenderState[] = [];
  private replayIndex = 0;
  public isReplaying = false;

  private camLook = new THREE.Vector3(0, 0, 0);
  private orbitAngle = 0;

  constructor(container: HTMLElement, quality: GraphicsQuality) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1324);
    this.scene.fog = new THREE.FogExp2(0x0b1324, 0.0055);

    this.camera = new THREE.PerspectiveCamera(44, window.innerWidth / window.innerHeight, 0.1, 260);
    this.camera.position.set(0, 38, 44);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: quality !== 'low',
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    // Luces (calibradas para Three.js r170+)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.88));
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x14532d, 0.62);
    hemi.position.set(0, 50, 0);
    this.scene.add(hemi);

    this.dirLight = new THREE.DirectionalLight(0xfffbeb, 1.65);
    this.dirLight.position.set(22, 48, 28);
    const d = 44;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 130;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    buildStadium(this.scene);
    this.ball = createBall(this.scene);
    this.selector = createActiveSelector(this.scene);
    this.selector.group.visible = false;

    this.initBallTrail();
    this.applyQuality(quality);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  public applyQuality(quality: GraphicsQuality): void {
    const maxPR = quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPR));
    const shadows = quality !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.dirLight.castShadow = shadows;
    const mapSize = quality === 'high' ? 2048 : 1024;
    this.dirLight.shadow.mapSize.set(mapSize, mapSize);
  }

  private initBallTrail(): void {
    const geo = new THREE.SphereGeometry(BALL_RADIUS * 0.72, 10, 10);
    for (let i = 0; i < this.trailCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: (1 - i / this.trailCount) * 0.35
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this.trailMeshes.push(m);
    }
  }

  /** Dispara una explosión de partículas en la portería donde se anotó e inicia la repetición tras 1.2s. */
  public triggerGoalEffects(scoringTeam: 0 | 1): void {
    const goalX = scoringTeam === 0 ? HALF_W : -HALF_W;
    const colors = scoringTeam === 0 ? [0xf43f5e, 0xfb7185, 0xfacc15] : [0x3b82f6, 0x38bdf8, 0xfacc15];
    for (let i = 0; i < 45; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: colors[i % colors.length] });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.set(goalX, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 7);
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 14;
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed * (scoringTeam === 0 ? -0.7 : 0.7),
        6 + Math.random() * 11,
        Math.sin(angle) * speed
      );
      this.scene.add(mesh);
      this.particles.push({ mesh, vel, life: 1.6 });
    }

    if (this.replayHistory.length > 40) {
      this.replayPlayback = this.replayHistory.slice(-180);
      this.replayIndex = 0;
      this.isReplaying = true;
    }
  }

  public showEmote(playerId: number, emoteIdx: number): void {
    const v = this.visuals.get(playerId);
    if (!v) return;
    if (v.emoteSprite) this.scene.remove(v.emoteSprite);
    const emoji = EMOTES[emoteIdx % EMOTES.length] ?? '⚽';
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '82px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set(2.2, 2.2, 1);
    this.scene.add(sprite);
    v.emoteSprite = sprite;
    v.emoteExpire = performance.now() + 2600;
  }

  public clearMatchVisuals(): void {
    for (const v of this.visuals.values()) {
      this.scene.remove(v.actor.mesh);
      this.scene.remove(v.labelSprite);
      if (v.emoteSprite) this.scene.remove(v.emoteSprite);
    }
    this.visuals.clear();
    this.selector.group.visible = false;
    this.replayHistory = [];
    this.replayPlayback = [];
    this.isReplaying = false;
    this.trailMeshes.forEach(m => { m.visible = false; });
  }

  /** Dibuja el estadio girando suavemente en órbita cuando estamos en el menú o en el lobby. */
  public renderMenuOrbit(dt: number): void {
    this.orbitAngle += dt * 0.18;
    const radius = 52;
    this.camera.position.set(
      Math.cos(this.orbitAngle) * radius,
      30 + Math.sin(this.orbitAngle * 0.5) * 4,
      Math.sin(this.orbitAngle) * radius
    );
    this.camera.lookAt(0, 1, 0);
    this.ball.mesh.position.set(0, BALL_RADIUS, 0);
    this.ball.shadowMarker.position.set(0, 0.03, 0);
    this.renderer.render(this.scene, this.camera);
  }

  /** Dibuja un frame del partido a partir de `RenderState`. */
  public renderMatch(
    dt: number,
    elapsed: number,
    state: RenderState,
    localPlayerId: number,
    namesById: Map<number, string>
  ): void {
    // Guardar historial para repetición instantánea cuando está en juego
    if (state.phase === 'playing') {
      this.isReplaying = false;
      this.replayHistory.push(state);
      if (this.replayHistory.length > 210) this.replayHistory.shift();
    }

    let drawState = state;
    if (state.phase === 'goal' && this.isReplaying && this.replayPlayback.length > 0) {
      drawState = this.replayPlayback[Math.min(this.replayIndex, this.replayPlayback.length - 1)];
      this.replayIndex++;
      if (this.replayIndex >= this.replayPlayback.length) {
        this.isReplaying = false;
      }
    } else {
      this.isReplaying = false;
    }

    // Actualizar balón 3D
    const bSpeed = Math.hypot(drawState.ball.vx, drawState.ball.vy);
    const loftY = BALL_RADIUS + Math.min(1.6, (bSpeed / 42) * 0.9);
    this.ball.pos.set(drawState.ball.x, loftY, drawState.ball.y);
    this.ball.mesh.position.copy(this.ball.pos);
    this.ball.mesh.rotation.z -= drawState.ball.vx * dt * 1.4;
    this.ball.mesh.rotation.x += drawState.ball.vy * dt * 1.4;
    this.ball.shadowMarker.position.set(drawState.ball.x, 0.03, drawState.ball.y);

    // Estela del balón
    this.trailHistory.unshift(this.ball.pos.clone());
    if (this.trailHistory.length > this.trailCount) this.trailHistory.pop();
    const showTrail = bSpeed > 14;
    for (let i = 0; i < this.trailMeshes.length; i++) {
      const m = this.trailMeshes[i];
      const p = this.trailHistory[i];
      if (showTrail && p) {
        m.visible = true;
        m.position.copy(p);
        const s = 1 - i / (this.trailCount + 2);
        m.scale.setScalar(s);
      } else {
        m.visible = false;
      }
    }

    // Sincronizar jugadores 3D y etiquetas
    const seen = new Set<number>();
    let localRenderPlayer: RenderPlayer | null = null;

    for (const p of drawState.players) {
      seen.add(p.id);
      if (p.id === localPlayerId) localRenderPlayer = p;
      const username = namesById.get(p.id) ?? `#${p.number}`;
      const labelKey = `${username}|${p.number}|${p.team}`;

      let vis = this.visuals.get(p.id);
      if (!vis || vis.team !== p.team) {
        if (vis) {
          this.scene.remove(vis.actor.mesh);
          this.scene.remove(vis.labelSprite);
          if (vis.emoteSprite) this.scene.remove(vis.emoteSprite);
        }
        const isGk = p.slot === 0 && drawState.players.filter(x => x.team === p.team).length >= 2;
        const kitColor = p.team === 0 ? (isGk ? 0xfacc15 : 0xe11d48) : (isGk ? 0x10b981 : 0x2563eb);
        const shortColor = p.team === 0 ? 0x881337 : 0x1e3a8a;
        const skins = [0xfde68a, 0xfcd34d, 0xf59e0b, 0xd97706];
        const actor = new FootballPlayer(
          {
            id: String(p.id),
            team: p.team === 0 ? 'red' : 'blue',
            role: isGk ? 'gk' : 'field',
            homePos: new THREE.Vector3(p.x, 0, p.y),
            kitColor,
            shortColor,
            skinColor: skins[p.id % skins.length]
          },
          this.scene
        );
        const labelSprite = this.createNameSprite(username, p.number, p.team, p.id === localPlayerId);
        this.scene.add(labelSprite);
        vis = { actor, labelSprite, emoteSprite: null, emoteExpire: 0, labelKey, team: p.team };
        this.visuals.set(p.id, vis);
      } else if (vis.labelKey !== labelKey) {
        this.scene.remove(vis.labelSprite);
        vis.labelSprite = this.createNameSprite(username, p.number, p.team, p.id === localPlayerId);
        vis.labelKey = labelKey;
        this.scene.add(vis.labelSprite);
      }

      vis.actor.pos.set(p.x, 0, p.y);
      vis.actor.vel.set(p.vx, 0, p.vy);
      if (p.charge > 0.05) vis.actor.kickTimer = 0.08;
      vis.actor.updateAnimation(dt, this.ball.pos);

      vis.labelSprite.position.set(p.x, 3.85, p.y);
      if (vis.emoteSprite) {
        if (performance.now() > vis.emoteExpire) {
          this.scene.remove(vis.emoteSprite);
          vis.emoteSprite = null;
        } else {
          vis.emoteSprite.position.set(p.x, 4.9, p.y);
        }
      }
    }

    for (const [id, vis] of [...this.visuals.entries()]) {
      if (!seen.has(id)) {
        this.scene.remove(vis.actor.mesh);
        this.scene.remove(vis.labelSprite);
        if (vis.emoteSprite) this.scene.remove(vis.emoteSprite);
        this.visuals.delete(id);
      }
    }

    // Indicador del jugador local (anillo + cono pulsante)
    if (localRenderPlayer) {
      this.selector.group.visible = true;
      this.selector.group.position.set(localRenderPlayer.x, 0, localRenderPlayer.y);
      const pulse = 1 + Math.sin(elapsed * 7) * 0.09;
      this.selector.ringMesh.scale.set(pulse, pulse, 1);
      this.selector.coneMesh.position.y = 3.45 + Math.sin(elapsed * 6) * 0.18;
      this.selector.coneMesh.rotation.y += dt * 3;
    } else {
      this.selector.group.visible = false;
    }

    // Actualizar partículas de gol
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        this.particles.splice(i, 1);
      } else {
        pt.vel.y -= 18 * dt;
        pt.mesh.position.addScaledVector(pt.vel, dt);
        pt.mesh.rotation.x += dt * 5;
        pt.mesh.rotation.y += dt * 4;
      }
    }

    // Cámara cenital con zoom dinámico según dispersión Balón <-> Jugadores
    this.updateDynamicCamera(dt, drawState, localRenderPlayer);
    this.renderer.render(this.scene, this.camera);
  }

  private updateDynamicCamera(dt: number, state: RenderState, local: RenderPlayer | null): void {
    const bx = state.ball.x;
    const bz = state.ball.y;
    const focusX = local ? bx * 0.65 + local.x * 0.35 : bx * 0.75;
    const focusZ = local ? bz * 0.65 + local.y * 0.35 : bz * 0.55;

    let spread = 12;
    if (local) {
      spread = Math.hypot(bx - local.x, bz - local.y);
    }
    const zoomFactor = THREE.MathUtils.clamp((spread - 8) / 28, 0, 1);
    const targetY = 30 + zoomFactor * 11;
    const targetZ = 34 + zoomFactor * 9 + focusZ * 0.32;
    const targetX = THREE.MathUtils.clamp(focusX * 0.72, -20, 20);

    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetX, dt * 5);
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetY, dt * 4);
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetZ, dt * 5);

    const lookX = THREE.MathUtils.clamp(focusX * 0.65, -22, 22);
    const lookZ = THREE.MathUtils.clamp(focusZ * 0.45, -11, 11);
    this.camLook.x = THREE.MathUtils.lerp(this.camLook.x, lookX, dt * 7);
    this.camLook.y = 0.6;
    this.camLook.z = THREE.MathUtils.lerp(this.camLook.z, lookZ, dt * 7);
    this.camera.lookAt(this.camLook);
  }

  private createNameSprite(username: string, number: number, team: 0 | 1, isLocal: boolean): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
    ctx.strokeStyle = isLocal ? '#facc15' : team === 0 ? '#f43f5e' : '#3b82f6';
    ctx.lineWidth = isLocal ? 4 : 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 22px "Inter", sans-serif';
    ctx.fillStyle = isLocal ? '#fde047' : '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const safeText = `#${number} ${username}`.slice(0, 18);
    ctx.fillText(safeText, 128, 33);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4.1, 1.02, 1);
    return sprite;
  }
}
