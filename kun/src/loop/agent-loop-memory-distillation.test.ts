import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

describe('AgentLoop Memory distillation lifecycle', () => {
  it('notifies the coordinator only after the completed turn is durable', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-09-03T01:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const compactor = new ContextCompactor()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor,
      ids,
      nowIso
    })
    const model: ModelClient = {
      provider: 'test',
      model: 'test-model',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield { kind: 'assistant_text_delta', text: 'Done.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const schedule = vi.fn()
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: { request: async () => 'allow' } as never,
      userInputGate: {} as never,
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor,
      prefix: createImmutablePrefix({ systemPrompt: 'test' }),
      ids,
      nowIso,
      memoryDistillation: { schedule }
    })
    await threadStore.upsert(createThreadRecord({
      id: 'thread_1',
      title: 'Memory distillation',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId: 'thread_1',
      request: { prompt: 'Remember this preference.', model: model.model }
    })

    await expect(loop.runTurn('thread_1', started.turnId)).resolves.toBe('completed')
    expect((await threadStore.get('thread_1'))?.turns.at(-1)?.status).toBe('completed')
    expect(schedule).toHaveBeenCalledOnce()
    expect(schedule).toHaveBeenCalledWith({
      threadId: 'thread_1',
      turnId: started.turnId,
      status: 'completed'
    })
  })

  it('does not let a coordinator scheduling failure change completion', async () => {
    const schedule = vi.fn(() => { throw new Error('background failure') })
    const harness = await createMinimalLoop(schedule)
    await expect(harness.loop.runTurn('thread_2', harness.turnId)).resolves.toBe('completed')
    expect((await harness.threadStore.get('thread_2'))?.turns.at(-1)?.status).toBe('completed')
  })
})

async function createMinimalLoop(schedule: () => void) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const ids = new SequentialIdGenerator()
  const nowIso = () => '2026-09-03T01:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso
  })
  const compactor = new ContextCompactor()
  const turns = new TurnService({
    threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso
  })
  const model: ModelClient = {
    provider: 'test', model: 'test-model',
    async *stream() {
      yield { kind: 'assistant_text_delta' as const, text: 'Done.' }
      yield { kind: 'completed' as const, stopReason: 'stop' as const }
    }
  }
  const loop = new AgentLoop({
    threadStore, sessionStore,
    approvalGate: { request: async () => 'allow' } as never,
    userInputGate: {} as never,
    model, toolHost: new LocalToolHost({ tools: [] }), usage: new UsageService(),
    events, turns, inflight, steering, compactor,
    prefix: createImmutablePrefix({ systemPrompt: 'test' }), ids, nowIso,
    memoryDistillation: { schedule }
  })
  await threadStore.upsert(createThreadRecord({
    id: 'thread_2', title: 'Memory', workspace: '/tmp/workspace', model: model.model
  }))
  const started = await turns.startTurn({
    threadId: 'thread_2', request: { prompt: 'Remember this.', model: model.model }
  })
  return { loop, threadStore, turnId: started.turnId }
}
