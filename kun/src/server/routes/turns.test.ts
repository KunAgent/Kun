import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import type { StartTurnRequest } from '../../contracts/turns.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import { makeGoalContextItem, makeUserItem } from '../../domain/item.js'
import { ContextCompactor } from '../../loop/context-compactor.js'
import { InflightTracker } from '../../loop/inflight-tracker.js'
import { SteeringQueue } from '../../loop/steering-queue.js'
import { SequentialIdGenerator } from '../../ports/id-generator.js'
import { ThreadExecutionBusyError } from '../../ports/thread-execution-lease.js'
import { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { ThreadClosingError, TurnService } from '../../services/turn-service.js'
import type { JsonResponse } from '../response.js'
import { cancelToolCall, getTurn, rewindThread, startTurn, steerTurn } from './turns.js'

describe('GET /v1/threads/:id/turns/:turnId public-item boundary', () => {
  it('does not expose a legacy internal goal context from the raw turn mirror', async () => {
    const turn = createTurnRecord({
      id: 'turn_legacy_goal_context', threadId: 'thr_legacy_goal_context', prompt: 'finish', status: 'completed'
    })
    const user = makeUserItem({ id: 'item_user', threadId: turn.threadId, turnId: turn.id, text: 'finish' })
    const context = makeGoalContextItem({
      id: 'item_goal_context',
      threadId: turn.threadId,
      turnId: turn.id,
      text: 'internal goal instructions must never be public'
    })
    const turns = {
      getTurn: async () => ({ ...turn, items: [user, context] })
    } as unknown as TurnService

    const response = await getTurn(turns, turn.threadId, turn.id)
    const body = JSON.parse(response.body)

    expect(body.items.map((item: { id: string }) => item.id)).toEqual([user.id])
    expect(JSON.stringify(body)).not.toContain('internal goal instructions')
  })
})

describe('POST /v1/threads/:id/turns/:turnId/steer execution', () => {
  it('starts the runner after accepted steering so a suspended Graph planning turn can continue', async () => {
    const turns = {
      steerTurn: vi.fn(async () => undefined)
    } as unknown as TurnService
    const onSteered = vi.fn()
    const response = await steerTurn(
      turns,
      'thread_graph_planning',
      'turn_graph_planning',
      new Request('http://kun.local/v1/threads/thread_graph_planning/turns/turn_graph_planning/steer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Continue building the Graph.',
          attachmentIds: ['att_0123456789abcdef01234567']
        })
      }),
      onSteered
    ) as JsonResponse

    expect(response.status).toBe(200)
    expect(turns.steerTurn).toHaveBeenCalledWith({
      threadId: 'thread_graph_planning',
      turnId: 'turn_graph_planning',
      text: 'Continue building the Graph.',
      attachmentIds: ['att_0123456789abcdef01234567']
    })
    expect(onSteered).toHaveBeenCalledWith({
      threadId: 'thread_graph_planning',
      turnId: 'turn_graph_planning'
    })
  })
})

describe('POST /v1/threads/:id/turns/:turnId/tool-calls/:callId/cancel', () => {
  it('returns the accepted cancellation status without requiring a request body', async () => {
    const cancellation = {
      cancel: vi.fn(async (input: { threadId: string; turnId: string; callId: string }) => ({
        ...input,
        status: 'cancellation_requested' as const
      }))
    }
    const response = await cancelToolCall(
      cancellation as never,
      'thread_1',
      'turn_1',
      'call_1'
    ) as JsonResponse

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      threadId: 'thread_1',
      turnId: 'turn_1',
      callId: 'call_1',
      status: 'cancellation_requested'
    })
    expect(cancellation.cancel).toHaveBeenCalledWith({
      threadId: 'thread_1',
      turnId: 'turn_1',
      callId: 'call_1'
    })
  })

  it('maps missing and inactive calls to the documented HTTP statuses', async () => {
    const notFound = await cancelToolCall({
      cancel: async () => { throw new Error('tool call not found: call_1') }
    } as never, 'thread_1', 'turn_1', 'call_1') as JsonResponse
    expect(notFound.status).toBe(404)

    const conflict = await cancelToolCall({
      cancel: async () => { throw new Error('tool call is no longer active: call_1') }
    } as never, 'thread_1', 'turn_1', 'call_1') as JsonResponse
    expect(conflict.status).toBe(409)
  })
})

