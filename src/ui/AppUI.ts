/**
 * ============================================================================
 * INTERFAZ DE USUARIO COMPLETA (Inicio, Lobby Haxball 3 columnas, HUD, Final y Ajustes)
 * ============================================================================
 * Seguridad XSS: todos los nombres de usuario, mensajes de chat y códigos se insertan
 * exclusivamente mediante `textContent` o `value`.
 */
import gsap from 'gsap';
import { sfx } from '../audio/SoundEffects';
import type { InputManager } from '../input/InputManager';
import { normalizeRoomCode } from '../net/ice';
import type { LobbyState, MatchResult, PlayerInfo, RoomSettings, TeamName } from '../net/protocol';
import type { Session } from '../net/Session';
import { validateUsername } from '../net/username';
import type { RenderState } from '../sim/types';
import { TXT } from './i18n';
import { formatKeyCode, saveUserSettings, type GraphicsQuality, type KeyBindings, type UserSettings } from './settings';

export interface AppUICallbacks {
  onCreateRoom: (roomName: string, password: string, mode: 1 | 2 | 3 | 4 | 5, durationMin: number) => void;
  onJoinRoom: (code: string, password: string) => void;
  onStartOfflineBots: (mode: 1 | 2 | 3 | 4 | 5, durationMin: number) => void;
  onLeaveSession: () => void;
  onSettingsChanged: (settings: UserSettings) => void;
}

export class AppUI {
  private root: HTMLElement;
  private settings: UserSettings;
  private input: InputManager;
  private cb: AppUICallbacks;
  private session: Session | null = null;

  // Vistas principales
  private homeView!: HTMLElement;
  private lobbyView!: HTMLElement;
  private hudView!: HTMLElement;
  private endModal!: HTMLElement;
  private settingsModal!: HTMLElement;
  private statusToast!: HTMLElement;
  private screenFlash!: HTMLElement;

  // Elementos Home
  private usernameInput!: HTMLInputElement;
  private jerseyInput!: HTMLInputElement;
  private colorInput!: HTMLInputElement;
  private usernameErrorEl!: HTMLElement;
  private joinCodeInput!: HTMLInputElement;
  private joinPassInput!: HTMLInputElement;
  private createPassInput!: HTMLInputElement;
  private createModeSelect!: HTMLSelectElement;
  private createDurationInput!: HTMLInputElement;

  // Elementos Lobby
  private roomCodeBadge!: HTMLElement;
  private colRed!: HTMLElement;
  private colSpec!: HTMLElement;
  private colBlue!: HTMLElement;
  private colRedTitle!: HTMLElement;
  private colBlueTitle!: HTMLElement;
  private btnJoinRed!: HTMLButtonElement;
  private btnJoinSpec!: HTMLButtonElement;
  private btnJoinBlue!: HTMLButtonElement;
  private hostControlsBox!: HTMLElement;
  private waitingHostBanner!: HTMLElement;
  private chatLog!: HTMLElement;
  private chatInput!: HTMLInputElement;
  private lobbyModeSelect!: HTMLSelectElement;
  private lobbyDurationSelect!: HTMLSelectElement;
  private lobbyScoreLimitSelect!: HTMLSelectElement;
  private lobbyBotsCheck!: HTMLInputElement;
  private lobbyChargeCheck!: HTMLInputElement;
  private lobbyPassAssistCheck!: HTMLInputElement;
  private btnLockTeams!: HTMLButtonElement;

  // Elementos HUD
  private hudScoreRed!: HTMLElement;
  private hudScoreBlue!: HTMLElement;
  private hudTeamRedName!: HTMLElement;
  private hudTeamBlueName!: HTMLElement;
  private hudTimer!: HTMLElement;
  private hudBadge!: HTMLElement;
  private hudPing!: HTMLElement;
  private hudStaminaBar!: HTMLElement;
  private hudStaminaText!: HTMLElement;
  private hudPowerBar!: HTMLElement;
  private hudPowerText!: HTMLElement;
  private goalOverlay!: HTMLElement;
  private goalCard!: HTMLElement;
  private goalScorerText!: HTMLElement;
  private goalAssistText!: HTMLElement;
  private replayBanner!: HTMLElement;

  // Elementos Final
  private endWinnerTitle!: HTMLElement;
  private endScoreRed!: HTMLElement;
  private endScoreBlue!: HTMLElement;
  private endStatsBody!: HTMLElement;

  constructor(
    root: HTMLElement,
    settings: UserSettings,
    input: InputManager,
    callbacks: AppUICallbacks
  ) {
    this.root = root;
    this.settings = settings;
    this.input = input;
    this.cb = callbacks;
    this.buildDOM();
    this.checkUrlRoomParam();
  }

