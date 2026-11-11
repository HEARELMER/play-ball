/**
 * Capa de sesión: interfaz común que usa la UI para jugar offline, como host o como cliente.
 * `AuthoritySession` ejecuta lobby + simulación (offline y host); `ClientSession` solo envía/recibe.
 */
import { botInput } from '../bots/Bot';
import { SIM_DT } from '../sim/constants';
import { addPlayer, createState, DT, removePlayer, step } from '../sim/sim';
import {
  NEUTRAL_INPUT, type MatchConfig, type PlayerInput, type RenderState, type SimEvent, type SimState, type TeamId
} from '../sim/types';
import { LobbyModel } from './lobby';
import {
  authorize, teamIndex, type ClientMsg, type HostMsg, type LobbyState, type MatchResult, type RoomSettings,
  type TeamName, type AdminAction
} from './protocol';
import { lerpRender } from './snapshot';

export interface SessionHandlers {
  lobby?(l: LobbyState): void;
  chat?(from: string, text: string, system: boolean): void;
  matchStart?(config: MatchConfig): void;
  matchEnd?(r: MatchResult): void;
  toLobby?(): void;
  simEvent?(e: SimEvent): void;
  goal?(team: 0 | 1, scorer: string, assist: string): void;
  paused?(v: boolean): void;
  kicked?(reason: string): void;
  closed?(reason: string): void;
  emote?(playerId: number, emote: number): void;
}

export abstract class Session {
  abstract readonly kind: 'offline' | 'host' | 'client';
  public localId = 0;
  public lobby!: LobbyState;
  public handlers: SessionHandlers = {};
  public inMatch = false;
  public paused = false;
  public pingMs = 0;
  public config: MatchConfig | null = null;

  abstract send(msg: ClientMsg): void;
  abstract sendInput(i: PlayerInput): void;
  abstract tick(dtSec: number): void;
  abstract getRenderState(nowMs: number): RenderState | null;
  abstract leave(): void;

  get isAdmin(): boolean { return this.lobby?.hostId === this.localId; }
  get me() { return this.lobby?.players.find(p => p.id === this.localId); }

  changeTeam(team: TeamName): void { this.send({ t: 'change_team', team }); }
  setProfile(number: number, color: string): void { this.send({ t: 'set_profile', number, color }); }
  chat(text: string): void { this.send({ t: 'chat', text }); }
  emote(id: number): void { this.send({ t: 'emote', id }); }
  movePlayer(targetId: number, team: TeamName): void { this.send({ t: 'admin_move_player', targetId, team }); }
  kick(targetId: number): void { this.send({ t: 'kick', targetId }); }
  updateSettings(settings: Partial<RoomSettings>): void { this.send({ t: 'update_settings', settings }); }
  admin(action: AdminAction, targetId?: number): void { this.send({ t: 'admin_action', action, targetId }); }
  startMatch(): void { this.send({ t: 'start_match' }); }
}

export function simToRender(s: SimState): RenderState {
  return {
    tick: s.tick, phase: s.phase, overtime: s.overtime, clock: s.clock, score: [s.score[0], s.score[1]],
    lastGoalTeam: s.lastGoalTeam, ball: { x: s.ball.x, y: s.ball.y, vx: s.ball.vx, vy: s.ball.vy },
    players: s.players.map(p => ({
      id: p.id, team: p.team, slot: p.slot, number: p.number, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      energy: p.energy, charge: p.charge
    }))
  };
}

const TEAM_LABEL: Record<TeamName, (s: RoomSettings) => string> = {
  red: s => s.teamNames[0], blue: s => s.teamNames[1], spec: (): string => 'espectadores'
};

export class AuthoritySession extends Session {
  readonly kind: 'offline' | 'host' | 'client' = 'offline';
  public model: LobbyModel;
  public sim: SimState | null = null;
  private acc = 0;
  private prev: RenderState | null = null;
  private localInput: PlayerInput = { ...NEUTRAL_INPUT };
  private remoteInputs = new Map<number, PlayerInput>();
  private localSeq = 0;

  constructor(roomCode: string, settings: Partial<RoomSettings>, password: string, hostName: string,
    profile: { number: number; color: string }) {
    super();
    this.model = new LobbyModel(roomCode, settings, password);
    const r = this.model.addHuman(hostName, { isHost: true, number: profile.number, color: profile.color });
    if (!r.ok) throw new Error('host_name_' + r.reason);
    this.localId = r.player.id;
    this.lobby = this.model.toState();
  }

  // -------------------------------------------------------- hooks de red (host los sobreescribe)
  protected broadcast(_msg: HostMsg): void { /* offline */ }
  protected sendTo(_id: number, _msg: HostMsg): void { /* offline */ }
  protected afterTick(_events: SimEvent[]): void { /* offline */ }
  protected onKick(_id: number): void { /* offline */ }

