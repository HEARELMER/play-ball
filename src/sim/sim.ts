/**
 * Simulación determinista 2D estilo Haxball. Paso fijo SIM_DT (60 Hz).
 * No usa Math.random, Date, Three.js, DOM ni red.
 */
import {
  ACCEL, BALL_DAMP, BALL_MASS, BALL_MAX_SPEED, BALL_RADIUS, CHARGE_TIME, ENERGY_DRAIN, ENERGY_REGEN,
  GOAL_DEPTH, GOAL_PAUSE, GOAL_WIDTH, HALF_H, HALF_W, KICKOFF_TIME, KICK_COOLDOWN, KICK_REACH,
  PLAYER_MASS, PLAYER_RADIUS, POST_RADIUS, RUN_SPEED, SIM_DT, SPRINT_SPEED
} from './constants';
import type {
  MatchConfig, PlayerInput, PlayerStats, SimEvent, SimPlayer, SimState, TeamId
} from './types';
import { NEUTRAL_INPUT } from './types';

export const DT = SIM_DT;
const PR = PLAYER_RADIUS;
const BR = BALL_RADIUS;
const HALF_GOAL = GOAL_WIDTH / 2;

interface Disc { x: number; y: number; vx: number; vy: number }

const POSTS: Disc[] = [
  { x: -HALF_W, y: -HALF_GOAL, vx: 0, vy: 0 },
  { x: -HALF_W, y: HALF_GOAL, vx: 0, vy: 0 },
  { x: HALF_W, y: -HALF_GOAL, vx: 0, vy: 0 },
  { x: HALF_W, y: HALF_GOAL, vx: 0, vy: 0 }
];

/** Posición de saque/formación de un puesto. Slot 0 = portero (si hay 2+ por equipo). */
export function formationPos(team: TeamId, slot: number, size: number): { x: number; y: number } {
  let x: number;
  let y: number;
  if (size <= 1) {
    x = -12;
    y = 0;
  } else if (slot === 0) {
    x = -(HALF_W - 3);
    y = 0;
  } else {
    const nField = size - 1;
    const i = (slot - 1) % Math.max(1, nField);
    y = nField === 1 ? 0 : ((i + 0.5) / nField - 0.5) * HALF_H * 1.7;
    x = -8 - (i % 2) * 5;
  }
  return { x: team === 0 ? x : -x, y };
}

function makePlayer(id: number, team: TeamId, slot: number, number: number, size: number): SimPlayer {
  const f = formationPos(team, slot, size);
  return {
    id, team, slot, number, x: f.x, y: f.y, vx: 0, vy: 0, energy: 100, charge: 0,
    kickHeld: false, kickCooldown: 0, facing: team === 0 ? 0 : Math.PI, lastSeq: 0
  };
}

function emptyStats(): PlayerStats {
  return { goals: 0, assists: 0, shots: 0, possessionTicks: 0 };
}

export function createState(
  config: MatchConfig,
  roster: { id: number; team: TeamId; number: number }[]
): SimState {
  const used: [number, number] = [0, 0];
  const players: SimPlayer[] = [];
  const stats: Record<number, PlayerStats> = {};
  for (const r of roster) {
    players.push(makePlayer(r.id, r.team, used[r.team]++, r.number, config.mode));
    stats[r.id] = emptyStats();
  }
  return {
    tick: 0, phase: 'kickoff', overtime: false, clock: config.durationSec, score: [0, 0],
    ball: { x: 0, y: 0, vx: 0, vy: 0, lastTouchId: -1, prevTouchId: -1 },
    players, lastGoalTeam: -1, config, phaseTimer: KICKOFF_TIME, kickoffTeam: 0,
    pendingEnd: false, stats, winner: -1
  };
}

/** Añade un jugador en el primer puesto libre de su equipo. */
export function addPlayer(s: SimState, r: { id: number; team: TeamId; number: number }): void {
  if (s.players.some(p => p.id === r.id)) return;
  const taken = new Set(s.players.filter(p => p.team === r.team).map(p => p.slot));
  let slot = 0;
  while (taken.has(slot)) slot++;
  s.players.push(makePlayer(r.id, r.team, slot, r.number, s.config.mode));
  if (!s.stats[r.id]) s.stats[r.id] = emptyStats();
}

