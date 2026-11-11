import { describe, expect, test } from 'bun:test';
import { BALL_RADIUS, HALF_W, HALF_H, PLAYER_RADIUS } from './constants';
import { DT, addPlayer, createState, removePlayer, step, stepPlayerSolo } from './sim';
import { DEFAULT_CONFIG, NEUTRAL_INPUT, type PlayerInput, type SimState } from './types';

const cfg = { ...DEFAULT_CONFIG, mode: 1 as const, durationSec: 5 };
const mk = (): SimState => createState(cfg, [{ id: 1, team: 0, number: 7 }, { id: 2, team: 1, number: 9 }]);
const inp = (o: Partial<PlayerInput>): PlayerInput => ({ ...NEUTRAL_INPUT, ...o });

function playing(s: SimState): void {
  while (s.phase === 'kickoff') step(s, {});
}

describe('sim', () => {
  test('arranca en kickoff y pasa a playing', () => {
    const s = mk();
    expect(s.phase).toBe('kickoff');
    playing(s);
    expect(s.phase).toBe('playing');
  });

  test('colisión disco-disco separa jugadores', () => {
    const s = mk();
    playing(s);
    s.players[0].x = 0; s.players[0].y = 5; s.players[1].x = 0.5; s.players[1].y = 5;
    step(s, {});
    const d = Math.hypot(s.players[0].x - s.players[1].x, s.players[0].y - s.players[1].y);
    expect(d).toBeGreaterThanOrEqual(PLAYER_RADIUS * 2 - 1e-6);
  });

  test('disco-pared: el balón rebota y no sale del campo', () => {
    const s = mk();
    playing(s);
    s.ball.x = 10; s.ball.y = HALF_H - BALL_RADIUS - 0.1; s.ball.vy = 30;
    for (let i = 0; i < 10; i++) step(s, {});
    expect(s.ball.vy).toBeLessThan(0);
    expect(Math.abs(s.ball.y)).toBeLessThanOrEqual(HALF_H);
  });

  test('disco-poste: el balón rebota en el poste', () => {
    const s = mk();
    playing(s);
    s.ball.x = HALF_W - 3; s.ball.y = 4.7; s.ball.vx = 30; s.ball.vy = 0;
    let bounced = false;
    for (let i = 0; i < 40; i++) { step(s, {}); if (s.ball.vx < 0) bounced = true; }
    expect(bounced).toBe(true);
    expect(s.score[0] + s.score[1]).toBe(0);
  });

  test('gol: marcador, fase goal y saque del rival', () => {
    const s = mk();
    playing(s);
    s.ball.x = HALF_W - 1; s.ball.y = 0; s.ball.vx = 40; s.ball.lastTouchId = 1;
    const ev = [];
    for (let i = 0; i < 30; i++) ev.push(...step(s, {}));
    expect(s.score).toEqual([1, 0]);
    expect(s.phase).toBe('goal');
    expect(s.kickoffTeam).toBe(1);
    expect(s.stats[1].goals).toBe(1);
    expect(ev.some(e => e.type === 'goal')).toBe(true);
  });

  test('saque tras gol: reposiciona y vuelve a jugar', () => {
    const s = mk();
    playing(s);
    s.ball.x = -HALF_W + 1; s.ball.vx = -40; s.ball.lastTouchId = 2;
    for (let i = 0; i < 600 && s.phase !== 'playing' || s.score[1] === 0 && i < 600; i++) {
      step(s, {});
      if (s.phase === 'kickoff') break;
    }
    expect(s.phase).toBe('kickoff');
    expect(s.ball.x).toBe(0);
    expect(s.ball.vx).toBe(0);
    playing(s);
    expect(s.phase).toBe('playing');
  });

  test('reloj: descuenta y termina el partido', () => {
    const s = createState({ ...cfg, durationSec: 1, overtime: 'none' }, [{ id: 1, team: 0, number: 1 }]);
    s.score = [1, 0];
    for (let i = 0; i < 200 && s.phase !== 'ended'; i++) step(s, {});
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe(0);
  });

  test('empate con gol de oro entra en prórroga y el siguiente gol gana', () => {
    const s = createState({ ...cfg, durationSec: 1 }, [{ id: 1, team: 0, number: 1 }]);
    for (let i = 0; i < 200 && !s.overtime; i++) step(s, {});
    expect(s.overtime).toBe(true);
    s.ball.x = HALF_W - 1; s.ball.vx = 40; s.ball.lastTouchId = 1;
    for (let i = 0; i < 600 && s.phase !== 'ended'; i++) step(s, {});
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe(0);
  });

  test('límite de goles termina el partido', () => {
    const s = createState({ ...cfg, scoreLimit: 1, durationSec: 600 }, [{ id: 1, team: 0, number: 1 }]);
    playing(s);
    s.ball.x = HALF_W - 1; s.ball.vx = 40; s.ball.lastTouchId = 1;
    for (let i = 0; i < 600 && s.phase !== 'ended'; i++) step(s, {});
    expect(s.phase).toBe('ended');
  });

  test('energía de sprint: se consume y se recupera', () => {
    const s = mk();
    playing(s);
    const p = s.players[0];
    for (let i = 0; i < 60; i++) step(s, { 1: inp({ dx: 1, sprint: true }) });
    expect(p.energy).toBeLessThan(80);
    const low = p.energy;
    for (let i = 0; i < 120; i++) step(s, { 1: inp({ dx: 0 }) });
    expect(p.energy).toBeGreaterThan(low);
    expect(p.energy).toBeLessThanOrEqual(100);
  });

  test('sprint es más rápido que correr', () => {
    const a = mk(); const b = mk();
    playing(a); playing(b);
    for (let i = 0; i < 40; i++) {
      step(a, { 1: inp({ dx: 1, sprint: true }) });
      step(b, { 1: inp({ dx: 1 }) });
    }
    expect(a.players[0].x).toBeGreaterThan(b.players[0].x);
  });

  test('patada con carga: más carga = más potencia', () => {
    const run = (hold: number): number => {
      const s = mk();
      playing(s);
      s.players[0].x = 0; s.players[0].y = 0; s.ball.x = 1.6; s.ball.y = 0;
      for (let i = 0; i < hold; i++) step(s, { 1: inp({ kick: true }) });
      step(s, { 1: inp({ kick: false }) });
      return s.ball.vx;
    };
    expect(run(36)).toBeGreaterThan(run(2));
  });

  test('modo clásico: patada inmediata al pulsar', () => {
    const s = createState({ ...cfg, chargeKick: false }, [{ id: 1, team: 0, number: 1 }]);
    playing(s);
    s.players[0].x = 0; s.players[0].y = 0; s.ball.x = 1.6; s.ball.y = 0;
    step(s, { 1: inp({ kick: true }) });
    expect(s.ball.vx).toBeGreaterThan(20);
  });

  test('add/remove jugador mantiene puestos', () => {
    const s = mk();
    addPlayer(s, { id: 3, team: 0, number: 3 });
    expect(s.players.find(p => p.id === 3)?.slot).toBe(1);
    removePlayer(s, 3);
    expect(s.players.length).toBe(2);
  });

  test('stepPlayerSolo no sale del campo', () => {
    const s = mk();
    const p = s.players[0];
    for (let i = 0; i < 600; i++) stepPlayerSolo(p, inp({ dx: -1, dy: -1 }));
    expect(p.x).toBeGreaterThanOrEqual(-HALF_W);
    expect(p.y).toBeGreaterThanOrEqual(-HALF_H);
  });

  test('determinismo: misma secuencia de inputs => mismo estado', () => {
    const run = (): string => {
      const s = createState({ ...DEFAULT_CONFIG, mode: 2 }, [
        { id: 1, team: 0, number: 1 }, { id: 2, team: 0, number: 2 },
        { id: 3, team: 1, number: 3 }, { id: 4, team: 1, number: 4 }
      ]);
      for (let t = 0; t < 1500; t++) {
        const k = t * DT;
        step(s, {
          1: inp({ dx: Math.cos(k), dy: Math.sin(k * 1.3), sprint: t % 90 < 30, kick: t % 50 < 20 }),
          2: inp({ dx: Math.sin(k), dy: -0.5, kick: t % 70 < 10 }),
          3: inp({ dx: -1, dy: Math.cos(k * 2), sprint: true }),
          4: inp({ dx: -Math.sin(k), dy: 0.3, kick: t % 40 < 5 })
        });
      }
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});
