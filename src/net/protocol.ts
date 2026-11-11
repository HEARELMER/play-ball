/**
 * Tipos compartidos y validación estricta de mensajes (canal fiable, JSON).
 * El host es la autoridad: valida cada mensaje y difunde `lobby_state` completo.
 */
import type { MatchConfig } from '../sim/types';

export type TeamName = 'red' | 'blue' | 'spec';
export const TEAM_NAMES: TeamName[] = ['red', 'blue', 'spec'];

export interface PlayerInfo {
  id: number;
  username: string;
  team: TeamName;
  number: number;
  color: string;
  isHost: boolean;
  isBot: boolean;
  ping: number;
  ready: boolean;
  muted?: boolean;
}

export interface RoomSettings {
  roomName: string;
  mode: MatchConfig['mode'];
  durationSec: number;
  scoreLimit: number;
  overtime: MatchConfig['overtime'];
  chargeKick: boolean;
  passAssist: boolean;
  fillBots: boolean;
  allowMidJoin: boolean;
  maxPlayers: number;
  teamNames: [string, string];
  teamColors: [string, string];
  hasPassword: boolean;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  roomName: 'Sala',
  mode: 3,
  durationSec: 14 * 60,
  scoreLimit: 0,
  overtime: 'golden',
  chargeKick: true,
  passAssist: false,
  fillBots: false,
  allowMidJoin: true,
  maxPlayers: 10,
  teamNames: ['Rojo', 'Azul'],
  teamColors: ['#e11d48', '#2563eb'],
  hasPassword: false
};

export interface LobbyState {
  roomCode: string;
  hostId: number;
  players: PlayerInfo[];
  settings: RoomSettings;
  locked: boolean;
  matchActive: boolean;
}

export const MAX_CHAT_LEN = 200;
export const MAX_MSG_BYTES = 4096;

// ---------------------------------------------------------------- mensajes cliente -> host
export type AdminAction =
  | 'pause' | 'resume' | 'restart' | 'stop' | 'lock' | 'unlock' | 'auto_assign'
  | 'make_host' | 'mute' | 'unmute';

export type ClientMsg =
  | { t: 'join_request'; username: string; password: string; number: number; color: string; cid: string }
  | { t: 'change_team'; team: TeamName }
  | { t: 'set_profile'; number: number; color: string }
  | { t: 'admin_move_player'; targetId: number; team: TeamName }
  | { t: 'kick'; targetId: number }
  | { t: 'update_settings'; settings: Partial<RoomSettings> }
  | { t: 'admin_action'; action: AdminAction; targetId?: number }
  | { t: 'chat'; text: string }
  | { t: 'emote'; id: number }
  | { t: 'start_match' }
  | { t: 'pong'; ts: number };

// ---------------------------------------------------------------- mensajes host -> cliente
export type RejectReason = 'full' | 'password' | 'invalid_name' | 'banned' | 'bad_request';

export interface MatchResult {
  winner: 0 | 1 | 2;
  score: [number, number];
  durationSec: number;
  players: { id: number; username: string; team: 0 | 1; number: number; goals: number; assists: number; shots: number; possession: number }[];
  teamNames: [string, string];
}

export type HostMsg =
  | { t: 'join_accept'; playerId: number; lobby: LobbyState }
  | { t: 'join_reject'; reason: RejectReason }
  | { t: 'lobby_state'; lobby: LobbyState }
  | { t: 'chat_msg'; from: string; text: string; system: boolean }
  | { t: 'match_start'; config: MatchConfig }
  | { t: 'goal'; team: 0 | 1; scorer: string; assist: string }
  | { t: 'match_end'; result: MatchResult }
  | { t: 'to_lobby' }
  | { t: 'paused'; value: boolean }
  | { t: 'kicked'; reason: string }
  | { t: 'emote_msg'; id: number; emote: number }
  | { t: 'ping'; ts: number }
  | { t: 'sim_event'; kind: 'kickoff' | 'overtime' };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isTeam = (v: unknown): v is TeamName => typeof v === 'string' && (TEAM_NAMES as string[]).includes(v);
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const ADMIN_ACTIONS: AdminAction[] = [
  'pause', 'resume', 'restart', 'stop', 'lock', 'unlock', 'auto_assign', 'make_host', 'mute', 'unmute'
];

