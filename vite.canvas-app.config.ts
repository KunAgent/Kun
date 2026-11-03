import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Page of the built-in canvas MCP App. It is served to the app sandbox as
 * `ui://kun-canvas/*` resources by the canvas MCP server, so asset URLs stay
 * relative. Excalidraw fonts are not copied: the server reuses the renderer's
 * existing font directory.
 */
export default defineConfig({
  root: resolve('src/canvas-app'),
  base: './',
  plugins: [react()],
  define: {
    'process.env.IS_PREACT': JSON.stringify('false')
  },
  build: {
    outDir: resolve('out/canvas-app'),
    emptyOutDir: true,
    target: ['chrome128'],
    modulePreload: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 8_000,
    sourcemap: false
  }
})
