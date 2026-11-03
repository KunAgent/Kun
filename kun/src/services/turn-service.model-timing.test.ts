import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { FileThreadStore } from '../adapters/file/file-thread-store.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'
import { UsageService } from './usage-service.js'

function timedUsage(completionTokens: number, requestTtftMs: number, requestGenerationMs: number) {
  return { ...emptyUsageSnapshot(), completionTokens, totalTokens: completionTokens, turns: 1, requestTtftMs, requestGenerationMs }
}

async function harness(dataDir: string) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new FileThreadStore({ dataDir })
  const eventBus = new InMemoryEventBus()
  const nowIso = () => '2026-10-21T00:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso
  })
  const usage = new UsageService()
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(),
    nowIso,
    usage
  })
  await threadStore.upsert(createThreadRecord({ id: 'thr_timing', title: 'Timing', workspace: '/tmp/workspace', model: 'm' }))
  return { turns, usage }
}

describe('TurnService model timing', () => {
  it('stamps the turn averages on the settled turn so they survive a restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-turn-model-timing-'))
    try {
      const { turns, usage } = await harness(dataDir)
      const started = await turns.startTurn({ threadId: 'thr_timing', request: { prompt: 'hi', model: 'm' } })
      usage.record('thr_timing', timedUsage(40, 400, 1_000), undefined, started.turnId)
      const live = usage.record('thr_timing', timedUsage(60, 800, 1_000), undefined, started.turnId)

      await turns.finishTurn({ threadId: 'thr_timing', turnId: started.turnId, status: 'completed' })

      // A fresh store reads what the next runtime process would see.
      const reloaded = await new FileThreadStore({ dataDir }).get('thr_timing')
      expect(reloaded?.turns.find((turn) => turn.id === started.turnId)?.modelTiming).toEqual({
        avgTtftMs: live.turnAvgTtftMs,
        avgTokensPerSecond: live.turnAvgTokensPerSecond
      })
      expect(live.turnAvgTtftMs).toBe(600)
      expect(live.turnAvgTokensPerSecond).toBe(50)
      // The in-memory fold is released once the turn has its copy.
      expect(usage.turnModelTiming('thr_timing', started.turnId)).toBeUndefined()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('leaves a turn without measured calls unstamped', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-turn-model-timing-none-'))
    try {
      const { turns, usage } = await harness(dataDir)
      const started = await turns.startTurn({ threadId: 'thr_timing', request: { prompt: 'hi', model: 'm' } })
      usage.record('thr_timing', { ...emptyUsageSnapshot(), completionTokens: 5, totalTokens: 5, turns: 1 }, undefined, started.turnId)

      await turns.finishTurn({ threadId: 'thr_timing', turnId: started.turnId, status: 'failed', error: 'boom' })

      const reloaded = await new FileThreadStore({ dataDir }).get('thr_timing')
      const turn = reloaded?.turns.find((candidate) => candidate.id === started.turnId)
      expect(turn?.status).toBe('failed')
      expect(turn).not.toHaveProperty('modelTiming')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
