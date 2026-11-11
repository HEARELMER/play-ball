import { describe, expect, test } from 'bun:test';
import { sanitizeUsername, uniqueUsername, validateUsername } from './username';
import { LobbyModel } from './lobby';
import { authorize, parseClientMsg, parseHostMsg } from './protocol';
import { decodeInput, decodeSnapshot, encodeInput, encodeSnapshot, lerpRender, snapshotToRender } from './snapshot';
import { createState, step } from '../sim/sim';
import { DEFAULT_CONFIG } from '../sim/types';

describe('username', () => {
  test('rechaza vacío, corto, largo y caracteres inválidos', () => {
    expect(validateUsername('   ')).toEqual({ ok: false, error: 'empty' });
    expect(validateUsername('ab')).toEqual({ ok: false, error: 'too_short' });
    expect(validateUsername('a'.repeat(17))).toEqual({ ok: false, error: 'too_long' });
    expect(validateUsername('<b>hola</b>')).toEqual({ ok: false, error: 'invalid_chars' });
    expect(validateUsername('x"onload=1')).toEqual({ ok: false, error: 'invalid_chars' });
  });
  test('acepta letras, números, espacios, guion y guion bajo y recorta', () => {
    expect(validateUsername('  Juan_Pérez-9  ')).toEqual({ ok: true, name: 'Juan_Pérez-9' });
    expect(sanitizeUsername('a   b')).toBe('a b');
  });
  test('filtro de insultos', () => {
    expect(validateUsername('Mierda99')).toEqual({ ok: false, error: 'blocked' });
  });
  test('sufijo para duplicados', () => {
    expect(uniqueUsername('Leo', ['leo'])).toBe('Leo#2');
    expect(uniqueUsername('Leo', ['leo', 'Leo#2'])).toBe('Leo#3');
    expect(uniqueUsername('Leo', ['Ana'])).toBe('Leo');
  });
});

function room(settings = {}) {
  let t = 0;
  const l = new LobbyModel('ABCD', { mode: 2, ...settings }, '', () => t);
  const host = l.addHuman('Host', { isHost: true });
  if (!host.ok) throw new Error('host');
  return { l, host: host.player, tick: (ms: number) => { t += ms; } };
}
function join(l: LobbyModel, name: string) {
  const r = l.addHuman(name);
  if (!r.ok) throw new Error(r.reason);
  return r.player;
}

describe('lobby', () => {
  test('entra como espectador y nombres repetidos reciben sufijo', () => {
    const { l } = room();
    const a = join(l, 'Leo');
    const b = join(l, 'leo');
    expect(a.team).toBe('spec');
    expect(b.username).toBe('leo#2');
  });
  test('nombre inválido rechazado', () => {
    const { l } = room();
    expect(l.addHuman('<script>')).toEqual({ ok: false, reason: 'invalid_name' });
    expect(l.addHuman('')).toEqual({ ok: false, reason: 'invalid_name' });
  });
  test('equipo lleno bloquea', () => {
    const { l } = room();
    const p = [join(l, 'Ana'), join(l, 'Beto'), join(l, 'Carla')];
    expect(l.changeTeam(p[0].id, 'red')).toBe('ok');
    expect(l.changeTeam(p[1].id, 'red')).toBe('ok');
    expect(l.changeTeam(p[2].id, 'red')).toBe('team_full');
    expect(l.changeTeam(p[2].id, 'blue')).toBe('ok');
  });
  test('permisos de admin: mover, expulsar, ajustes', () => {
    const { l, host } = room();
    const a = join(l, 'Ana');
    const b = join(l, 'Beto');
    expect(l.adminMove(a.id, b.id, 'red')).toBe('denied');
    expect(l.kick(a.id, b.id)).toBe('denied');
    expect(l.updateSettings(a.id, { mode: 5 })).toBe('denied');
    expect(l.adminMove(host.id, b.id, 'red')).toBe('ok');
    expect(l.get(b.id)?.team).toBe('red');
    expect(l.kick(host.id, host.id)).toBe('denied');
    expect(l.kick(host.id, a.id)).toBe('ok');
    expect(l.get(a.id)).toBeUndefined();
  });
  test('equipos bloqueados impiden cambiar a no-admin', () => {
    const { l, host } = room();
    const a = join(l, 'Ana');
    l.setLocked(host.id, true);
    expect(l.changeTeam(a.id, 'red')).toBe('locked');
    expect(l.changeTeam(host.id, 'red')).toBe('ok');
  });
  test('auto-asignar equilibra', () => {
    const { l, host } = room({ mode: 3 });
    for (const n of ['Ana', 'Beto', 'Carla', 'Dani']) join(l, n);
    expect(l.autoAssign(host.id)).toBe('ok');
    const red = l.players.filter(p => p.team === 'red').length;
    const blue = l.players.filter(p => p.team === 'blue').length;
    expect(Math.abs(red - blue)).toBeLessThanOrEqual(1);
    expect(red + blue).toBe(5);
  });
  test('bots rellenan y se retiran cuando entra un humano', () => {
    const { l, host } = room({ mode: 2, fillBots: true });
    l.changeTeam(host.id, 'red');
    expect(l.players.filter(p => p.isBot && p.team === 'red').length).toBe(1);
    expect(l.players.filter(p => p.isBot && p.team === 'blue').length).toBe(2);
    const a = join(l, 'Ana');
    l.changeTeam(a.id, 'red');
    expect(l.players.filter(p => p.isBot && p.team === 'red').length).toBe(0);
  });
  test('reconexión con el mismo nombre recupera el equipo', () => {
    const { l } = room();
    const a = join(l, 'Ana');
    l.changeTeam(a.id, 'blue');
    l.removeHuman(a.id);
    const back = join(l, 'Ana');
    expect(back.team).toBe('blue');
    expect(back.username).toBe('Ana');
  });
  test('contraseña y sala llena', () => {
    const l = new LobbyModel('ABCD', { maxPlayers: 2 }, 'clave');
    expect(l.addHuman('Host', { isHost: true })).toMatchObject({ ok: true });
    expect(l.addHuman('Ana', { password: 'mal' })).toEqual({ ok: false, reason: 'password' });
    expect(l.addHuman('Ana', { password: 'clave' })).toMatchObject({ ok: true });
    expect(l.addHuman('Beto', { password: 'clave' })).toEqual({ ok: false, reason: 'full' });
    expect(JSON.stringify(l.toState())).not.toContain('clave');
  });
  test('chat: antispam, tamaño máximo y silencio', () => {
    const { l, host, tick } = room();
    const a = join(l, 'Ana');
    expect(l.chat(a.id, 'hola').result).toBe('ok');
    expect(l.chat(a.id, 'x'.repeat(500)).text?.length).toBe(200);
    expect(l.chat(a.id, 'tres').result).toBe('ok');
    expect(l.chat(a.id, 'cuatro').result).toBe('rate');
    tick(6000);
    expect(l.chat(a.id, 'ok').result).toBe('ok');
    l.mute(host.id, a.id, true);
    expect(l.chat(a.id, 'hola').result).toBe('muted');
    expect(l.chat(a.id, '   ').result).not.toBe('ok');
  });
  test('reducir el modo manda sobrantes a espectador', () => {
    const { l, host } = room({ mode: 3 });
    const ps = ['Ana', 'Beto', 'Carla'].map(n => join(l, n));
    ps.forEach(p => l.adminMove(host.id, p.id, 'red'));
    l.updateSettings(host.id, { mode: 1 });
    expect(l.players.filter(p => p.team === 'red').length).toBe(1);
  });
});

