/**
 * ============================================================================
 * GESTIÓN DE ENTRADA (TECLADO + BOTONES TÁCTILES)
 * ============================================================================
 */
export interface KeyState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  shootHold: boolean;
}

export interface InputCallbacks {
  onPassOrTackle: () => void;
  onShootRelease: () => void;
  onSwitchPlayer: () => void;
  onStartChargingShot: () => void;
}

export class InputManager {
  public keys: KeyState = {
    up: false,
    down: false,
    left: false,
    right: false,
    sprint: false,
    shootHold: false
  };

  constructor(callbacks: InputCallbacks) {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') this.keys.up = true;
      if (code === 'KeyS' || code === 'ArrowDown') this.keys.down = true;
      if (code === 'KeyA' || code === 'ArrowLeft') this.keys.left = true;
      if (code === 'KeyD' || code === 'ArrowRight') this.keys.right = true;
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys.sprint = true;

      if (code === 'Space' && !e.repeat) {
        e.preventDefault();
        callbacks.onPassOrTackle();
      }

      if ((code === 'KeyJ' || code === 'Enter') && !e.repeat) {
        e.preventDefault();
        this.keys.shootHold = true;
        callbacks.onStartChargingShot();
      }

      if (code === 'KeyQ' && !e.repeat) {
        e.preventDefault();
        callbacks.onSwitchPlayer();
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') this.keys.up = false;
      if (code === 'KeyS' || code === 'ArrowDown') this.keys.down = false;
      if (code === 'KeyA' || code === 'ArrowLeft') this.keys.left = false;
      if (code === 'KeyD' || code === 'ArrowRight') this.keys.right = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.keys.sprint = false;

      if (code === 'KeyJ' || code === 'Enter') {
        this.keys.shootHold = false;
        callbacks.onShootRelease();
      }
    });

    // Controles táctiles auxiliares
    const btnSwitch = document.getElementById('touch-switch');
    const btnPass = document.getElementById('touch-pass');
    const btnSprint = document.getElementById('touch-sprint');
    const btnShoot = document.getElementById('touch-shoot');

    btnSwitch?.addEventListener('click', () => callbacks.onSwitchPlayer());
    btnPass?.addEventListener('click', () => callbacks.onPassOrTackle());

    btnSprint?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.keys.sprint = true;
    });
    btnSprint?.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.keys.sprint = false;
    });

    btnShoot?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.keys.shootHold = true;
      callbacks.onStartChargingShot();
    });
    btnShoot?.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.keys.shootHold = false;
      callbacks.onShootRelease();
    });
  }
}
