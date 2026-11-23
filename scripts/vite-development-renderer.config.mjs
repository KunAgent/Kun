import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const scriptsRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptsRoot, '..')
const requestedPort = Number(process.env.KUN_ELECTRON_VITE_PORT)
const requestedCacheDir = process.env.KUN_ELECTRON_VITE_CACHE_DIR?.trim()

if (!Number.isSafeInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65_535) {
  throw new Error('KUN_ELECTRON_VITE_PORT must select a valid development renderer port')
}
if (!requestedCacheDir || !isAbsolute(requestedCacheDir)) {
  throw new Error('KUN_ELECTRON_VITE_CACHE_DIR must select an absolute isolated Vite cache directory')
}

export default defineConfig({
  root: resolve(repositoryRoot, 'src', 'renderer'),
  cacheDir: requestedCacheDir,
  resolve: {
    alias: {
      '@renderer': resolve(repositoryRoot, 'src', 'renderer', 'src'),
      '@shared': resolve(repositoryRoot, 'src', 'shared')
    }
  },
  // As in the desktop renderer, serve the Word ESM package directly so the
  // module worker URL resolves beside the parser rather than in Vite's cache.
  optimizeDeps: {
    exclude: ['@extend-ai/react-docx'],
    include: ['react-dom', 'react-dom/server', '@extend-ai/react-docx > utif', '@extend-ai/react-docx > fast-png']
  },
  server: {
    host: '127.0.0.1',
    port: requestedPort,
    strictPort: true
  },
  plugins: [react()]
})