export function removePlayer(s: SimState, id: number): void {
  s.players = s.players.filter(p => p.id !== id);
}

export function resetPositions(s: SimState): void {
  for (const p of s.players) {
    const f = formationPos(p.team, p.slot, s.config.mode);
    p.x = f.x; p.y = f.y; p.vx = 0; p.vy = 0; p.charge = 0; p.kickHeld = false;
    p.facing = p.team === 0 ? 0 : Math.PI;
  }
  const b = s.ball;
  b.x = 0; b.y = 0; b.vx = 0; b.vy = 0; b.lastTouchId = -1; b.prevTouchId = -1;
}

/**
 * Movimiento + energía + paredes de UN jugador. Compartido con la predicción local del cliente.
 */
export function stepPlayerSolo(p: SimPlayer, inp: PlayerInput): void {
  let dx = inp.dx;
  let dy = inp.dy;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  const moving = len > 0.05;
  let max = RUN_SPEED;
  if (inp.sprint && moving && p.energy > 2) {
    max = SPRINT_SPEED;
    p.energy = Math.max(0, p.energy - ENERGY_DRAIN * DT);
  } else if (!inp.sprint) {
    p.energy = Math.min(100, p.energy + ENERGY_REGEN * DT);
  }
  const k = Math.min(1, ACCEL * DT);
  p.vx += (dx * max - p.vx) * k;
  p.vy += (dy * max - p.vy) * k;
  if (moving) p.facing = Math.atan2(dy, dx);
  p.x += p.vx * DT;
  p.y += p.vy * DT;
  p.lastSeq = inp.seq;
  clampPlayer(p);
}

function clampPlayer(p: SimPlayer): void {
  const mx = HALF_W - PR;
  const my = HALF_H - PR;
  if (p.x < -mx) { p.x = -mx; if (p.vx < 0) p.vx = 0; }
  if (p.x > mx) { p.x = mx; if (p.vx > 0) p.vx = 0; }
  if (p.y < -my) { p.y = -my; if (p.vy < 0) p.vy = 0; }
  if (p.y > my) { p.y = my; if (p.vy > 0) p.vy = 0; }
}

/** Colisión elástica entre discos. invMass 0 = fijo. Devuelve true si hubo contacto. */
function collide(a: Disc, b: Disc, ra: number, rb: number, ima: number, imb: number, rest: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minD = ra + rb;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD) return false;
  const d = Math.sqrt(d2);
  const nx = d > 1e-6 ? dx / d : 1;
  const ny = d > 1e-6 ? dy / d : 0;
  const overlap = minD - d;
  const tot = ima + imb;
  if (tot === 0) return true;
  a.x -= nx * overlap * (ima / tot);
  a.y -= ny * overlap * (ima / tot);
  b.x += nx * overlap * (imb / tot);
  b.y += ny * overlap * (imb / tot);
  const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rvn < 0) {
    const j = (-(1 + rest) * rvn) / tot;
    a.vx -= j * ima * nx; a.vy -= j * ima * ny;
    b.vx += j * imb * nx; b.vy += j * imb * ny;
  }
  return true;
}

function touch(s: SimState, id: number): void {
  const b = s.ball;
  if (b.lastTouchId !== id) {
    b.prevTouchId = b.lastTouchId;
    b.lastTouchId = id;
  }
}

