import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { AnalyticsInput, AnalyticsConfig, workRequestEpoch, workRunKeySource } from '../../shared/product-analytics'
import { ProductAnalyticsService } from './service'
import { AnalyticsTransport } from './transport'
import { emptyAnalyticsState } from './storage'
import type { ArtAccountAccess } from '../art-assets/account-access'

function fixture() {
  let disk = emptyAnalyticsState(), actor: string | null = null
  let workVersion: 0 | 1 | undefined
  const sessionId = randomUUID(), sent: any[] = []
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/config')) return Response.json({ schemaVersion: 1, policyVersion: 'product-analytics-v1', collectionEnabled: true, guidanceEnabled: false, workAnalyticsVersion: workVersion })
    if (String(url).endsWith('/sessions')) return Response.json({ sessionId, credential: 'anonymous-test-credential', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
    if (String(url).endsWith('/events')) {
      const body = JSON.parse(String(init?.body)); sent.push(body)
      return Response.json({ acceptedEventIds: body.events.map((e: any) => e.eventId), rejected: [] })
    }
    return new Response(null, { status: 204 })
  })
  const account = { getState: vi.fn(async () => ({ user: actor ? { id: actor } : null })),
    accessToken: vi.fn(async () => actor ? 'test-token' : null), expire: vi.fn(), onState: vi.fn(() => () => {}) } as unknown as ArtAccountAccess
  const runtime = vi.fn(async (_path?: string, _method?: string, _body?: string) => ({ ok: false, body: '' }))
  const storage = { read: async () => structuredClone(disk), write: async (s: typeof disk) => { disk = structuredClone(s) } }
  const service = new ProductAnalyticsService({ storage, transport: new AnalyticsTransport(fetcher as typeof fetch), account, runtime,
    appVersion: '0.4.0', platform: 'macos' })
  return { service, fetcher, account, runtime, storage, sent, state: () => disk, actor: (id: string | null) => { actor = id },
    workVersion: (version: 0 | 1 | undefined) => { workVersion = version } }
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

  it('keeps Work queued on old servers without starving Code/Room, then uploads when support appears', async () => {
    const f = fixture(); await f.service.setEnabled(true); await settle()
    for (let i = 0; i < 55; i++) await f.service.track({ name: 'work_entered', properties: { mode: 'work' } })
    await f.service.track({ name: 'run_started', properties: { mode: 'code', runKey: 'a'.repeat(64) } })
    await f.service.flush()
    expect(f.sent.flatMap(batch => batch.events).map(e => e.properties.mode)).toEqual(['code'])
    expect(f.state().events).toHaveLength(55)
    f.workVersion(1); await f.service.flush(); await f.service.flush()
    expect(f.state().events).toHaveLength(0)
    expect(f.sent.flatMap(batch => batch.events).filter(e => e.properties.mode === 'work')).toHaveLength(55)
    f.service.dispose()
  })

  it('falls back to the old Runtime lease without losing existing event collection', async () => {
    const f = fixture()
    f.runtime.mockImplementation(async (path, _method, body) => {
      if (path?.endsWith('/lease')) return JSON.parse(body!).workAnalyticsVersion
        ? { ok: false, status: 400, body: JSON.stringify({ code: 'validation_error', details: [{ code: 'unrecognized_keys', keys: ['workAnalyticsVersion'], path: [] }] }) }
        : { ok: true, status: 200, body: '{}' }
      return { ok: true, body: JSON.stringify({ epoch: f.state().epoch, events: [] }) }
    })
    await f.service.setEnabled(true); await settle()
    const leases = f.runtime.mock.calls.filter(([path, , body]) => path?.endsWith('/lease') && JSON.parse(body!).epoch)
    expect(leases.some(([, , body]) => JSON.parse(body!).workAnalyticsVersion === 1)).toBe(true)
    expect(leases.some(([, , body]) => JSON.parse(body!).workAnalyticsVersion === undefined)).toBe(true)
    await f.service.track({ name: 'workspace_ready' }); await f.service.flush()
    expect(f.sent.flatMap(batch => batch.events).some(e => e.name === 'workspace_ready')).toBe(true)
    f.service.dispose()
  })

  it('never downgrades a Work lease or clears its queue on transient Runtime errors', async () => {
    const f = fixture()
    f.runtime.mockImplementation(async () => ({ ok: false, status: 503, body: '{"code":"unavailable"}' }))
    await f.service.setEnabled(true); await settle()
    f.runtime.mockClear(); await f.service.flush()
    const leases = f.runtime.mock.calls.filter(([path, , body]) => path?.endsWith('/lease') && JSON.parse(body!).epoch)
    expect(leases).toHaveLength(1)
    expect(JSON.parse(leases[0][2]!).workAnalyticsVersion).toBe(1)
    f.service.dispose()
  })

  it('discards unsupported Work queues on withdrawal and fences a switched account', async () => {
    const f = fixture(); f.actor(randomUUID()); await f.service.setEnabled(true); await settle()
    const epoch = f.state().epoch
    await f.service.track({ name: 'work_task_submitted', properties: { mode: 'work', runKey: 'b'.repeat(64) } }, epoch)
    const oldId = f.state().events.at(-1)!.eventId
    f.actor(randomUUID()); f.workVersion(1); await f.service.flush()
    await f.service.track({ name: 'work_entered', properties: { mode: 'work' } }, epoch)
    expect(f.sent.flatMap(batch => batch.events).some(e => e.eventId === oldId)).toBe(false)
    expect(f.state().events.some(e => e.properties.mode === 'work')).toBe(false)
    await f.service.track({ name: 'work_entered', properties: { mode: 'work' } })
    await f.service.setEnabled(false)
    expect(f.state().events).toEqual([]); f.service.dispose()
  })

  it('defaults missing server support to zero and only recognizes consent-epoch Work request markers', () => {
    expect(AnalyticsConfig.parse({ schemaVersion: 1, policyVersion: 'product-analytics-v1', collectionEnabled: true, guidanceEnabled: false }).workAnalyticsVersion).toBe(0)
    const epoch = randomUUID(), id = `turn_work_${epoch}_${randomUUID()}`
    expect(workRequestEpoch(id)).toBe(epoch); expect(workRunKeySource(id)).toBe('work:' + id)
    for (const invalid of [undefined, '', 'turn_old', id + 'tail', 'prefix' + id, 'turn_work_bad_bad']) expect(workRequestEpoch(invalid)).toBeNull()
  })

})
