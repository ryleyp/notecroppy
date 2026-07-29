import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deployed as a GitHub Pages *project* site at https://<user>.github.io/notecroppy/,
// so production assets need that base. Dev stays at / for a simpler local URL.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/notecroppy/' : '/',
  plugins: [react()],
  server: {
    port: 5273,
  },
}));