describe('protocolo', () => {
  test('rechaza mensajes mal formados', () => {
    expect(parseClientMsg(null)).toBeNull();
    expect(parseClientMsg('hola')).toBeNull();
    expect(parseClientMsg({ t: 'nope' })).toBeNull();
    expect(parseClientMsg({ t: 'change_team', team: 'verde' })).toBeNull();
    expect(parseClientMsg({ t: 'chat', text: 'x'.repeat(1000) })).toBeNull();
    expect(parseClientMsg({ t: 'kick', targetId: -1 })).toBeNull();
    expect(parseClientMsg({ t: 'update_settings', settings: { mode: 99 } })).toBeNull();
    expect(parseClientMsg({ t: 'join_request', username: 5 })).toBeNull();
    expect(parseHostMsg({ t: 'lobby_state', lobby: 3 })).toBeNull();
  });
  test('acepta mensajes válidos y filtra ajustes', () => {
    expect(parseClientMsg({ t: 'change_team', team: 'red' })).toEqual({ t: 'change_team', team: 'red' });
    const m = parseClientMsg({ t: 'update_settings', settings: { mode: 4, durationSec: 600, hasPassword: true } });
    expect(m).toEqual({ t: 'update_settings', settings: { mode: 4, durationSec: 600 } });
  });
  test('jugadores sin permisos no pueden usar mensajes de admin', () => {
    const kick = parseClientMsg({ t: 'kick', targetId: 2 })!;
    const start = parseClientMsg({ t: 'start_match' })!;
    const chat = parseClientMsg({ t: 'chat', text: 'hola' })!;
    expect(authorize(kick, false)).toBe(false);
    expect(authorize(start, false)).toBe(false);
    expect(authorize(kick, true)).toBe(true);
    expect(authorize(chat, false)).toBe(true);
  });
});

describe('binario', () => {
  test('input ida y vuelta', () => {
    const d = decodeInput(encodeInput({ dx: 1, dy: -0.5, sprint: true, kick: false, seq: 123456 }))!;
    expect(d.seq).toBe(123456);
    expect(d.dx).toBeCloseTo(1, 1);
    expect(d.dy).toBeCloseTo(-0.5, 1);
    expect(d.sprint).toBe(true);
    expect(d.kick).toBe(false);
    expect(decodeInput(new ArrayBuffer(3))).toBeNull();
  });
  test('snapshot ida y vuelta + interpolación', () => {
    const s = createState({ ...DEFAULT_CONFIG, mode: 2 }, [
      { id: 1, team: 0, number: 7 }, { id: 2, team: 1, number: 9 }
    ]);
    while (s.phase === 'kickoff') step(s, {});
    s.ball.x = 3.5; s.ball.vx = 2;
    const snap = decodeSnapshot(encodeSnapshot(s, true, [{ type: 1, a: 1, b: 200 }]))!;
    expect(snap.tick).toBe(s.tick);
    expect(snap.phase).toBe('playing');
    expect(snap.paused).toBe(true);
    expect(snap.players.length).toBe(2);
    expect(snap.players[1].number).toBe(9);
    expect(snap.ball.x).toBeCloseTo(3.5);
    expect(snap.events[0]).toEqual({ type: 1, a: 1, b: 200 });
    const a = snapshotToRender(snap);
    const b = { ...a, ball: { ...a.ball, x: 5.5 } };
    expect(lerpRender(a, b, 0.5).ball.x).toBeCloseTo(4.5);
    expect(decodeSnapshot(new ArrayBuffer(5))).toBeNull();
  });
});
