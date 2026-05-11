import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: true, // bind to 0.0.0.0 so the local-network IP works
    proxy: {
      '/session': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
      '/signal': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
