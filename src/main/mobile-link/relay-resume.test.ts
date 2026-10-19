import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunAccountState } from '../../shared/kun-account'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import type { AccountSessionEnding, ArtAccountAccess } from '../art-assets/account-access'
import { RelayPreference } from './relay-preference'
import { MobileRelayResume, RESUME_RETRY_MS } from './relay-resume'

const signedIn = (id: string): KunAccountState =>
  ({ status: 'authenticated', error: null, user: { id, name: id, email: id + '@kun.test', avatarUrl: null } })
const anonymous: KunAccountState = { status: 'anonymous', user: null, error: null }
const settle = () => new Promise((resolve) => setImmediate(resolve))
let root = ''

function fixture(initial: KunAccountState) {
  let state = initial
  const listeners = new Set<(state: KunAccountState) => void>()
  const ending = new Set<(session: AccountSessionEnding) => Promise<void>>()
  const relay = {
    enable: vi.fn(async (value: boolean, _keepGrants?: boolean) => ({ enabled: value }) as MobileLinkStatus),
    dispose: vi.fn()
  }
  const preference = new RelayPreference(root)
  const account: ArtAccountAccess = {
    getState: async () => state,
    accessToken: async () => 'token',
    expire: async () => {},
    onState: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    onSessionEnding: (listener) => { ending.add(listener); return () => { ending.delete(listener) } }
  }
  return {
    relay,
    preference,
    launch: async () => {
      const resume = new MobileRelayResume({ account, relay, preference })
      await settle()
      return resume
    },
    change: (next: KunAccountState) => { state = next; for (const listener of listeners) listener(next) },
    end: async (userId: string) => { await Promise.all([...ending].map((listener) => listener({ userId, accessToken: 'token' }))) }
  }
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kun-relay-resume-')) })
afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

describe('remembered Kun iOS relay', () => {
  it('stays off for an account that never started it', async () => {
    const f = fixture(signedIn('owner'))
    const resume = await f.launch()
    await settle()
    expect(f.relay.enable).not.toHaveBeenCalled()
    resume.dispose()
    expect(f.relay.dispose).toHaveBeenCalledWith(false)
  })

  it('remembers a manual start, keeps grants on quit and resumes them after a relaunch', async () => {
    const f = fixture(signedIn('owner'))
    const first = await f.launch()
    await first.manual(true)
    expect(f.relay.enable).toHaveBeenCalledWith(true, false)
    expect(JSON.parse(await readFile(join(root, 'owner', 'relay.json'), 'utf8'))).toEqual({ enabled: true })
    first.dispose()
    expect(f.relay.dispose).toHaveBeenLastCalledWith(true)

    f.relay.enable.mockClear()
    const second = await f.launch()
    await vi.waitFor(() => expect(f.relay.enable).toHaveBeenCalledWith(true, true))
    second.dispose()
    expect(f.relay.dispose).toHaveBeenLastCalledWith(true)
  })

  it('a manual start for a remembered account keeps its grants', async () => {
    const f = fixture(signedIn('owner'))
    await f.preference.remember('owner')
    f.relay.enable.mockRejectedValueOnce(new Error('LOGIN_REQUIRED'))
    const resume = await f.launch()
    await vi.waitFor(() => expect(f.relay.enable).toHaveBeenCalledTimes(1))
    await resume.manual(true)
    expect(f.relay.enable).toHaveBeenLastCalledWith(true, true)
    resume.dispose()
  })

  it('an explicit stop forgets the start, revokes, and the next launch stays off', async () => {
    const f = fixture(signedIn('owner'))
    const first = await f.launch()
    await first.manual(true)
    await first.manual(false)
    expect(f.relay.enable).toHaveBeenLastCalledWith(false)
    expect(await f.preference.remembered('owner')).toBe(false)
    first.dispose()
    expect(f.relay.dispose).toHaveBeenLastCalledWith(false)

    f.relay.enable.mockClear()
    const second = await f.launch()
    await settle()
    expect(f.relay.enable).not.toHaveBeenCalled()
    await second.manual(true)
    expect(f.relay.enable).toHaveBeenLastCalledWith(true, false)
    second.dispose()
  })

  it('sign-out forgets the start so quitting and relaunching revoke instead of resuming', async () => {
    const f = fixture(signedIn('owner'))
    const resume = await f.launch()
    await resume.manual(true)
    await f.end('owner')
    f.change(anonymous)
    expect(await f.preference.remembered('owner')).toBe(false)
    resume.dispose()
    expect(f.relay.dispose).toHaveBeenLastCalledWith(false)
  })

  it('an account switch forgets the previous account and never resumes it for the new one', async () => {
    const f = fixture(signedIn('first'))
    const resume = await f.launch()
    await resume.manual(true)
    f.relay.enable.mockClear()
    f.change(signedIn('second'))
    await vi.waitFor(async () => expect(await f.preference.remembered('first')).toBe(false))
    expect(f.relay.enable).not.toHaveBeenCalled()
    resume.dispose()
    expect(f.relay.dispose).toHaveBeenLastCalledWith(false)
  })

  it('retries a resume that failed on the network and stops once the user turns it off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const f = fixture(signedIn('owner'))
    await f.preference.remember('owner')
    f.relay.enable
      .mockRejectedValueOnce(new Error('CONNECTION_UNAVAILABLE'))
      .mockRejectedValueOnce(new Error('CONNECTION_UNAVAILABLE'))
    const resume = await f.launch()
    await vi.waitFor(() => expect(f.relay.enable).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(RESUME_RETRY_MS[0])
    expect(f.relay.enable).toHaveBeenCalledTimes(2)
    expect(f.relay.enable).toHaveBeenLastCalledWith(true, true)
    await resume.manual(false)
    await vi.advanceTimersByTimeAsync(RESUME_RETRY_MS.reduce((sum, delay) => sum + delay, 0))
    expect(f.relay.enable.mock.calls.map((call) => call[0])).toEqual([true, true, false])
    resume.dispose()
  })

  it('gives up after the retry budget and when sign-in is required', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const f = fixture(signedIn('owner'))
    await f.preference.remember('owner')
    f.relay.enable.mockRejectedValue(new Error('CONNECTION_UNAVAILABLE'))
    const resume = await f.launch()
    await vi.waitFor(() => expect(f.relay.enable).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(RESUME_RETRY_MS.reduce((sum, delay) => sum + delay, 0) * 2)
    expect(f.relay.enable).toHaveBeenCalledTimes(RESUME_RETRY_MS.length + 1)
    resume.dispose()

    f.relay.enable.mockReset()
    f.relay.enable.mockRejectedValue(new Error('LOGIN_REQUIRED'))
    const again = await f.launch()
    await vi.waitFor(() => expect(f.relay.enable).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(RESUME_RETRY_MS[0] * 4)
    expect(f.relay.enable).toHaveBeenCalledTimes(1)
    again.dispose()
  })

  it('rejects account ids that are not a single path segment', async () => {
    const preference = new RelayPreference(root)
    await expect(preference.remember('../outside')).rejects.toThrow('INVALID_OWNER')
    expect(await preference.remembered('../outside')).toBe(false)
  })
})