  private checkUrlRoomParam(): void {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      this.joinCodeInput.value = normalizeRoomCode(room);
      this.showToast(`Sala detectada en enlace: ${this.joinCodeInput.value}`);
    }
  }

  public bindSession(session: Session | null): void {
    this.session = session;
    this.chatLog.innerHTML = '';
    if (session) {
      this.renderLobby(session.lobby);
    }
  }

  public showScreen(screen: 'home' | 'lobby' | 'match'): void {
    this.homeView.classList.toggle('hidden', screen !== 'home');
    this.lobbyView.classList.toggle('hidden', screen !== 'lobby');
    this.hudView.classList.toggle('hidden', screen !== 'match');
    if (screen !== 'match') {
      this.goalOverlay.classList.add('hidden');
      this.endModal.classList.add('hidden');
    }
  }

  public showToast(msg: string, isError = false): void {
    this.statusToast.textContent = msg;
    this.statusToast.className = `fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl font-semibold text-xs shadow-lg border transition-all ${
      isError
        ? 'bg-rose-950/90 border-rose-500 text-rose-200'
        : 'bg-slate-900/90 border-cyan-500/50 text-cyan-200'
    }`;
    this.statusToast.classList.remove('hidden');
    gsap.fromTo(this.statusToast, { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.22 });
    setTimeout(() => {
      this.statusToast.classList.add('hidden');
    }, 3400);
  }

  public triggerGoalFlash(): void {
    this.screenFlash.classList.remove('hidden');
    gsap.fromTo(
      this.screenFlash,
      { opacity: 0.55 },
      {
        opacity: 0,
        duration: 0.65,
        onComplete: () => this.screenFlash.classList.add('hidden')
      }
    );
  }

  public showGoalAnnouncement(team: 0 | 1, scorer: string, assist: string, teamNames: [string, string]): void {
    this.triggerGoalFlash();
    const tName = teamNames[team] ?? (team === 0 ? 'ROJO' : 'AZUL');
    this.goalScorerText.textContent = scorer ? `⚽ Gol de ${scorer} (${tName})` : `⚽ ¡Anota ${tName}!`;
    this.goalScorerText.className = `arcade-font text-xl sm:text-2xl font-bold mt-2 ${
      team === 0 ? 'text-rose-400' : 'text-blue-400'
    }`;
    this.goalAssistText.textContent = assist ? `🎯 Asistencia: ${assist}` : '';
    this.goalOverlay.classList.remove('hidden');
    this.goalCard.classList.remove('goal-banner-active');
    void this.goalCard.offsetWidth;
    this.goalCard.classList.add('goal-banner-active');
  }

  public hideGoalAnnouncement(): void {
    this.goalOverlay.classList.add('hidden');
  }

  public appendChatMessage(from: string, text: string, system: boolean): void {
    const row = document.createElement('div');
    row.className = system
      ? 'text-[11px] italic text-amber-300/90 py-0.5'
      : 'text-xs text-slate-200 py-0.5 break-words';

    if (system) {
      row.textContent = `• ${text}`;
    } else {
      const author = document.createElement('span');
      author.className = 'font-bold text-cyan-300 mr-1.5';
      author.textContent = `${from}:`;
      const body = document.createElement('span');
      body.textContent = text;
      row.append(author, body);
    }
    this.chatLog.appendChild(row);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  /** Actualiza las 3 columnas del Lobby estilo Haxball y los controles de administrador. */
  public renderLobby(lobby: LobbyState): void {
    this.roomCodeBadge.textContent = lobby.roomCode;
    this.colRedTitle.textContent = `${lobby.settings.teamNames[0]} (${
      lobby.players.filter(p => p.team === 'red' && !p.isBot).length
    }/${lobby.settings.mode})`;
    this.colBlueTitle.textContent = `${lobby.settings.teamNames[1]} (${
      lobby.players.filter(p => p.team === 'blue' && !p.isBot).length
    }/${lobby.settings.mode})`;

    const isAdmin = this.session?.isAdmin ?? false;
    const myTeam = this.session?.me?.team ?? 'spec';
    const redFull = lobby.players.filter(p => p.team === 'red' && !p.isBot).length >= lobby.settings.mode;
    const blueFull = lobby.players.filter(p => p.team === 'blue' && !p.isBot).length >= lobby.settings.mode;

    this.btnJoinRed.disabled = myTeam === 'red' || (!isAdmin && (lobby.locked || redFull));
    this.btnJoinBlue.disabled = myTeam === 'blue' || (!isAdmin && (lobby.locked || blueFull));
    this.btnJoinSpec.disabled = myTeam === 'spec';

    this.btnJoinRed.textContent = redFull && myTeam !== 'red' ? 'Rojo (Lleno)' : TXT.joinRed;
    this.btnJoinBlue.textContent = blueFull && myTeam !== 'blue' ? 'Azul (Lleno)' : TXT.joinBlue;

    this.fillTeamColumn(this.colRed, lobby.players.filter(p => p.team === 'red'), isAdmin, lobby.hostId);
    this.fillTeamColumn(this.colSpec, lobby.players.filter(p => p.team === 'spec'), isAdmin, lobby.hostId);
    this.fillTeamColumn(this.colBlue, lobby.players.filter(p => p.team === 'blue'), isAdmin, lobby.hostId);

    this.hostControlsBox.classList.toggle('hidden', !isAdmin);
    this.waitingHostBanner.classList.toggle('hidden', isAdmin);

    this.lobbyModeSelect.value = String(lobby.settings.mode);
    this.lobbyDurationSelect.value = String(Math.round(lobby.settings.durationSec / 60));
    this.lobbyScoreLimitSelect.value = String(lobby.settings.scoreLimit);
    this.lobbyBotsCheck.checked = lobby.settings.fillBots;
    this.lobbyChargeCheck.checked = lobby.settings.chargeKick;
    this.lobbyPassAssistCheck.checked = lobby.settings.passAssist;

    this.lobbyModeSelect.disabled = !isAdmin;
    this.lobbyDurationSelect.disabled = !isAdmin;
    this.lobbyScoreLimitSelect.disabled = !isAdmin;
    this.lobbyBotsCheck.disabled = !isAdmin;
    this.lobbyChargeCheck.disabled = !isAdmin;
    this.lobbyPassAssistCheck.disabled = !isAdmin;

    this.btnLockTeams.textContent = lobby.locked ? TXT.unlockTeams : TXT.lockTeams;
  }

  private fillTeamColumn(container: HTMLElement, list: PlayerInfo[], isAdmin: boolean, hostId: number): void {
    container.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-xs text-slate-500 italic py-4 text-center';
      empty.textContent = 'Sin jugadores';
      container.appendChild(empty);
      return;
    }

    for (const p of list) {
      const card = document.createElement('div');
      card.className =
        'flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-700/70 text-xs';

      const left = document.createElement('div');
      left.className = 'flex items-center gap-2 min-w-0';

      const badge = document.createElement('span');
      badge.className =
        'w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] text-slate-950 shrink-0';
      badge.style.backgroundColor = p.color || '#38bdf8';
      badge.textContent = String(p.number);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'font-semibold text-white truncate';
      nameSpan.textContent = p.username;

      left.append(badge, nameSpan);

      if (p.id === hostId) {
        const crown = document.createElement('span');
        crown.className = 'text-amber-400 text-[11px] font-bold';
        crown.title = 'Anfitrión (Admin)';
        crown.textContent = '👑';
        left.appendChild(crown);
      }
      if (p.isBot) {
        const botTag = document.createElement('span');
        botTag.className = 'px-1.5 py-0.5 rounded bg-slate-700 text-[10px] font-bold text-cyan-300';
        botTag.textContent = 'BOT';
        left.appendChild(botTag);
      }

      const right = document.createElement('div');
      right.className = 'flex items-center gap-1.5 shrink-0';

      if (!p.isBot) {
        const pingSpan = document.createElement('span');
        pingSpan.className = 'text-[10px] text-emerald-400 font-mono';
        pingSpan.textContent = `${p.ping}ms`;
        right.appendChild(pingSpan);
      }

      // Controles de administrador por jugador (mover a R / E / A, silenciar, expulsar)
      if (isAdmin && !p.isBot) {
        const moveGroup = document.createElement('div');
        moveGroup.className = 'flex items-center gap-0.5';
        (['red', 'spec', 'blue'] as TeamName[]).forEach(t => {
          if (t === p.team) return;
          const b = document.createElement('button');
          b.className =
            'px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-slate-300 cursor-pointer';
          b.textContent = t === 'red' ? 'R' : t === 'blue' ? 'A' : 'E';
          b.title = `Mover a ${t}`;
          b.addEventListener('click', () => this.session?.movePlayer(p.id, t));
          moveGroup.appendChild(b);
        });
        right.appendChild(moveGroup);

        if (p.id !== this.session?.localId) {
          const kickBtn = document.createElement('button');
          kickBtn.className =
            'px-1.5 py-0.5 rounded bg-rose-900/70 hover:bg-rose-700 text-[10px] font-bold text-rose-200 cursor-pointer';
          kickBtn.textContent = '✕';
          kickBtn.title = 'Expulsar jugador';
          kickBtn.addEventListener('click', () => this.session?.kick(p.id));
          right.appendChild(kickBtn);
        }
      }

      card.append(left, right);
      container.appendChild(card);
    }
  }

  /** Actualiza el HUD superior e indicadores durante la partida. */
  public updateMatchHUD(state: RenderState, isReplaying: boolean): void {
    const lobby = this.session?.lobby;
    if (lobby) {
      this.hudTeamRedName.textContent = lobby.settings.teamNames[0];
      this.hudTeamBlueName.textContent = lobby.settings.teamNames[1];
    }
    this.hudScoreRed.textContent = String(state.score[0]);
    this.hudScoreBlue.textContent = String(state.score[1]);

    const secs = Math.ceil(Math.max(0, state.clock));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    this.hudTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    if (state.overtime) {
      this.hudBadge.textContent = TXT.overtimeBadge;
      this.hudBadge.className =
        'text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/30 text-amber-300 border border-amber-400/50 mt-0.5 animate-pulse';
    } else {
      this.hudBadge.textContent = state.phase === 'kickoff' ? 'SAQUE DE CENTRO' : 'EN JUEGO';
      this.hudBadge.className =
        'text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-emerald-300 mt-0.5';
    }

    const myPing = this.session?.me?.ping ?? 0;
    this.hudPing.textContent = `${myPing} ms`;
    this.replayBanner.classList.toggle('hidden', !isReplaying);

    const localP = state.players.find(p => p.id === this.session?.localId) ?? state.players[0];
    if (localP) {
      const energyPct = Math.round(localP.energy);
      this.hudStaminaBar.style.width = `${energyPct}%`;
      this.hudStaminaText.textContent = `${energyPct}%`;

      const chargePct = Math.round(localP.charge * 100);
      this.hudPowerBar.style.width = `${chargePct}%`;
      this.hudPowerText.textContent = `${chargePct}%`;
    }
  }

  /** Muestra la pantalla de final de partido con tabla de estadísticas y botón de Revancha. */
  public showMatchEnd(result: MatchResult): void {
    this.hideGoalAnnouncement();
    this.endScoreRed.textContent = String(result.score[0]);
    this.endScoreBlue.textContent = String(result.score[1]);

    if (result.winner === 0) {
      this.endWinnerTitle.textContent = `🏆 ¡VICTORIA DE ${result.teamNames[0].toUpperCase()}!`;
      this.endWinnerTitle.className = 'arcade-font text-2xl sm:text-3xl font-extrabold text-rose-400 mb-4';
    } else if (result.winner === 1) {
      this.endWinnerTitle.textContent = `🏆 ¡VICTORIA DE ${result.teamNames[1].toUpperCase()}!`;
      this.endWinnerTitle.className = 'arcade-font text-2xl sm:text-3xl font-extrabold text-blue-400 mb-4';
    } else {
      this.endWinnerTitle.textContent = '🤝 ¡EMPATE!';
      this.endWinnerTitle.className = 'arcade-font text-2xl sm:text-3xl font-extrabold text-amber-300 mb-4';
    }

    this.endStatsBody.innerHTML = '';
    for (const p of result.players) {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-slate-800 text-xs';
      const tdName = document.createElement('td');
      tdName.className = `py-1.5 font-semibold ${p.team === 0 ? 'text-rose-300' : 'text-blue-300'}`;
      tdName.textContent = `#${p.number} ${p.username}`;

      const tdGoals = document.createElement('td');
      tdGoals.className = 'py-1.5 text-center font-bold text-white';
      tdGoals.textContent = String(p.goals);

      const tdAssists = document.createElement('td');
      tdAssists.className = 'py-1.5 text-center text-slate-300';
      tdAssists.textContent = String(p.assists);

      const tdShots = document.createElement('td');
      tdShots.className = 'py-1.5 text-center text-slate-300';
      tdShots.textContent = String(p.shots);

      const tdPoss = document.createElement('td');
      tdPoss.className = 'py-1.5 text-right text-cyan-300';
      tdPoss.textContent = `${p.possession}%`;

      tr.append(tdName, tdGoals, tdAssists, tdShots, tdPoss);
      this.endStatsBody.appendChild(tr);
    }

    this.endModal.classList.remove('hidden');
  }

  private validateAndSaveProfile(): boolean {
    const v = validateUsername(this.usernameInput.value);
    if (!v.ok) {
      const msgMap: Record<string, string> = {
        empty: TXT.errUsernameEmpty,
        too_short: TXT.errUsernameShort,
        too_long: TXT.errUsernameLong,
        invalid_chars: TXT.errUsernameChars,
        blocked: TXT.errUsernameBlocked
      };
      this.usernameErrorEl.textContent = msgMap[v.error] ?? TXT.errUsernameChars;
      this.usernameErrorEl.classList.remove('hidden');
      return false;
    }
    this.usernameErrorEl.classList.add('hidden');
    this.settings.username = v.name;
    this.settings.jerseyNumber = Math.max(1, Math.min(99, Number(this.jerseyInput.value) || 10));
    this.settings.avatarColor = /^#[0-9a-fA-F]{6}$/.test(this.colorInput.value)
      ? this.colorInput.value
      : '#3b82f6';
    saveUserSettings(this.settings);
    this.cb.onSettingsChanged(this.settings);
    return true;
  }

  private buildDOM(): void {
    this.root.innerHTML = `
      <!-- Flash de gol -->
      <div id="screen-flash" class="fixed inset-0 z-30 pointer-events-none bg-white hidden"></div>

      <!-- Toast de estado -->
      <div id="status-toast" class="hidden"></div>

      <!-- ==================== 1. PANTALLA DE INICIO ==================== -->
      <div id="view-home" class="fixed inset-0 z-20 flex items-center justify-center p-4 overflow-y-auto">
        <div class="hud-glass max-w-3xl w-full rounded-3xl p-6 sm:p-8 border border-slate-700/80 shadow-2xl my-auto">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/70 pb-5 mb-6">
            <div>
              <div class="text-[11px] uppercase tracking-[0.25em] text-cyan-400 font-bold">${TXT.subtitle}</div>
              <h1 class="arcade-font text-3xl sm:text-5xl font-extrabold italic tracking-tight text-white mt-0.5">
                ${TXT.title}
              </h1>
            </div>
            <button id="btn-open-settings" class="self-start sm:self-auto px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold text-slate-200 cursor-pointer">
              ⚙️ ${TXT.btnSettings}
            </button>
          </div>

          <!-- Perfil de Jugador (Username + Dorsal + Color) -->
          <div class="bg-slate-900/80 rounded-2xl p-4 border border-slate-800 mb-6">
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div class="sm:col-span-2">
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5" for="inp-username">
                  ${TXT.usernameLabel}
                </label>
                <input id="inp-username" type="text" maxlength="16" placeholder="${TXT.usernamePlaceholder}"
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-semibold focus:outline-none focus:border-cyan-400" />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5" for="inp-jersey">
                  ${TXT.jerseyLabel} (1-99)
                </label>
                <input id="inp-jersey" type="number" min="1" max="99"
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm font-semibold focus:outline-none focus:border-cyan-400" />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5" for="inp-color">
                  ${TXT.colorLabel}
                </label>
                <input id="inp-color" type="color"
                  class="w-full h-[42px] rounded-xl bg-slate-950 border border-slate-700 cursor-pointer p-1" />
              </div>
            </div>
            <p id="err-username" class="text-xs text-rose-400 font-semibold mt-2 hidden"></p>
          </div>

          <!-- Dos tarjetas: Crear Sala / Unirse a Sala + Botón Offline -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <!-- Crear sala -->
            <div class="bg-slate-900/75 rounded-2xl p-4 border border-slate-800 flex flex-col justify-between">
              <div>
                <h2 class="arcade-font text-lg font-bold text-blue-400 mb-3">🏟️ ${TXT.createPromptTitle}</h2>
                <div class="grid grid-cols-2 gap-2.5 mb-2.5">
                  <div>
                    <label class="block text-[11px] text-slate-400 mb-1">Modo</label>
                    <select id="sel-create-mode" class="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white">
                      <option value="1">1 vs 1</option>
                      <option value="2">2 vs 2</option>
                      <option value="3" selected>3 vs 3</option>
                      <option value="4">4 vs 4</option>
                      <option value="5">5 vs 5</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-[11px] text-slate-400 mb-1">Duración (min)</label>
                    <input id="inp-create-duration" type="number" min="1" max="45" value="14"
                      class="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white" />
                  </div>
                </div>
                <input id="inp-create-pass" type="password" maxlength="24" placeholder="${TXT.passwordPlaceholder}"
                  class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white mb-3" />
              </div>
              <div class="flex flex-col gap-2">
                <button id="btn-create-room" class="w-full py-2.5 px-4 rounded-xl arcade-font font-bold text-sm uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition cursor-pointer">
                  ${TXT.btnCreateRoom}
                </button>
                <button id="btn-play-bots" class="w-full py-2 px-4 rounded-xl font-bold text-xs uppercase tracking-wider bg-emerald-600/90 hover:bg-emerald-500 text-white transition cursor-pointer">
                  🤖 ${TXT.btnPlayBots}
                </button>
              </div>
            </div>

            <!-- Unirse a sala -->
            <div class="bg-slate-900/75 rounded-2xl p-4 border border-slate-800 flex flex-col justify-between">
              <div>
                <h2 class="arcade-font text-lg font-bold text-amber-400 mb-3">🔗 ${TXT.joinPromptTitle}</h2>
                <label class="block text-[11px] text-slate-400 mb-1">Código o Enlace de Invitación</label>
                <input id="inp-join-code" type="text" placeholder="${TXT.roomCodePlaceholder}"
                  class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white uppercase tracking-wider mb-2.5" />
                <input id="inp-join-pass" type="password" maxlength="24" placeholder="${TXT.passwordPlaceholder}"
                  class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white mb-3" />
              </div>
              <button id="btn-join-room" class="w-full py-2.5 px-4 rounded-xl arcade-font font-bold text-sm uppercase tracking-wider bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg transition cursor-pointer">
                ${TXT.btnJoinRoom}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== 2. LOBBY HAXBALL (3 COLUMNAS + CHAT) ==================== -->
      <div id="view-lobby" class="fixed inset-0 z-20 flex items-center justify-center p-3 sm:p-6 overflow-y-auto hidden">
        <div class="hud-glass max-w-6xl w-full rounded-3xl p-4 sm:p-6 border border-slate-700/80 shadow-2xl my-auto flex flex-col gap-4">
          <!-- Cabecera de Sala -->
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700/70 pb-3">
            <div class="flex items-center gap-3">
              <span class="text-xs uppercase tracking-widest text-slate-400 font-bold">CÓDIGO DE SALA:</span>
              <span id="lobby-room-code" class="arcade-font text-xl font-extrabold px-3 py-1 rounded-xl bg-slate-900 border border-cyan-500/40 text-cyan-300 tracking-widest">LOCAL</span>
              <button id="btn-copy-link" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-slate-200 cursor-pointer">
                📋 ${TXT.copyLink}
              </button>
            </div>
            <div class="flex items-center gap-2">
              <button id="btn-lobby-settings" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-slate-200 cursor-pointer">
                ⚙️ ${TXT.btnSettings}
              </button>
              <button id="btn-leave-room" class="px-3 py-1.5 rounded-xl bg-rose-900/80 hover:bg-rose-800 border border-rose-600/50 text-xs font-semibold text-rose-200 cursor-pointer">
                🚪 ${TXT.leaveRoom}
              </button>
            </div>
          </div>

          <!-- Cuerpo: 3 Columnas de Equipos + Panel Lateral (Ajustes y Chat) -->
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div class="lg:col-span-8 flex flex-col gap-3">
              <!-- Tres Columnas: Rojo | Espectadores | Azul -->
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <!-- Columna Rojo -->
                <div class="bg-slate-950/75 rounded-2xl p-3 border border-rose-500/40 flex flex-col">
                  <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-rose-500/30">
                    <span id="col-red-title" class="arcade-font font-bold text-sm text-rose-400">Rojo</span>
                    <button id="btn-join-red" class="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-[11px] font-bold text-white cursor-pointer">
                      ${TXT.joinRed}
                    </button>
                  </div>
                  <div id="col-red-list" class="space-y-1.5 min-h-[150px]"></div>
                </div>

                <!-- Columna Espectadores -->
                <div class="bg-slate-950/75 rounded-2xl p-3 border border-slate-700 flex flex-col">
                  <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-700">
                    <span class="arcade-font font-bold text-sm text-slate-300">${TXT.spectators}</span>
                    <button id="btn-join-spec" class="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-[11px] font-bold text-white cursor-pointer">
                      ${TXT.joinSpec}
                    </button>
                  </div>
                  <div id="col-spec-list" class="space-y-1.5 min-h-[150px]"></div>
                </div>

                <!-- Columna Azul -->
                <div class="bg-slate-950/75 rounded-2xl p-3 border border-blue-500/40 flex flex-col">
                  <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-blue-500/30">
                    <span id="col-blue-title" class="arcade-font font-bold text-sm text-blue-400">Azul</span>
                    <button id="btn-join-blue" class="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-[11px] font-bold text-white cursor-pointer">
                      ${TXT.joinBlue}
                    </button>
                  </div>
                  <div id="col-blue-list" class="space-y-1.5 min-h-[150px]"></div>
                </div>
              </div>

              <!-- Reglas de la Partida -->
              <div class="bg-slate-900/75 rounded-2xl p-3.5 border border-slate-800 grid grid-cols-2 sm:grid-cols-6 gap-2.5 items-center text-xs">
                <div>
                  <label class="block text-[10px] text-slate-400 uppercase">Modo</label>
                  <select id="lobby-mode" class="w-full mt-0.5 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-white">
                    <option value="1">1v1</option>
                    <option value="2">2v2</option>
                    <option value="3">3v3</option>
                    <option value="4">4v4</option>
                    <option value="5">5v5</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[10px] text-slate-400 uppercase">Tiempo</label>
                  <select id="lobby-duration" class="w-full mt-0.5 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-white">
                    <option value="3">3 min</option>
                    <option value="5">5 min</option>
                    <option value="10">10 min</option>
                    <option value="14">14 min</option>
                    <option value="20">20 min</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[10px] text-slate-400 uppercase">Límite Goles</label>
                  <select id="lobby-score-limit" class="w-full mt-0.5 px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-white">
                    <option value="0">Sin límite</option>
                    <option value="3">3 goles</option>
                    <option value="5">5 goles</option>
                    <option value="7">7 goles</option>
                    <option value="10">10 goles</option>
                  </select>
                </div>
                <label class="flex items-center gap-1.5 cursor-pointer pt-3">
                  <input id="lobby-bots" type="checkbox" class="accent-emerald-400" />
                  <span>${TXT.fillBots}</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer pt-3">
                  <input id="lobby-charge" type="checkbox" class="accent-amber-400" />
                  <span>Tiro cargado</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer pt-3">
                  <input id="lobby-pass-assist" type="checkbox" class="accent-cyan-400" />
                  <span>Pase asistido</span>
                </label>
              </div>

              <!-- Botonera del Host / Aviso para Clientes -->
              <div id="host-controls-box" class="flex flex-wrap items-center justify-between gap-2 bg-slate-900/90 p-3 rounded-2xl border border-amber-500/30">
                <div class="flex flex-wrap gap-2">
                  <button id="btn-auto-assign" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-amber-300 border border-amber-400/30 cursor-pointer">
                    ⚖️ ${TXT.autoAssign}
                  </button>
                  <button id="btn-lock-teams" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-600 cursor-pointer">
                    🔒 ${TXT.lockTeams}
                  </button>
                </div>
                <button id="btn-start-match" class="px-6 py-2.5 rounded-xl arcade-font font-extrabold text-sm uppercase tracking-wider bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 shadow-lg cursor-pointer">
                  ⚽ ${TXT.startMatch}
                </button>
              </div>
              <div id="waiting-host-banner" class="hidden text-center py-3 rounded-2xl bg-slate-900/70 border border-slate-800 text-xs text-amber-300 font-semibold">
                ⏳ ${TXT.waitingHost}
              </div>
            </div>

            <!-- Chat de Sala y Reacciones Rápidas -->
            <div class="lg:col-span-4 bg-slate-950/80 rounded-2xl p-3 border border-slate-800 flex flex-col h-[340px] lg:h-auto">
              <div class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">💬 Chat de Sala</div>
              <div id="chat-log" class="flex-1 overflow-y-auto space-y-1 pr-1 mb-2 text-xs"></div>
              <div class="flex gap-1 mb-2">
                ${['⚽', '🔥', '👏', '😂', '😱', '🛡️']
                  .map(
                    (em, idx) =>
                      `<button data-emote="${idx}" class="emote-btn flex-1 py-1 rounded bg-slate-900 hover:bg-slate-800 text-sm cursor-pointer">${em}</button>`
                  )
                  .join('')}
              </div>
              <div class="flex gap-1.5">
                <input id="chat-input" type="text" maxlength="200" placeholder="${TXT.chatPlaceholder}"
                  class="flex-1 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-cyan-400" />
                <button id="chat-send" class="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white cursor-pointer">Enviar</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ==================== 3. HUD DEL PARTIDO ==================== -->
      <div id="view-hud" class="fixed inset-0 z-10 pointer-events-none hidden">
        <!-- Marcador Superior -->
        <div class="w-full flex flex-col items-center pt-3 px-4">
          <div class="hud-glass rounded-2xl px-4 py-2 flex items-center gap-3 sm:gap-5 pointer-events-auto">
            <!-- Equipo Rojo -->
            <div class="flex items-center gap-2">
              <div class="w-3.5 h-8 rounded-sm bg-gradient-to-b from-rose-500 to-red-700"></div>
              <div id="hud-team-red" class="arcade-font text-xs sm:text-sm font-bold text-rose-300">ROJO</div>
              <div id="hud-score-red" class="arcade-font text-2xl sm:text-4xl font-bold text-rose-400 bg-slate-900/90 px-3 py-0.5 rounded-xl border border-rose-500/30 min-w-[44px] text-center">0</div>
            </div>

            <!-- Reloj Central -->
            <div class="flex flex-col items-center px-2 border-x border-slate-700/70">
              <div id="hud-timer" class="arcade-font text-xl sm:text-3xl font-bold tracking-wider text-amber-300">14:00</div>
              <div id="hud-badge" class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-emerald-300 mt-0.5">EN JUEGO</div>
            </div>

            <!-- Equipo Azul -->
            <div class="flex items-center gap-2">
              <div id="hud-score-blue" class="arcade-font text-2xl sm:text-4xl font-bold text-blue-400 bg-slate-900/90 px-3 py-0.5 rounded-xl border border-blue-500/30 min-w-[44px] text-center">0</div>
              <div id="hud-team-blue" class="arcade-font text-xs sm:text-sm font-bold text-blue-300">AZUL</div>
              <div class="w-3.5 h-8 rounded-sm bg-gradient-to-b from-blue-400 to-blue-600"></div>
            </div>

            <!-- Ping + Botones rápidos -->
            <div class="flex items-center gap-1.5 pl-1">
              <span id="hud-ping" class="text-[10px] font-mono text-emerald-400 hidden sm:inline">0 ms</span>
              <button id="btn-hud-lobby" title="Sala / Lobby" class="p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-xs text-slate-200 border border-slate-600/50 cursor-pointer">
                🏟️
              </button>
              <button id="btn-hud-settings" title="Ajustes" class="p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-xs text-slate-200 border border-slate-600/50 cursor-pointer">
                ⚙️
              </button>
            </div>
          </div>

          <!-- Barras de Sprint y Potencia -->
          <div class="hud-glass mt-2 rounded-xl px-4 py-1.5 flex items-center gap-4 w-full max-w-md">
            <div class="flex-1">
              <div class="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-0.5">
                <span class="text-cyan-300">⚡ Sprint</span>
                <span id="hud-stamina-text" class="text-slate-300">100%</span>
              </div>
              <div class="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                <div id="hud-stamina-bar" class="h-full bg-gradient-to-r from-cyan-500 to-emerald-400" style="width:100%"></div>
              </div>
            </div>
            <div class="flex-1">
              <div class="flex justify-between text-[10px] font-bold uppercase tracking-wider mb-0.5">
                <span class="text-amber-300">🔥 Patada</span>
                <span id="hud-power-text" class="text-slate-300">0%</span>
              </div>
              <div class="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-700">
                <div id="hud-power-bar" class="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" style="width:0%"></div>
              </div>
            </div>
          </div>

          <!-- Indicador de Repetición Instantánea -->
          <div id="replay-banner" class="hidden mt-2 px-3 py-1 rounded-full bg-rose-600/90 text-white text-xs font-extrabold uppercase tracking-widest animate-pulse">
            🎥 ${TXT.replayBadge}
          </div>
        </div>

        <!-- Controles Táctiles (Joystick Virtual nipplejs + Botones Sprint/Patada) -->
        <div id="touch-joystick-zone" class="fixed bottom-4 left-4 w-36 h-36 pointer-events-auto sm:hidden"></div>
        <div class="fixed bottom-6 right-5 flex gap-3 pointer-events-auto sm:hidden">
          <button id="touch-sprint-btn" class="hud-glass active:scale-95 px-5 py-4 rounded-2xl font-extrabold text-xs text-cyan-300 border border-cyan-400/50">
            SPRINT
          </button>
          <button id="touch-kick-btn" class="hud-glass active:scale-95 px-6 py-4 rounded-2xl font-extrabold text-xs text-amber-300 border border-amber-400/50">
            PATADA
          </button>
        </div>
      </div>

      <!-- ==================== AVISO ANIMADO DE ¡GOL! ==================== -->
      <div id="goal-overlay" class="fixed inset-0 z-20 pointer-events-none flex items-center justify-center hidden">
        <div id="goal-card" class="text-center px-10 py-7 rounded-3xl hud-glass border-2 border-amber-400/80">
          <div class="arcade-font text-6xl sm:text-8xl font-extrabold italic tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-amber-400 to-orange-500">
            ${TXT.goalBanner}
          </div>
          <div id="goal-scorer-text" class="arcade-font text-xl sm:text-2xl font-bold mt-2 text-white"></div>
          <div id="goal-assist-text" class="text-xs font-semibold text-amber-200 mt-1"></div>
        </div>
      </div>

      <!-- ==================== 4. PANTALLA FINAL CON ESTADÍSTICAS ==================== -->
      <div id="modal-end" class="fixed inset-0 z-30 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 hidden">
        <div class="hud-glass max-w-lg w-full rounded-3xl p-6 text-center border border-slate-700 shadow-2xl">
          <h2 id="end-winner-title" class="arcade-font text-2xl sm:text-3xl font-extrabold text-white mb-4"></h2>
          <div class="grid grid-cols-3 items-center bg-slate-900/90 rounded-2xl p-4 mb-4 border border-slate-800">
            <div>
              <div class="text-xs font-bold text-rose-400">ROJO</div>
              <div id="end-score-red" class="arcade-font text-4xl font-extrabold text-white mt-1">0</div>
            </div>
            <div class="arcade-font text-lg font-bold text-slate-500">VS</div>
            <div>
              <div class="text-xs font-bold text-blue-400">AZUL</div>
              <div id="end-score-blue" class="arcade-font text-4xl font-extrabold text-white mt-1">0</div>
            </div>
          </div>

          <div class="max-h-48 overflow-y-auto mb-5 bg-slate-900/60 rounded-xl p-3 border border-slate-800 text-left">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-[10px] uppercase text-slate-400 border-b border-slate-700">
                  <th class="pb-1">Jugador</th>
                  <th class="pb-1 text-center">Goles</th>
                  <th class="pb-1 text-center">Asist.</th>
                  <th class="pb-1 text-center">Tiros</th>
                  <th class="pb-1 text-right">Posesión</th>
                </tr>
              </thead>
              <tbody id="end-stats-body"></tbody>
            </table>
          </div>

          <button id="btn-rematch" class="w-full py-3 px-6 rounded-xl arcade-font font-bold text-base uppercase tracking-wider bg-blue-600 hover:bg-blue-500 text-white cursor-pointer">
            🔄 ${TXT.rematch}
          </button>
        </div>
      </div>

      <!-- ==================== 5. MODAL DE AJUSTES ==================== -->
      <div id="modal-settings" class="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 hidden">
        <div class="hud-glass max-w-md w-full rounded-3xl p-6 border border-slate-700">
          <div class="flex items-center justify-between border-b border-slate-700 pb-3 mb-4">
            <h3 class="arcade-font text-lg font-bold text-white">⚙️ Ajustes</h3>
            <button id="btn-close-settings" class="text-slate-400 hover:text-white text-sm font-bold cursor-pointer">✕</button>
          </div>
          <div class="space-y-4 text-xs">
            <div>
              <label class="flex justify-between text-slate-300 font-semibold mb-1">
                <span>Volumen General</span>
                <span id="lbl-volume">${Math.round(this.settings.volume * 100)}%</span>
              </label>
              <input id="set-volume" type="range" min="0" max="100" value="${Math.round(this.settings.volume * 100)}" class="w-full accent-cyan-400" />
            </div>
            <div>
              <label class="block text-slate-300 font-semibold mb-1">Calidad Gráfica</label>
              <select id="set-quality" class="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white">
                <option value="low">Baja (Máximo FPS)</option>
                <option value="medium">Media</option>
                <option value="high">Alta (Sombras suaves)</option>
              </select>
            </div>
            <div>
              <label class="flex justify-between text-slate-300 font-semibold mb-1">
                <span>Sensibilidad Joystick / Gamepad</span>
                <span id="lbl-sens">${this.settings.sensitivity.toFixed(1)}x</span>
              </label>
              <input id="set-sens" type="range" min="5" max="18" value="${Math.round(this.settings.sensitivity * 10)}" class="w-full accent-cyan-400" />
            </div>
            <div>
              <div class="text-slate-300 font-semibold mb-2">Teclas (pulsa para reasignar)</div>
              <div id="keybind-grid" class="grid grid-cols-2 gap-2"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Referencias DOM
    this.homeView = this.root.querySelector('#view-home')!;
    this.lobbyView = this.root.querySelector('#view-lobby')!;
    this.hudView = this.root.querySelector('#view-hud')!;
    this.endModal = this.root.querySelector('#modal-end')!;
    this.settingsModal = this.root.querySelector('#modal-settings')!;
    this.statusToast = this.root.querySelector('#status-toast')!;
    this.screenFlash = this.root.querySelector('#screen-flash')!;

    this.usernameInput = this.root.querySelector('#inp-username')!;
    this.jerseyInput = this.root.querySelector('#inp-jersey')!;
    this.colorInput = this.root.querySelector('#inp-color')!;
    this.usernameErrorEl = this.root.querySelector('#err-username')!;
    this.joinCodeInput = this.root.querySelector('#inp-join-code')!;
    this.joinPassInput = this.root.querySelector('#inp-join-pass')!;
    this.createPassInput = this.root.querySelector('#inp-create-pass')!;
    this.createModeSelect = this.root.querySelector('#sel-create-mode')!;
    this.createDurationInput = this.root.querySelector('#inp-create-duration')!;

    this.usernameInput.value = this.settings.username;
    this.jerseyInput.value = String(this.settings.jerseyNumber);
    this.colorInput.value = this.settings.avatarColor;

    this.roomCodeBadge = this.root.querySelector('#lobby-room-code')!;
    this.colRed = this.root.querySelector('#col-red-list')!;
    this.colSpec = this.root.querySelector('#col-spec-list')!;
    this.colBlue = this.root.querySelector('#col-blue-list')!;
    this.colRedTitle = this.root.querySelector('#col-red-title')!;
    this.colBlueTitle = this.root.querySelector('#col-blue-title')!;
    this.btnJoinRed = this.root.querySelector('#btn-join-red')!;
    this.btnJoinSpec = this.root.querySelector('#btn-join-spec')!;
    this.btnJoinBlue = this.root.querySelector('#btn-join-blue')!;
    this.hostControlsBox = this.root.querySelector('#host-controls-box')!;
    this.waitingHostBanner = this.root.querySelector('#waiting-host-banner')!;
    this.chatLog = this.root.querySelector('#chat-log')!;
    this.chatInput = this.root.querySelector('#chat-input')!;
    this.lobbyModeSelect = this.root.querySelector('#lobby-mode')!;
    this.lobbyDurationSelect = this.root.querySelector('#lobby-duration')!;
    this.lobbyScoreLimitSelect = this.root.querySelector('#lobby-score-limit')!;
    this.lobbyBotsCheck = this.root.querySelector('#lobby-bots')!;
    this.lobbyChargeCheck = this.root.querySelector('#lobby-charge')!;
    this.lobbyPassAssistCheck = this.root.querySelector('#lobby-pass-assist')!;
    this.btnLockTeams = this.root.querySelector('#btn-lock-teams')!;

    this.hudScoreRed = this.root.querySelector('#hud-score-red')!;
    this.hudScoreBlue = this.root.querySelector('#hud-score-blue')!;
    this.hudTeamRedName = this.root.querySelector('#hud-team-red')!;
    this.hudTeamBlueName = this.root.querySelector('#hud-team-blue')!;
    this.hudTimer = this.root.querySelector('#hud-timer')!;
    this.hudBadge = this.root.querySelector('#hud-badge')!;
    this.hudPing = this.root.querySelector('#hud-ping')!;
    this.hudStaminaBar = this.root.querySelector('#hud-stamina-bar')!;
    this.hudStaminaText = this.root.querySelector('#hud-stamina-text')!;
    this.hudPowerBar = this.root.querySelector('#hud-power-bar')!;
    this.hudPowerText = this.root.querySelector('#hud-power-text')!;
    this.goalOverlay = this.root.querySelector('#goal-overlay')!;
    this.goalCard = this.root.querySelector('#goal-card')!;
    this.goalScorerText = this.root.querySelector('#goal-scorer-text')!;
    this.goalAssistText = this.root.querySelector('#goal-assist-text')!;
    this.replayBanner = this.root.querySelector('#replay-banner')!;

    this.endWinnerTitle = this.root.querySelector('#end-winner-title')!;
    this.endScoreRed = this.root.querySelector('#end-score-red')!;
    this.endScoreBlue = this.root.querySelector('#end-score-blue')!;
    this.endStatsBody = this.root.querySelector('#end-stats-body')!;

    this.input.mountTouchControls(
      this.root.querySelector('#touch-joystick-zone'),
      this.root.querySelector('#touch-sprint-btn'),
      this.root.querySelector('#touch-kick-btn')
    );

    this.wireEvents();
    this.renderKeybindButtons();
  }

  private wireEvents(): void {
    this.root.querySelector('#btn-create-room')?.addEventListener('click', () => {
      if (!this.validateAndSaveProfile()) return;
      const mode = Number(this.createModeSelect.value) as 1 | 2 | 3 | 4 | 5;
      const dur = Math.max(1, Math.min(45, Number(this.createDurationInput.value) || 14));
      this.cb.onCreateRoom(`${this.settings.username}`, this.createPassInput.value, mode, dur);
    });

    this.root.querySelector('#btn-play-bots')?.addEventListener('click', () => {
      if (!this.validateAndSaveProfile()) return;
      const mode = Number(this.createModeSelect.value) as 1 | 2 | 3 | 4 | 5;
      const dur = Math.max(1, Math.min(45, Number(this.createDurationInput.value) || 14));
      this.cb.onStartOfflineBots(mode, dur);
    });

    this.root.querySelector('#btn-join-room')?.addEventListener('click', () => {
      if (!this.validateAndSaveProfile()) return;
      const code = normalizeRoomCode(this.joinCodeInput.value);
      if (code.length < 4) {
        this.showToast('Introduce un código de sala válido (4–6 letras).', true);
        return;
      }
      this.cb.onJoinRoom(code, this.joinPassInput.value);
    });

    this.btnJoinRed.addEventListener('click', () => this.session?.changeTeam('red'));
    this.btnJoinSpec.addEventListener('click', () => this.session?.changeTeam('spec'));
    this.btnJoinBlue.addEventListener('click', () => this.session?.changeTeam('blue'));

    this.root.querySelector('#btn-auto-assign')?.addEventListener('click', () => {
      this.session?.admin('auto_assign');
    });

    this.btnLockTeams.addEventListener('click', () => {
      if (!this.session) return;
      this.session.admin(this.session.lobby.locked ? 'unlock' : 'lock');
    });

    this.root.querySelector('#btn-start-match')?.addEventListener('click', () => {
      this.session?.startMatch();
    });

    this.root.querySelector('#btn-leave-room')?.addEventListener('click', () => {
      this.cb.onLeaveSession();
    });

    this.root.querySelector('#btn-copy-link')?.addEventListener('click', () => {
      const code = this.session?.lobby.roomCode ?? '';
      const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
      navigator.clipboard?.writeText(url);
      this.showToast(`${TXT.copied} (${url})`);
    });

    const pushSettingsPatch = (): void => {
      if (!this.session?.isAdmin) return;
      const patch: Partial<RoomSettings> = {
        mode: Number(this.lobbyModeSelect.value) as 1 | 2 | 3 | 4 | 5,
        durationSec: Number(this.lobbyDurationSelect.value) * 60,
        scoreLimit: Number(this.lobbyScoreLimitSelect.value),
        fillBots: this.lobbyBotsCheck.checked,
        chargeKick: this.lobbyChargeCheck.checked,
        passAssist: this.lobbyPassAssistCheck.checked
      };
      this.session.updateSettings(patch);
    };

    [
      this.lobbyModeSelect,
      this.lobbyDurationSelect,
      this.lobbyScoreLimitSelect,
      this.lobbyBotsCheck,
      this.lobbyChargeCheck,
      this.lobbyPassAssistCheck
    ].forEach(el => el.addEventListener('change', pushSettingsPatch));

    // Chat y emotes
    const sendChat = (): void => {
      const txt = this.chatInput.value.trim();
      if (!txt) return;
      this.session?.chat(txt);
      this.chatInput.value = '';
    };
    this.root.querySelector('#chat-send')?.addEventListener('click', sendChat);
    this.chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendChat();
    });

    this.root.querySelectorAll('.emote-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.emote ?? 0);
        this.session?.emote(id);
      });
    });

    // HUD y Revancha
    this.root.querySelector('#btn-hud-lobby')?.addEventListener('click', () => {
      if (this.session?.isAdmin) {
        this.session.admin('stop');
      } else {
        this.showScreen('lobby');
      }
    });

    this.root.querySelector('#btn-rematch')?.addEventListener('click', () => {
      this.endModal.classList.add('hidden');
      if (this.session?.isAdmin) {
        this.session.admin('stop');
      } else {
        this.showScreen('lobby');
      }
    });

    // Modal de Ajustes
    const openSettings = (): void => this.settingsModal.classList.remove('hidden');
    this.root.querySelector('#btn-open-settings')?.addEventListener('click', openSettings);
    this.root.querySelector('#btn-lobby-settings')?.addEventListener('click', openSettings);
    this.root.querySelector('#btn-hud-settings')?.addEventListener('click', openSettings);
    this.root.querySelector('#btn-close-settings')?.addEventListener('click', () => {
      this.settingsModal.classList.add('hidden');
    });

    const volInput = this.root.querySelector('#set-volume') as HTMLInputElement;
    const volLbl = this.root.querySelector('#lbl-volume')!;
    volInput.addEventListener('input', () => {
      const v = Number(volInput.value) / 100;
      volLbl.textContent = `${Math.round(v * 100)}%`;
      this.settings.volume = v;
      sfx.setVolume(v);
      saveUserSettings(this.settings);
      this.cb.onSettingsChanged(this.settings);
    });

    const qualSelect = this.root.querySelector('#set-quality') as HTMLSelectElement;
    qualSelect.value = this.settings.quality;
    qualSelect.addEventListener('change', () => {
      this.settings.quality = qualSelect.value as GraphicsQuality;
      saveUserSettings(this.settings);
      this.cb.onSettingsChanged(this.settings);
    });

    const sensInput = this.root.querySelector('#set-sens') as HTMLInputElement;
    const sensLbl = this.root.querySelector('#lbl-sens')!;
    sensInput.addEventListener('input', () => {
      const s = Number(sensInput.value) / 10;
      sensLbl.textContent = `${s.toFixed(1)}x`;
      this.settings.sensitivity = s;
      saveUserSettings(this.settings);
      this.cb.onSettingsChanged(this.settings);
    });
  }

  private renderKeybindButtons(): void {
    const grid = this.root.querySelector('#keybind-grid')!;
    grid.innerHTML = '';
    const labels: { key: keyof KeyBindings; label: string }[] = [
      { key: 'up', label: 'Arriba' },
      { key: 'down', label: 'Abajo' },
      { key: 'left', label: 'Izquierda' },
      { key: 'right', label: 'Derecha' },
      { key: 'sprint', label: 'Sprint' },
      { key: 'kick', label: 'Patada' }
    ];

    for (const item of labels) {
      const btn = document.createElement('button');
      btn.className =
        'flex items-center justify-between px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 cursor-pointer';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.label;
      const codeSpan = document.createElement('span');
      codeSpan.className = 'kbd-key';
      codeSpan.textContent = formatKeyCode(this.settings.keys[item.key]);
      btn.append(nameSpan, codeSpan);

      btn.addEventListener('click', () => {
        codeSpan.textContent = '...';
        this.input.captureNextKey(newCode => {
          this.settings.keys[item.key] = newCode;
          saveUserSettings(this.settings);
          this.cb.onSettingsChanged(this.settings);
          this.renderKeybindButtons();
        });
      });
      grid.appendChild(btn);
    }
  }
}
