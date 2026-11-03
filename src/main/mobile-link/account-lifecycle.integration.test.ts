import { describe, expect, it, vi } from 'vitest'
import { KunAccountService } from '../kun-account/service'
import { MobileLinkService } from './service'
import type { AccountTokens } from '../kun-account/transport'
import type { AccountSessionEnding, ArtAccountAccess } from '../art-assets/account-access'
import type { KunAccountState } from '../../shared/kun-account'
import type { Socket } from '@kun/remote-protocol'

const tick = () => new Promise((resolve) => setImmediate(resolve))
describe('Kun account and mobile service lifecycle integration', () => {
  it('stops admission before account storage is cleared and never starts with another account token', async () => {
    const user = { id: 'owner', name: 'Owner', email: 'owner@test.invalid', avatarUrl: null }
    let stored: AccountTokens | null = { accessToken: 'old-token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }
    const listeners = new Set<(state: KunAccountState) => void>()
    const ending = new Set<(session: AccountSessionEnding) => Promise<void>>()
    let releaseStore!: () => void
    const account = new KunAccountService({
      clientId: 'public-client',
      storage: {
        assertAvailable: async () => {}, read: async () => stored,
        write: async (tokens) => { stored = tokens },
        clear: async () => { await new Promise<void>((resolve) => { releaseStore = resolve }); stored = null }
      },
      transport: { user: async () => user, exchange: vi.fn(), logout: vi.fn(async () => {}) },
      listen: vi.fn(), openBrowser: vi.fn(), focus: vi.fn(),
      changed: (state) => { for (const listener of listeners) listener(state) },
      sessionEnding: async (session) => { await Promise.allSettled([...ending].map((listener) => listener(session))) }
    })
    const access: ArtAccountAccess = {
      getState: () => account.getState(), accessToken: (force) => account.accessToken(force), expire: () => account.expire(),
      onState: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      onSessionEnding: (listener) => { ending.add(listener); return () => { ending.delete(listener) } }
    }
    let socket!: Socket
    const fetcher = vi.fn(async (url) => {
      const path = new URL(String(url)).pathname
      return Response.json(path.endsWith('/grants') ? { grants: [] }
        : path.endsWith('/pairings') ? { pairings: [] }
          : path.endsWith('/relay-tickets') ? { url: 'wss://relay.test/ws', ticket: 'ticket' } : { ok: true })
    }) as typeof fetch
    const service = new MobileLinkService({ requireMembership: async () => {},
      account: access, origin: 'https://relay.test', name: 'host', platform: 'macos', fetch: fetcher,
      identity: async () => ({ id: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) }),
      socket: () => (socket = { onopen: null, onmessage: null, onerror: null, onclose: null,
        send: vi.fn(), close: vi.fn(() => socket.onclose?.()) }),
      lease: vi.fn()
    })
    try {
      await account.getState()
      await service.enable(true)
      await tick()
      vi.mocked(fetcher).mockClear()
      const logout = account.logout()
      await tick()
      expect(socket.close).toHaveBeenCalled()
      expect((await service.status()).enabled).toBe(false)
      expect(await account.accessToken()).toBeNull()
      await expect(service.enable(true)).rejects.toThrow('ACCOUNT_CHANGED')
      expect(fetcher).toHaveBeenCalledOnce()
      expect(fetcher).toHaveBeenCalledWith('https://relay.test/api/remote/v1/devices/enabled',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer old-token' }) }))
      releaseStore()
      await logout
      await expect(service.enable(true)).rejects.toThrow('LOGIN_REQUIRED')
      expect(stored).toBeNull()
    } finally { service.dispose(); account.dispose() }
  })
})
