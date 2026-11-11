/**
 * Sesión HOST sobre PeerJS: el host ejecuta la simulación (autoridad), recibe inputs de los clientes
 * y difunde snapshots binarios (~30 Hz, canal rápido) + eventos/lobby (canal fiable).
 */
import Peer, { type DataConnection } from 'peerjs';
import type { PlayerInput, SimEvent } from '../sim/types';
import { iceServers, peerIdFor, randomRoomCode } from './ice';
import { parseClientMsg, type HostMsg, type RoomSettings } from './protocol';
import { AuthoritySession } from './Session';
import { decodeInput, encodeSnapshot, toWireEvents, type WireEvent } from './snapshot';

interface ClientLink {
  cid: string;
  rel?: DataConnection;
  fast?: DataConnection;
  playerId: number;
  joined: boolean;
  lastPong: number;
  winStart: number;
  winCount: number;
}

const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 12000;
const MAX_MSGS_PER_SEC = 120;

export class HostSession extends AuthoritySession {
  readonly kind = 'host' as const;
  private peer: Peer | null = null;
  private links = new Map<string, ClientLink>();
  private byPlayer = new Map<number, string>();
  private pendingWire: WireEvent[] = [];
  private beat: ReturnType<typeof setInterval> | null = null;
  private closing = false;

  constructor(roomCode: string, settings: Partial<RoomSettings>, password: string, hostName: string,
    profile: { number: number; color: string }) {
    super(roomCode, settings, password, hostName, profile);
  }

