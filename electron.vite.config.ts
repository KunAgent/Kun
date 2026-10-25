import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

function copyExcalidrawAssets(): void {
  const from = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
  const to = resolve('src/renderer/public/excalidraw/fonts')
  if (!existsSync(from)) return
  mkdirSync(resolve('src/renderer/public/excalidraw'), { recursive: true })
  cpSync(from, to, { recursive: true })
}

function excalidrawAssetsPlugin() {
  return {
    name: 'copy-excalidraw-assets',
    buildStart() {
      copyExcalidrawAssets()
    },
    configureServer() {
      copyExcalidrawAssets()
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // electron-vite disables minification by default; enable esbuild so the
      // shipped main-process bundle is smaller without touching externals.
      minify: 'esbuild',
      // Per-chunk gzip reporting costs heap on large builds and the desktop
      // package never consumes the numbers.
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'claw-schedule-mcp-node-entry': resolve('src/main/claw-schedule-mcp-node-entry.ts'),
          'canvas-mcp-node-entry': resolve('src/main/canvas-mcp/canvas-mcp-node-entry.ts'),
          'assistant-mcp-node-entry': resolve('src/main/assistant-mailbox/mcp-node-entry.ts'),
          // sanoTTS WASM inference blocks its JS thread, so it runs on a worker.
          'local-sanotts-worker-entry': resolve('src/main/services/local-sanotts-worker-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: 'esbuild',
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'protected-room-dialog': resolve('src/preload/protected-room-dialog.ts'),
          'extension-view': resolve('src/preload/extension-view.ts'),
          'app-sandbox-shell': resolve('src/preload/app-sandbox-shell.ts'),
          'extension-protected-surface': resolve('src/preload/extension-protected-surface.ts'),
          'storage-relocation-recovery': resolve('src/preload/storage-relocation-recovery.ts'),
          'runtime-data-recovery': resolve('src/preload/runtime-data-recovery.ts'),
          'tray-quota': resolve('src/preload/tray-quota.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    server: {
      host: '127.0.0.1'
    },
    worker: {
      // The Excel parser worker is split into chunks, which Vite's default IIFE
      // worker output cannot express.
      format: 'es'
    },
    optimizeDeps: {
      // The Office viewers start their parsers with `new Worker(new URL(...))`, which
      // the dependency pre-bundler breaks in dev. They are served as they are; only
      // the CommonJS packages beneath them are pre-bundled.
      exclude: ['@extend-ai/react-docx', '@extend-ai/react-pptx', '@extend-ai/react-xlsx'],
      include: [
        'react-dom/server',
        '@extend-ai/react-docx > utif',
        '@extend-ai/react-docx > fast-png',
        '@extend-ai/react-pptx > regl',
        '@extend-ai/react-pptx > topojson-client',
        '@extend-ai/react-xlsx > regl',
        '@extend-ai/react-xlsx > topojson-client'
      ]
    },
    build: {
      minify: 'esbuild',
      // Remote phones load this same bundle. Chrome-only syntax and Vite's
      // modulepreload wrapper both surface as Safari's
      // "Importing a module script failed."
      target: ['chrome128', 'safari16'],
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'tray-quota': resolve('src/renderer/tray-quota.html')
        }
      }
    },
    plugins: [react(), excalidrawAssetsPlugin()]
  }
})
