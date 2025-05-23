import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/todo-makethis-work': {
        target: 'http://localhost:8000', // Django backend
        changeOrigin: true,
        secure: false, // Set to true if using HTTPS
      },
    },
  },
});