  /** Abre la sala. Si el código está ocupado genera otro. Resuelve con el código final. */
  start(): Promise<string> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      let opened = false;
      const open = (): void => {
        const code = attempts === 0 ? this.model.roomCode : randomRoomCode();
        this.model.roomCode = code;
        const peer = new Peer(peerIdFor(code), { config: { iceServers: iceServers() } });
        this.peer = peer;
        peer.on('open', () => {
          opened = true;
          peer.on('connection', c => this.onConnection(c));
          peer.on('disconnected', () => { if (!this.closing) peer.reconnect(); });
          this.beat = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
          this.lobby = this.model.toState();
          resolve(code);
        });
        peer.on('error', err => {
          if (!opened && (err as { type?: string }).type === 'unavailable-id' && attempts++ < 5) {
            peer.destroy();
            open();
          } else if (!opened) {
            reject(err);
          } else {
            console.warn('[host] peer error', err);
          }
        });
      };
      open();
    });
  }

  // ------------------------------------------------------------ conexiones
  private onConnection(conn: DataConnection): void {
    const meta = conn.metadata as { ch?: string; cid?: string } | undefined;
    if (!meta || typeof meta.cid !== 'string' || meta.cid.length > 64 || (meta.ch !== 'rel' && meta.ch !== 'fast')) {
      conn.close();
      return;
    }
    let link = this.links.get(meta.cid);
    if (!link) {
      if (this.links.size >= 24) { conn.close(); return; }
      link = { cid: meta.cid, playerId: 0, joined: false, lastPong: performance.now(), winStart: 0, winCount: 0 };
      this.links.set(meta.cid, link);
    }
    const l = link;
    if (meta.ch === 'rel') {
      l.rel = conn;
      conn.on('data', d => { try { this.onRel(l, d); } catch (e) { console.warn('[host] rel', e); } });
      conn.on('close', () => this.dropLink(l));
      conn.on('error', () => this.dropLink(l));
    } else {
      l.fast = conn;
      conn.on('data', d => this.onFast(l, d));
    }
  }

  private onRel(link: ClientLink, data: unknown): void {
    const now = performance.now();
    if (now - link.winStart > 1000) { link.winStart = now; link.winCount = 0; }
    if (++link.winCount > MAX_MSGS_PER_SEC) return; // anti-flood
    const msg = parseClientMsg(data);
    if (!msg) return;
    if (!link.joined) {
      if (msg.t !== 'join_request') return;
      const r = this.model.addHuman(msg.username, { number: msg.number, color: msg.color, password: msg.password });
      if (!r.ok) {
        link.rel?.send({ t: 'join_reject', reason: r.reason } satisfies HostMsg);
        setTimeout(() => this.closeLink(link), 300);
        return;
      }
      link.joined = true;
      link.playerId = r.player.id;
      this.byPlayer.set(r.player.id, link.cid);
      link.rel?.send({ t: 'join_accept', playerId: r.player.id, lobby: this.model.toState() } satisfies HostMsg);
      this.systemChat(`${r.player.username} entró a la sala`);
      this.pushLobby();
      if (this.inMatch && this.config) link.rel?.send({ t: 'match_start', config: this.config } satisfies HostMsg);
      return;
    }
    if (msg.t === 'pong') {
      link.lastPong = now;
      this.model.setPing(link.playerId, now - msg.ts);
      return;
    }
    this.apply(link.playerId, msg);
  }

  private onFast(link: ClientLink, data: unknown): void {
    if (!link.joined) return;
    let buf: ArrayBuffer | null = null;
    if (data instanceof ArrayBuffer) buf = data;
    else if (ArrayBuffer.isView(data)) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    if (!buf) return;
    const input = decodeInput(buf);
    if (!input) return;
    const len = Math.hypot(input.dx, input.dy);
    if (len > 1) { input.dx /= len; input.dy /= len; }
    this.setRemoteInput(link.playerId, input as PlayerInput);
  }

  private closeLink(link: ClientLink): void {
    try { link.rel?.close(); link.fast?.close(); } catch { /* ya cerrado */ }
    this.dropLink(link);
  }

  private dropLink(link: ClientLink): void {
    if (!this.links.has(link.cid)) return;
    this.links.delete(link.cid);
    if (!link.joined) return;
    this.byPlayer.delete(link.playerId);
    const p = this.model.get(link.playerId);
    if (p) {
      this.model.removeHuman(link.playerId, true); // recordado para reconexión
      this.systemChat(`${p.username} salió`);
      this.pushLobby();
    }
  }

  private heartbeat(): void {
    const now = performance.now();
    for (const l of [...this.links.values()]) {
      if (!l.joined) continue;
      if (now - l.lastPong > TIMEOUT_MS) { this.closeLink(l); continue; }
      if (l.rel?.open) l.rel.send({ t: 'ping', ts: now } satisfies HostMsg);
    }
    this.pushLobby();
  }

  // ------------------------------------------------------------ hooks de AuthoritySession
  protected override broadcast(msg: HostMsg): void {
    for (const l of this.links.values()) if (l.joined && l.rel?.open) l.rel.send(msg);
  }

  protected override sendTo(id: number, msg: HostMsg): void {
    const cid = this.byPlayer.get(id);
    const l = cid ? this.links.get(cid) : undefined;
    if (l?.rel?.open) l.rel.send(msg);
  }

  protected override onKick(id: number): void {
    const cid = this.byPlayer.get(id);
    const l = cid ? this.links.get(cid) : undefined;
    if (l) setTimeout(() => this.closeLink(l), 200);
  }

  protected override afterTick(events: SimEvent[]): void {
    const s = this.sim;
    if (!s) return;
    this.pendingWire.push(...toWireEvents(events));
    const ended = events.some(e => e.type === 'end');
    if (s.tick % 2 !== 0 && !ended) return;
    const buf = encodeSnapshot(s, this.paused, this.pendingWire);
    this.pendingWire = [];
    for (const l of this.links.values()) if (l.joined && l.fast?.open) l.fast.send(buf);
  }

  override leave(): void {
    this.closing = true;
    if (this.beat) clearInterval(this.beat);
    this.broadcast({ t: 'kicked', reason: 'El anfitrión cerró la sala.' });
    for (const l of this.links.values()) { try { l.rel?.close(); l.fast?.close(); } catch { /* */ } }
    this.links.clear();
    this.peer?.destroy();
    super.leave();
  }
}