function tryKick(s: SimState, p: SimPlayer, power: number, events: SimEvent[]): void {
  if (p.kickCooldown > 0) return;
  const b = s.ball;
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist > PR + BR + KICK_REACH) return;
  let nx = dist > 1e-6 ? dx / dist : Math.cos(p.facing);
  let ny = dist > 1e-6 ? dy / dist : Math.sin(p.facing);
  const goalDirX = p.team === 0 ? 1 : -1;
  const towardGoal = nx * goalDirX;

  if (s.config.passAssist && towardGoal < 0.8) {
    let best: SimPlayer | null = null;
    let bestAng = 0.45;
    for (const m of s.players) {
      if (m.team !== p.team || m.id === p.id) continue;
      const mx = m.x - p.x;
      const my = m.y - p.y;
      const md = Math.hypot(mx, my);
      if (md < 4 || md > 35) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (mx * nx + my * ny) / md)));
      if (ang < bestAng) { bestAng = ang; best = m; }
    }
    if (best) {
      const mx = best.x - p.x;
      const my = best.y - p.y;
      const md = Math.hypot(mx, my);
      const ax = nx * 0.4 + (mx / md) * 0.6;
      const ay = ny * 0.4 + (my / md) * 0.6;
      const al = Math.hypot(ax, ay) || 1;
      nx = ax / al; ny = ay / al;
    }
  }

  b.vx = nx * power + p.vx * 0.35;
  b.vy = ny * power + p.vy * 0.35;
  p.kickCooldown = KICK_COOLDOWN;
  touch(s, p.id);
  if (towardGoal > 0.5) s.stats[p.id].shots++;
  events.push({ type: 'kick', id: p.id, power: Math.min(1, power / 44) });
}

function ballWalls(s: SimState, events: SimEvent[]): void {
  const b = s.ball;
  const ax = Math.abs(b.x);
  const sx = b.x < 0 ? -1 : 1;
  if (ax > HALF_W) {
    // Dentro de la red de la portería
    const ylim = HALF_GOAL - BR;
    if (b.y < -ylim) { b.y = -ylim; if (b.vy < 0) b.vy = -b.vy * 0.3; }
    if (b.y > ylim) { b.y = ylim; if (b.vy > 0) b.vy = -b.vy * 0.3; }
    const xlim = HALF_W + GOAL_DEPTH - BR;
    if (ax > xlim) { b.x = sx * xlim; if (b.vx * sx > 0) b.vx = -b.vx * 0.25; b.vy *= 0.5; }
    return;
  }
  const ylim = HALF_H - BR;
  if (b.y < -ylim) { b.y = -ylim; if (b.vy < 0) { b.vy = -b.vy * 0.7; events.push({ type: 'bounce' }); } }
  if (b.y > ylim) { b.y = ylim; if (b.vy > 0) { b.vy = -b.vy * 0.7; events.push({ type: 'bounce' }); } }
  if (ax > HALF_W - BR && Math.abs(b.y) > HALF_GOAL) {
    b.x = sx * (HALF_W - BR);
    if (b.vx * sx > 0) { b.vx = -b.vx * 0.7; events.push({ type: 'bounce' }); }
  }
}

function endMatch(s: SimState, events: SimEvent[]): void {
  s.phase = 'ended';
  const [r, bl] = s.score;
  s.winner = r > bl ? 0 : bl > r ? 1 : 2;
  events.push({ type: 'end', winner: s.winner });
}

function onGoal(s: SimState, team: TeamId, events: SimEvent[]): void {
  s.score[team]++;
  const scorer = s.players.find(p => p.id === s.ball.lastTouchId);
  let scorerId = -1;
  let assistId = -1;
  if (scorer && scorer.team === team) {
    scorerId = scorer.id;
    s.stats[scorer.id].goals++;
    const prev = s.players.find(p => p.id === s.ball.prevTouchId);
    if (prev && prev.team === team && prev.id !== scorer.id) {
      assistId = prev.id;
      s.stats[prev.id].assists++;
    }
  }
  s.phase = 'goal';
  s.phaseTimer = GOAL_PAUSE;
  s.lastGoalTeam = team;
  s.kickoffTeam = (1 - team) as TeamId;
  const lim = s.config.scoreLimit;
  s.pendingEnd = s.overtime || (lim > 0 && s.score[team] >= lim);
  events.push({ type: 'goal', team, scorerId, assistId });
}

