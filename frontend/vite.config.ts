import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The back end the dev server talks to. Default: one running locally on :8000.
// To build against the deployed server instead (no local back end needed):
//   API_TARGET=https://callback.denishoti.dev npm run dev
const apiTarget = process.env.API_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: ['.trycloudflare.com'], // quick tunnels, if ever needed
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, secure: true },
    },
  },
});
