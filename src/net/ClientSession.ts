/**
 * Sesión CLIENTE sobre PeerJS: envía inputs a 60 Hz (canal rápido), recibe snapshots,
 * interpola entidades remotas (~100 ms de buffer) y predice al jugador local con reconciliación.
 */
import Peer, { type DataConnection } from 'peerjs';
import { DT, stepPlayerSolo } from '../sim/sim';
import {
  NEUTRAL_INPUT, type PlayerInput, type RenderState, type SimEvent, type SimPlayer
} from '../sim/types';
import { iceServers, peerIdFor, randomRoomCode } from './ice';
import { parseHostMsg, type ClientMsg } from './protocol';
import { Session } from './Session';
import {
  decodeSnapshot, encodeInput, EV_BOUNCE, EV_KICK, EV_POST, lerpRender, snapshotToRender, type WirePlayer
} from './snapshot';

export type ConnectError = 'not_found' | 'timeout' | 'password' | 'full' | 'invalid_name' | 'banned' | 'network' | 'bad_request';

const INTERP_DELAY_MS = 100;
const SNAP_ERROR_SNAP = 2.5;

interface Buffered { at: number; state: RenderState }

export class ClientSession extends Session {
  readonly kind = 'client' as const;
  private peer: Peer | null = null;
  private rel: DataConnection | null = null;
  private fast: DataConnection | null = null;
  private buffer: Buffered[] = [];
  private lastTick = -1;
  private lastEventTick = -1;
  private latest: PlayerInput = { ...NEUTRAL_INPUT };
  private seq = 0;
  private acc = 0;
  private pending: PlayerInput[] = [];
  private predicted: SimPlayer | null = null;
  private leaving = false;

  constructor(
    private roomCode: string,
    private profile: { username: string; password: string; number: number; color: string }
  ) { super(); }

