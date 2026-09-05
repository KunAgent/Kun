import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ThreadExecutionLeasePort } from '../ports/thread-execution-lease.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'

async function fixture(owner: ThreadExecutionLeasePort['owner']) {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-08-21T08:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso
  })
  const base = {
    threadStore,
    sessionStore,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(),
    nowIso
  }
  const original = new TurnService(base)
  const threadId = 'thread-managed-recovery'
  await threadStore.upsert(createThreadRecord({
    id: threadId,
    title: 'Managed recovery',
    workspace: '/tmp/workspace',
    model: 'test-model'
  }))
  const started = await original.startTurn({
    threadId,
    request: { prompt: 'Continue safely.' }
  })
  const executionLeases: ThreadExecutionLeasePort = {
    acquire: vi.fn(),
    release: vi.fn(),
    owner
  }
  const recovered = new TurnService({
    ...base,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    executionLeases
  })
  return { original, recovered, started, threadStore, sessionStore }
}

async function persistManagerSettlement(test: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  await test.original.finishTurn({
    threadId: test.started.threadId,
    turnId: test.started.turnId,
    status: 'failed',
    error: 'Turn owner stopped heartbeating.',
    code: 'owner_lease_expired',
    severity: 'warning'
  })
  const thread = await test.threadStore.get(test.started.threadId)
  if (!thread) throw new Error('fixture thread missing')
  await test.threadStore.upsert({
    ...thread,
    turns: thread.turns.map((turn) => turn.id === test.started.turnId
      ? {
          ...turn,
          managerLeaseSettlement: {
            code: 'owner_lease_expired' as const,
            ownerFlavor: 'production' as const,
            ownerInstanceId: 'runtime-dead',
            fencingToken: 1,
            settledAt: '2026-08-21T08:00:00.000Z'
          }
        }
      : turn)
  })
}

describe('managed Runtime restart reconciliation', () => {
  it('leaves a sibling Runtime turn untouched while its Manager lease is live', async () => {
    const test = await fixture(async (threadId) => ({
      threadId,
      turnId: 'turn-owned-by-sibling',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-live',
      fencingToken: 1,
      acquiredAt: '2026-08-21T07:59:50.000Z',
      expiresAt: '2026-08-21T08:00:05.000Z'
    }))

    await expect(test.recovered.reconcileOrphanedTurns()).resolves.toEqual([])
    await expect(test.recovered.getTurn(test.started.threadId, test.started.turnId))
      .resolves.toMatchObject({ status: 'running' })
  })

  it('fails closed when Manager lease ownership cannot be read', async () => {
    const test = await fixture(async () => {
      throw new Error('Manager unavailable')
    })

    await expect(test.recovered.reconcileOrphanedTurns()).resolves.toEqual([])
    await expect(test.recovered.getTurn(test.started.threadId, test.started.turnId))
      .resolves.toMatchObject({ status: 'running' })
  })

  it('reconciles and checkpoints an active turn once the Manager has no owner', async () => {
    const test = await fixture(async () => null)

    await expect(test.recovered.reconcileOrphanedTurns())
      .resolves.toEqual([{
        threadId: test.started.threadId,
        turnId: test.started.turnId
      }])
    await expect(test.recovered.getTurn(test.started.threadId, test.started.turnId))
      .resolves.toMatchObject({
        status: 'failed',
        error: 'Turn was interrupted by a runtime restart.'
      })
  })

  it('persists a terminal code and checkpoints a Manager-settled turn without duplication', async () => {
    const test = await fixture(async () => null)
    await persistManagerSettlement(test)

    await expect(test.recovered.getTurn(test.started.threadId, test.started.turnId))
      .resolves.toMatchObject({
        status: 'failed',
        terminalCode: 'owner_lease_expired'
    })
    await expect(test.recovered.reconcileManagerSettledInterruptions())
      .resolves.toEqual([{
        threadId: test.started.threadId,
        turnId: test.started.turnId
      }])
    await expect(test.recovered.reconcileManagerSettledInterruptions())
      .resolves.toEqual([{
        threadId: test.started.threadId,
        turnId: test.started.turnId
      }])

    const notes = (await test.sessionStore.loadItems(test.started.threadId))
      .filter((item) => item.kind === 'interruption_note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      id: `item_${test.started.turnId}_interruption_note`,
      sourceTurnId: test.started.turnId
    })
  })

  it('recognizes the exact legacy canonical error item without terminalCode', async () => {
    const test = await fixture(async () => null)
    await test.original.finishTurn({
      threadId: test.started.threadId,
      turnId: test.started.turnId,
      status: 'failed',
      error: 'Turn owner stopped heartbeating.',
      code: 'owner_lease_expired',
      severity: 'warning'
    })
    const thread = await test.threadStore.get(test.started.threadId)
    if (!thread) throw new Error('fixture thread missing')
    await test.threadStore.upsert({
      ...thread,
      turns: thread.turns.map((turn) => {
        if (turn.id !== test.started.turnId) return turn
        const { terminalCode: _terminalCode, ...legacy } = turn
        return legacy
      })
    })

    await expect(test.recovered.reconcileManagerSettledInterruptions())
      .resolves.toEqual([{
        threadId: test.started.threadId,
        turnId: test.started.turnId
      }])
  })

  it('returns a source with a retained non-active goal for ordinary recovery', async () => {
    const test = await fixture(async () => null)
    await persistManagerSettlement(test)
    const thread = await test.threadStore.get(test.started.threadId)
    if (!thread) throw new Error('fixture thread missing')
    await test.threadStore.upsert({
      ...thread,
      goal: {
        threadId: thread.id,
        objective: 'A previous goal remains paused',
        status: 'paused',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: '2026-08-21T07:00:00.000Z',
        updatedAt: '2026-08-21T08:00:00.000Z'
      }
    })

    await expect(test.recovered.reconcileManagerSettledInterruptions()).resolves.toEqual([{
      threadId: test.started.threadId,
      turnId: test.started.turnId
    }])
  })

  it('does not trust a generic terminal code without Manager provenance', async () => {
    const test = await fixture(async () => null)
    await test.original.finishTurn({
      threadId: test.started.threadId,
      turnId: test.started.turnId,
      status: 'failed',
      error: 'provider supplied this code',
      code: 'owner_lease_expired'
    })

    await expect(test.recovered.reconcileManagerSettledInterruptions()).resolves.toEqual([])
  })

  it('does not auto-resume Manager settlements older than the startup window', async () => {
    const test = await fixture(async () => null)
    await persistManagerSettlement(test)

    await expect(test.recovered.reconcileManagerSettledInterruptions({
      settledAfter: '2026-08-21T08:00:01.000Z'
    })).resolves.toEqual([])
  })

  it('does not schedule recovery when the interruption checkpoint cannot commit', async () => {
    const test = await fixture(async () => null)
    await persistManagerSettlement(test)
    vi.spyOn(test.sessionStore, 'rewriteItemsIfRevision').mockResolvedValue({
      applied: false,
      reason: 'closed'
    })

    await expect(test.recovered.reconcileManagerSettledInterruptions()).resolves.toEqual([])
  })
})
