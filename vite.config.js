import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // firebase-admin is server-only (Admin SDK). It must never be bundled
      // into the browser/Electron client bundle.
      external: ['firebase-admin'],
    },
  },
  define: {
    global: 'globalThis',
  },
});
