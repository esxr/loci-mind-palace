import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@web': path.resolve(__dirname, 'src/web'),
    },
  },
  optimizeDeps: {
    include: ['noa-engine'],
  },
  server: {
    port: 5173,
  },
});
