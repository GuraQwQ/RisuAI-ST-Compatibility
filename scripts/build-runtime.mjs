import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({ root, configFile: false, publicDir: false, build: {
  outDir: 'dist', emptyOutDir: false, minify: true, target: 'es2022',
  lib: { entry: fileURLToPath(new URL('../packages/runtime/frame-libraries.mjs', import.meta.url)),
    formats: ['iife'], name: 'STCompatibilityFrame', fileName: () => 'runtime-frame.js' },
} });
await build({ root, configFile: false, publicDir: false, build: {
  outDir: 'dist', emptyOutDir: false, minify: false, target: 'es2022',
  lib: { entry: fileURLToPath(new URL('../packages/runtime/page.mjs', import.meta.url)),
    formats: ['iife'], name: 'STCompatibilityPage', fileName: () => 'runtime-page.js' },
} });
