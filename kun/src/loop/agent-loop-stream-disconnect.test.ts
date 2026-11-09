import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileSessionStore } from '../adapters/file/file-session-store.js'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import {
  TurnService,
  ownerLeaseExpiredTurnAbortReason
} from '../services/turn-service.js'
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

function createHarness(model: ModelClient, sessionStore: SessionStore = new InMemorySessionStore()) {
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
      error: 'stream terminated: quota exceeded', code: 'quota_exceeded',
      details: { modelFailure: { responseReceived: true, category: 'quota', providerCode: 'quota_exceeded' } }
    })).toBeNull()
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

  it('persists lease loss as one typed failure instead of a user abort', async () => {
    const model = new DisconnectingModel()
    const harness = createHarness(model)
    const started = await startTurn(harness, 'thr_lease_loss', model)
    const run = harness.loop.runTurn('thr_lease_loss', started.turnId)

    expect(harness.turns.abortTurnExecution(
      started.turnId,
      ownerLeaseExpiredTurnAbortReason({
        ownerFlavor: 'production',
        ownerInstanceId: 'runtime-1'
      })
    )).toBe(true)

    await expect(run).resolves.toBe('failed')

    const events = harness.eventBus.snapshotSince('thr_lease_loss', 0)
    const leaseFailures = events.filter(
      (event) => event.kind === 'turn_failed' && event.code === 'owner_lease_expired'
    )
    expect(leaseFailures).toHaveLength(1)
    expect(events.some((event) => event.kind === 'turn_aborted')).toBe(false)

    const turn = await harness.turns.getTurn('thr_lease_loss', started.turnId)
    expect(turn).toMatchObject({
      status: 'failed',
      error: 'Turn owner production/runtime-1 stopped heartbeating.'
    })
    const items = await harness.sessionStore.loadItems('thr_lease_loss')
    expect(items.filter(
      (item) => item.kind === 'error' && item.code === 'owner_lease_expired'
    )).toMatchObject([{
      id: `item_${started.turnId}_owner_lease_expired`,
      status: 'failed'
    }])
  })

  it('preserves partial text and interruption details in the failed turn', async () => {
    const model: ModelClient = {
      provider: 'test', model: 'disconnect-model',
      async *stream() {
        yield { kind: 'assistant_text_delta', text: '部分答案 🐈' }
        yield { kind: 'error', code: 'stream_read_error', message: 'connection reset',
          failure: { category: 'network', failoverAllowed: false, responsePhase: 'interrupted', partialOutput: true } }
      }
    }
    const harness = createHarness(model)
    const started = await startTurn(harness, 'thr_partial', model)
    await expect(harness.loop.runTurn('thr_partial', started.turnId)).resolves.toBe('failed')
    const items = await harness.sessionStore.loadItems('thr_partial')
    expect(items.filter((item) => item.kind === 'assistant_text')).toMatchObject([{ text: '部分答案 🐈' }])
    expect(items.filter((item) => item.kind === 'error')).toMatchObject([{
      code: 'stream_disconnected', details: {
        rawCode: 'stream_read_error', modelFailure: { responsePhase: 'interrupted', partialOutput: true }
      }
    }])
    const events = harness.eventBus.snapshotSince('thr_partial', 0)
    expect(events.filter((event) => event.kind === 'turn_failed')).toHaveLength(1)
    expect(events.some((event) => event.kind === 'turn_completed')).toBe(false)
  })

  it('keeps interrupted SSE text in history for a subsequent turn', async () => {
    const requests: string[] = []
    const encoder = new TextEncoder()
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(String(init?.body))
      if (requests.length === 1) {
        let sent = false
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true
              controller.enqueue(encoder.encode(
                'data: {"type":"response.output_text.delta","delta":"已保存的部分 🐈"}\n\n'
              ))
            } else controller.error(new Error('simulated socket reset'))
          }
        }), { headers: { 'content-type': 'text/event-stream' } })
      }
      return new Response([
        'data: {"type":"response.output_text.delta","delta":"继续完成"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'
      ].join(''), { headers: { 'content-type': 'text/event-stream' } })
    }) as typeof fetch
    const model = new CompatModelClient({ baseUrl: 'https://provider.example/v1/responses', apiKey: 'test',
      model: 'disconnect-model', endpointFormat: 'responses',
      retry: { maxAttempts: 2, initialDelayMs: 0, httpStatusCodes: [] }, fetchImpl })
    const root = await mkdtemp(join(tmpdir(), 'kun-stream-history-'))
    const sessionStore = new FileSessionStore({ dataDir: root })
    try {
      const harness = createHarness(model, sessionStore)
      const first = await startTurn(harness, 'thr_sse_history', model)
      await expect(harness.loop.runTurn('thr_sse_history', first.turnId)).resolves.toBe('failed')
      expect(requests).toHaveLength(1)
      const reopenedStore = new FileSessionStore({ dataDir: root })
      try {
        const failedItems = await reopenedStore.loadItems('thr_sse_history')
        expect(failedItems.filter((item) => item.kind === 'assistant_text')).toMatchObject([{ text: '已保存的部分 🐈' }])
        expect(failedItems.filter((item) => item.kind === 'error')).toMatchObject([{
          code: 'stream_disconnected', details: { rawCode: 'stream_read_error',
            rawMessage: 'model stream read failed: simulated socket reset' }
        }])
      } finally {
        await reopenedStore.close()
      }

      const next = await harness.turns.startTurn({
        threadId: 'thr_sse_history', request: { prompt: '继续', model: model.model }
      })
      await expect(harness.loop.runTurn('thr_sse_history', next.turnId)).resolves.toBe('completed')
      expect(requests).toHaveLength(2)
      expect(requests[1]).toContain('已保存的部分 🐈')
      const reloaded = await sessionStore.loadItems('thr_sse_history')
      expect(reloaded.filter((item) => item.kind === 'assistant_text')).toMatchObject([
        { text: '已保存的部分 🐈' }, { text: '继续完成' }
      ])
      const events = harness.eventBus.snapshotSince('thr_sse_history', 0)
      expect(events.filter((event) => event.kind === 'turn_failed' && event.turnId === first.turnId)).toHaveLength(1)
      expect(events.some((event) => event.kind === 'turn_completed' && event.turnId === first.turnId)).toBe(false)
    } finally {
      await sessionStore.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('redacts provider codes in persisted failures', async () => {
    const secret = 'sk-abcdefghijklmnop1234567890'
    const model: ModelClient = {
      provider: 'test', model: 'disconnect-model',
      async *stream() {
        yield { kind: 'error', code: secret, message: `provider error ${secret}`,
          failure: { category: 'request', failoverAllowed: false, responseReceived: true, providerCode: secret } }
      }
    }
    const harness = createHarness(model)
    const started = await startTurn(harness, 'thr_secret', model)
    await expect(harness.loop.runTurn('thr_secret', started.turnId)).resolves.toBe('failed')
    const recorded = [await harness.sessionStore.loadItems('thr_secret'), harness.eventBus.snapshotSince('thr_secret', 0)]
    expect(JSON.stringify(recorded)).not.toContain(secret)
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
