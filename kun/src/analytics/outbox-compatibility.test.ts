import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import {
  acknowledgeAnalytics, appendAnalytics, leaseAnalytics, readAnalytics, updateAnalytics, type PendingAnalytics
} from './outbox.js'

// The pre-Work strict event contract and stripping state shape. This models
// an installed older Runtime, independently from the expanded current enum.
const LegacyProps = z.object({
  mode: z.enum(['code', 'room']).optional(), scope: z.enum(['personal', 'shared']).optional(),
  operation: z.enum(['send_message', 'start_task', 'continue_task']).optional(),
  requestOutcome: z.enum(['accepted', 'failed', 'unknown']).optional(),
  step: z.enum(['welcome', 'model', 'permission', 'agents', 'account', 'ready', 'first_task']).optional(),
  action: z.enum(['entered', 'completed', 'skipped', 'copy', 'continue', 'selected']).optional(),
  status: z.enum(['completed', 'failed', 'cancelled']).optional(),
  errorCategory: z.enum(['network', 'authentication', 'quota', 'permission', 'configuration', 'runtime', 'unknown']).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(), outputPresent: z.boolean().optional(),
  runKey: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict()
const LegacyEvent = z.object({
  name: z.enum(['app_session_started', 'onboarding_step', 'provider_check_finished', 'remote_action_finished',
    'workspace_ready', 'account_session_ready', 'run_started', 'run_finished', 'result_presented', 'result_action']),
  properties: LegacyProps.default({}), eventId: z.string().uuid(), occurredAt: z.string().datetime()
}).strict()
const LegacyState = z.object({ epoch: z.string().uuid().nullable(), leaseUntil: z.number(),
  after: z.string(), events: z.array(LegacyEvent).max(1000) })
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const run of cleanup.splice(0)) await run() })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-analytics-rollback-'))
  const store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  cleanup.push(async () => { await store.close(); await rm(dir, { recursive: true, force: true }) })
  const epoch = randomUUID()
  await leaseAnalytics(store, epoch, undefined, 1)
  const event = (mode: 'code' | 'room' | 'work'): PendingAnalytics => ({
    eventId: randomUUID(), occurredAt: new Date().toISOString(), name: 'run_started',
    properties: { mode, runKey: 'b'.repeat(64) }
  })
  const raw = async () => (await store.get('product_analytics', 'self'))!.value
  const legacyWrite = async (change: (state: z.infer<typeof LegacyState>) => z.infer<typeof LegacyState>) => {
    const row = (await store.get('product_analytics', 'self'))!
    const value = change(LegacyState.parse(row.value))
    await store.commit({ requestId: randomUUID(),
      checks: [{ kind: 'product_analytics', id: 'self', expectedRevision: row.revision }],
      puts: [{ kind: 'product_analytics', id: 'self', value }], events: [] })
  }
  return { store, epoch, event, raw, legacyWrite }
}

describe('analytics Runtime storage rollback compatibility', () => {
  it('keeps the legacy array readable and restores exact mixed order without leaking storage fields to the API', async () => {
    const f = await fixture()
    const events = [f.event('work'), f.event('code'), f.event('work'), f.event('room')]
    for (const event of events) await appendAnalytics(f.store, f.epoch, event)
    const legacy = LegacyState.parse(await f.raw())
    expect(legacy.events).toEqual([events[1], events[3]])
    const stored = await f.raw() as { workEvents: { position: number; event: PendingAnalytics }[] }
    expect(stored.workEvents).toEqual([{ position: 0, event: events[0] }, { position: 2, event: events[2] }])
    const state = (await readAnalytics(f.store)).value
    expect(state.events).toEqual(events)
    expect(state).not.toHaveProperty('workEvents')
    await acknowledgeAnalytics(f.store, f.epoch, [events[1].eventId, events[2].eventId])
    expect((await readAnalytics(f.store)).value.events).toEqual([events[0], events[3]])
    expect(LegacyState.parse(await f.raw()).events).toEqual([events[3]])
    await appendAnalytics(f.store, f.epoch, events[0])
    expect((await readAnalytics(f.store)).value.events).toHaveLength(2)
  })

  it('supports an older Runtime lease rewrite, new legacy events, and later upgrading again', async () => {
    const f = await fixture(), code = f.event('code'), work = f.event('work'), room = f.event('room')
    await appendAnalytics(f.store, f.epoch, code); await appendAnalytics(f.store, f.epoch, work)
    await f.legacyWrite(state => ({ ...state, leaseUntil: Date.now() + 45_000 }))
    expect((await readAnalytics(f.store)).value).toMatchObject({ workAnalyticsVersion: 0, events: [code] })
    await f.legacyWrite(state => ({ ...state, events: [...state.events, room] }))
    await leaseAnalytics(f.store, f.epoch, undefined, 1)
    const next = f.event('work'); await appendAnalytics(f.store, f.epoch, next)
    expect((await readAnalytics(f.store)).value.events).toEqual([code, room, next])
    expect(LegacyState.parse(await f.raw()).events).toEqual([code, room])
  })

  it('allows the old Runtime to clear the queue without interpreting new Work events', async () => {
    const f = await fixture()
    await appendAnalytics(f.store, f.epoch, f.event('work'))
    await appendAnalytics(f.store, f.epoch, f.event('code'))
    await f.legacyWrite(state => ({ ...state, epoch: null, leaseUntil: 0, events: [] }))
    expect((await readAnalytics(f.store)).value).toMatchObject({ epoch: null, workAnalyticsVersion: 0, events: [] })
    expect(LegacyState.parse(await f.raw()).events).toEqual([])
  })

  it('retains Code/Room when an old Main downgrades a current Runtime in the same epoch', async () => {
    const f = await fixture(), code = f.event('code'), work = f.event('work')
    await appendAnalytics(f.store, f.epoch, work); await appendAnalytics(f.store, f.epoch, code)
    await leaseAnalytics(f.store, f.epoch)
    expect((await readAnalytics(f.store)).value).toMatchObject({ workAnalyticsVersion: 0, events: [code] })
    expect(await f.raw()).toMatchObject({ events: [code], workEvents: [] })
    await appendAnalytics(f.store, f.epoch, work)
    expect((await readAnalytics(f.store)).value.events).toEqual([code])
  })

  it('enforces one shared 1000-event capacity and fences acknowledgement/clear by epoch', async () => {
    const f = await fixture()
    const events = Array.from({ length: 1000 }, (_, index) => f.event(index % 2 ? 'work' : 'code'))
    await updateAnalytics(f.store, state => ({ ...state, events }))
    const latest = f.event('room'); await appendAnalytics(f.store, f.epoch, latest)
    expect((await readAnalytics(f.store)).value.events).toEqual([...events.slice(1), latest])
    const stored = await f.raw() as { events: PendingAnalytics[]; workEvents: unknown[] }
    expect(stored.events.length + stored.workEvents.length).toBe(1000)
    const staleEpoch = randomUUID()
    await acknowledgeAnalytics(f.store, staleEpoch, [latest.eventId])
    await leaseAnalytics(f.store, null, staleEpoch)
    expect((await readAnalytics(f.store)).value.events).toHaveLength(1000)
    await leaseAnalytics(f.store, randomUUID(), undefined, 1)
    expect((await readAnalytics(f.store)).value.events).toEqual([])
    expect(await f.raw()).toMatchObject({ events: [], workEvents: [] })
  })
})
