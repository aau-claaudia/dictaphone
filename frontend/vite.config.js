import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // make development server accessible from the wireless network, for testing on mobile device
    proxy: {
      // Proxy WebSocket connections to the Daphne server
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true, // This is crucial for WebSocket proxying
      },
      // Proxy media file requests to the Django/Daphne server.
      // Match any URL that contains '/media/RECORDINGS/'
      '^.*(/media/RECORDINGS/.*)$': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // This is the folder where the build will be generated
    outDir: 'build',
    // This is the folder where the assets will be generated
    assetsDir: 'static',
    // This is the base url of the assets
    // It should match Django's STATIC_URL
    base: '/static/',
  }
});