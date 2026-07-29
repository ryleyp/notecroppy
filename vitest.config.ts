import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: vitest resolves its own copy of vite, and
// sharing one config file makes the two sets of plugin types collide.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
