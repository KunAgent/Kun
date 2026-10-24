import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { ProductAnalyticsObserver } from './observer.js'
import { acknowledgeAnalytics, leaseAnalytics, readAnalytics } from './outbox.js'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const run of cleanup.splice(0)) await run() })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-analytics-'))
  const store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  cleanup.push(async () => { await store.close(); await rm(dir, { recursive: true, force: true }) })
  const thread = { id: 'thread1', title: 'PRIVATE', agentSurface: 'code' } as ThreadRecord
  const turn = { id: 'turn1', threadId: 'thread1', clientSurface: 'gui' } as Turn
  const observer = new ProductAnalyticsObserver({ store, threads: { get: async () => thread }, turns: { getTurn: async () => turn } })
  const event = (kind: string, timestamp = new Date().toISOString()) => ({ kind, threadId: 'thread1', turnId: 'turn1', timestamp,
    seq: 1, text: 'DO NOT COLLECT', details: { path: '/private/code' } } as RuntimeEvent)
  return { store, thread, turn, observer, event }
}
describe('runtime analytics opt-in', () => {
  it('does not even read storage on normal legacy-user events', async () => {
    const f = await fixture(), get = vi.spyOn(f.store, 'get')
    f.observer.record(f.event('turn_started')); f.observer.record(f.event('turn_completed'))
    await Promise.resolve(); expect(get).not.toHaveBeenCalled()
  })
  it('records only minimal facts, does not modify rewards, and uses stable replay ids', async () => {
    const f = await fixture(), epoch = randomUUID(); await leaseAnalytics(f.store, epoch)
    f.observer.record(f.event('turn_started'))
    await vi.waitFor(async () => expect((await readAnalytics(f.store)).value.events).toHaveLength(1))
    f.observer.record(f.event('turn_failed'))
    await vi.waitFor(async () => expect((await readAnalytics(f.store)).value.events).toHaveLength(2))
    const events = (await readAnalytics(f.store)).value.events
    expect(events[1].properties.status).toBe('failed')
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|DO NOT COLLECT|private\/code/)
    expect(await f.store.get('room_wardrobe', 'self')).toBeNull()
    await acknowledgeAnalytics(f.store, epoch, events.map(e => e.eventId))
    expect((await readAnalytics(f.store)).value.events).toEqual([])
  })
  it('drops terminal events across consent/account epoch changes and does not backfill history', async () => {
    const f = await fixture(); await leaseAnalytics(f.store, randomUUID())
    f.observer.record(f.event('turn_started', new Date(Date.now()-60_000).toISOString()))
    await new Promise(r => setTimeout(r, 10)); expect((await readAnalytics(f.store)).value.events).toEqual([])
    f.observer.record(f.event('turn_started'))
    await vi.waitFor(async () => expect((await readAnalytics(f.store)).value.events).toHaveLength(1))
    await leaseAnalytics(f.store, randomUUID()); f.observer.record(f.event('turn_completed'))
    await new Promise(r => setTimeout(r, 10)); expect((await readAnalytics(f.store)).value.events).toEqual([])
  })
  it('ignores non-Code surfaces and background turns', async () => {
    const f = await fixture(); await leaseAnalytics(f.store, randomUUID()); f.thread.agentSurface = 'write'
    f.observer.record(f.event('turn_started'))
    await new Promise(r => setTimeout(r, 10)); expect((await readAnalytics(f.store)).value.events).toEqual([])
    f.thread.agentSurface = 'code'; f.turn.messageSource = 'background_subagent'
    f.observer.record(f.event('turn_started'))
    await new Promise(r => setTimeout(r, 10)); expect((await readAnalytics(f.store)).value.events).toEqual([])
  })
  it('a delayed opt-out cannot revoke a newer consent epoch', async () => {
    const f = await fixture(), oldEpoch = randomUUID(), nextEpoch = randomUUID()
    await leaseAnalytics(f.store, oldEpoch); await leaseAnalytics(f.store, nextEpoch)
    await leaseAnalytics(f.store, null, oldEpoch)
    expect((await readAnalytics(f.store)).value.epoch).toBe(nextEpoch)
    f.observer.record(f.event('turn_started'))
    await vi.waitFor(async () => expect((await readAnalytics(f.store)).value.events).toHaveLength(1))
  })

})
