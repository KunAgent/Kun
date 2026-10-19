import { resolve } from 'node:path'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import {
  APP_SANDBOX_CHANNELS,
  APP_SANDBOX_INSTANCE_ARGUMENT,
  APP_SANDBOX_NONCE_ARGUMENT
} from '../shared/app-sandbox'

it('keeps the shell preload literals in sync with the shared contract', async () => {
  const result = await build({
    entryPoints: [resolve('src/preload/app-sandbox-shell.ts')], bundle: true, format: 'cjs',
    platform: 'node', packages: 'external', write: false
  })
  const text = result.outputFiles[0]!.text
  for (const value of [
    APP_SANDBOX_CHANNELS.guestHello,
    APP_SANDBOX_CHANNELS.guestMessage,
    APP_SANDBOX_CHANNELS.hostMessage,
    APP_SANDBOX_INSTANCE_ARGUMENT,
    APP_SANDBOX_NONCE_ARGUMENT
  ]) expect(text).toContain(value)
  // A sandboxed preload may only require electron.
  expect([...text.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])).toEqual(['electron'])
})