  get ping(): number { return this.me?.ping ?? 0; }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cid = randomRoomCode(16);
      let settled = false;
      const fail = (r: ConnectError): void => {
        if (settled) { if (!this.leaving) this.handlers.closed?.('Se perdió la conexión con el host.'); return; }
        settled = true;
        clearTimeout(timer);
        this.teardown();
        reject(new Error(r));
      };
      const timer = setTimeout(() => fail('timeout'), 12000);
      const peer = new Peer({ config: { iceServers: iceServers() } });
      this.peer = peer;
      peer.on('error', e => fail((e as { type?: string }).type === 'peer-unavailable' ? 'not_found' : 'network'));
      peer.on('open', () => {
        const host = peerIdFor(this.roomCode);
        const rel = peer.connect(host, { reliable: true, serialization: 'json', metadata: { ch: 'rel', cid } });
        const fast = peer.connect(host, { reliable: false, serialization: 'raw', metadata: { ch: 'fast', cid } });
        this.rel = rel;
        this.fast = fast;
        rel.on('open', () => rel.send({
          t: 'join_request', username: this.profile.username, password: this.profile.password,
          number: this.profile.number, color: this.profile.color, cid
        } satisfies ClientMsg));
        rel.on('data', d => {
          const msg = parseHostMsg(d);
          if (!msg) return;
          if (msg.t === 'join_accept' && !settled) {
            settled = true;
            clearTimeout(timer);
            this.localId = msg.playerId;
            this.lobby = msg.lobby;
            this.handlers.lobby?.(this.lobby);
            resolve();
            return;
          }
          if (msg.t === 'join_reject') { fail(msg.reason as ConnectError); return; }
          this.onHost(msg);
        });
        rel.on('close', () => fail('network'));
        fast.on('data', d => this.onFast(d));
      });
    });
  }

  private onHost(msg: NonNullable<ReturnType<typeof parseHostMsg>>): void {
    const h = this.handlers;
    switch (msg.t) {
      case 'lobby_state': this.lobby = msg.lobby; h.lobby?.(this.lobby); break;
      case 'chat_msg': h.chat?.(msg.from, msg.text, msg.system); break;
      case 'match_start':
        this.config = msg.config; this.inMatch = true; this.resetNet();
        h.matchStart?.(msg.config);
        break;
      case 'goal':
        h.goal?.(msg.team, String(msg.scorer ?? ''), String(msg.assist ?? ''));
        h.simEvent?.({ type: 'goal', team: msg.team, scorerId: -1, assistId: -1 });
        break;
      case 'sim_event': h.simEvent?.({ type: msg.kind }); break;
      case 'match_end':
        h.matchEnd?.(msg.result);
        h.simEvent?.({ type: 'end', winner: msg.result.winner });
        break;
      case 'to_lobby': this.inMatch = false; this.resetNet(); h.toLobby?.(); break;
      case 'paused': this.paused = !!msg.value; h.paused?.(this.paused); break;
      case 'kicked': this.leaving = true; h.kicked?.(String(msg.reason ?? '')); this.teardown(); break;
      case 'emote_msg': h.emote?.(msg.id, msg.emote); break;
      case 'ping': if (this.rel?.open) this.rel.send({ t: 'pong', ts: msg.ts } satisfies ClientMsg); break;
      default: break;
    }
  }

  private resetNet(): void {
    this.buffer = []; this.lastTick = -1; this.lastEventTick = -1;
    this.pending = []; this.predicted = null; this.acc = 0;
  }

  private onFast(data: unknown): void {
    let buf: ArrayBuffer | null = null;
    if (data instanceof ArrayBuffer) buf = data;
    else if (ArrayBuffer.isView(data)) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    if (!buf) return;
    const snap = decodeSnapshot(buf);
    if (!snap || snap.tick <= this.lastTick) return; // fuera de orden o duplicado
    this.lastTick = snap.tick;
    const state = snapshotToRender(snap);
    this.buffer.push({ at: performance.now(), state });
    if (this.buffer.length > 40) this.buffer.shift();

    if (snap.tick > this.lastEventTick) {
      this.lastEventTick = snap.tick;
      for (const e of snap.events) {
        let ev: SimEvent | null = null;
        if (e.type === EV_KICK) ev = { type: 'kick', id: e.a, power: e.b / 255 };
        else if (e.type === EV_BOUNCE) ev = { type: 'bounce' };
        else if (e.type === EV_POST) ev = { type: 'post' };
        if (ev) this.handlers.simEvent?.(ev);
      }
    }
    const mine = snap.players.find(p => p.id === this.localId);
    if (mine) this.reconcile(mine, snap.phase);
  }

  /** Reconciliación: parte del estado autoritativo y reaplica los inputs aún no confirmados. */
  private reconcile(auth: WirePlayer, phase: RenderState['phase']): void {
    this.pending = this.pending.filter(i => i.seq > auth.lastSeq);
    const p: SimPlayer = {
      id: auth.id, team: auth.team, slot: auth.slot, number: auth.number, x: auth.x, y: auth.y, vx: auth.vx,
      vy: auth.vy, energy: auth.energy, charge: auth.charge, kickHeld: false, kickCooldown: 0, facing: 0,
      lastSeq: auth.lastSeq
    };
    if (phase === 'playing' || phase === 'goal') for (const i of this.pending) stepPlayerSolo(p, i);
    const old = this.predicted;
    if (old && Math.hypot(old.x - p.x, old.y - p.y) < SNAP_ERROR_SNAP) {
      p.x = old.x + (p.x - old.x) * 0.35;
      p.y = old.y + (p.y - old.y) * 0.35;
    }
    this.predicted = p;
  }

  send(msg: ClientMsg): void { if (this.rel?.open) this.rel.send(msg); }

  sendInput(i: PlayerInput): void { this.latest = i; }

  tick(dtSec: number): void {
    if (!this.inMatch || !this.fast?.open) return;
    this.acc = Math.min(this.acc + dtSec, 0.25);
    while (this.acc >= DT) {
      this.acc -= DT;
      const input: PlayerInput = { ...this.latest, seq: ++this.seq };
      this.fast.send(encodeInput(input));
      this.pending.push(input);
      if (this.pending.length > 180) this.pending.shift();
      const last = this.buffer[this.buffer.length - 1]?.state;
      if (this.predicted && last && (last.phase === 'playing' || last.phase === 'goal') && !this.paused) {
        stepPlayerSolo(this.predicted, input);
      }
    }
  }

  getRenderState(nowMs: number): RenderState | null {
    const b = this.buffer;
    if (b.length === 0) return null;
    const t = nowMs - INTERP_DELAY_MS;
    let out: RenderState;
    if (t <= b[0].at) out = b[0].state;
    else if (t >= b[b.length - 1].at) out = b[b.length - 1].state;
    else {
      let i = 0;
      while (i < b.length - 2 && b[i + 1].at < t) i++;
      const a = b[i];
      const c = b[i + 1];
      out = lerpRender(a.state, c.state, (t - a.at) / Math.max(1, c.at - a.at));
    }
    const pr = this.predicted;
    if (pr && (out.phase === 'playing' || out.phase === 'goal')) {
      out = {
        ...out,
        players: out.players.map(p => p.id === pr.id ? { ...p, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, energy: pr.energy } : p)
      };
    }
    return out;
  }

  private teardown(): void {
    try { this.rel?.close(); this.fast?.close(); } catch { /* */ }
    this.peer?.destroy();
    this.peer = null; this.rel = null; this.fast = null;
  }

  leave(): void {
    this.leaving = true;
    this.teardown();
  }
}