/** Validación parcial de ajustes: devuelve solo los campos válidos (nunca confía en el cliente). */
export function sanitizeSettingsPatch(raw: unknown): Partial<RoomSettings> | null {
  if (!isObj(raw)) return null;
  const o: Partial<RoomSettings> = {};
  if (raw.roomName !== undefined) { if (!isStr(raw.roomName, 32)) return null; o.roomName = raw.roomName.trim().slice(0, 32) || 'Sala'; }
  if (raw.mode !== undefined) { if (!isInt(raw.mode, 1, 5)) return null; o.mode = raw.mode as MatchConfig['mode']; }
  if (raw.durationSec !== undefined) { if (!isInt(raw.durationSec, 30, 3600)) return null; o.durationSec = raw.durationSec; }
  if (raw.scoreLimit !== undefined) { if (!isInt(raw.scoreLimit, 0, 99)) return null; o.scoreLimit = raw.scoreLimit; }
  if (raw.overtime !== undefined) { if (raw.overtime !== 'golden' && raw.overtime !== 'none') return null; o.overtime = raw.overtime; }
  for (const k of ['chargeKick', 'passAssist', 'fillBots', 'allowMidJoin'] as const) {
    if (raw[k] !== undefined) { if (typeof raw[k] !== 'boolean') return null; o[k] = raw[k] as boolean; }
  }
  if (raw.maxPlayers !== undefined) { if (!isInt(raw.maxPlayers, 2, 10)) return null; o.maxPlayers = raw.maxPlayers; }
  if (raw.teamNames !== undefined) {
    const t = raw.teamNames;
    if (!Array.isArray(t) || t.length !== 2 || !isStr(t[0], 20) || !isStr(t[1], 20)) return null;
    o.teamNames = [String(t[0]).trim().slice(0, 20) || 'Rojo', String(t[1]).trim().slice(0, 20) || 'Azul'];
  }
  if (raw.teamColors !== undefined) {
    const t = raw.teamColors;
    if (!Array.isArray(t) || t.length !== 2 || !isColor(t[0]) || !isColor(t[1])) return null;
    o.teamColors = [t[0] as string, t[1] as string];
  }
  return o;
}

/** Parsea y valida un mensaje cliente->host. Devuelve null si está mal formado. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  try {
    if (JSON.stringify(raw).length > MAX_MSG_BYTES) return null;
  } catch { return null; }
  switch (raw.t) {
    case 'join_request':
      if (!isStr(raw.username, 64) || !isStr(raw.password ?? '', 64) || !isInt(raw.number, 1, 99) || !isColor(raw.color) || !isStr(raw.cid, 64)) return null;
      return { t: 'join_request', username: raw.username, password: (raw.password as string) ?? '', number: raw.number, color: raw.color, cid: raw.cid };
    case 'change_team':
      return isTeam(raw.team) ? { t: 'change_team', team: raw.team } : null;
    case 'set_profile':
      return isInt(raw.number, 1, 99) && isColor(raw.color) ? { t: 'set_profile', number: raw.number, color: raw.color } : null;
    case 'admin_move_player':
      return isInt(raw.targetId, 0, 255) && isTeam(raw.team) ? { t: 'admin_move_player', targetId: raw.targetId, team: raw.team } : null;
    case 'kick':
      return isInt(raw.targetId, 0, 255) ? { t: 'kick', targetId: raw.targetId } : null;
    case 'update_settings': {
      const s = sanitizeSettingsPatch(raw.settings);
      return s ? { t: 'update_settings', settings: s } : null;
    }
    case 'admin_action':
      if (!(ADMIN_ACTIONS as unknown[]).includes(raw.action)) return null;
      if (raw.targetId !== undefined && !isInt(raw.targetId, 0, 255)) return null;
      return { t: 'admin_action', action: raw.action as AdminAction, targetId: raw.targetId as number | undefined };
    case 'chat':
      return isStr(raw.text, MAX_CHAT_LEN) ? { t: 'chat', text: raw.text } : null;
    case 'emote':
      return isInt(raw.id, 0, 7) ? { t: 'emote', id: raw.id } : null;
    case 'start_match':
      return { t: 'start_match' };
    case 'pong':
      return typeof raw.ts === 'number' ? { t: 'pong', ts: raw.ts } : null;
    default:
      return null;
  }
}

/** Mensajes que solo puede enviar el admin/host. */
export function requiresAdmin(m: ClientMsg): boolean {
  return m.t === 'admin_move_player' || m.t === 'kick' || m.t === 'update_settings' ||
    m.t === 'admin_action' || m.t === 'start_match';
}

/** Autorización: false si el remitente no tiene permisos para este mensaje. */
export function authorize(m: ClientMsg, senderIsHost: boolean): boolean {
  return !requiresAdmin(m) || senderIsHost;
}

/** Validación de forma mínima de mensajes host->cliente (el cliente no confía ciegamente). */
export function parseHostMsg(raw: unknown): HostMsg | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  const validLobby = (l: unknown): l is LobbyState =>
    isObj(l) && typeof l.roomCode === 'string' && Array.isArray(l.players) && isObj(l.settings) && typeof l.hostId === 'number';
  switch (raw.t) {
    case 'join_accept': return typeof raw.playerId === 'number' && validLobby(raw.lobby) ? (raw as unknown as HostMsg) : null;
    case 'join_reject': return typeof raw.reason === 'string' ? (raw as unknown as HostMsg) : null;
    case 'lobby_state': return validLobby(raw.lobby) ? (raw as unknown as HostMsg) : null;
    case 'chat_msg': return isStr(raw.from, 64) && isStr(raw.text, 400) ? (raw as unknown as HostMsg) : null;
    case 'match_start': return isObj(raw.config) ? (raw as unknown as HostMsg) : null;
    case 'goal': return (raw.team === 0 || raw.team === 1) ? (raw as unknown as HostMsg) : null;
    case 'match_end': return isObj(raw.result) ? (raw as unknown as HostMsg) : null;
    case 'to_lobby': case 'paused': case 'kicked': case 'emote_msg': case 'ping': case 'sim_event':
      return raw as unknown as HostMsg;
    default: return null;
  }
}

export function teamIndex(t: TeamName): 0 | 1 | -1 {
  return t === 'red' ? 0 : t === 'blue' ? 1 : -1;
}
