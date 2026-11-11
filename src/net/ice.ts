/**
 * Configuración ICE: STUN públicos + TURN opcional por variables de entorno de Vite
 * (VITE_TURN_URL, VITE_TURN_USER, VITE_TURN_PASS). Sin secretos en el repositorio.
 */
export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ];
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  if (env.VITE_TURN_URL) {
    servers.push({ urls: env.VITE_TURN_URL.split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  }
  return servers;
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomRoomCode(len = 5): string {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, n => LETTERS[n % LETTERS.length]).join('');
}

export const peerIdFor = (code: string): string => `fb3d-${code.toUpperCase()}`;

export function normalizeRoomCode(raw: string): string {
  let s = raw.trim();
  try {
    const u = new URL(s);
    s = u.searchParams.get('room') ?? s;
  } catch { /* no es una URL */ }
  return s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
}
