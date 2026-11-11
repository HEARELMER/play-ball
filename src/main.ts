/**
 * ============================================================================
 * PUNTO DE ENTRADA Y MÁQUINA DE ESTADOS DE LA APLICACIÓN
 * ============================================================================
 * Orquesta:
 *  - Render 3D (`WorldRenderer`)
 *  - Sesiones (`OfflineSession`, `HostSession`, `ClientSession`)
 *  - Entrada unificada (`InputManager`)
 *  - Audio sintetizado (`sfx`)
 *  - Interfaz de Usuario (`AppUI`)
 */
import './style.css';
import { sfx } from './audio/SoundEffects';
import { InputManager } from './input/InputManager';
import { ClientSession } from './net/ClientSession';
import { HostSession } from './net/HostSession';
import { randomRoomCode } from './net/ice';
import { OfflineSession, type Session } from './net/Session';
import { WorldRenderer } from './render/WorldRenderer';
import type { SimEvent } from './sim/types';
import { AppUI } from './ui/AppUI';
import { TXT } from './ui/i18n';
import { loadUserSettings } from './ui/settings';

const settings = loadUserSettings();
sfx.setVolume(settings.volume);

const input = new InputManager();
input.setBindings(settings.keys);
input.setSensitivity(settings.sensitivity);

const canvasContainer = document.getElementById('canvas-container') as HTMLElement;
const uiRoot = document.getElementById('app-ui') as HTMLElement;
const world = new WorldRenderer(canvasContainer, settings.quality);

let activeSession: Session | null = null;

function detachSession(): void {
  if (activeSession) {
    activeSession.leave();
    activeSession = null;
  }
  world.clearMatchVisuals();
  ui.bindSession(null);
  ui.showScreen('home');
}

function attachSessionHandlers(session: Session): void {
  session.handlers = {
    lobby: lobby => {
      ui.renderLobby(lobby);
    },
    chat: (from, text, system) => {
      ui.appendChatMessage(from, text, system);
    },
    matchStart: () => {
      world.clearMatchVisuals();
      ui.hideGoalAnnouncement();
      ui.showScreen('match');
      sfx.playWhistle(false);
    },
    simEvent: (ev: SimEvent) => {
      if (ev.type === 'kick') sfx.playKick(ev.power);
      else if (ev.type === 'bounce') sfx.playPass();
      else if (ev.type === 'post') sfx.playPostHit();
      else if (ev.type === 'kickoff') {
        ui.hideGoalAnnouncement();
        sfx.playWhistle(false);
      } else if (ev.type === 'overtime') {
        sfx.playWhistle(false);
        ui.showToast('⚡ ¡Empate! Comienza el Gol de Oro');
      } else if (ev.type === 'end') {
        sfx.playWhistle(true);
      }
    },
    goal: (team, scorer, assist) => {
      sfx.playWhistle(false);
      sfx.playGoalFanfare();
      world.triggerGoalEffects(team);
      const names = session.lobby?.settings.teamNames ?? ['Rojo', 'Azul'];
      ui.showGoalAnnouncement(team, scorer, assist, names);
    },
    matchEnd: result => {
      ui.showMatchEnd(result);
    },
    toLobby: () => {
      world.clearMatchVisuals();
      ui.showScreen('lobby');
    },
    kicked: reason => {
      detachSession();
      ui.showToast(reason || 'Saliste de la sala.', true);
    },
    closed: reason => {
      detachSession();
      ui.showToast(reason || 'Conexión cerrada.', true);
    },
    emote: (playerId, emote) => {
      world.showEmote(playerId, emote);
    }
  };
}

const ui = new AppUI(uiRoot, settings, input, {
  onCreateRoom: async (roomName, password, mode, durationMin) => {
    detachSession();
    ui.showToast(TXT.connecting);
    const code = randomRoomCode(5);
    const host = new HostSession(
      code,
      { roomName, mode, durationSec: durationMin * 60, fillBots: true },
      password,
      settings.username,
      { number: settings.jerseyNumber, color: settings.avatarColor }
    );
    attachSessionHandlers(host);
    try {
      const finalCode = await host.start();
      activeSession = host;
      host.changeTeam('red');
      ui.bindSession(host);
      ui.showScreen('lobby');
      ui.showToast(`Sala creada: ${finalCode}`);
    } catch {
      // Si el servidor de señalización PeerJS no está accesible (ej. sin red), abre en modo local
      ui.showToast('Sin red P2P disponible; abriendo sala en modo local.', true);
      const local = new OfflineSession(
        code,
        { roomName, mode, durationSec: durationMin * 60, fillBots: true },
        password,
        settings.username,
        { number: settings.jerseyNumber, color: settings.avatarColor }
      );
      attachSessionHandlers(local);
      activeSession = local;
      local.changeTeam('red');
      ui.bindSession(local);
      ui.showScreen('lobby');
    }
  },

  onJoinRoom: async (code, password) => {
    detachSession();
    ui.showToast(`${TXT.connecting} (${code})`);
    const client = new ClientSession(code, {
      username: settings.username,
      password,
      number: settings.jerseyNumber,
      color: settings.avatarColor
    });
    attachSessionHandlers(client);
    try {
      await client.connect();
      activeSession = client;
      ui.bindSession(client);
      ui.showScreen(client.inMatch ? 'match' : 'lobby');
      ui.showToast(`Conectado a la sala ${code}`);
    } catch (err) {
      const codeErr = (err as Error)?.message ?? 'network';
      const errMap: Record<string, string> = {
        not_found: 'La sala no existe o el anfitrión se desconectó.',
        timeout: 'Tiempo de espera agotado al conectar.',
        password: 'Contraseña incorrecta.',
        full: 'La sala está llena.',
        invalid_name: 'Nombre de usuario inválido.',
        banned: 'Nombre bloqueado por el filtro.'
      };
      ui.showToast(errMap[codeErr] ?? 'Error de red al conectar con la sala.', true);
    }
  },

  onStartOfflineBots: (mode, durationMin) => {
    detachSession();
    const offline = new OfflineSession(
      'BOTS',
      { roomName: 'Partida Offline', mode, durationSec: durationMin * 60, fillBots: true },
      '',
      settings.username,
      { number: settings.jerseyNumber, color: settings.avatarColor }
    );
    attachSessionHandlers(offline);
    activeSession = offline;
    offline.changeTeam('red');
    ui.bindSession(offline);
    offline.startMatch();
  },

  onLeaveSession: () => {
    detachSession();
  },

  onSettingsChanged: newSettings => {
    input.setBindings(newSettings.keys);
    input.setSensitivity(newSettings.sensitivity);
    sfx.setVolume(newSettings.volume);
    world.applyQuality(newSettings.quality);
  }
});

// ============================================================================
// BUCLE PRINCIPAL DE ANIMACIÓN Y SIMULACIÓN
// ============================================================================
let lastTime = performance.now();
let elapsed = 0;

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  elapsed += dt;

  if (activeSession && activeSession.inMatch) {
    const sample = input.sample();
    activeSession.sendInput(sample);
    activeSession.tick(dt);

    const renderState = activeSession.getRenderState(now);
    if (renderState) {
      const namesById = new Map<number, string>();
      for (const p of activeSession.lobby.players) {
        namesById.set(p.id, p.username);
      }
      world.renderMatch(dt, elapsed, renderState, activeSession.localId, namesById);
      ui.updateMatchHUD(renderState, world.isReplaying);
      return;
    }
  }

  world.renderMenuOrbit(dt);
}

requestAnimationFrame(animate);
