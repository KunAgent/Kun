import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KUN_ACCOUNT_CHANNELS as channels } from '../../shared/kun-account'
import { KUN_ACCOUNT_WARDROBE_CHANNELS as wardrobeChannels } from '../../shared/kun-account-economy'

const mocks = vi.hoisted(() => ({
  save: vi.fn(), write: vi.fn(), reveal: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(), trusted: true,
  assertTrusted: vi.fn(), open: vi.fn(), once: vi.fn(), create: vi.fn(), get: vi.fn(async () => ({ status: 'anonymous', user: null, error: null })),
  accountChanged: vi.fn(), change: vi.fn(async () => ({ ok: true, value: {} })), read: vi.fn(async () => ({ ok: true, value: {} }))
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/account-test', once: mocks.once },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler) },
  net: { fetch: vi.fn() }, safeStorage: {}, shell: { openExternal: mocks.open, showItemInFolder: mocks.reveal }, dialog: { showSaveDialog: mocks.save }
}))
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>(), writeFile: mocks.write }))
vi.mock('./app-ipc-handler-utils', () => ({
  assertTrustedWorkbenchSender: mocks.assertTrusted,
  trustedWorkbenchSenderIsCurrent: () => mocks.trusted,
  revealDialogParent: vi.fn()
}))
vi.mock('../kun-account/service', () => ({ KunAccountService: class {
  constructor(deps: unknown) { mocks.create(deps) }
  getState = mocks.get
  login = mocks.get
  reopenLogin = mocks.get
  refresh = mocks.get
  cancelLogin = mocks.get
  logout = mocks.get
  dispose = vi.fn()
} }))
vi.mock('../kun-account/wardrobe-sync', () => ({ AccountWardrobeSync: class {
  accountChanged = mocks.accountChanged
  change = mocks.change
  read = mocks.read
  sync = vi.fn()
  refresh = vi.fn()
  dispose = vi.fn()
} }))
import { registerKunAccountIpc } from './register-kun-account-ipc'

const runtime = vi.fn()

beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); mocks.trusted = true; mocks.assertTrusted.mockImplementation(() => {}) })
describe('Kun account IPC boundary', () => {
  it('keeps secret storage lazy and rejects every untrusted invocation before service access', async () => {
    registerKunAccountIpc(() => null, runtime)
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.assertTrusted.mockImplementation(() => { throw new Error('untrusted') })
    for (const channel of [channels.get, channels.login, channels.reopen, channels.cancel, channels.refresh, channels.logout, channels.manage]) {
      await expect(Promise.resolve().then(() => mocks.handlers.get(channel)!({}))).rejects.toThrow('untrusted')
    }
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('opens a fixed account center URL and never accepts a renderer-supplied URL', async () => {
    registerKunAccountIpc(() => null, runtime)
    await mocks.handlers.get(channels.manage)!({}, 'https://attacker.example')
    expect(mocks.open).toHaveBeenCalledWith('https://api-kun-server.com/auth/account')
  })
  it('only broadcasts redacted state to the current trusted workbench frame', async () => {
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: {}, send: vi.fn() } }
    registerKunAccountIpc(() => window as never, runtime)
    await mocks.handlers.get(channels.get)!({})
    const deps = mocks.create.mock.calls[0][0]
    const state = { status: 'authenticated', user: { name: 'Name' }, error: null }
    mocks.trusted = false
    deps.changed(state)
    expect(window.webContents.send).not.toHaveBeenCalled()
    mocks.trusted = true
    deps.changed(state)
    expect(window.webContents.send).toHaveBeenCalledWith(channels.state, state)
    expect(mocks.accountChanged).toHaveBeenCalledWith(state)
    expect(mocks.once).toHaveBeenCalledWith('before-quit', expect.any(Function))
  })
  it('checks the sender and the shape of every wardrobe call before it reaches the account', async () => {
    registerKunAccountIpc(() => null, runtime)
    mocks.assertTrusted.mockImplementation(() => { throw new Error('untrusted') })
    for (const channel of Object.values(wardrobeChannels)) {
      await expect(Promise.resolve().then(() => mocks.handlers.get(channel)!({}, ['x']))).rejects.toThrow('untrusted')
    }
    mocks.assertTrusted.mockImplementation(() => {})
    for (const [channel, input] of [[wardrobeChannels.open, []], [wardrobeChannels.open, Array(11).fill('b')], [wardrobeChannels.stash, 'b'],
      [wardrobeChannels.seen, [3]], [wardrobeChannels.exchange, ''], [wardrobeChannels.setLook, ['sky']], [wardrobeChannels.purchase, 7],
      [wardrobeChannels.claimInvite, 'x'.repeat(40)], [wardrobeChannels.settings, null]] as const) {
      await expect(Promise.resolve().then(() => mocks.handlers.get(channel)!({}, input)), channel).rejects.toThrow('invalid wardrobe')
    }
    expect(mocks.change).not.toHaveBeenCalled()
    await mocks.handlers.get(wardrobeChannels.open)!({}, ['b1', 'b2'])
    await mocks.handlers.get(wardrobeChannels.shop)!({})
    expect(mocks.change).toHaveBeenCalledTimes(1)
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it('saves validated PNG bytes only to the native dialog selection and reveals the saved path', async () => {
    registerKunAccountIpc(() => null, runtime)
    const input = { dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', fileName: 'Kun-Invite-K7QM4XPA.png' }
    mocks.save.mockResolvedValueOnce({ canceled: true })
    expect(await mocks.handlers.get(wardrobeChannels.saveSharePoster)!({}, input)).toEqual({ status: 'cancelled' })
    expect(mocks.write).not.toHaveBeenCalled()
    mocks.save.mockResolvedValueOnce({ canceled: false, filePath: '/chosen/poster.png' })
    expect(await mocks.handlers.get(wardrobeChannels.saveSharePoster)!({}, input)).toEqual({ status: 'saved', path: '/chosen/poster.png' })
    expect(mocks.save).toHaveBeenCalledWith({ defaultPath: '/tmp/account-test/Kun-Invite-K7QM4XPA.png', filters: [{ name: 'PNG', extensions: ['png'] }] })
    expect(mocks.write).toHaveBeenCalledWith('/chosen/poster.png', Buffer.from(input.dataBase64, 'base64'))
    await mocks.handlers.get(wardrobeChannels.revealSharePoster)!({}, '/attacker/path')
    expect(mocks.reveal).toHaveBeenCalledWith('/chosen/poster.png')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects a malformed poster before opening a file dialog', async () => {
    registerKunAccountIpc(() => null, runtime)
    await expect(mocks.handlers.get(wardrobeChannels.saveSharePoster)!({}, { fileName: '../x.png', dataBase64: 'bad' })).rejects.toThrow()
    expect(mocks.save).not.toHaveBeenCalled()
  })

})
