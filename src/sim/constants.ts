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
