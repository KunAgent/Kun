import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/webview',
  base: './',
  esbuild: { jsx: 'automatic' },
  css: { postcss: { plugins: [] } },
  build: {
    target: 'es2022',
    outDir: '../../dist/webview',
    emptyOutDir: true
  }
})
