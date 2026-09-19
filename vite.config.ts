import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@appdeploy/client': fileURLToPath(new URL('./src/api.ts', import.meta.url)),
    },
  },
  build: {
    outDir: process.env.APPDEPLOY_VITE_OUT_DIR || 'dist',
    sourcemap: true,
    rollupOptions: {
      maxParallelFileOps: 128,
    },
  },
});
