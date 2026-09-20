import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { TurnClientSurface, TurnStatus } from '../contracts/turns.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { DEFAULT_MAX_CONCURRENT_TURNS, TurnCapacityError, TurnService } from './turn-service.js'

function createHarness(maxConcurrentTurns?: number) {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-09-13T00:00:00.000Z'
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events: new RuntimeEventRecorder({
      eventBus, sessionStore, allocateSeq: (threadId) => eventBus.allocateSeq(threadId), nowIso
    }),
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(),
    nowIso,
    maxConcurrentTurns
  })
  return { turns, threadStore, sessionStore }
}

function threadWithTurns(
  id: string,
  clientSurface: TurnClientSurface,
  statuses: TurnStatus[],
  extra: Partial<ThreadRecord> = {}
): ThreadRecord {
  return {
    ...createThreadRecord({ id, title: id, workspace: '/tmp/capacity', model: 'test-model' }),
    ...extra,
    turns: statuses.map((status, index) => createTurnRecord({
      id: `${id}_turn_${index}`, threadId: id, prompt: 'private prompt', clientSurface, status
    }))
  }
}

describe('TurnService.capacitySnapshot', () => {
  it('counts persisted turns on every surface, rooms, and archived side threads', async () => {
    const h = createHarness(19)
    const surfaces: TurnClientSurface[] = ['gui', 'tui', 'cli', 'api', 'im', 'extension']
    for (const surface of surfaces) {
      await h.threadStore.upsert(threadWithTurns(`thr_${surface}`, surface,
        ['running', 'queued', 'queued', 'completed', 'failed', 'aborted'],
        surface === 'extension'
          ? { ownerExtensionId: 'com.example.foreign', ownerExtensionVersion: '1.0.0' }
          : {}
      ))
    }
    await h.threadStore.upsert(threadWithTurns('thr_room', 'gui', ['running', 'queued'], {
      relation: 'side',
      roomContext: {
        roomId: 'room_private', memberId: 'developer', kind: 'execution',
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: []
      }
    }))
    await h.threadStore.upsert(threadWithTurns('thr_archived_side', 'api', ['running', 'queued'], {
      relation: 'side', status: 'archived'
    }))
    const list = vi.spyOn(h.threadStore, 'list')
    const loadItems = vi.spyOn(h.sessionStore, 'loadItems')

    expect(await h.turns.capacitySnapshot()).toEqual({
      activeTurns: 8, queuedTurns: 14, maxConcurrentTurns: 19, busy: true
    })
    expect(list).toHaveBeenCalledWith({ includeArchived: true, includeSide: true })
    expect(loadItems).not.toHaveBeenCalled()
  })

  it('uses metadata without loading history and does not turn store errors into idle', async () => {
    const h = createHarness()
    const thread = threadWithTurns('thr_metadata', 'gui', ['running'])
    await h.threadStore.upsert(thread)
    const metadata = vi.fn(async () => thread as ThreadRecord | null)
    Object.assign(h.threadStore, { getMetadata: metadata })
    const get = vi.spyOn(h.threadStore, 'get')
    expect(await h.turns.capacitySnapshot()).toMatchObject({ activeTurns: 1, busy: true })
    expect(get).not.toHaveBeenCalled()

    metadata.mockResolvedValueOnce(null)
    expect(await h.turns.capacitySnapshot()).toMatchObject({ activeTurns: 0, busy: false })
    metadata.mockRejectedValueOnce(new Error('metadata unavailable'))
    await expect(h.turns.capacitySnapshot()).rejects.toThrow('metadata unavailable')
  })

  it('tracks admission, queue promotion, settlement, and the live admission limit', async () => {
    const h = createHarness(1)
    await h.threadStore.upsert(threadWithTurns('thr_first', 'gui', []))
    await h.threadStore.upsert(threadWithTurns('thr_second', 'extension', []))
    const start = (threadId: string) => h.turns.startTurn({
      threadId, request: { prompt: 'run', model: 'test-model' }
    })
    const first = await start('thr_first')
    await expect(start('thr_second')).rejects.toBeInstanceOf(TurnCapacityError)
    const queued = await h.turns.enqueueTurn({
      threadId: 'thr_second', request: { prompt: 'queued', model: 'test-model' }
    })
    expect(await h.turns.capacitySnapshot()).toEqual({
      activeTurns: 1, queuedTurns: 1, maxConcurrentTurns: 1, busy: true
    })
    expect(await h.turns.startNextQueuedTurn('thr_second')).toBeNull()

    await h.turns.finishTurn({ threadId: 'thr_first', turnId: first.turnId, status: 'completed' })
    expect(await h.turns.capacitySnapshot()).toEqual({
      activeTurns: 0, queuedTurns: 1, maxConcurrentTurns: 1, busy: true
    })
    await h.turns.startNextQueuedTurn('thr_second')
    expect(await h.turns.capacitySnapshot()).toMatchObject({ activeTurns: 1, queuedTurns: 0, busy: true })

    h.turns.updateRuntimeConfig({ maxConcurrentTurns: 2.9 })
    const next = await start('thr_first')
    expect(await h.turns.capacitySnapshot()).toEqual({
      activeTurns: 2, queuedTurns: 0, maxConcurrentTurns: 2, busy: true
    })
    await h.turns.finishTurn({ threadId: 'thr_first', turnId: next.turnId, status: 'failed' })
    await h.turns.interruptTurn({ threadId: 'thr_second', turnId: queued.turnId })
    expect(await h.turns.capacitySnapshot()).toEqual({
      activeTurns: 0, queuedTurns: 0, maxConcurrentTurns: 2, busy: false
    })
    h.turns.updateRuntimeConfig({ maxConcurrentTurns: undefined })
    expect((await h.turns.capacitySnapshot()).maxConcurrentTurns).toBe(DEFAULT_MAX_CONCURRENT_TURNS)
  })
})
