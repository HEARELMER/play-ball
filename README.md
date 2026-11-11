# ⚽ Fútbol 3D Online — Arcade Haxball 5v5 (PeerJS + Three.js + Bun)

Juego de fútbol 3D arcade multijugador online **de hasta 5 vs 5 estilo Haxball**, construido como sitio estático sin servidor propio de juego (topología **Host autoritativo P2P** sobre WebRTC DataChannels con **PeerJS**).

---

## 🚀 Requisitos y Comandos (`Bun`)

Este proyecto utiliza **exclusivamente [Bun](https://bun.sh)** como gestor de paquetes, runtime y test runner.

```bash
# 1. Instalar dependencias
bun install

# 2. Servidor de desarrollo (Vite)
bun run dev

# 3. Ejecutar suite de pruebas unitarias (simulación determinista, lobby, protocolo y binario)
bun test

# 4. Compilar versión de producción estática en dist/
bun run build

# 5. Previsualizar compilación de producción
bun run preview
```

---

## 🏗️ Arquitectura del Proyecto (`src/`)

Separación estricta entre simulación, renderizado, red, bots, entrada e interfaz:

```text
src/
  sim/        Simulación 2D pura y determinista a 60 Hz (SIN Three.js, SIN DOM, SIN red).
  render/     Three.js: estadio con InstancedMesh, jugadores low-poly, balón, estela, partículas y repetición.
  net/        PeerJS: HostSession, ClientSession, protocolo validado, snapshots binarios, interpolación y predicción.
  bots/       IA determinista adaptable de 1v1 a 5v5 (portero, perseguidor y apoyo).
  ui/         Pantalla de inicio, Lobby de 3 columnas estilo Haxball, HUD, chat, estadísticas y ajustes.
  audio/      Sintetizador Web Audio API (cero archivos externos) con control de volumen maestro.
  input/      Teclado reasignable, Gamepad estándar y joystick virtual táctil (nipplejs).
  data/       Lista editable de palabras filtradas para nombres de usuario.
  main.ts     Punto de entrada y máquina de estados.
```

---

## 🎮 Controles

| Acción | Teclado (por defecto, reasignable) | Móvil / Táctil | Gamepad |
| :--- | :--- | :--- | :--- |
| **Moverse** | `W` `A` `S` `D` o Flechas | Joystick izquierdo (`nipplejs`) | Stick izquierdo |
| **Sprint** | `Shift` | Botón `SPRINT` | `B` / `RB` / `LT` |
| **Patada / Tiro cargado** | `Espacio` / `J` / `Enter` | Botón `PATADA` | `A` / `X` / `RT` |

---

## 🌐 Configuración TURN Opcional (Variables de Entorno)

Por defecto se utilizan servidores STUN públicos. Para redes simétricas estrictas puedes definir un servidor TURN mediante variables de entorno en `.env` o en el panel de Cloudflare Pages (sin guardar secretos en el repositorio):

```env
VITE_TURN_URL=turn:tu-servidor-turn.ejemplo.com:3478
VITE_TURN_USER=usuario_turn
VITE_TURN_PASS=secreto_turn
```

---

## ☁️ Despliegue en Cloudflare Pages

1. Sube este repositorio a **GitHub** o **GitLab**.
2. Entra en el panel de **Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git**.
3. Selecciona el repositorio y configura el paso de compilación:
   - **Framework preset:** `Vite`
   - **Build command:** `bun run build`
   - **Build output directory:** `dist`
4. *(Opcional)* En **Environment variables**, añade `VITE_TURN_URL`, `VITE_TURN_USER` y `VITE_TURN_PASS` si dispones de un servidor TURN propio.
5. Pulsa **Save and Deploy**. Cada push generará automáticamente el sitio estático con soporte PWA offline.
