import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkDependencies } from './service'
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  power: new Map<string, () => void>(),
  quit: undefined as undefined | (() => void), online: true, address: '192.0.2.1', remembered: false,
  deps: undefined as LinkDependencies | undefined,
  status: vi.fn(async () => ({ enabled: false })), enable: vi.fn(), confirm: vi.fn(),
  revoke: vi.fn(), setScopes: vi.fn(), suspend: vi.fn(), reconnect: vi.fn(), dispose: vi.fn(),
  trusted: vi.fn(), info: vi.fn(), warn: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '2.3.4', getPath: () => '/tmp/mobile-link-test', once: (_event: string, callback: () => void) => { mock.quit = callback } },
  ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => mock.handlers.set(channel, callback) },
  net: { isOnline: () => mock.online, fetch: vi.fn() },
  powerMonitor: {
    on: (event: string, callback: () => void) => mock.power.set(event, callback),
    removeListener: (event: string, callback: () => void) => {
      if (mock.power.get(event) === callback) mock.power.delete(event)
    }
  }
}))
vi.mock('node:os', () => ({ hostname: () => 'desktop',
  networkInterfaces: () => ({ en0: [{ address: mock.address, family: 'IPv4', internal: false }] }) }))
vi.mock('../ipc/app-ipc-handler-utils', () => ({ assertTrustedWorkbenchSender: mock.trusted }))
vi.mock('../logger', () => ({ logInfo: mock.info, logWarn: mock.warn }))
vi.mock('./files', () => ({ transferFiles: vi.fn() }))
vi.mock('./share-file-services', () => ({ transferSharedFiles: vi.fn() }))
vi.mock('./identity', () => ({ loadIdentity: vi.fn() }))
vi.mock('./socket', () => ({ MobileLinkSockets: class { open = vi.fn(); dispose = vi.fn() } }))
vi.mock('./relay-preference', () => ({ RelayPreference: class {
  remembered = async () => mock.remembered
  remember = async () => { mock.remembered = true }
  forget = async () => { mock.remembered = false }
} }))
vi.mock('./service', () => ({ MobileLinkService: class {
  constructor(deps: LinkDependencies) { mock.deps = deps }
  status = mock.status
  enable = mock.enable
  confirm = mock.confirm
  revoke = mock.revoke
  setScopes = mock.setScopes
  suspend = mock.suspend
  reconnect = mock.reconnect
  dispose = mock.dispose
} }))
import { registerMobileLink } from './register'
import { RESUME_RETRY_MS } from './relay-resume'

const account = {
  getState: async () => ({ status: 'anonymous', user: null, error: null }),
  onState: () => () => {}, onSessionEnding: () => () => {}
} as any

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mock.handlers.clear(); mock.power.clear()
  mock.online = true; mock.address = '192.0.2.1'; mock.quit = undefined; mock.remembered = false
  mock.enable.mockReset()
  mock.trusted.mockImplementation(() => {})
})
afterEach(() => { mock.quit?.(); vi.useRealTimers() })

