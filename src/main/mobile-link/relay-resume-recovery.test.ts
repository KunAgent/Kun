import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunAccountState } from '../../shared/kun-account'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import type { AccountSessionEnding, ArtAccountAccess } from '../art-assets/account-access'
import { MobileRelayResume, RESUME_RETRY_MS } from './relay-resume'

const signedIn = (id: string): KunAccountState => ({ status: 'authenticated', error: null,
  user: { id, name: id, email: id + '@kun.test', avatarUrl: null } })
const anonymous: KunAccountState = { status: 'anonymous', user: null, error: null }
const budget = RESUME_RETRY_MS.reduce((sum, delay) => sum + delay, 0)
const settle = () => vi.advanceTimersByTimeAsync(0)
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(remembered = ['owner']) {
  let state = signedIn('owner')
  const stored = new Set(remembered)
  const listeners = new Set<(value: KunAccountState) => void>()
  const ending = new Set<(session: AccountSessionEnding) => Promise<void>>()
  const relay = { enable: vi.fn(async (value: boolean, _keepGrants?: boolean) =>
    ({ enabled: value }) as MobileLinkStatus), dispose: vi.fn() }
  const account: ArtAccountAccess = {
    getState: vi.fn(async () => state), accessToken: async () => 'token', expire: async () => {},
    onState: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    onSessionEnding: (listener) => { ending.add(listener); return () => { ending.delete(listener) } }
  }
  const preference = {
    remembered: vi.fn(async (owner: string) => stored.has(owner)),
    remember: vi.fn(async (owner: string) => { stored.add(owner) }),
    forget: vi.fn(async (owner: string) => { stored.delete(owner) })
  }
  const diagnostic = vi.fn()
  return { relay, account, preference, diagnostic, stored,
    launch: () => new MobileRelayResume({ relay, account, preference, diagnostic }),
    change: (next: KunAccountState) => { state = next; for (const listener of listeners) listener(next) },
    end: () => Promise.all([...ending].map((listener) => listener({ userId: state.user?.id ?? null, accessToken: 'token' }))) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('remembered relay network recovery', () => {
  it('re-arms an exhausted startup budget after network recovery and leaves an enabled relay alone', async () => {
    const f = fixture()
    f.relay.enable.mockRejectedValue(new Error('CONNECTION_UNAVAILABLE'))
    const resume = f.launch()
    await settle()
    await vi.advanceTimersByTimeAsync(budget * 2)
    expect(f.relay.enable).toHaveBeenCalledTimes(RESUME_RETRY_MS.length + 1)
    f.relay.enable.mockResolvedValue({ enabled: true } as MobileLinkStatus)
    resume.recover()
    await settle()
    expect(f.relay.enable).toHaveBeenLastCalledWith(true, true)
    expect(f.relay.enable).toHaveBeenCalledTimes(RESUME_RETRY_MS.length + 2)
    resume.recover()
    await vi.advanceTimersByTimeAsync(budget * 2)
    expect(f.relay.enable).toHaveBeenCalledTimes(RESUME_RETRY_MS.length + 2)
    expect(f.diagnostic).toHaveBeenCalledWith('RELAY_RESUMED')
    resume.dispose()
  })

  it('coalesces hints during an attempt and cancels the older delayed retry when a hint wakes it', async () => {
    const f = fixture(), request = deferred<MobileLinkStatus>()
    f.relay.enable.mockReturnValueOnce(request.promise)
    const resume = f.launch()
    await settle()
    for (let i = 0; i < 10; i++) resume.recover()
    expect(f.relay.enable).toHaveBeenCalledOnce()
    request.reject(new Error('CONNECTION_UNAVAILABLE'))
    await settle()
    resume.recover()
    resume.recover()
    await settle()
    expect(f.relay.enable).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(budget * 2)
    expect(f.relay.enable).toHaveBeenCalledTimes(2)
    resume.dispose()
  })

  it.each(['LOGIN_REQUIRED', 'SECURE_STORAGE_REQUIRED'])('does not retry %s on network hints', async (code) => {
    const f = fixture()
    f.relay.enable.mockRejectedValue(new Error(code))
    const resume = f.launch()
    await settle()
    resume.recover()
    await vi.advanceTimersByTimeAsync(budget * 2)
    expect(f.relay.enable).toHaveBeenCalledOnce()
    resume.dispose()
  })

  it('does not resume an account that never enabled remote access', async () => {
    const f = fixture([]), resume = f.launch()
    await settle()
    resume.recover()
    await settle()
    expect(f.relay.enable).not.toHaveBeenCalled()
    resume.dispose()
  })

  it('keeps an explicit stop effective while an earlier startup failure arrives late', async () => {
    const f = fixture(), request = deferred<MobileLinkStatus>()
    f.relay.enable.mockReturnValueOnce(request.promise)
    const resume = f.launch()
    await settle()
    const stop = resume.manual(false)
    resume.recover()
    await stop
    request.reject(new Error('CONNECTION_UNAVAILABLE'))
    await settle()
    resume.recover()
    await vi.advanceTimersByTimeAsync(budget * 2)
    expect(f.relay.enable.mock.calls).toEqual([[true, true], [false]])
    expect(f.stored.has('owner')).toBe(false)
    resume.dispose()
  })

  it.each(['logout', 'switch'])('does not revive the previous account after %s', async (action) => {
    const f = fixture(), request = deferred<MobileLinkStatus>()
    f.relay.enable.mockReturnValueOnce(request.promise)
    const resume = f.launch()
    await settle()
    if (action === 'logout') {
      await f.end()
      // Logout closes recovery before the anonymous state or token clear finishes.
      resume.recover()
      f.change(anonymous)
    } else f.change(signedIn('second'))
    await settle()
    request.reject(new Error('CONNECTION_UNAVAILABLE'))
    await settle()
    resume.recover()
    await vi.advanceTimersByTimeAsync(budget * 2)
    expect(f.relay.enable).toHaveBeenCalledOnce()
    expect(f.stored.has('owner')).toBe(false)
    resume.dispose()
  })

  it('does not let an old successful attempt consume a new account recovery', async () => {
    const f = fixture(['owner', 'second']), request = deferred<MobileLinkStatus>()
    f.relay.enable.mockReturnValueOnce(request.promise)
      .mockRejectedValueOnce(new Error('CONNECTION_UNAVAILABLE'))
    const resume = f.launch()
    await settle()
    f.change(signedIn('second'))
    await settle()
    request.resolve({ enabled: true } as MobileLinkStatus)
    await settle()
    expect(f.diagnostic).not.toHaveBeenCalledWith('RELAY_RESUMED')
    resume.recover()
    await settle()
    expect(f.relay.enable).toHaveBeenCalledTimes(3)
    expect(f.stored.has('owner')).toBe(false)
    resume.dispose()
  })

  it('ignores late preference reads and recovery hints after disposal', async () => {
    const f = fixture(), read = deferred<boolean>()
    f.preference.remembered.mockReturnValueOnce(read.promise)
    const resume = f.launch()
    await settle()
    resume.dispose()
    read.resolve(true)
    await settle()
    resume.recover()
    await vi.advanceTimersByTimeAsync(budget * 2)
    expect(f.relay.enable).not.toHaveBeenCalled()
    expect(f.relay.dispose).toHaveBeenCalledOnce()
    resume.dispose()
    expect(f.relay.dispose).toHaveBeenCalledOnce()
  })

  it('does not re-remember a late manual start after a newer manual stop', async () => {
    const f = fixture([]), request = deferred<MobileLinkStatus>(), resume = f.launch()
    await settle()
    f.relay.enable.mockReturnValueOnce(request.promise)
    const start = resume.manual(true)
    await resume.manual(false)
    request.resolve({ enabled: true } as MobileLinkStatus)
    await start
    resume.recover()
    expect(f.preference.remember).not.toHaveBeenCalled()
    expect(f.stored.has('owner')).toBe(false)
    resume.dispose()
  })

  it('does not apply an older launch account snapshot after a live state event', async () => {
    const f = fixture(), read = deferred<KunAccountState>()
    vi.mocked(f.account.getState).mockReturnValue(read.promise)
    const resume = f.launch()
    f.change(signedIn('second'))
    await settle()
    read.resolve(signedIn('owner'))
    await settle()
    resume.recover()
    expect(f.relay.enable).not.toHaveBeenCalled()
    expect(f.preference.remembered).toHaveBeenCalledExactlyOnceWith('second')
    resume.dispose()
  })
})
