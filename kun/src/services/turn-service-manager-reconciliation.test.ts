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
  return { recovered, started }
}

describe('managed Runtime restart reconciliation', () => {
  it('leaves a sibling Runtime turn untouched while its Manager lease is live', async () => {
    const test = await fixture(async (threadId) => ({
      threadId,
      turnId: 'turn-owned-by-sibling',
      ownerFlavor: 'development',
      ownerInstanceId: 'development-live',
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
      .resolves.toEqual([test.started.threadId])
    await expect(test.recovered.getTurn(test.started.threadId, test.started.turnId))
      .resolves.toMatchObject({
        status: 'failed',
        error: 'Turn was interrupted by a runtime restart.'
      })
  })
})
