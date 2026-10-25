import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Socket } from '@kun/remote-protocol'
import type { KunAccountState } from '../../shared/kun-account'
import { MobileLinkService } from './service'
import { MobileLinkRecovery } from './recovery'
import { MobileRelayResume, RESUME_RETRY_MS } from './relay-resume'

afterEach(() => vi.useRealTimers())

describe('desktop remembered startup with the real relay service', () => {
  it('recovers registration after a long outage while preserving grants and stops recovering after explicit disable', async () => {
    vi.useFakeTimers()
    let online = false
    let network = 'wifi'
    const user: KunAccountState = { status: 'authenticated', error: null,
      user: { id: 'owner', name: 'Owner', email: 'owner@kun.test', avatarUrl: null } }
    const account = { getState: async () => user, accessToken: async () => 'token',
      expire: async () => {}, onState: () => () => {} }
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (!online) throw new Error('offline')
      const path = new URL(String(input)).pathname
      return Response.json(path.endsWith('/grants') ? { grants: [] }
        : path.endsWith('/pairings') ? { pairings: [] }
          : path.endsWith('/relay-tickets') ? { url: 'wss://relay.test/ws', ticket: 'ticket' }
            : { ok: true })
    }) as unknown as ReturnType<typeof vi.fn<typeof fetch>>
    const sockets: Socket[] = []
    const service = new MobileLinkService({ requireMembership: async () => {}, account, origin: 'https://relay.test', name: 'desktop', platform: 'macos',
      fetch: fetcher, identity: async () => ({ id: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) }),
      lease: vi.fn(), socket: () => {
        const socket: Socket = { onopen: null, onmessage: null, onerror: null, onclose: null,
          close: vi.fn(() => socket.onclose?.()), send: vi.fn((raw) => {
            if (JSON.parse(raw).kind === 'ping')
              queueMicrotask(() => socket.onmessage?.({ data: '{"v":1,"kind":"pong"}' }))
          }) }
        sockets.push(socket)
        queueMicrotask(() => socket.onmessage?.({ data: '{"v":1,"kind":"hello"}' }))
        return socket
      } })
    let remembered = true
    const resume = new MobileRelayResume({ account, relay: service, preference: {
      remembered: async () => remembered, remember: async () => { remembered = true },
      forget: async () => { remembered = false }
    } })
    const recovery = new MobileLinkRecovery({ online: () => online, network: () => network,
      power: () => () => {}, suspend: () => service.suspend(),
      reconnect: (reason) => { service.reconnect(reason); resume.recover() } })
    const countRegistrations = () => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/devices')).length
    const settle = () => vi.advanceTimersByTimeAsync(0)
    try {
      await settle()
      const budget = RESUME_RETRY_MS.reduce((sum, delay) => sum + delay, 0)
      await vi.advanceTimersByTimeAsync(budget * 2)
      expect(countRegistrations()).toBe(RESUME_RETRY_MS.length + 1)
      expect((await service.status()).enabled).toBe(false)
      expect(sockets).toHaveLength(0)
      online = true
      await vi.advanceTimersByTimeAsync(5000)
      expect(countRegistrations()).toBe(RESUME_RETRY_MS.length + 2)
      expect(await service.status()).toMatchObject({ enabled: true, online: true })
      expect(sockets).toHaveLength(1)
      expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/devices/enabled')).map(([, init]) => init?.body))
        .toEqual([JSON.stringify({ enabled: true })])
      network = 'ethernet'
      await vi.advanceTimersByTimeAsync(5000)
      expect(sockets).toHaveLength(1)
      expect(countRegistrations()).toBe(RESUME_RETRY_MS.length + 2)
      await resume.manual(false)
      expect(remembered).toBe(false)
      network = 'wifi'
      await vi.advanceTimersByTimeAsync(budget * 2)
      expect(await service.status()).toMatchObject({ enabled: false, online: false })
      expect(sockets).toHaveLength(1)
      expect(countRegistrations()).toBe(RESUME_RETRY_MS.length + 2)
    } finally { recovery.dispose(); resume.dispose(); await settle() }
  })
})
