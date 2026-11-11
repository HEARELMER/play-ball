/**
 * Ajustes locales persistidos en localStorage: volumen, calidad gráfica, sensibilidad y teclas.
 */
export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface KeyBindings {
  up: string;
  down: string;
  left: string;
  right: string;
  sprint: string;
  kick: string;
}

export interface UserSettings {
  username: string;
  jerseyNumber: number;
  avatarColor: string;
  volume: number;
  muted: boolean;
  quality: GraphicsQuality;
  sensitivity: number;
  keys: KeyBindings;
}

const STORAGE_KEY = 'fb3d_user_settings_v1';

export function detectDefaultQuality(): GraphicsQuality {
  if (typeof navigator === 'undefined') return 'high';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return isMobile ? 'medium' : 'high';
}

export const DEFAULT_KEYS: KeyBindings = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  kick: 'Space'
};

export function loadUserSettings(): UserSettings {
  const defaults: UserSettings = {
    username: 'Jugador',
    jerseyNumber: 10,
    avatarColor: '#3b82f6',
    volume: 0.8,
    muted: false,
    quality: detectDefaultQuality(),
    sensitivity: 1.0,
    keys: { ...DEFAULT_KEYS }
  };
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      ...defaults,
      ...parsed,
      keys: { ...DEFAULT_KEYS, ...(parsed.keys ?? {}) }
    };
  } catch {
    return defaults;
  }
}

export function saveUserSettings(s: UserSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* ignore quota */ }
}

export function formatKeyCode(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('ShiftLeft', 'Shift')
    .replace('ShiftRight', 'R-Shift')
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→');
}
