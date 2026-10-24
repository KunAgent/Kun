import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { AnalyticsInput } from '../../shared/product-analytics'
import { ProductAnalyticsService } from './service'
import { AnalyticsTransport } from './transport'
import { emptyAnalyticsState } from './storage'
import type { ArtAccountAccess } from '../art-assets/account-access'

function fixture() {
  let disk = emptyAnalyticsState(), actor: string | null = null
  const sessionId = randomUUID(), sent: any[] = []
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/config')) return Response.json({ schemaVersion: 1, policyVersion: 'product-analytics-v1', collectionEnabled: true, guidanceEnabled: false })
    if (String(url).endsWith('/sessions')) return Response.json({ sessionId, credential: 'anonymous-test-credential', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    if (String(url).endsWith('/events')) {
      const body = JSON.parse(String(init?.body)); sent.push(body)
      return Response.json({ acceptedEventIds: body.events.map((e: any) => e.eventId), rejected: [] })
    }
    return new Response(null, { status: 204 })
  })
  const account = { getState: vi.fn(async () => ({ user: actor ? { id: actor } : null })),
    accessToken: vi.fn(async () => actor ? 'test-token' : null), expire: vi.fn(), onState: vi.fn(() => () => {}) } as unknown as ArtAccountAccess
  const runtime = vi.fn(async () => ({ ok: false, body: '' }))
  const storage = { read: async () => structuredClone(disk), write: async (s: typeof disk) => { disk = structuredClone(s) } }
  const service = new ProductAnalyticsService({ storage, transport: new AnalyticsTransport(fetcher as typeof fetch), account, runtime,
    appVersion: '0.4.0', platform: 'macos' })
  return { service, fetcher, account, runtime, storage, sent, state: () => disk, actor: (id: string | null) => { actor = id } }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20))
describe('opt-in analytics isolation', () => {
  it('does not initialize auth, runtime, network or event storage for an existing disabled user', async () => {
    const f = fixture()
    expect((await f.service.getState()).enabled).toBe(false)
    await f.service.track({ name: 'app_session_started' }); await f.service.flush()
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.runtime).not.toHaveBeenCalled(); expect(f.account.getState).not.toHaveBeenCalled()
    expect(f.state().events).toEqual([]); f.service.dispose()
  })
  it('rejects content fields at the wire boundary', () => {
    expect(AnalyticsInput.safeParse({ name: 'run_started', properties: { mode: 'code', prompt: 'secret' } }).success).toBe(false)
    expect(AnalyticsInput.safeParse({ name: 'result_action', userId: 'spoof', properties: {} }).success).toBe(false)
  })
  it('persists before upload, accepts only acknowledged ids, and purges on opt-out', async () => {
    const f = fixture(); await f.service.setEnabled(true); await settle()
    await f.service.track({ name: 'app_session_started' })
    expect(f.state().events).toHaveLength(1)
    await f.service.flush()
    expect(f.sent[0].events[0].surface).toBe('desktop'); expect(f.state().events).toHaveLength(0)
    await f.service.track({ name: 'app_session_started' }); await f.service.setEnabled(false)
    expect(f.state().events).toEqual([]); expect(f.state().installationId).toBeNull(); f.service.dispose()
  })
  it('never uploads old actor events with a switched account', async () => {
    const f = fixture(); f.actor(randomUUID()); await f.service.setEnabled(true); await settle()
    await f.service.track({ name: 'app_session_started' })
    const oldId = f.state().events[0].eventId
    f.actor(randomUUID()); await f.service.flush()
    expect(f.sent.flatMap(b => b.events).some((e: any) => e.eventId === oldId)).toBe(false)
    f.service.dispose()
  })
  it('old servers back off without signing the user out or blocking collection', async () => {
    const f = fixture(); f.fetcher.mockImplementation(async () => new Response(null, { status: 404 }))
    await f.service.setEnabled(true); await settle()
    await f.service.track({ name: 'app_session_started' }); await f.service.flush(); await f.service.flush()
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.account.expire).not.toHaveBeenCalled()
    expect(f.state().events).toHaveLength(1); f.service.dispose()
  })
  it('fails closed when consent cannot be saved', async () => {
    const f = fixture(); f.storage.write = async () => { throw new Error('disk full') }
    await expect(f.service.setEnabled(true)).rejects.toThrow('disk full')
    expect((await f.service.getState()).enabled).toBe(false); f.service.dispose()
  })
  it('drops a delayed UI event from a previous identity epoch', async () => {
    const f = fixture(); f.actor(randomUUID()); await f.service.setEnabled(true); await settle()
    const epoch = f.state().epoch; f.actor(randomUUID())
    await f.service.track({ name: 'result_action', properties: { action: 'copy' } }, epoch)
    expect(f.state().events.some(e => e.name === 'result_action')).toBe(false); f.service.dispose()
  })
  it('can disable a restored opt-in before starting its background services', async () => {
    const f = fixture(); f.storage.read = async () => ({ ...emptyAnalyticsState(), enabled: true, installationId: randomUUID() })
    await f.service.setEnabled(false); await settle()
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.account.getState).not.toHaveBeenCalled(); f.service.dispose()
  })

})