/** Avanza un tick. `inputs` indexado por id de jugador. */
export function step(s: SimState, inputs: Record<number, PlayerInput | undefined>): SimEvent[] {
  const events: SimEvent[] = [];
  if (s.phase === 'ended') return events;
  s.tick++;

  if (s.phase === 'kickoff') {
    s.phaseTimer -= DT;
    if (s.phaseTimer <= 0) {
      s.phase = 'playing';
      events.push({ type: 'kickoff' });
    }
    return events;
  }

  // 1. Inputs: movimiento, energía, patada
  for (const p of s.players) {
    const inp = inputs[p.id] ?? NEUTRAL_INPUT;
    p.kickCooldown = Math.max(0, p.kickCooldown - DT);
    stepPlayerSolo(p, inp);
    if (s.config.chargeKick) {
      if (inp.kick) {
        p.charge = Math.min(1, p.charge + DT / CHARGE_TIME);
      } else if (p.kickHeld) {
        tryKick(s, p, 14 + 30 * Math.max(0.2, p.charge), events);
        p.charge = 0;
      }
    } else if (inp.kick && !p.kickHeld) {
      tryKick(s, p, 30, events);
    }
    p.kickHeld = inp.kick;
  }

  // 2. Colisiones jugador-jugador y jugador-poste
  const ps = s.players;
  const imp = 1 / PLAYER_MASS;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) collide(ps[i], ps[j], PR, PR, imp, imp, 0.3);
    for (const post of POSTS) collide(ps[i], post, PR, POST_RADIUS, imp, 0, 0.2);
    clampPlayer(ps[i]);
  }

  // 3. Balón
  const b = s.ball;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  const damp = Math.pow(BALL_DAMP, DT);
  b.vx *= damp;
  b.vy *= damp;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > BALL_MAX_SPEED) { b.vx *= BALL_MAX_SPEED / sp; b.vy *= BALL_MAX_SPEED / sp; }
  for (const p of ps) {
    if (collide(p, b, PR, BR, imp, 1 / BALL_MASS, 0.5)) touch(s, p.id);
  }
  for (const post of POSTS) {
    const sp0 = Math.hypot(b.vx, b.vy);
    if (collide(b, post, BR, POST_RADIUS, 1 / BALL_MASS, 0, 0.7) && sp0 > 4) events.push({ type: 'post' });
  }
  ballWalls(s, events);
  for (const p of ps) clampPlayer(p);

  // 4. Reglas
  if (s.phase === 'playing') {
    if (b.lastTouchId >= 0 && s.stats[b.lastTouchId]) s.stats[b.lastTouchId].possessionTicks++;
    if (b.x < -HALF_W - BR * 0.5) onGoal(s, 1, events);
    else if (b.x > HALF_W + BR * 0.5) onGoal(s, 0, events);
    else if (!s.overtime) {
      s.clock -= DT;
      if (s.clock <= 0) {
        s.clock = 0;
        if (s.score[0] === s.score[1] && s.config.overtime === 'golden') {
          s.overtime = true;
          events.push({ type: 'overtime' });
        } else {
          endMatch(s, events);
        }
      }
    } else {
      s.clock += DT;
    }
  } else if (s.phase === 'goal') {
    s.phaseTimer -= DT;
    if (s.phaseTimer <= 0) {
      if (s.pendingEnd) {
        endMatch(s, events);
      } else {
        resetPositions(s);
        s.phase = 'kickoff';
        s.phaseTimer = KICKOFF_TIME;
      }
    }
  }
  return events;
}

/** Posesión (0..1) del equipo rojo según toques acumulados. */
export function possession(s: SimState): [number, number] {
  let r = 0;
  let bl = 0;
  for (const p of s.players) {
    const t = s.stats[p.id]?.possessionTicks ?? 0;
    if (p.team === 0) r += t; else bl += t;
  }
  const tot = r + bl;
  return tot === 0 ? [0.5, 0.5] : [r / tot, bl / tot];
}

export function cloneState<T>(s: T): T {
  return structuredClone(s);
}
