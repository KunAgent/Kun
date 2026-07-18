import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'node20',
    outDir: 'dist/host',
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('src/host/extension.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'extension.js'
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
})
