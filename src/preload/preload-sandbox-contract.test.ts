import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { expect, it, vi } from 'vitest'

it('loads the bundled workbench bridge with sandbox-supported imports only', async () => {
  const result = await build({
    entryPoints: [resolve('src/preload/index.ts')], bundle: true, format: 'cjs',
    platform: 'node', packages: 'external', write: false
  })
  const invoke = vi.fn(async () => ({}))
  const expose = vi.fn()
  const electron = {
    contextBridge: { exposeInMainWorld: expose, exposeInIsolatedWorld: vi.fn() },
    ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn(), send: vi.fn(), sendSync: vi.fn() },
    webFrame: {}, webUtils: {}
  }
  const imports: string[] = []
  runInNewContext(result.outputFiles[0].text, {
    require: (name: string) => {
      imports.push(name)
      if (name === 'electron') return electron
      throw new Error(`Unsupported sandbox preload dependency: ${name}`)
    },
    process: { platform: 'darwin', argv: [] },
    document: { readyState: 'complete', addEventListener: vi.fn() },
    window: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    module: { exports: {} }, exports: {}, console
  }, { timeout: 5_000 })
  expect([...new Set(imports)]).toEqual(['electron'])
  const api = expose.mock.calls.find(([name]) => name === 'kunGui')?.[1]
  expect(api).toBeDefined()
  expect(api.onProviderMutationFlushRequest).toBeTypeOf('function')
  await api.googleWorkspace.status()
  expect(invoke).toHaveBeenLastCalledWith('google-workspace:status')
})
