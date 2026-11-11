/**
 * Tipos de la simulación. SIN Three.js, SIN DOM, SIN red.
 * Coordenadas: plano del campo (x, y). El render mapea y -> z.
 * Equipo 0 = Rojo (izquierda, ataca +x). Equipo 1 = Azul (derecha, ataca -x).
 */
export type TeamId = 0 | 1;
export type Phase = 'kickoff' | 'playing' | 'goal' | 'ended';
export const PHASES: Phase[] = ['kickoff', 'playing', 'goal', 'ended'];

/** Input de un jugador en un tick. `kick` es "botón mantenido". */
export interface PlayerInput {
  dx: number; // -1..1
  dy: number; // -1..1
  sprint: boolean;
  kick: boolean;
  seq: number;
}
export const NEUTRAL_INPUT: PlayerInput = { dx: 0, dy: 0, sprint: false, kick: false, seq: 0 };

export interface MatchConfig {
  mode: 1 | 2 | 3 | 4 | 5;
  /** Duración en segundos (por defecto 14 min). */
  durationSec: number;
  /** 0 = sin límite. */
  scoreLimit: number;
  overtime: 'golden' | 'none';
  /** true: el botón de patada carga potencia; false: modo clásico de un botón. */
  chargeKick: boolean;
  passAssist: boolean;
}
export const DEFAULT_CONFIG: MatchConfig = {
  mode: 3,
  durationSec: 14 * 60,
  scoreLimit: 0,
  overtime: 'golden',
  chargeKick: true,
  passAssist: false
};

export interface RenderPlayer {
  id: number;
  team: TeamId;
  slot: number;
  number: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Energía de sprint 0..100. */
  energy: number;
  /** Carga de patada 0..1. */
  charge: number;
}

export interface RenderState {
  tick: number;
  phase: Phase;
  overtime: boolean;
  /** Segundos restantes (o transcurridos en prórroga). */
  clock: number;
  score: [number, number];
  ball: { x: number; y: number; vx: number; vy: number };
  players: RenderPlayer[];
  lastGoalTeam: -1 | 0 | 1;
}

export interface SimPlayer extends RenderPlayer {
  kickHeld: boolean;
  kickCooldown: number;
  facing: number;
  lastSeq: number;
}

export interface SimBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastTouchId: number;
  prevTouchId: number;
}

export interface PlayerStats {
  goals: number;
  assists: number;
  shots: number;
  possessionTicks: number;
}

export interface SimState extends RenderState {
  config: MatchConfig;
  players: SimPlayer[];
  ball: SimBall;
  phaseTimer: number;
  kickoffTeam: TeamId;
  pendingEnd: boolean;
  stats: Record<number, PlayerStats>;
  /** -1 en juego, 0 rojo, 1 azul, 2 empate. */
  winner: -1 | 0 | 1 | 2;
}

export type SimEvent =
  | { type: 'kick'; id: number; power: number }
  | { type: 'bounce' }
  | { type: 'post' }
  | { type: 'goal'; team: TeamId; scorerId: number; assistId: number }
  | { type: 'kickoff' }
  | { type: 'overtime' }
  | { type: 'end'; winner: 0 | 1 | 2 };
