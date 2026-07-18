import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    env: {
      KUN_DISABLE_OS_CREDENTIAL_STORE: '1'
    },
    include: ['src/**/*.test.ts'],
    ...(process.platform === 'win32' ? { maxWorkers: 2 } : {})
  }
})
