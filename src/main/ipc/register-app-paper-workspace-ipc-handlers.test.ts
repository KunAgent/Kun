import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { registerAppPaperWorkspaceIpcHandlers } from './register-app-paper-workspace-ipc-handlers'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { REMOTE_ALLOWED_INVOKE_CHANNELS } from '../remote/remote-allowlist'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(),
  ensure: vi.fn(),
  create: vi.fn(),
  getPath: vi.fn(() => '/app-data')
}))
vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  ipcMain: { handle: (channel: string, handler: never) => mocks.handlers.set(channel, handler) }
}))
vi.mock('../services/paper/paper-workspace-service', () => ({
  createPaperWorkspaceEnsurer: (options: unknown) => { mocks.create(options); return mocks.ensure }
}))
vi.mock('./app-ipc-handler-utils', () => ({
  assertTrustedWorkbenchSender: (event: { trusted?: boolean }) => {
    if (!event.trusted) throw new Error('Untrusted sender')
  },
  parseIpcPayload: (_channel: string, schema: z.ZodType, payload: unknown) => schema.parse(payload)
}))

const store = {}
const call = (payload?: unknown, event = { trusted: true }) =>
  mocks.handlers.get('paper-workspace:ensure')!(event, payload)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.ensure.mockResolvedValue({ ok: true, workspaceRoot: '/app-data/paper-workspaces/default' })
  registerAppPaperWorkspaceIpcHandlers({
    store, getMainWindow: () => null
  } as unknown as RegisterAppIpcHandlersOptions)
})

describe('paper workspace ensure IPC', () => {
  it('requires a trusted workbench sender before filesystem work', async () => {
    await expect(call(undefined, { trusted: false })).rejects.toThrow('Untrusted sender')
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('uses only the app-owned userData destination and returns the typed result', async () => {
    const options = mocks.create.mock.calls[0][0] as { store: unknown; userDataDir: () => string }
    expect(options.store).toBe(store)
    expect(options.userDataDir()).toBe('/app-data')
    expect(mocks.getPath).toHaveBeenCalledWith('userData')
    expect(await call()).toMatchObject({ ok: true, workspaceRoot: '/app-data/paper-workspaces/default' })
    expect(mocks.ensure).toHaveBeenCalledOnce()
  })

  it.each([{}, { workspaceRoot: '/other' }, '/other', null])('rejects renderer-supplied creation parameters', async (payload) => {
    await expect(call(payload)).rejects.toThrow()
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it('does not expose default directory creation to remote clients', () => {
    expect(REMOTE_ALLOWED_INVOKE_CHANNELS.has('paper-workspace:ensure')).toBe(false)
  })
})
