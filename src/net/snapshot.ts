/**
 * Formato binario compacto (ArrayBuffer/DataView) para inputs (cliente->host) y snapshots (host->cliente).
 * Little-endian.
 */
import { PHASES, type PlayerInput, type RenderState, type SimEvent, type SimState, type TeamId } from '../sim/types';

export const PKT_INPUT = 1;
export const PKT_SNAPSHOT = 2;

// ------------------------------------------------------------------ inputs (10 bytes)
export function encodeInput(i: PlayerInput): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  const v = new DataView(buf);
  v.setUint8(0, PKT_INPUT);
  v.setUint32(1, i.seq >>> 0, true);
  v.setInt8(5, Math.round(Math.max(-1, Math.min(1, i.dx)) * 127));
  v.setInt8(6, Math.round(Math.max(-1, Math.min(1, i.dy)) * 127));
  v.setUint8(7, (i.sprint ? 1 : 0) | (i.kick ? 2 : 0));
  return buf;
}

export function decodeInput(buf: ArrayBuffer): PlayerInput | null {
  if (buf.byteLength !== 8) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== PKT_INPUT) return null;
  const f = v.getUint8(7);
  return {
    seq: v.getUint32(1, true),
    dx: v.getInt8(5) / 127,
    dy: v.getInt8(6) / 127,
    sprint: (f & 1) !== 0,
    kick: (f & 2) !== 0
  };
}

// ------------------------------------------------------------------ snapshot
export interface WireEvent { type: number; a: number; b: number }
export const EV_KICK = 1;
export const EV_BOUNCE = 2;
export const EV_POST = 3;

/** Eventos de la sim que viajan en el snapshot (los demás van por el canal fiable). */
export function toWireEvents(events: SimEvent[]): WireEvent[] {
  const out: WireEvent[] = [];
  for (const e of events) {
    if (e.type === 'kick') out.push({ type: EV_KICK, a: e.id, b: Math.round(e.power * 255) });
    else if (e.type === 'bounce') out.push({ type: EV_BOUNCE, a: 0, b: 0 });
    else if (e.type === 'post') out.push({ type: EV_POST, a: 0, b: 0 });
  }
  return out.slice(0, 32);
}

export interface WirePlayer {
  id: number; team: TeamId; slot: number; number: number;
  x: number; y: number; vx: number; vy: number; energy: number; charge: number; lastSeq: number;
}

export interface Snapshot {
  tick: number;
  phase: RenderState['phase'];
  overtime: boolean;
  paused: boolean;
  clock: number;
  score: [number, number];
  lastGoalTeam: -1 | 0 | 1;
  ball: { x: number; y: number; vx: number; vy: number };
  players: WirePlayer[];
  events: WireEvent[];
}

const HEADER = 1 + 4 + 1 + 1 + 4 + 1 + 1 + 16 + 1;
const PLAYER_BYTES = 1 + 1 + 1 + 1 + 16 + 1 + 1 + 4;

