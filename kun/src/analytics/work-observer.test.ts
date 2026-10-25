import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
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

async function fixture(options: { consent?: boolean; capability?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-work-analytics-'))
  const store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  cleanup.push(async () => { await store.close(); await rm(dir, { recursive: true, force: true }) })
  const epoch = randomUUID()
  if (options.consent !== false) {
    await leaseAnalytics(store, epoch, undefined, options.capability === 0 ? 0 : 1)
  }
  const thread = { id: 'thread1', title: 'PRIVATE TITLE', agentSurface: 'write' } as ThreadRecord
  const turn = { id: 'turn1', threadId: 'thread1', clientSurface: 'gui',
    clientRequestId: `turn_work_${epoch}_${randomUUID()}` } as Turn
  const getThread = vi.fn(async () => thread)
  const observer = new ProductAnalyticsObserver({ store, threads: { get: getThread }, turns: { getTurn: async () => turn } })
  const now = Date.now() + 1
  const event = (kind: string, extra: Record<string, unknown> = {}, at = now) => ({
    kind, threadId: thread.id, turnId: turn.id, timestamp: new Date(at).toISOString(), seq: 1,
    prompt: 'SECRET PROMPT', answers: ['SECRET ANSWER'], reason: '/private/file', ...extra
  } as unknown as RuntimeEvent)
  // Await only the observer's private best-effort queues, never the agent event pipeline.
  const emit = async (kind: string, extra: Record<string, unknown> = {}, at = now) => {
    observer.record(event(kind, extra, at))
    const queues = observer as unknown as { lane: Promise<void>; work: { lane: Promise<void> } }
    await Promise.all([queues.lane, queues.work.lane])
  }
  const events = async () => (await readAnalytics(store)).value.events
  return { store, epoch, thread, turn, getThread, observer, emit, event, events, now }
}

describe('Work runtime analytics', () => {
  it('keeps legacy users at zero analytics IO and old Main leases free of Work events', async () => {
    const off = await fixture({ consent: false })
    const read = vi.spyOn(off.store, 'get')
    await off.emit('turn_started')
    await off.emit('approval_requested', { approvalId: 'private', approvalReviewer: 'user', status: 'pending' })
    expect(read).not.toHaveBeenCalled()
    expect(off.getThread).not.toHaveBeenCalled()
    const old = await fixture({ capability: 0 })
    await old.emit('turn_started'); await old.emit('turn_completed')
    expect(await old.events()).toEqual([])
  })

  it('records a root user Work turn with opaque identity and an independent technical terminal status', async () => {
    const f = await fixture()
    await f.emit('turn_started')
    await f.emit('turn_completed', {}, f.now + 250)
    const events = await f.events()
    expect(events.map(event => event.name)).toEqual(['run_started', 'run_finished'])
    const runKey = createHash('sha256').update('work:' + f.turn.clientRequestId).digest('hex')
    expect(events[0].properties).toEqual({ mode: 'work', runKey })
    expect(events[1].properties).toEqual({ mode: 'work', runKey, status: 'completed', durationMs: 250 })
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE|SECRET|private|thread1|turn1|turn_work_/)
    expect(await f.store.get('room_wardrobe', 'self')).toBeNull()
  })

  it('keeps existing Code and Room event shapes intact', async () => {
    const code = await fixture({ capability: 0 }); code.thread.agentSurface = 'code'
    await code.emit('turn_started'); await code.emit('turn_failed', { code: 'model_network_error' }, code.now + 10)
    expect((await code.events()).map(event => [event.name, event.properties.mode])).toEqual([
      ['run_started', 'code'], ['run_finished', 'code']
    ])
    const room = await fixture({ capability: 0 })
    room.thread.agentSurface = 'code'
    room.thread.roomContext = { roomId: 'room1' } as ThreadRecord['roomContext']
    await room.emit('turn_started'); await room.emit('turn_aborted', {}, room.now + 10)
    expect((await room.events()).map(event => [event.name, event.properties.mode])).toEqual([
      ['run_started', 'room'], ['run_finished', 'room']
    ])
  })

  it('prefers the turn surface and permits thread fallback only when the turn has none', async () => {
    const f = await fixture(); f.thread.agentSurface = 'code'; f.turn.agentSurface = 'write'
    await f.emit('turn_started'); await f.emit('turn_completed')
    expect((await f.events()).map(event => event.properties.mode)).toEqual(['work', 'work'])
    const other = await fixture(); other.turn.agentSurface = 'design'
    await other.emit('turn_started')
    expect(await other.events()).toEqual([])
  })

  it.each([
    ['parentThreadId', 'parent'], ['executionUnit', { kind: 'worker' }], ['ownerExtensionId', 'extension'],
    ['historyRefId', 'history'], ['roomContext', { roomId: 'room1' }],
    ['workbenchOrigin', { kind: 'bot', roomId: 'room1', linkId: 'link', agentId: 'bot' }]
  ])('excludes the %s execution boundary from Work usage', async (field, value) => {
    const f = await fixture(); Object.assign(f.thread, { [String(field)]: value })
    await f.emit('turn_started'); await f.emit('turn_completed')
    expect((await f.events()).filter(event => event.properties.mode === 'work')).toEqual([])
  })

  it.each([
    { clientRequestId: undefined }, { clientRequestId: 'ordinary-request' },
    { clientRequestId: 'subagent-recovery:123' }, { clientRequestId: `turn_work_${randomUUID()}_${randomUUID()}` },
    { clientSurface: 'api' }, { clientSurface: undefined }, { messageSource: 'background_subagent' },
    { messageSource: 'background_shell' }, { messageSource: 'worker_update' }
  ])('excludes autonomous, unmarked, stale-epoch or non-GUI starts: %j', async changes => {
    const f = await fixture(); Object.assign(f.turn, changes)
    await f.emit('turn_started'); await f.emit('turn_completed')
    expect(await f.events()).toEqual([])
  })

  it('does not backfill old runs and does not repeat acknowledged start or terminal events', async () => {
    const f = await fixture()
    await f.emit('turn_started', {}, f.now - 60_000)
    await f.emit('turn_completed')
    expect(await f.events()).toEqual([])
    await f.emit('turn_started'); await f.emit('turn_started')
    await f.emit('turn_completed', {}, f.now + 20)
    const accepted = await f.events()
    expect(accepted).toHaveLength(2)
    await acknowledgeAnalytics(f.store, f.epoch, accepted.map(event => event.eventId))
    await f.emit('turn_started'); await f.emit('turn_completed', {}, f.now + 20)
    expect(await f.events()).toEqual([])
    // A repeated admission id attached to another execution is still the same user task.
    f.turn.id = 'turn2'
    await f.emit('turn_started')
    expect(await f.events()).toEqual([])
  })

  it('drops in-flight state on account/consent changes and rejects a request captured under the previous epoch', async () => {
    const f = await fixture()
    await f.emit('turn_started')
    await leaseAnalytics(f.store, randomUUID(), undefined, 1)
    await f.emit('turn_completed'); await f.emit('turn_started')
    expect(await f.events()).toEqual([])
    await leaseAnalytics(f.store, null)
    const get = vi.spyOn(f.store, 'get')
    await f.emit('turn_started'); await f.emit('turn_completed')
    expect(get).not.toHaveBeenCalled()
  })

  it('separates human approval from automatic review and deduplicates resolved waits', async () => {
    const f = await fixture(); await f.emit('turn_started')
    await f.emit('approval_requested', { approvalId: 'automatic', approvalReviewer: 'agent', status: 'pending' })
    await f.emit('approval_resolved', { approvalId: 'automatic', approvalReviewer: 'agent', status: 'allowed' })
    const pending = { approvalId: 'private-human-id', approvalReviewer: 'user', status: 'pending' }
    await f.emit('approval_requested', pending, f.now + 10)
    await f.emit('approval_requested', pending, f.now + 10)
    await f.emit('approval_resolved', { ...pending, status: 'allowed' }, f.now + 40)
    await f.emit('approval_resolved', { ...pending, status: 'allowed' }, f.now + 40)
    await f.emit('turn_completed', {}, f.now + 50)
    const events = await f.events()
    expect(events.map(event => event.name)).toEqual(['run_started', 'work_wait_started', 'work_wait_finished', 'run_finished'])
    expect(events[2].properties).toMatchObject({ mode: 'work', waitKind: 'approval', waitOutcome: 'approved', durationMs: 30 })
    expect(JSON.stringify(events)).not.toMatch(/private-human-id|SECRET|automatic/)
  })

  it('purges queued Work events when an old Main renews the same epoch and keeps existing Code events', async () => {
    const f = await fixture()
    await f.emit('turn_started')
    f.thread.agentSurface = 'code'; f.turn.id = 'code-turn'
    await f.emit('turn_started'); await f.emit('turn_completed', {}, f.now + 5)
    expect((await f.events()).map(event => event.properties.mode)).toEqual(['work', 'code', 'code'])
    await leaseAnalytics(f.store, f.epoch)
    expect((await readAnalytics(f.store)).value.workAnalyticsVersion).toBe(0)
    expect((await f.events()).map(event => event.properties.mode)).toEqual(['code', 'code'])
    f.thread.agentSurface = 'write'; f.turn.id = 'turn1'
    await f.emit('turn_completed', {}, f.now + 10)
    expect((await f.events()).map(event => event.properties.mode)).toEqual(['code', 'code'])
  })

  it.each([
    ['approval', 'denied', 'denied'], ['approval', 'expired', 'unknown'],
    ['user_input', 'submitted', 'submitted'], ['user_input', 'cancelled', 'cancelled'], ['user_input', 'timeout', 'timeout']
  ])('classifies %s %s as %s without changing the run terminal state', async (kind, status, expected) => {
    const f = await fixture(); await f.emit('turn_started')
    const identity = kind === 'approval'
      ? { approvalId: 'private-id', approvalReviewer: 'user' } : { inputId: 'private-id' }
    await f.emit(`${kind}_requested`, { ...identity, status: 'pending' }, f.now + 5)
    await f.emit(`${kind}_resolved`, { ...identity, status }, f.now + 15)
    await f.emit('turn_completed', {}, f.now + 20)
    const events = await f.events()
    expect(events.find(event => event.name === 'work_wait_finished')?.properties).toMatchObject({
      waitKind: kind, waitOutcome: expected, durationMs: 10
    })
    expect(events.at(-1)?.properties.status).toBe('completed')
  })

  it('closes open waits on cancellation and ignores late settlements', async () => {
    const f = await fixture(); await f.emit('turn_started')
    await f.emit('user_input_resolved', { inputId: 'not-open', status: 'submitted' }, f.now + 1)
    await f.emit('user_input_requested', { inputId: 'open', status: 'pending' }, f.now + 5)
    await f.emit('turn_aborted', {}, f.now + 15)
    await f.emit('user_input_resolved', { inputId: 'open', status: 'submitted' }, f.now + 20)
    const events = await f.events()
    expect(events).toHaveLength(4)
    expect(events[2].properties).toMatchObject({ waitKind: 'user_input', waitOutcome: 'cancelled', durationMs: 10 })
    expect(events[3].properties.status).toBe('cancelled')
  })

  it('bounds outstanding and resolved wait identities for a long-running task', async () => {
    const f = await fixture(); await f.emit('turn_started')
    for (let index = 0; index < 132; index++) {
      await f.emit('user_input_requested', { inputId: `input-${index}`, status: 'pending' }, f.now + 1)
      await f.emit('user_input_resolved', { inputId: `input-${index}`, status: 'submitted' }, f.now + 2)
    }
    await f.emit('turn_completed', {}, f.now + 3)
    const events = await f.events()
    expect(events.filter(event => event.name === 'work_wait_started')).toHaveLength(128)
    expect(events.filter(event => event.name === 'work_wait_finished')).toHaveLength(128)
    expect(events.at(-1)?.name).toBe('run_finished')
  }, 30_000)

  it('isolates storage failures from the runtime event producer', async () => {
    const f = await fixture()
    const get = vi.spyOn(f.store, 'get').mockRejectedValue(new Error('analytics unavailable'))
    expect(f.observer.record(f.event('turn_started'))).toBeUndefined()
    await expect(f.emit('turn_completed')).resolves.toBeUndefined()
    get.mockRestore()
    expect(await f.events()).toEqual([])
  })
})
