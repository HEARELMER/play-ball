/**
 * Modelo de lobby del HOST (autoridad). Lógica pura, sin red ni DOM: se usa igual en
 * modo local/offline, en el host de PeerJS y en los tests.
 */
import {
  DEFAULT_SETTINGS, MAX_CHAT_LEN, type LobbyState, type PlayerInfo, type RejectReason,
  type RoomSettings, type TeamName
} from './protocol';
import { sanitizeUsername, uniqueUsername, validateUsername } from './username';

export type LobbyResult = 'ok' | 'team_full' | 'locked' | 'denied' | 'unknown' | 'rate' | 'muted' | 'empty';
export type JoinResult = { ok: true; player: PlayerInfo } | { ok: false; reason: RejectReason };

const CHAT_WINDOW_MS = 5000;
const CHAT_MAX_PER_WINDOW = 3;

export class LobbyModel {
  public players: PlayerInfo[] = [];
  public settings: RoomSettings;
  public locked = false;
  public matchActive = false;
  public hostId = 0;
  private nextId = 1;
  private remembered = new Map<string, { team: TeamName; number: number }>();
  private chatTimes = new Map<number, number[]>();

  constructor(
    public roomCode: string,
    settings: Partial<RoomSettings> = {},
    private password = '',
    private now: () => number = () => Date.now()
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings, hasPassword: password.length > 0 };
  }

  humans(): PlayerInfo[] { return this.players.filter(p => !p.isBot); }
  get(id: number): PlayerInfo | undefined { return this.players.find(p => p.id === id); }
  private teamHumans(team: TeamName): number { return this.humans().filter(p => p.team === team).length; }
  private isHostId(id: number): boolean { return id === this.hostId && id !== 0; }

  addHuman(rawName: string, opts: { number?: number; color?: string; password?: string; isHost?: boolean } = {}): JoinResult {
    const v = validateUsername(rawName);
    if (!v.ok) return { ok: false, reason: v.error === 'blocked' ? 'banned' : 'invalid_name' };
    if (!opts.isHost && this.password && opts.password !== this.password) return { ok: false, reason: 'password' };
    if (this.humans().length >= this.settings.maxPlayers) return { ok: false, reason: 'full' };

    const taken = this.humans().map(p => p.username);
    const key = v.name.toLowerCase();
    const reconnect = !taken.some(t => t.toLowerCase() === key) ? this.remembered.get(key) : undefined;
    const username = uniqueUsername(v.name, taken);
    const id = this.nextId++;
    let team: TeamName = 'spec';
    if (reconnect) {
      this.remembered.delete(key);
      if (reconnect.team !== 'spec' && this.teamHumans(reconnect.team) < this.settings.mode) team = reconnect.team;
    }
    const player: PlayerInfo = {
      id, username, team, number: opts.number ?? reconnect?.number ?? ((id * 7) % 99) + 1,
      color: opts.color ?? '#facc15', isHost: !!opts.isHost, isBot: false, ping: 0, ready: true, muted: false
    };
    this.players.push(player);
    if (opts.isHost) this.hostId = id;
    this.recomputeBots();
    return { ok: true, player };
  }

  removeHuman(id: number, remember = true): void {
    const p = this.get(id);
    if (!p || p.isBot) return;
    if (remember && p.team !== 'spec') this.remembered.set(p.username.toLowerCase(), { team: p.team, number: p.number });
    this.players = this.players.filter(x => x.id !== id);
    this.chatTimes.delete(id);
    this.recomputeBots();
  }

  changeTeam(actorId: number, team: TeamName): LobbyResult {
    const p = this.get(actorId);
    if (!p || p.isBot) return 'unknown';
    if (p.team === team) return 'ok';
    if (team === 'spec') { p.team = 'spec'; this.recomputeBots(); return 'ok'; }
    if (!this.isHostId(actorId)) {
      if (this.locked) return 'locked';
      if (this.matchActive && !this.settings.allowMidJoin) return 'denied';
    }
    if (this.teamHumans(team) >= this.settings.mode) return 'team_full';
    p.team = team;
    this.recomputeBots();
    return 'ok';
  }

  adminMove(actorId: number, targetId: number, team: TeamName): LobbyResult {
    if (!this.isHostId(actorId)) return 'denied';
    const t = this.get(targetId);
    if (!t || t.isBot) return 'unknown';
    if (t.team === team) return 'ok';
    if (team !== 'spec' && this.teamHumans(team) >= this.settings.mode) return 'team_full';
    t.team = team;
    this.recomputeBots();
    return 'ok';
  }

  kick(actorId: number, targetId: number): LobbyResult {
    if (!this.isHostId(actorId)) return 'denied';
    if (actorId === targetId) return 'denied';
    const t = this.get(targetId);
    if (!t || t.isBot) return 'unknown';
    this.removeHuman(targetId, false);
    return 'ok';
  }

  setHost(actorId: number, targetId: number): LobbyResult {
    if (!this.isHostId(actorId)) return 'denied';
    const t = this.get(targetId);
    if (!t || t.isBot) return 'unknown';
    for (const p of this.players) p.isHost = false;
    t.isHost = true;
    this.hostId = t.id;
    return 'ok';
  }

  mute(actorId: number, targetId: number, value: boolean): LobbyResult {
    if (!this.isHostId(actorId)) return 'denied';
    const t = this.get(targetId);
    if (!t || t.isBot || t.id === actorId) return 'unknown';
    t.muted = value;
    return 'ok';
  }

  setLocked(actorId: number, value: boolean): LobbyResult {
    if (!this.isHostId(actorId)) return 'denied';
    this.locked = value;
    return 'ok';
  }

  updateSettings(actorId: number, patch: Partial<RoomSettings>): LobbyResult {
    if (!this.isHostId(actorId)) return 'denied';
    const { hasPassword: _ignored, ...rest } = patch;
    this.settings = { ...this.settings, ...rest };
    this.settings.maxPlayers = Math.max(this.settings.maxPlayers, Math.min(10, this.humans().length), 2);
    // Si el modo se reduce, los humanos sobrantes de cada equipo pasan a espectador.
    for (const team of ['red', 'blue'] as TeamName[]) {
      const members = this.humans().filter(p => p.team === team).sort((a, b) => b.id - a.id);
      for (let i = 0; i < members.length - this.settings.mode; i++) members[i].team = 'spec';
    }
    this.recomputeBots();
    return 'ok';
  }

  /** Reparte espectadores en el equipo con menos jugadores (hasta llenar). */
  autoAssign(actorId: number): LobbyResult {
    if (!this.isHostId(actorId)) return 'denied';
    const specs = this.humans().filter(p => p.team === 'spec').sort((a, b) => a.id - b.id);
    for (const p of specs) {
      const r = this.teamHumans('red');
      const b = this.teamHumans('blue');
      const target: TeamName = r <= b ? 'red' : 'blue';
      if (this.teamHumans(target) < this.settings.mode) p.team = target;
      else {
        const other: TeamName = target === 'red' ? 'blue' : 'red';
        if (this.teamHumans(other) < this.settings.mode) p.team = other;
      }
    }
    this.recomputeBots();
    return 'ok';
  }

  setProfile(id: number, number: number, color: string): LobbyResult {
    const p = this.get(id);
    if (!p || p.isBot) return 'unknown';
    p.number = Math.max(1, Math.min(99, Math.round(number)));
    p.color = color;
    return 'ok';
  }

  setPing(id: number, ping: number): void {
    const p = this.get(id);
    if (p) p.ping = Math.max(0, Math.min(999, Math.round(ping)));
  }

  /** Valida un mensaje de chat: longitud, antispam y silencio. */
  chat(actorId: number, text: string): { result: LobbyResult; from?: string; text?: string } {
    const p = this.get(actorId);
    if (!p || p.isBot) return { result: 'unknown' };
    if (p.muted) return { result: 'muted' };
    // eslint-disable-next-line no-control-regex
    const clean = sanitizeUsernameLike(text).slice(0, MAX_CHAT_LEN);
    if (clean.length === 0) return { result: 'empty' };
    const now = this.now();
    const times = (this.chatTimes.get(actorId) ?? []).filter(t => now - t < CHAT_WINDOW_MS);
    if (times.length >= CHAT_MAX_PER_WINDOW) { this.chatTimes.set(actorId, times); return { result: 'rate' }; }
    times.push(now);
    this.chatTimes.set(actorId, times);
    return { result: 'ok', from: p.username, text: clean };
  }

  /** Quita todos los bots y vuelve a rellenar los puestos vacíos si `fillBots` está activo. */
  recomputeBots(): void {
    this.players = this.players.filter(p => !p.isBot);
    if (!this.settings.fillBots) return;
    for (const [idx, team] of (['red', 'blue'] as TeamName[]).entries()) {
      const need = this.settings.mode - this.teamHumans(team);
      for (let n = 0; n < need; n++) {
        this.players.push({
          id: 100 + idx * 10 + n, username: `BOT ${n + 1}`, team, number: 10 + n,
          color: this.settings.teamColors[idx], isHost: false, isBot: true, ping: 0, ready: true
        });
      }
    }
  }

  toState(): LobbyState {
    return JSON.parse(JSON.stringify({
      roomCode: this.roomCode, hostId: this.hostId, players: this.players,
      settings: { ...this.settings, hasPassword: this.password.length > 0 },
      locked: this.locked, matchActive: this.matchActive
    })) as LobbyState;
  }
}

function sanitizeUsernameLike(text: string): string {
  return sanitizeUsername(text);
}
