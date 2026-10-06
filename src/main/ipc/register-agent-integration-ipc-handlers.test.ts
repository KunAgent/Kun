import { expect, it, vi, afterEach } from 'vitest'
const f = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, body: unknown) => Promise<unknown>>(),
  open: vi.fn(async () => ''), trusted: vi.fn(), request: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (id: string, callback: (event: unknown, body: unknown) => Promise<unknown>) => f.handlers.set(id, callback) }, shell: { openPath: f.open } }))
vi.mock('./app-ipc-handler-utils', () => ({ assertTrustedWorkbenchSender: f.trusted,
  parseIpcPayload: (_channel: string, schema: { parse(value: unknown): unknown }, value: unknown) => schema.parse(value) }))
import { registerAgentIntegrationIpcHandlers } from './register-agent-integration-ipc-handlers'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
afterEach(() => { f.handlers.clear(); vi.clearAllMocks() })
function setup() {
  registerAgentIntegrationIpcHandlers({ getMainWindow: () => null, runtimeRequest: f.request } as unknown as RegisterAppIpcHandlersOptions)
  return f.handlers.get('agent:open-integration')!
}
it('opens only the host-resolved registered application after checking the trusted sender', async () => {
  const run = setup()
  f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ path: '/Applications/Editor.app', exists: true, kind: 'application' }) })
  expect(await run({}, { harnessId: 'vscode', action: 'application' })).toEqual({ ok: true })
  expect(f.trusted).toHaveBeenCalledOnce()
  expect(f.request).toHaveBeenCalledWith('/v1/harnesses/vscode/integration/resolve', 'POST', JSON.stringify({ harnessId: 'vscode', action: 'application' }))
  expect(f.open).toHaveBeenCalledWith('/Applications/Editor.app')
})
it('rejects arbitrary renderer paths, invalid server targets, missing installations and mismatched actions', async () => {
  const run = setup()
  await expect(run({}, { harnessId: 'vscode', action: 'application', path: '/arbitrary' })).rejects.toThrow()
  expect(f.request).not.toHaveBeenCalled()
  for (const body of [{ path: '../relative', exists: true, kind: 'application' }, { path: '/a', exists: false, kind: 'application' }, { path: '/a', exists: true, kind: 'file' }]) {
    f.request.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify(body) })
    expect(await run({}, { harnessId: 'vscode', action: 'application' })).toMatchObject({ ok: false })
  }
  f.request.mockResolvedValue({ ok: false, status: 404, body: '{}' })
  expect(await run({}, { harnessId: 'vscode', action: 'configuration', index: 0 })).toMatchObject({ ok: false })
  expect(f.open).not.toHaveBeenCalled()
})
