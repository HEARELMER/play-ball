/** Validación y saneamiento de nombres de usuario. Función pura, sin DOM. */
import { BLOCKED_WORDS } from '../data/blockedWords';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
const ALLOWED = /^[\p{L}\p{N} _-]+$/u;

export type UsernameError = 'empty' | 'too_short' | 'too_long' | 'invalid_chars' | 'blocked';

/** Recorta, colapsa espacios y elimina caracteres de control. Nunca devuelve HTML interpretable. */
export function sanitizeUsername(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[0@]/g, 'o').replace(/[1!]/g, 'i').replace(/3/g, 'e').replace(/[^a-z]/g, '');
}

export function validateUsername(raw: string): { ok: true; name: string } | { ok: false; error: UsernameError } {
  const name = sanitizeUsername(raw);
  if (name.length === 0) return { ok: false, error: 'empty' };
  if (name.length < USERNAME_MIN) return { ok: false, error: 'too_short' };
  if (name.length > USERNAME_MAX) return { ok: false, error: 'too_long' };
  if (!ALLOWED.test(name)) return { ok: false, error: 'invalid_chars' };
  const n = normalize(name);
  if (BLOCKED_WORDS.some(w => n.includes(normalize(w)))) return { ok: false, error: 'blocked' };
  return { ok: true, name };
}

/** Devuelve un nombre único en `taken` añadiendo sufijo `#2`, `#3`... (sin distinguir mayúsculas). */
export function uniqueUsername(name: string, taken: string[]): string {
  const set = new Set(taken.map(t => t.toLowerCase()));
  if (!set.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const suffix = `#${i}`;
    const cand = name.slice(0, USERNAME_MAX - suffix.length) + suffix;
    if (!set.has(cand.toLowerCase())) return cand;
  }
  return name.slice(0, USERNAME_MAX - 3) + '#' + String(taken.length);
}