  setRemoteInput(playerId: number, i: PlayerInput): void { this.remoteInputs.set(playerId, i); }

  // -------------------------------------------------------- entrada local
  sendInput(i: PlayerInput): void { this.localInput = { ...i, seq: ++this.localSeq }; }

  send(msg: ClientMsg): void { this.apply(this.localId, msg); }

  protected notify(actorId: number, text: string): void {
    if (actorId === this.localId) this.handlers.chat?.('', text, true);
    else this.sendTo(actorId, { t: 'chat_msg', from: '', text, system: true });
  }

  protected systemChat(text: string): void {
    this.handlers.chat?.('', text, true);
    this.broadcast({ t: 'chat_msg', from: '', text, system: true });
  }

  protected pushLobby(): void {
    this.syncRoster();
    this.lobby = this.model.toState();
    this.handlers.lobby?.(this.lobby);
    this.broadcast({ t: 'lobby_state', lobby: this.lobby });
  }

  /** Aplica un mensaje de un jugador (o del host local) con validación de permisos. */
  apply(actorId: number, msg: ClientMsg): void {
    const m = this.model;
    if (!authorize(msg, actorId === m.hostId)) { this.notify(actorId, 'No tienes permisos de admin.'); return; }
    const actor = m.get(actorId);
    switch (msg.t) {
      case 'change_team': {
        const res = m.changeTeam(actorId, msg.team);
        if (res === 'ok' && actor) {
          this.systemChat(msg.team === 'spec' ? `${actor.username} pasó a espectador` : `${actor.username} se unió al equipo ${TEAM_LABEL[msg.team](m.settings)}`);
        } else if (res === 'team_full') this.notify(actorId, 'Ese equipo está lleno.');
        else if (res === 'locked') this.notify(actorId, 'Los equipos están bloqueados por el host.');
        else if (res === 'denied') this.notify(actorId, 'No se puede entrar a mitad de partida.');
        break;
      }
      case 'set_profile': m.setProfile(actorId, msg.number, msg.color); break;
      case 'admin_move_player': {
        const res = m.adminMove(actorId, msg.targetId, msg.team);
        if (res === 'team_full') this.notify(actorId, 'Ese equipo está lleno.');
        break;
      }
      case 'kick': {
        if (msg.targetId === this.localId) { this.notify(actorId, 'No puedes expulsar al anfitrión de la sala.'); break; }
        const t = m.get(msg.targetId);
        if (m.kick(actorId, msg.targetId) === 'ok' && t) {
          this.sendTo(t.id, { t: 'kicked', reason: 'Fuiste expulsado de la sala.' });
          this.onKick(t.id);
          this.systemChat(`${t.username} fue expulsado`);
        }
        break;
      }
      case 'update_settings': m.updateSettings(actorId, msg.settings); break;
      case 'chat': {
        const r = m.chat(actorId, msg.text);
        if (r.result === 'ok') {
          this.handlers.chat?.(r.from!, r.text!, false);
          this.broadcast({ t: 'chat_msg', from: r.from!, text: r.text!, system: false });
        } else if (r.result === 'rate') this.notify(actorId, 'Estás escribiendo demasiado rápido.');
        else if (r.result === 'muted') this.notify(actorId, 'Estás silenciado.');
        return;
      }
      case 'emote':
        this.handlers.emote?.(actorId, msg.id);
        this.broadcast({ t: 'emote_msg', id: actorId, emote: msg.id });
        return;
      case 'start_match': this.beginMatch(actorId); return;
      case 'admin_action': this.adminAction(actorId, msg.action, msg.targetId); break;
      case 'pong': return;
      case 'join_request': return;
    }
    this.pushLobby();
  }

  private adminAction(actorId: number, action: AdminAction, targetId?: number): void {
    const m = this.model;
    switch (action) {
      case 'pause': case 'resume':
        if (this.sim) this.setPaused(action === 'pause');
        break;
      case 'restart':
        if (this.sim) this.createSim();
        break;
      case 'stop': this.backToLobby(); break;
      case 'lock': m.setLocked(actorId, true); break;
      case 'unlock': m.setLocked(actorId, false); break;
      case 'auto_assign': m.autoAssign(actorId); break;
      case 'make_host': if (targetId !== undefined) m.setHost(actorId, targetId); break;
      case 'mute': if (targetId !== undefined) m.mute(actorId, targetId, true); break;
      case 'unmute': if (targetId !== undefined) m.mute(actorId, targetId, false); break;
    }
  }

  protected setPaused(v: boolean): void {
    this.paused = v;
    this.handlers.paused?.(v);
    this.broadcast({ t: 'paused', value: v });
  }

