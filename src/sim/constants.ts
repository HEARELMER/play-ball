/**
 * ============================================================================
 * CONSTANTES DE LA CANCHA Y FÍSICAS
 * ============================================================================
 */
export const PITCH_WIDTH = 64;        // Eje X: de -32 a +32
export const PITCH_HEIGHT = 40;       // Eje Z: de -20 a +20
export const HALF_W = PITCH_WIDTH / 2;
export const HALF_H = PITCH_HEIGHT / 2;

export const GOAL_WIDTH = 9.4;        // Apertura de portería en eje Z
export const GOAL_HEIGHT = 3.6;       // Altura del travesaño en eje Y
export const GOAL_DEPTH = 3.2;        // Profundidad de la red

export const BALL_RADIUS = 0.58;
export const GRAVITY = 24.0;
export const GRASS_FRICTION = 2.65;   // Desaceleración por fricción en césped
export const AIR_DRAG = 0.32;
export const BOUNCE_DAMPING = 0.68;

export const PLAYER_RADIUS = 0.85;
export const STEAL_COOLDOWN_TIME = 0.85; // Segundos de inmunidad/bloqueo tras robo


// --- Simulación 2D estilo Haxball (Fase 3) ---
export const SIM_DT = 1 / 60;
export const RUN_SPEED = 11;
export const SPRINT_SPEED = 15.5;
export const ACCEL = 10;
export const ENERGY_DRAIN = 30;
export const ENERGY_REGEN = 15;
export const PLAYER_MASS = 2;
export const BALL_MASS = 1;
export const BALL_DAMP = 0.45; // factor de velocidad restante por segundo
export const BALL_MAX_SPEED = 60;
export const POST_RADIUS = 0.22;
export const KICK_REACH = 0.55;
export const KICK_COOLDOWN = 0.2;
export const CHARGE_TIME = 0.6;
export const KICKOFF_TIME = 1.5;
export const GOAL_PAUSE = 4.5;
