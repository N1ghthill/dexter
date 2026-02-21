import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main/main.ts', 'src/main/preload.ts'],
  outDir: 'dist/main',
  format: ['cjs'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: false,
  splitting: false,
  external: ['electron']
});