export function encodeSnapshot(s: SimState, paused: boolean, events: WireEvent[]): ArrayBuffer {
  const n = s.players.length;
  const buf = new ArrayBuffer(HEADER + n * PLAYER_BYTES + 1 + events.length * 3);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, PKT_SNAPSHOT); o += 1;
  v.setUint32(o, s.tick >>> 0, true); o += 4;
  v.setUint8(o, PHASES.indexOf(s.phase)); o += 1;
  v.setUint8(o, (s.overtime ? 1 : 0) | (paused ? 2 : 0) | ((s.lastGoalTeam + 1) << 2)); o += 1;
  v.setFloat32(o, s.clock, true); o += 4;
  v.setUint8(o, Math.min(255, s.score[0])); o += 1;
  v.setUint8(o, Math.min(255, s.score[1])); o += 1;
  v.setFloat32(o, s.ball.x, true); o += 4;
  v.setFloat32(o, s.ball.y, true); o += 4;
  v.setFloat32(o, s.ball.vx, true); o += 4;
  v.setFloat32(o, s.ball.vy, true); o += 4;
  v.setUint8(o, n); o += 1;
  for (const p of s.players) {
    v.setUint8(o, p.id); o += 1;
    v.setUint8(o, p.team); o += 1;
    v.setUint8(o, p.slot); o += 1;
    v.setUint8(o, p.number); o += 1;
    v.setFloat32(o, p.x, true); o += 4;
    v.setFloat32(o, p.y, true); o += 4;
    v.setFloat32(o, p.vx, true); o += 4;
    v.setFloat32(o, p.vy, true); o += 4;
    v.setUint8(o, Math.round(p.energy * 2.55)); o += 1;
    v.setUint8(o, Math.round(p.charge * 255)); o += 1;
    v.setUint32(o, p.lastSeq >>> 0, true); o += 4;
  }
  v.setUint8(o, events.length); o += 1;
  for (const e of events) {
    v.setUint8(o, e.type); v.setUint8(o + 1, e.a); v.setUint8(o + 2, e.b); o += 3;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot | null {
  if (buf.byteLength < HEADER) return null;
  const v = new DataView(buf);
  let o = 0;
  if (v.getUint8(o) !== PKT_SNAPSHOT) return null;
  o += 1;
  const tick = v.getUint32(o, true); o += 4;
  const phase = PHASES[v.getUint8(o)];
  o += 1;
  if (!phase) return null;
  const flags = v.getUint8(o); o += 1;
  const clock = v.getFloat32(o, true); o += 4;
  const score: [number, number] = [v.getUint8(o), v.getUint8(o + 1)]; o += 2;
  const ball = {
    x: v.getFloat32(o, true), y: v.getFloat32(o + 4, true),
    vx: v.getFloat32(o + 8, true), vy: v.getFloat32(o + 12, true)
  };
  o += 16;
  const n = v.getUint8(o); o += 1;
  if (buf.byteLength < o + n * PLAYER_BYTES + 1) return null;
  const players: WirePlayer[] = [];
  for (let i = 0; i < n; i++) {
    const id = v.getUint8(o);
    const team = v.getUint8(o + 1) as TeamId;
    const slot = v.getUint8(o + 2);
    const number = v.getUint8(o + 3);
    o += 4;
    const x = v.getFloat32(o, true), y = v.getFloat32(o + 4, true);
    const vx = v.getFloat32(o + 8, true), vy = v.getFloat32(o + 12, true);
    o += 16;
    const energy = v.getUint8(o) / 2.55;
    const charge = v.getUint8(o + 1) / 255;
    o += 2;
    const lastSeq = v.getUint32(o, true); o += 4;
    players.push({ id, team, slot, number, x, y, vx, vy, energy, charge, lastSeq });
  }
  const ne = v.getUint8(o); o += 1;
  const events: WireEvent[] = [];
  for (let i = 0; i < ne && o + 3 <= buf.byteLength; i++) {
    events.push({ type: v.getUint8(o), a: v.getUint8(o + 1), b: v.getUint8(o + 2) });
    o += 3;
  }
  return {
    tick, phase, overtime: (flags & 1) !== 0, paused: (flags & 2) !== 0,
    lastGoalTeam: (((flags >> 2) & 3) - 1) as -1 | 0 | 1,
    clock, score, ball, players, events
  };
}

export function snapshotToRender(s: Snapshot): RenderState {
  return {
    tick: s.tick, phase: s.phase, overtime: s.overtime, clock: s.clock, score: [s.score[0], s.score[1]],
    ball: { ...s.ball }, lastGoalTeam: s.lastGoalTeam,
    players: s.players.map(p => ({
      id: p.id, team: p.team, slot: p.slot, number: p.number, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      energy: p.energy, charge: p.charge
    }))
  };
}

/** Interpola posiciones entre dos estados de render (t en 0..1). El resto de campos viene de `b`. */
export function lerpRender(a: RenderState, b: RenderState, t: number): RenderState {
  const byId = new Map(a.players.map(p => [p.id, p]));
  return {
    ...b,
    ball: {
      x: a.ball.x + (b.ball.x - a.ball.x) * t, y: a.ball.y + (b.ball.y - a.ball.y) * t,
      vx: b.ball.vx, vy: b.ball.vy
    },
    players: b.players.map(p => {
      const q = byId.get(p.id);
      if (!q) return p;
      return { ...p, x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t };
    })
  };
}
