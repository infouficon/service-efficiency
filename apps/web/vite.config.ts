import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * H-39: part of every built file name. Bump it when Cloudflare holds a bad copy of an asset URL (a 404 cached during a rolling
 * deploy): every file then gets a name Cloudflare has never seen. g2 = 2026-11-05 (index-DVDPg1Dr.js was a cached 404).
 */
const ASSET_GENERATION = 'g2';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${ASSET_GENERATION}.js`,
        chunkFileNames: `assets/[name]-[hash]-${ASSET_GENERATION}.js`,
        assetFileNames: `assets/[name]-[hash]-${ASSET_GENERATION}[extname]`,
      },
    },
  },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
});
