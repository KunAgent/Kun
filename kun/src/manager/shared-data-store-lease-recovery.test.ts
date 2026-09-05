import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Manager lease settlement rewind recovery', () => {
  it('cold-loads an expired turn as terminal and permits an authoritative rewind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-manager-rewind-recovery-'))
    roots.push(root)
    const dataDir = join(root, 'data')
    let store = await ManagerSharedDataStore.create(dataDir)
    const thread = createThreadRecord({
      id: 'thread-expired-rewind',
      title: 'Expired rewind',
      workspace: '/tmp/workspace',
      model: 'test-model'
    })
    const turn = createTurnRecord({
      id: 'turn-expired-rewind',
      threadId: thread.id,
      prompt: 'Recover this turn',
      status: 'running'
    })
    await store.executeThread('upsert', {
      thread: { ...thread, status: 'running', turns: [turn] }
    })
    await store.executeSession('checkpointLiveItem', {
      threadId: thread.id,
      representedSeq: 7,
      item: {
        id: 'item-expired-live',
        turnId: turn.id,
        threadId: thread.id,
        role: 'assistant',
        status: 'running',
        createdAt: '2026-09-02T00:00:00.000Z',
        kind: 'assistant_text',
        text: 'partial answer'
      }
    })
    await store.executeSession('checkpointLiveItem', {
      threadId: thread.id,
      representedSeq: 3,
      item: {
        id: 'item-rewound-ghost',
        turnId: 'turn-already-rewound',
        threadId: thread.id,
        role: 'assistant',
        status: 'running',
        createdAt: '2026-09-01T23:59:00.000Z',
        kind: 'assistant_reasoning',
        text: 'must not be resurrected'
      }
    })

    await expect(store.reconcileExpiredLease({
      threadId: thread.id,
      turnId: turn.id,
      ownerFlavor: 'production',
      ownerInstanceId: 'runtime-expired',
      fencingToken: 1,
      acquiredAt: '2026-09-02T00:00:00.000Z',
      expiresAt: '2026-09-02T00:00:30.000Z'
    })).resolves.toBe(true)
    await store.close()

    store = await ManagerSharedDataStore.create(dataDir)
    const coldSnapshot = await store.sessionStore.loadItemSnapshot(thread.id)
    expect(coldSnapshot.replayAfterSeq).toBeUndefined()
    expect(coldSnapshot.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'item-expired-live', status: 'failed' }),
      expect.objectContaining({ code: 'owner_lease_expired', status: 'failed' })
    ]))
    expect(coldSnapshot.items.some((item) => item.id === 'item-rewound-ghost')).toBe(false)
    expect(await store.threadStore.get(thread.id)).toMatchObject({
      status: 'idle',
      turns: [expect.objectContaining({
        id: turn.id,
        status: 'failed',
        terminalCode: 'owner_lease_expired'
      })]
    })

    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-09-02T00:01:00.000Z'
    const turns = new TurnService({
      threadStore: store.threadStore,
      sessionStore: store.sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore: store.sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })

    await expect(turns.rewindThread({ threadId: thread.id, turnId: turn.id }))
      .resolves.toMatchObject({ removedTurns: 1, remainingTurns: 0 })
    expect((await store.threadStore.get(thread.id))?.turns).toEqual([])
    expect(await store.sessionStore.loadItems(thread.id)).toEqual([])
    await store.close()
  })
})
