import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer')
    }
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