  // -------------------------------------------------------- partido
  private roster(): { id: number; team: TeamId; number: number }[] {
    return this.model.players.filter(p => p.team !== 'spec')
      .map(p => ({ id: p.id, team: teamIndex(p.team) as TeamId, number: p.number }));
  }

  private matchConfig(): MatchConfig {
    const s = this.model.settings;
    return {
      mode: s.mode, durationSec: s.durationSec, scoreLimit: s.scoreLimit, overtime: s.overtime,
      chargeKick: s.chargeKick, passAssist: s.passAssist
    };
  }

  private createSim(): void {
    this.config = this.matchConfig();
    this.sim = createState(this.config, this.roster());
    this.prev = simToRender(this.sim);
    this.acc = 0;
    this.paused = false;
  }

  private beginMatch(actorId: number): void {
    if (this.roster().length === 0) { this.notify(actorId, 'Se necesita al menos un jugador en un equipo.'); return; }
    this.model.recomputeBots();
    this.model.matchActive = true;
    this.createSim();
    this.inMatch = true;
    this.pushLobby();
    this.handlers.matchStart?.(this.config!);
    this.broadcast({ t: 'match_start', config: this.config! });
  }

  backToLobby(): void {
    this.sim = null;
    this.prev = null;
    this.inMatch = false;
    this.paused = false;
    this.model.matchActive = false;
    this.handlers.toLobby?.();
    this.broadcast({ t: 'to_lobby' });
    this.pushLobby();
  }

  /** Reconcilia jugadores de la simulación con el lobby (altas/bajas a mitad de partido). */
  protected syncRoster(): void {
    const s = this.sim;
    if (!s || s.phase === 'ended') return;
    const want = new Map(this.roster().map(r => [r.id, r]));
    for (const p of [...s.players]) if (!want.has(p.id)) removePlayer(s, p.id);
    for (const r of want.values()) {
      if (!s.players.some(p => p.id === r.id)) addPlayer(s, r);
      else {
        const p = s.players.find(q => q.id === r.id)!;
        if (p.team !== r.team) { removePlayer(s, r.id); addPlayer(s, r); }
        else p.number = r.number;
      }
    }
  }

  protected playerName(id: number): string {
    return id >= 0 ? (this.model.get(id)?.username ?? '') : '';
  }

  private buildResult(s: SimState): MatchResult {
    const total = s.players.reduce((a, p) => a + (s.stats[p.id]?.possessionTicks ?? 0), 0) || 1;
    return {
      winner: s.winner === -1 ? 2 : s.winner, score: [s.score[0], s.score[1]], durationSec: s.config.durationSec,
      teamNames: [...this.model.settings.teamNames] as [string, string],
      players: s.players.map(p => ({
        id: p.id, username: this.playerName(p.id) || 'Jugador', team: p.team, number: p.number,
        goals: s.stats[p.id]?.goals ?? 0, assists: s.stats[p.id]?.assists ?? 0, shots: s.stats[p.id]?.shots ?? 0,
        possession: Math.round(((s.stats[p.id]?.possessionTicks ?? 0) / total) * 100)
      }))
    };
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      this.handlers.simEvent?.(e);
      if (e.type === 'goal') {
        const scorer = this.playerName(e.scorerId);
        const assist = this.playerName(e.assistId);
        this.handlers.goal?.(e.team, scorer, assist);
        this.broadcast({ t: 'goal', team: e.team, scorer, assist });
      } else if (e.type === 'kickoff' || e.type === 'overtime') {
        this.broadcast({ t: 'sim_event', kind: e.type });
      } else if (e.type === 'end' && this.sim) {
        const result = this.buildResult(this.sim);
        this.handlers.matchEnd?.(result);
        this.broadcast({ t: 'match_end', result });
      }
    }
  }

  tick(dtSec: number): void {
    const s = this.sim;
    if (!s || this.paused) return;
    this.acc = Math.min(this.acc + dtSec, 0.25);
    while (this.acc >= DT) {
      this.acc -= DT;
      const inputs: Record<number, PlayerInput> = {};
      for (const p of s.players) {
        const info = this.model.get(p.id);
        if (info?.isBot) inputs[p.id] = botInput(s, p.id);
        else if (p.id === this.localId) inputs[p.id] = this.localInput;
        else inputs[p.id] = this.remoteInputs.get(p.id) ?? NEUTRAL_INPUT;
      }
      this.prev = simToRender(s);
      const events = step(s, inputs);
      this.handleEvents(events);
      this.afterTick(events);
    }
  }

  getRenderState(_nowMs: number): RenderState | null {
    if (!this.sim) return null;
    const cur = simToRender(this.sim);
    if (!this.prev || this.paused) return cur;
    return lerpRender(this.prev, cur, Math.min(1, this.acc / SIM_DT));
  }

  leave(): void { this.sim = null; }
}

export class OfflineSession extends AuthoritySession {}
