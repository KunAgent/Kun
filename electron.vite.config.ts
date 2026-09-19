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
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'claw-schedule-mcp-node-entry': resolve('src/main/claw-schedule-mcp-node-entry.ts'),
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
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'protected-room-dialog': resolve('src/preload/protected-room-dialog.ts'),
          'extension-view': resolve('src/preload/extension-view.ts'),
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
    build: {
      minify: 'esbuild',
      // Remote phones load this same bundle. Chrome-only syntax and Vite's
      // modulepreload wrapper both surface as Safari's
      // "Importing a module script failed."
      target: ['chrome128', 'safari16'],
      modulePreload: false,
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