describe('desktop mobile recovery composition', () => {
  it('restarts an exhausted remembered startup on network restoration without re-enabling a healthy relay', async () => {
    mock.remembered = true
    mock.online = false
    mock.enable.mockRejectedValue(new Error('CONNECTION_UNAVAILABLE'))
    registerMobileLink({ getMainWindow: () => null, acquireRuntimeRequestLease: vi.fn() } as any, {
      ...account, getState: async () => ({ status: 'authenticated', user: { id: 'owner' }, error: null })
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(RESUME_RETRY_MS.reduce((sum, delay) => sum + delay, 0) * 2)
    const attempts = RESUME_RETRY_MS.length + 1
    expect(mock.enable).toHaveBeenCalledTimes(attempts)
    mock.enable.mockResolvedValue({ enabled: true })
    mock.online = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.reconnect).toHaveBeenCalledWith('NETWORK_ONLINE')
    expect(mock.enable).toHaveBeenCalledTimes(attempts + 1)
    expect(mock.enable).toHaveBeenLastCalledWith(true, true)
    mock.address = '192.0.2.2'
    await vi.advanceTimersByTimeAsync(5000)
    mock.power.get('resume')?.()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.enable).toHaveBeenCalledTimes(attempts + 1)
  })
  it('stays off by default and connects host power/network recovery without changing device grants', async () => {
    registerMobileLink({ getMainWindow: () => null, acquireRuntimeRequestLease: vi.fn() } as any, account)
    expect(mock.enable).not.toHaveBeenCalled()
    mock.power.get('suspend')?.()
    expect(mock.suspend).toHaveBeenCalledOnce()
    mock.power.get('resume')?.()
    expect(mock.reconnect).toHaveBeenCalledWith('HOST_RESUMED')
    mock.address = '192.0.2.2'
    await vi.advanceTimersByTimeAsync(5000)
    expect(mock.reconnect).toHaveBeenCalledWith('NETWORK_CHANGED')
    expect(mock.enable).not.toHaveBeenCalled()
    mock.quit?.()
    const count = mock.reconnect.mock.calls.length
    expect(mock.power.size).toBe(0)
    await vi.advanceTimersByTimeAsync(30000)
    expect(mock.reconnect).toHaveBeenCalledTimes(count)
    // Never started in this launch, so quitting revokes rather than keeping access.
    expect(mock.dispose).toHaveBeenCalledWith(false)
  })
  it('requires the trusted workbench for advanced permission changes and forwards only explicit UI choices', async () => {
    registerMobileLink({ getMainWindow: () => null, acquireRuntimeRequestLease: vi.fn() } as any, account)
    mock.trusted.mockImplementationOnce(() => { throw new Error('untrusted') })
    expect(() => mock.handlers.get('mobile-link:set-scopes')!({}, 'grant', ['groups.read'])).toThrow('untrusted')
    expect(mock.setScopes).not.toHaveBeenCalled()
    mock.handlers.get('mobile-link:set-scopes')!({}, 'grant', ['groups.read'])
    expect(mock.setScopes).toHaveBeenCalledWith('grant', ['groups.read'])
    mock.handlers.get('mobile-link:confirm')!({}, 'pairing', ['groups.read'])
    expect(mock.confirm).toHaveBeenCalledWith('pairing', ['groups.read'])
  })
  it('requires the trusted workbench before status or start and logs only fixed diagnostic metadata', async () => {
    registerMobileLink({ getMainWindow: () => null, acquireRuntimeRequestLease: vi.fn() } as any, account)
    mock.trusted.mockImplementation(() => { throw new Error('untrusted') })
    expect(() => mock.handlers.get('mobile-link:status')!({})).toThrow('untrusted')
    expect(() => mock.handlers.get('mobile-link:enable')!({}, true)).toThrow('untrusted')
    expect(mock.status).not.toHaveBeenCalled()
    expect(mock.enable).not.toHaveBeenCalled()
    mock.deps!.diagnostic?.('CONNECTED', { attempt: 2, elapsedMs: 12 })
    expect(mock.info).toHaveBeenCalledWith('mobile-link', 'CONNECTED', { attempt: 2, elapsedMs: 12 })
    mock.deps!.diagnostic?.('unsafe-url-or-token-value')
    expect(mock.warn).not.toHaveBeenCalled()
    for (const code of ['SOCKET_CLOSED_4401', 'SOCKET_CLOSED_4403', 'SOCKET_CLOSED_1013'])
      mock.deps!.diagnostic?.(code)
    expect(mock.warn.mock.calls.map((call) => call[1])).toEqual([
      'SOCKET_CLOSED_4401', 'SOCKET_CLOSED_4403', 'SOCKET_CLOSED_1013'
    ])
    mock.deps!.diagnostic?.('ARBITRARY_PRIVATE_TEXT')
    mock.deps!.diagnostic?.('SOCKET_CLOSED_99999')
    expect(mock.warn).toHaveBeenCalledTimes(3)
  })
})
