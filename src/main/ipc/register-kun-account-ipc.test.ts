import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KUN_ACCOUNT_CHANNELS as channels } from '../../shared/kun-account'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(), trusted: true,
  assertTrusted: vi.fn(), open: vi.fn(), once: vi.fn(), create: vi.fn(), get: vi.fn(async () => ({ status: 'anonymous', user: null, error: null }))
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/account-test', once: mocks.once },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler) },
  net: { fetch: vi.fn() }, safeStorage: {}, shell: { openExternal: mocks.open }
}))
vi.mock('./app-ipc-handler-utils', () => ({
  assertTrustedWorkbenchSender: mocks.assertTrusted,
  trustedWorkbenchSenderIsCurrent: () => mocks.trusted,
  revealDialogParent: vi.fn()
}))
vi.mock('../kun-account/service', () => ({ KunAccountService: class {
  constructor(deps: unknown) { mocks.create(deps) }
  getState = mocks.get
  login = mocks.get
  refresh = mocks.get
  cancelLogin = mocks.get
  logout = mocks.get
  dispose = vi.fn()
} }))
import { registerKunAccountIpc } from './register-kun-account-ipc'

beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); mocks.trusted = true; mocks.assertTrusted.mockImplementation(() => {}) })
describe('Kun account IPC boundary', () => {
  it('keeps secret storage lazy and rejects every untrusted invocation before service access', async () => {
    registerKunAccountIpc(() => null)
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.assertTrusted.mockImplementation(() => { throw new Error('untrusted') })
    for (const channel of [channels.get, channels.login, channels.cancel, channels.refresh, channels.logout, channels.manage]) {
      await expect(Promise.resolve().then(() => mocks.handlers.get(channel)!({}))).rejects.toThrow('untrusted')
    }
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('opens a fixed account center URL and never accepts a renderer-supplied URL', async () => {
    registerKunAccountIpc(() => null)
    await mocks.handlers.get(channels.manage)!({}, 'https://attacker.example')
    expect(mocks.open).toHaveBeenCalledWith('https://api-kun-server.com/auth/account')
  })
  it('only broadcasts redacted state to the current trusted workbench frame', async () => {
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {}, send: vi.fn() } }
    registerKunAccountIpc(() => window as never)
    await mocks.handlers.get(channels.get)!({})
    const deps = mocks.create.mock.calls[0][0]
    const state = { status: 'authenticated', user: { name: 'Name' }, error: null }
    mocks.trusted = false
    deps.changed(state)
    expect(window.webContents.send).not.toHaveBeenCalled()
    mocks.trusted = true
    deps.changed(state)
    expect(window.webContents.send).toHaveBeenCalledWith(channels.state, state)
    expect(mocks.once).toHaveBeenCalledWith('before-quit', expect.any(Function))
  })
})
