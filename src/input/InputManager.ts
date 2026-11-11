/**
 * ============================================================================
 * GESTIÓN DE ENTRADA (TECLADO + GAMEPAD + JOYSTICK VIRTUAL NIPPLEJS)
 * ============================================================================
 * Produce un `PlayerInput` por frame y soporta reasignación de teclas y sensibilidad.
 */
import nipplejs from 'nipplejs';
import type { PlayerInput } from '../sim/types';
import { DEFAULT_KEYS, type KeyBindings } from '../ui/settings';

export class InputManager {
  private pressed = new Set<string>();
  private touchVec = { x: 0, y: 0 };
  private touchSprint = false;
  private touchKick = false;
  private seq = 0;
  private bindings: KeyBindings = { ...DEFAULT_KEYS };
  private sensitivity = 1.0;
  private joystick: nipplejs.JoystickManager | null = null;
  private capturingCallback: ((code: string) => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.capturingCallback) {
        e.preventDefault();
        const cb = this.capturingCallback;
        this.capturingCallback = null;
        cb(e.code);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      this.pressed.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.pressed.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.pressed.clear();
      this.touchVec = { x: 0, y: 0 };
      this.touchSprint = false;
      this.touchKick = false;
    });
  }

  public setBindings(b: KeyBindings): void {
    this.bindings = { ...b };
  }

  public setSensitivity(s: number): void {
    this.sensitivity = Math.max(0.4, Math.min(2.0, s));
  }

  /** Captura la próxima tecla pulsada para reasignar controles. */
  public captureNextKey(cb: (code: string) => void): void {
    this.capturingCallback = cb;
  }

  /** Monta el joystick virtual (`nipplejs`) y los botones táctiles en móvil. */
  public mountTouchControls(
    joystickZone: HTMLElement | null,
    sprintBtn: HTMLElement | null,
    kickBtn: HTMLElement | null
  ): void {
    if (this.joystick) {
      this.joystick.destroy();
      this.joystick = null;
    }
    if (joystickZone) {
      this.joystick = nipplejs.create({
        zone: joystickZone,
        mode: 'static',
        position: { left: '75px', bottom: '75px' },
        color: '#38bdf8',
        size: 110
      });
      this.joystick.on('move', (_evt, data) => {
        if (data?.vector) {
          const force = Math.min(1, (data.force ?? 1) * this.sensitivity);
          this.touchVec.x = data.vector.x * force;
          this.touchVec.y = -data.vector.y * force;
        }
      });
      this.joystick.on('end', () => {
        this.touchVec.x = 0;
        this.touchVec.y = 0;
      });
    }

    const bindHold = (el: HTMLElement | null, setter: (v: boolean) => void): void => {
      if (!el) return;
      const start = (e: Event): void => { e.preventDefault(); setter(true); };
      const end = (e: Event): void => { e.preventDefault(); setter(false); };
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', end);
      el.addEventListener('mouseleave', end);
    };

    bindHold(sprintBtn, v => { this.touchSprint = v; });
    bindHold(kickBtn, v => { this.touchKick = v; });
  }

  /** Lee teclado + gamepad + táctil y devuelve el `PlayerInput` actual. */
  public sample(): PlayerInput {
    let dx = 0;
    let dy = 0;
    const b = this.bindings;

    if (this.pressed.has(b.up) || this.pressed.has('ArrowUp')) dy -= 1;
    if (this.pressed.has(b.down) || this.pressed.has('ArrowDown')) dy += 1;
    if (this.pressed.has(b.left) || this.pressed.has('ArrowLeft')) dx -= 1;
    if (this.pressed.has(b.right) || this.pressed.has('ArrowRight')) dx += 1;

    let sprint = this.pressed.has(b.sprint) || this.pressed.has('ShiftRight') || this.touchSprint;
    let kick =
      this.pressed.has(b.kick) ||
      this.pressed.has('KeyJ') ||
      this.pressed.has('Enter') ||
      this.pressed.has('KeyX') ||
      this.touchKick;

    if (Math.hypot(this.touchVec.x, this.touchVec.y) > 0.08) {
      dx = this.touchVec.x;
      dy = this.touchVec.y;
    }

    // Soporte de Gamepad estándar
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      const gp = pads?.[0];
      if (gp) {
        const gx = gp.axes[0] ?? 0;
        const gy = gp.axes[1] ?? 0;
        if (Math.hypot(gx, gy) > 0.18) {
          dx = gx * this.sensitivity;
          dy = gy * this.sensitivity;
        }
        if (gp.buttons[0]?.pressed || gp.buttons[2]?.pressed || gp.buttons[7]?.pressed) kick = true;
        if (gp.buttons[1]?.pressed || gp.buttons[5]?.pressed || gp.buttons[6]?.pressed) sprint = true;
      }
    }

    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }

    return {
      dx,
      dy,
      sprint,
      kick,
      seq: ++this.seq
    };
  }
}
