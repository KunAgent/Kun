import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import { AgentLoop } from './agent-loop.js'
import { ContextCompactor } from './context-compactor.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'

/**
 * Mirrors the production incident: HTTP success, real usage accounting, and
 * `stopReason: "stop"` with zero text, reasoning, and tool calls.
 */
class UsageOnlyModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'empty-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield {
      kind: 'usage',
      usage: {
        promptTokens: 30_000,
        completionTokens: 1,
        totalTokens: 30_001,
        cacheHitRate: null,
        turns: 1
      }
    }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class ReasoningOnlyModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'reasoning-model'

  async *stream(): AsyncIterable<ModelStreamChunk> {
    yield { kind: 'assistant_reasoning_delta', text: 'internal reasoning' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

/**
 * Mirrors the room coordination incident: the model submits the scoped room
 * result tool, then the provider finishes the follow-up round with a bare
 * reasoning item (HTTP 200, real usage, no visible content).
 */
class SubmitThenEmptyModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'submit-then-empty-model'
  private calls = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.calls += 1
    if (this.calls === 1) {
      yield {
        kind: 'tool_call_complete',
        callId: 'call_room_plan',
        toolName: 'submit_room_plan',
        arguments: { kind: 'answer', response: 'Hi! How can I help?', participants: [], assignments: [] }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

const submitRoomPlanTool = LocalToolHost.defineTool({
  name: 'submit_room_plan',
  description: 'Submit the structured room decision for the current user request.',
  toolKind: 'tool_call',
  inputSchema: { type: 'object' },
  policy: 'auto',
  sideEffect: 'read-only',
  shouldAdvertise: (context) => context.roomStepKind === 'coordination',
  execute: async (args) => ({ output: { accepted: true, value: args } })
})

describe('AgentLoop empty model response safety net', () => {
  it('fails the turn visibly instead of persisting a completed empty answer', async () => {
    const harness = createHarness(new UsageOnlyModel())
    const started = await startTurn(harness, 'thr_empty')

    await expect(harness.loop.runTurn('thr_empty', started.turnId)).resolves.toBe('failed')

    const turn = await harness.turns.getTurn('thr_empty', started.turnId)
    expect(turn?.status).toBe('failed')
    expect(turn?.error).toContain('without returning text, reasoning, a tool call')

    const events = harness.eventBus.snapshotSince('thr_empty', 0)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'error',
        code: 'model_empty_response',
        severity: 'error'
      })
    ]))
    expect(events.some((event) => event.kind === 'turn_failed')).toBe(true)
    expect(events.some((event) => event.kind === 'turn_completed')).toBe(false)

    const items = await harness.sessionStore.loadItems('thr_empty')
    expect(items.some((item) => item.kind === 'error' && item.code === 'model_empty_response'))
      .toBe(true)
  })

  it('does not misclassify reasoning-only responses as empty', async () => {
    const harness = createHarness(new ReasoningOnlyModel())
    const started = await startTurn(harness, 'thr_reasoning')

    await expect(harness.loop.runTurn('thr_reasoning', started.turnId)).resolves.toBe('completed')

    const events = harness.eventBus.snapshotSince('thr_reasoning', 0)
    expect(events.some((event) => event.kind === 'error' && event.code === 'model_empty_response'))
      .toBe(false)
    expect(events.some((event) => event.kind === 'turn_completed')).toBe(true)
  })

  it('completes a room step when the scoped result was already submitted', async () => {
    const harness = createHarness(new SubmitThenEmptyModel(), {
      toolHost: new LocalToolHost({ tools: [submitRoomPlanTool] })
    })
    const started = await startTurn(harness, 'thr_room', {
      roomId: 'room-1',
      memberId: 'member-1',
      kind: 'coordination',
      allowedToolNames: ['submit_room_plan'],
      blockedToolNames: [],
      blockedProviderIds: [],
      blockedSkillIds: []
    })

    await expect(harness.loop.runTurn('thr_room', started.turnId)).resolves.toBe('completed')

    const events = harness.eventBus.snapshotSince('thr_room', 0)
    expect(events.some((event) => event.kind === 'error' && event.code === 'model_empty_response'))
      .toBe(false)
    expect(events.some((event) => event.kind === 'turn_completed')).toBe(true)
  })
})

function createHarness(model: ModelClient, options: { toolHost?: LocalToolHost } = {}) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const ids = new SequentialIdGenerator()
  const nowIso = () => '2026-08-17T00:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso
  })
  const compactor = new ContextCompactor()
  const turns = new TurnService({
    threadStore, sessionStore, events, inflight, steering, compactor, ids, nowIso
  })
  const loop = new AgentLoop({
    threadStore,
    sessionStore,
    approvalGate: { request: async () => 'allow' } as never,
    userInputGate: {} as never,
    model,
    toolHost: options.toolHost ?? new LocalToolHost({ tools: [] }),
    usage: new UsageService(),
    events,
    turns,
    inflight,
    steering,
    compactor,
    prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
    ids,
    nowIso
  })
  return { sessionStore, threadStore, eventBus, turns, loop, model }
}

async function startTurn(
  harness: ReturnType<typeof createHarness>,
  threadId: string,
  roomContext?: Parameters<typeof createThreadRecord>[0]['roomContext']
) {
  await harness.threadStore.upsert(createThreadRecord({
    id: threadId,
    title: 'Empty response',
    workspace: '/tmp/workspace',
    model: harness.model.model,
    ...(roomContext ? { roomContext } : {})
  }))
  return harness.turns.startTurn({
    threadId,
    request: { prompt: 'please answer', model: harness.model.model }
  })
}
