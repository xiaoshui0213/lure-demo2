import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    open: '/editor.html',
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        prototype: resolve(__dirname, 'prototype.html'),
        editor: resolve(__dirname, 'editor.html'),
        fishingDemo: resolve(__dirname, 'fishing-demo.html'),
        fishingSceneEditor: resolve(__dirname, 'fishing-scene-editor.html'),
      },
    },
  },
});
