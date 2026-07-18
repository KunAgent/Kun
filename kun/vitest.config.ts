import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Match the internal alias exactly so public packages such as
    // `@kun/extension-api` keep normal Node package resolution.
    alias: [{ find: /^@kun$/, replacement: resolve('src') }]
  },
  test: {
    environment: 'node',
    env: {
      KUN_DISABLE_OS_CREDENTIAL_STORE: '1'
    },
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    globals: false,
    ...(process.platform === 'win32' ? { maxWorkers: 2 } : {})
  }
})
