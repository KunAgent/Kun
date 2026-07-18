import { defineConfig } from 'vite'

export default defineConfig({
  ssr: {
    // A .kunx Host entry must be standalone. Repository workspace packages are
    // not installed beside an unpacked extension, so bundle the public SDK and
    // its runtime validator while leaving Node built-ins external.
    noExternal: ['@kun/extension-api', 'zod']
  },
  build: {
    target: 'node20',
    ssr: 'src/host/extension.ts',
    outDir: 'dist/host',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'extension.js'
      }
    }
  }
})
