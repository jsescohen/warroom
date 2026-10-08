/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: true },
      '/ws': { target: `ws://localhost:${process.env.API_PORT ?? 8787}`, ws: true },
    },
  },
  // whole-world simulations take a few seconds each
  test: { testTimeout: 30_000 },
});
