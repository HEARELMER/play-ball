import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fútbol 3D Online - Arcade Haxball 5v5',
        short_name: 'Fútbol 3D',
        description: 'Juego de fútbol 3D multijugador online hasta 5v5 estilo Haxball con PeerJS',
        theme_color: '#090d16',
        background_color: '#090d16',
        display: 'fullscreen',
        orientation: 'landscape'
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff,woff2}']
      }
    })
  ],
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 750
  }
});
