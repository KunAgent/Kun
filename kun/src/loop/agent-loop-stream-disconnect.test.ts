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
import {
  rewriteStreamDisconnectFailure,
  looksLikeUpstreamStreamDisconnect
} from './stream-disconnection-failure.js'

/**
 * Emits an upstream in-stream error shaped like the real-world Responses
 * gateway disconnect: `stream closed before response.completed` with code
 * `stream_disconnected`. The generator keeps yielding until the loop stops
 * consuming (which happens when the abort signal fires).
 */
class DisconnectingModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'disconnect-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: 'partial answer' }
    yield {
      kind: 'error',
      message: 'stream closed before response.completed',
      code: 'stream_disconnected'
    }
  }
}

function createHarness(model: ModelClient) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const ids = new SequentialIdGenerator()
  const nowIso = () => '2026-08-24T00:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso
  })
  const turns = new TurnService({
    threadStore, sessionStore, events, inflight, steering,
    compactor: new ContextCompactor(), ids, nowIso
  })
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
    compactor: new ContextCompactor(),
    prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
    ids,
    nowIso
  })
  return { sessionStore, threadStore, eventBus, turns, loop }
}

async function startTurn(
  harness: ReturnType<typeof createHarness>,
  threadId: string,
  model: ModelClient
) {
  await harness.threadStore.upsert(createThreadRecord({
    id: threadId,
    title: 'Stream disconnect',
    workspace: '/tmp/workspace',
    model: model.model
  }))
  return harness.turns.startTurn({
    threadId,
    request: { prompt: 'please answer', model: model.model }
  })
}

describe('stream disconnection failure rewrite', () => {
  it('reclassifies upstream disconnect wording with a user-facing message', () => {
    const rewrite = rewriteStreamDisconnectFailure({
      error: 'stream closed before response.completed',
      code: 'stream_disconnected'
    })
    expect(rewrite).toMatchObject({
      code: 'stream_disconnected',
      details: {
        rawMessage: 'stream closed before response.completed',
        rawCode: 'stream_disconnected'
      }
    })
    expect(rewrite?.error).not.toContain('response.completed')
  })

  it('keeps provider business errors untouched', () => {
    expect(rewriteStreamDisconnectFailure({
      error: 'model request failed with status 404',
      code: 'http_404'
    })).toBeNull()
    expect(rewriteStreamDisconnectFailure({
      error: 'insufficient balance',
      code: 'payment_required'
    })).toBeNull()
  })

  it('detects gateway disconnect phrasing', () => {
    expect(looksLikeUpstreamStreamDisconnect('Stream closed before response.completed')).toBe(true)
    expect(looksLikeUpstreamStreamDisconnect('stream terminated')).toBe(true)
    expect(looksLikeUpstreamStreamDisconnect('invalid api key')).toBe(false)
  })
})

describe('AgentLoop stream disconnect during blocking tool call abort', () => {
  it('settles a turn as aborted when the abort races the disconnect error', async () => {
    const model = new DisconnectingModel()
    const harness = createHarness(model)
    const started = await startTurn(harness, 'thr_abort_race', model)

    // Abort mid-round: the model's disconnect error chunk is still queued
    // behind an already-aborted signal. The turn must settle as aborted
    // without leaking the raw gateway wording.
    const run = harness.loop.runTurn('thr_abort_race', started.turnId)
    const turn = await harness.turns.getTurn('thr_abort_race', started.turnId)
    expect(turn).toBeTruthy()
    harness.turns.abortTurnExecution(started.turnId)

    await expect(run).resolves.toBe('aborted')

    const events = harness.eventBus.snapshotSince('thr_abort_race', 0)
    expect(events.some((event) => event.kind === 'turn_failed')).toBe(false)
  })

  it('rewrites a real disconnect failure instead of blaming the provider', async () => {
    const model = new DisconnectingModel()
    const harness = createHarness(model)
    const started = await startTurn(harness, 'thr_disconnect', model)

    await expect(
      harness.loop.runTurn('thr_disconnect', started.turnId)
    ).resolves.toBe('failed')

    const events = harness.eventBus.snapshotSince('thr_disconnect', 0)
    const terminal = events.find(
      (event) => event.kind === 'turn_failed' && event.code === 'stream_disconnected'
    )
    expect(terminal).toBeTruthy()
    expect((terminal as { message?: string } | undefined)?.message)
      .not.toContain('response.completed')
    expect(events.some((event) => event.kind === 'error' && event.code === 'stream_disconnected'))
      .toBe(false)

    const turn = await harness.turns.getTurn('thr_disconnect', started.turnId)
    expect(turn?.status).toBe('failed')
    expect(turn?.error).not.toContain('stream closed before response.completed')

    const items = await harness.sessionStore.loadItems('thr_disconnect')
    const errorItem = items.find(
      (item) => item.kind === 'error' && item.code === 'stream_disconnected'
    )
    expect(errorItem).toBeTruthy()
    expect((errorItem as { details?: { rawMessage?: string } } | undefined)?.details?.rawMessage)
      .toBe('stream closed before response.completed')
  })
})
