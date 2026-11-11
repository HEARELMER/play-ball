/**
 * IA de bots sobre la simulación 2D. Pura y determinista (sin Math.random).
 * Rol según puesto: slot 0 = portero (si hay 2+ por equipo). Adaptada de la IA original
 * (portero que sigue el balón y despeja, perseguidor que conduce hacia puerta, apoyo en formación).
 */
import { BALL_RADIUS, GOAL_WIDTH, HALF_W, PLAYER_RADIUS } from '../sim/constants';
import { formationPos } from '../sim/sim';
import { NEUTRAL_INPUT, type PlayerInput, type SimPlayer, type SimState } from '../sim/types';

const REACH = PLAYER_RADIUS + BALL_RADIUS + 0.45;

function toward(p: SimPlayer, tx: number, ty: number, stop = 0.4): { dx: number; dy: number; dist: number } {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist < stop) return { dx: 0, dy: 0, dist };
  return { dx: dx / dist, dy: dy / dist, dist };
}

export function botInput(s: SimState, id: number): PlayerInput {
  const me = s.players.find(p => p.id === id);
  if (!me || s.phase === 'ended') return NEUTRAL_INPUT;
  const b = s.ball;
  const dir = me.team === 0 ? 1 : -1;
  const ownGoalX = -dir * HALF_W;
  const enemyGoalX = dir * HALF_W;
  const size = s.config.mode;
  const isGk = size >= 2 && me.slot === 0;
  const distBall = Math.hypot(b.x - me.x, b.y - me.y);
  // Pulso de patada: mantiene ~10 ticks y suelta (carga) o pulsa (modo clásico)
  const pulse = s.tick % 24 < 12;

  if (isGk) {
    const maxY = GOAL_WIDTH / 2 - 1.2;
    let tx = ownGoalX + dir * 2.5;
    const ty = Math.max(-maxY, Math.min(maxY, b.y * 0.7));
    const ballNear = Math.abs(b.x - ownGoalX) < 11;
    if (ballNear) tx = ownGoalX + dir * (2.5 + Math.min(4, Math.abs(b.x - ownGoalX) * 0.25));
    const m = toward(me, tx, ty);
    if (distBall < 6 && ballNear) {
      const c = toward(me, b.x, b.y, 0.1);
      return { dx: c.dx, dy: c.dy, sprint: false, kick: distBall < REACH && pulse, seq: 0 };
    }
    return { dx: m.dx, dy: m.dy, sprint: false, kick: false, seq: 0 };
  }

  // ¿Soy el compañero de campo más cercano al balón?
  let chaser = true;
  for (const m of s.players) {
    if (m.team !== me.team || m.id === me.id) continue;
    if (size >= 2 && m.slot === 0) continue;
    const d = Math.hypot(b.x - m.x, b.y - m.y);
    if (d < distBall - 0.01 || (Math.abs(d - distBall) <= 0.01 && m.id < me.id)) { chaser = false; break; }
  }

  if (chaser) {
    // Punto detrás del balón respecto a la puerta rival
    const gx = enemyGoalX - b.x;
    const gy = -b.y * 0.4;
    const gl = Math.hypot(gx, gy) || 1;
    const back = PLAYER_RADIUS + BALL_RADIUS + 0.2;
    const px = b.x - (gx / gl) * back;
    const py = b.y - (gy / gl) * back;
    const aligned = ((b.x - me.x) * gx + (b.y - me.y) * gy) / ((distBall || 1) * gl) > 0.55;
    const target = aligned || distBall < 2.2 ? { x: b.x, y: b.y } : { x: px, y: py };
    const m = toward(me, target.x, target.y, 0.1);
    return {
      dx: m.dx, dy: m.dy,
      sprint: me.energy > 30 && m.dist > 6,
      kick: aligned && distBall < REACH && pulse,
      seq: 0
    };
  }

  // Apoyo: formación desplazada hacia el balón
  const f = formationPos(me.team, me.slot, size);
  const tx = Math.max(-HALF_W + 6, Math.min(HALF_W - 6, f.x + b.x * 0.45));
  const ty = f.y * 0.8 + b.y * 0.2;
  const m = toward(me, tx, ty, 1);
  return { dx: m.dx, dy: m.dy, sprint: false, kick: false, seq: 0 };
}
