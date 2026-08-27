import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'claw-schedule-mcp-node-entry': resolve('src/main/claw-schedule-mcp-node-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
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
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'tray-quota': resolve('src/renderer/tray-quota.html')
        }
      }
    },
    plugins: [react()]
  }
})