describe('POST /v1/threads/:id/turns admission', () => {
  it('distinguishes a closing thread from a missing thread', async () => {
    const request = () => new Request('http://kun.local/v1/threads/thr_closing/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' })
    })
    const closing = await startTurn({
      startTurn: async () => { throw new ThreadClosingError('thr_closing') }
    } as unknown as TurnService, 'thr_closing', request()) as JsonResponse
    expect(closing.status).toBe(409)
    expect(JSON.parse(closing.body)).toEqual({
      code: 'thread_closing',
      message: 'thread is closing: thr_closing'
    })

    const missing = await startTurn({
      startTurn: async () => { throw new Error('thread not found: thr_missing') }
    } as unknown as TurnService, 'thr_missing', request()) as JsonResponse
    expect(missing.status).toBe(404)
    expect(JSON.parse(missing.body).code).toBe('not_found')
  })

  it('returns one admitted turn for exact retries and conflicts when the keyed request changes', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-08-09T10:00:00.000Z'
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_idempotent_start'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Idempotent start',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    const onStarted = vi.fn()
    const admittedRequest: StartTurnRequest = {
      prompt: 'run exactly once',
      clientRequestId: 'request_123',
      model: 'deepseek-v4-pro',
      sandboxMode: 'workspace-write',
      attachments: [{ path: '/tmp/input.txt', name: 'input.txt' }]
    }
    const request = (body: object = admittedRequest) => new Request(
      `http://kun.local/v1/threads/${threadId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })

    const [first, retry] = await Promise.all([
      startTurn(turns, threadId, request(), onStarted),
      startTurn(turns, threadId, request(), onStarted)
    ]) as JsonResponse[]

    expect(first.status).toBe(202)
    expect(retry.status).toBe(202)
    expect(JSON.parse(retry.body)).toEqual(JSON.parse(first.body))
    expect(onStarted).toHaveBeenCalledTimes(1)
    const thread = await threadStore.get(threadId)
    expect(thread?.turns).toHaveLength(1)
    expect(thread?.turns[0]).toMatchObject({
      clientRequestId: 'request_123',
      clientRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      prompt: 'run exactly once'
    })
    expect((await sessionStore.loadItems(threadId)).filter((item) => item.kind === 'user_message'))
      .toHaveLength(1)
    expect((await sessionStore.loadEventsSince(threadId, 0)).filter((event) => event.kind === 'turn_started'))
      .toHaveLength(1)

    const admittedBody = JSON.parse(first.body) as {
      threadId: string
      turnId: string
      userMessageItemId: string
    }
    const foreignOwner = {
      threadId,
      turnId: admittedBody.turnId,
      ownerFlavor: 'production' as const,
      ownerInstanceId: 'foreign-runtime-instance',
      acquiredAt: '2026-08-09T10:00:00.000Z',
      expiresAt: '2026-08-09T10:00:30.000Z'
    }
    const owner = vi.fn(async () => foreignOwner)
    const retryingRuntime = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (id) => eventBus.allocateSeq(id),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      executionLeases: {
        owner,
        acquire: async () => foreignOwner,
        release: async () => undefined
      },
      ids: new SequentialIdGenerator(),
      nowIso
    })
    await expect(retryingRuntime.startTurn({
      threadId,
      request: admittedRequest
    })).resolves.toEqual(admittedBody)
    expect(owner).not.toHaveBeenCalled()
    await expect(retryingRuntime.startTurn({
      threadId,
      request: { prompt: 'new work', clientRequestId: 'request_456' }
    })).rejects.toBeInstanceOf(ThreadExecutionBusyError)
    expect(owner).toHaveBeenCalledTimes(1)

    const changedRequests = [
      { ...admittedRequest, prompt: 'different prompt' },
      { ...admittedRequest, model: 'another-model' },
      { ...admittedRequest, attachments: [{ path: '/tmp/other.txt', name: 'other.txt' }] },
      { ...admittedRequest, sandboxMode: 'danger-full-access' }
    ]
    for (const changedRequest of changedRequests) {
      const conflict = await startTurn(
        turns,
        threadId,
        request(changedRequest),
        onStarted
      ) as JsonResponse
      expect(conflict.status).toBe(409)
      expect(JSON.parse(conflict.body)).toEqual({
        code: 'conflict',
        message: 'clientRequestId is already associated with a different request'
      })
    }
    expect(onStarted).toHaveBeenCalledTimes(1)
    expect((await threadStore.get(threadId))?.turns).toHaveLength(1)

    await turns.interruptTurn({ threadId, turnId: admittedBody.turnId })
  })

  it('returns sanitized structured details when another runtime owns the thread', async () => {
    const owner = {
      threadId: 'thr_busy',
      turnId: 'turn_active',
      ownerFlavor: 'production' as const,
      ownerInstanceId: 'private-runtime-instance',
      acquiredAt: '2026-08-09T10:00:00.000Z',
      expiresAt: '2026-08-09T10:00:30.000Z'
    }
    const turns = {
      startTurn: async () => { throw new ThreadExecutionBusyError(owner) }
    } as unknown as TurnService

    const response = await startTurn(
      turns,
      owner.threadId,
      new Request(`http://kun.local/v1/threads/${owner.threadId}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'distinct request', clientRequestId: 'request_busy' })
      })
    ) as JsonResponse
    const body = JSON.parse(response.body)

    expect(response.status).toBe(409)
    expect(body).toEqual({
      code: 'thread_busy',
      message: 'thread already has an active turn',
      details: {
        threadId: owner.threadId,
        activeTurnId: owner.turnId,
        ownerFlavor: owner.ownerFlavor,
        acquiredAt: owner.acquiredAt,
        expiresAt: owner.expiresAt
      }
    })
    expect(response.body).not.toContain(owner.ownerInstanceId)
  })

  it('rejects stale Graph submissions after safe disable while direct turns remain available', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-07-26T00:00:00.000Z'
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_graph_disabled'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Safe disable',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))

    const graphResponse = await startTurn(
      turns,
      threadId,
      new Request(`http://kun.local/v1/threads/${threadId}/turns`, {
        method: 'POST',
        body: JSON.stringify({ prompt: 'graph task', orchestration: 'graph' })
      }),
      undefined,
      () => false
    ) as JsonResponse
    expect(graphResponse.status).toBe(503)
    expect((await threadStore.get(threadId))?.turns).toEqual([])

    const directResponse = await startTurn(
      turns,
      threadId,
      new Request(`http://kun.local/v1/threads/${threadId}/turns`, {
        method: 'POST',
        body: JSON.stringify({ prompt: 'direct task' })
      }),
      undefined,
      () => false
    ) as JsonResponse
    expect(directResponse.status).toBe(202)
  })

  it('maps an archived thread to a conflict without creating a turn', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_route_archived'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Archived route',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro',
      status: 'archived'
    }))

    const response = await startTurn(
      turns,
      threadId,
      new Request(`http://kun.local/v1/threads/${threadId}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'must be rejected' })
      })
    ) as JsonResponse

    expect(response.status).toBe(409)
    expect(JSON.parse(response.body)).toEqual({
      code: 'conflict',
      message: `thread is archived: ${threadId}`
    })
    expect((await threadStore.get(threadId))?.turns).toEqual([])
  })

  it('maps exhausted global admission capacity to a structured 429 response', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      maxConcurrentTurns: 1,
      ids: new SequentialIdGenerator(),
      nowIso
    })
    await Promise.all(['thr_route_capacity_a', 'thr_route_capacity_b'].map((id) => threadStore.upsert(createThreadRecord({
      id,
      title: id,
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))))
    const first = await turns.startTurn({
      threadId: 'thr_route_capacity_a',
      request: { prompt: 'occupy the only slot' }
    })

    const response = await startTurn(
      turns,
      'thr_route_capacity_b',
      new Request('http://kun.local/v1/threads/thr_route_capacity_b/turns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'must be rejected' })
      })
    ) as JsonResponse

    expect(response.status).toBe(429)
    expect(JSON.parse(response.body)).toEqual({
      code: 'rate_limited',
      message: expect.stringContaining('runtime turn capacity reached'),
      details: { maxConcurrentTurns: 1 }
    })
    expect((await threadStore.get('thr_route_capacity_b'))?.turns).toEqual([])
    await turns.interruptTurn({ threadId: 'thr_route_capacity_a', turnId: first.turnId })
  })

  it('maps an active rewind attempt to a structured conflict', async () => {
    const threadStore = new InMemoryThreadStore()
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const nowIso = () => '2026-06-18T00:00:00.000Z'
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      ids: new SequentialIdGenerator(),
      nowIso
    })
    const threadId = 'thr_route_rewind_active'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Route rewind',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro'
    }))
    const started = await turns.startTurn({ threadId, request: { prompt: 'stay active' } })

    const response = await rewindThread(
      turns,
      threadId,
      new Request(`http://kun.local/v1/threads/${threadId}/rewind`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ turnId: started.turnId })
      })
    ) as JsonResponse

    expect(response.status).toBe(409)
    expect(JSON.parse(response.body)).toEqual({
      code: 'conflict',
      message: `cannot rewind while a turn is active: ${threadId}`
    })
    await turns.interruptTurn({ threadId, turnId: started.turnId })
  })
})
