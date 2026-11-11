# Decisiones de Diseño y Arquitectura (`DECISIONS.md`)

Este documento registra las decisiones técnicas adoptadas para evolucionar **Fútbol 3D Arcade** hacia un juego multijugador online hasta 5 vs 5 estilo Haxball sobre **Bun + Vite + Three.js + PeerJS**.

---

## 1. Lenguaje y Tipado: TypeScript Estricto (`strict: true`)
- **Opciones:** JavaScript con JSDoc vs TypeScript estricto.
- **Decisión:** **TypeScript estricto**.
- **Motivo:** Al separar estrictamente `src/sim/`, `src/net/`, `src/render/` y `src/bots/`, las interfaces de estado (`SimState`, `PlayerInput`, `MatchConfig`, snapshots binarios) previenen errores de serialización y aseguran que `src/sim/` no dependa de Three.js ni del DOM.

## 2. Iluminación y Color en Three.js Moderno (r170+)
- **Contexto:** El juego original usaba Three.js `r128`, donde el manejo de color y la atenuación de luces diferían de las versiones actuales (`r155+` usa `SRGBColorSpace` e iluminación física por defecto).
- **Decisión:** Configurar `renderer.outputColorSpace = THREE.SRGBColorSpace`, marcar las texturas procedurales (`CanvasTexture`) con `texture.colorSpace = THREE.SRGBColorSpace` y ajustar ligeramente la intensidad de `AmbientLight` (0.85), `HemisphereLight` (0.6) y `DirectionalLight` (1.6) para reproducir y mejorar la calidez visual y contraste del original.

## 3. Simulación Haxball 2D Determinista + Render 3D Encima
- **Opciones:** Física 3D completa vs Física 2D de discos con proyección/altura visual 3D.
- **Decisión:** **Física 2D determinista en el plano XZ a 60 Hz (`dt = 1/60`)** en `src/sim/`, manteniendo una coordenada visual de elevación suave o bote cosmético para efectos de tiro, y renderizado 3D completo con los personajes low-poly articulados en `src/render/`.
- **Motivo:** Garantiza colisiones exactas estilo Haxball (disco-disco, disco-pared, disco-poste), paquetes de red muy pequeños, predicción cliente/reconciliación determinista y tests unitarios rápidos en `bun test`.

## 4. Protocolo de Red P2P con PeerJS (Doble Canal WebRTC)
- **Opciones:** Un solo canal JSON vs Doble canal (binario no fiable para snapshots/inputs + JSON fiable para eventos de sala).
- **Decisión:**
  - **Canal Rápido (`reliable: false`)**: Envío de `PlayerInput` desde clientes a 60 Hz y difusión de `Snapshot` desde el Host a 30 Hz codificados en `ArrayBuffer` / `DataView` compacto.
  - **Canal Fiable (`reliable: true`)**: Eventos críticos de sala (unión/salida, cambio de equipo, chat, reacciones, inicio/pausa/reinicio, evento de gol y migración/pausa de host).
- **Motivo:** Evita el *head-of-line blocking* de TCP/SCTP fiable durante micro-pérdidas de paquetes en tiempo real.

## 5. Migración de Host
- **Opciones:** Migración transparente en caliente vs Pausa inmediata con promoción automática del cliente con menor ping / opción de continuar.
- **Decisión:** Todos los clientes conocen la lista ordenada de peers y conservan el último `SimState` recibido. Si el Host se desconecta, la partida entra en pausa automática y el jugador con menor ping (o el siguiente en la lista de sala) puede asumir como nuevo Host reanudando desde el último estado sincronizado, o guardar/reiniciar el partido.

## 6. Tailwind CSS v4 Local + `@fontsource`
- **Decisión:** Uso de `@tailwindcss/vite` y paquetes locales `@fontsource/chakra-petch` y `@fontsource/inter`.
- **Motivo:** Cero dependencias de CDN externas; permite que el juego funcione 100% offline como PWA instalable.
