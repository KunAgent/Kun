import { describe, expect, it, vi } from 'vitest'
import {
  forkThread,
  getThread,
  getThreadState,
  getThreadTimeline,
  updateThread
} from './threads.js'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'
import { createThreadRecord } from '../../domain/thread.js'
import { createTurnRecord } from '../../domain/turn.js'
import { makeGoalContextItem, makeUserItem } from '../../domain/item.js'
import { createApprovalRequest } from '../../domain/approval.js'
import { InMemoryApprovalGate } from '../../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../../adapters/in-memory-user-input-gate.js'
import type { ThreadService } from '../../services/thread-service.js'
import type { JsonResponse } from '../response.js'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'

function serviceWith(threadId: string): ThreadService {
  const record = createThreadRecord({
    id: threadId,
    title: 'Demo',
    workspace: '/tmp',
    model: 'deepseek-chat',
    status: 'running'
  })
  return {
    get: async (id: string) => (id === threadId ? record : null)
  } as unknown as ThreadService
}

describe('getThread pendingUserInputIds (#606)', () => {
  it('reports request ids the user-input gate is still awaiting for the thread', async () => {
    const gate = new InMemoryUserInputGate()
    // request() returns a promise that stays pending until resolved; we only
    // care that the request is now addressable in the gate.
    void gate
      .request({
        id: 'in_live',
        threadId: 'thr_1',
        turnId: 'turn_1',
        itemId: 'item_input',
        prompt: 'north or south?',
        questions: []
      })
      .catch(() => undefined)
    // A request for a different thread must not leak into this thread's list.
    void gate
      .request({
        id: 'in_other',
        threadId: 'thr_2',
        turnId: 'turn_x',
        itemId: 'item_x',
        prompt: 'unrelated',
        questions: []
      })
      .catch(() => undefined)

    const response = await getThread(serviceWith('thr_1'), 'thr_1', undefined, gate)
    const body = JSON.parse(response.body)
    expect(body.pendingUserInputIds).toEqual(['in_live'])
  })

  it('reports an empty list when nothing is awaiting (finished thread)', async () => {
    const response = await getThread(serviceWith('thr_1'), 'thr_1', undefined, new InMemoryUserInputGate())
    const body = JSON.parse(response.body)
    expect(body.pendingUserInputIds).toEqual([])
  })

  it('omits no field when no gate is provided', async () => {
    const response = await getThread(serviceWith('thr_1'), 'thr_1')
    const body = JSON.parse(response.body)
    expect(body.pendingUserInputIds).toEqual([])
    expect(body).not.toHaveProperty('pendingApprovalIds')
  })
})

describe('getThread replay snapshot boundary (#1087)', () => {
  it('freezes latestSeq before projection reads so a hydration-window event remains replayable', async () => {
    const initial = createThreadRecord({
      id: 'thr_boundary', title: 'Boundary', workspace: '/tmp',
      model: 'deepseek-chat', status: 'running'
    })
    initial.turns = [createTurnRecord({
      id: 'turn_boundary', threadId: initial.id, prompt: 'wait', status: 'running',
      createdAt: '2026-08-05T00:00:00.000Z'
    })]
    const settled = {
      ...initial,
      status: 'idle' as const,
      turns: initial.turns.map((turn) => ({ ...turn, status: 'completed' as const }))
    }
    const order: string[] = []
    let durableHighWater = 200
    const service = {
      get: vi.fn(async () => {
        order.push('thread')
        // A terminal event becomes durable after the response's replay floor
        // was captured but before its state projection is read.
        return settled
      })
    } as unknown as ThreadService
    const sessionStore = {
      highestSeq: vi.fn(async () => {
        order.push('event-boundary')
        const boundary = durableHighWater
        durableHighWater = 201
        return boundary
      }),
      loadItems: vi.fn(async () => {
        order.push('items')
        return []
      })
    }

    const response = await getThread(service, initial.id, sessionStore as never)
    const body = JSON.parse(response.body)

    expect(order).toEqual(['event-boundary', 'thread', 'items'])
    expect(durableHighWater).toBe(201)
    expect(body.latestSeq).toBe(200)
    expect(body.status).toBe('idle')
  })
})

describe('getThreadState', () => {
  it('returns only metadata and never loads session item history', async () => {
    const record = createThreadRecord({
      id: 'thr_state', title: 'State', workspace: '/tmp', model: 'deepseek-chat', status: 'running'
    })
    record.turns = [createTurnRecord({
      id: 'turn_state', threadId: record.id, prompt: 'continue', status: 'running',
      createdAt: '2026-08-07T00:00:00.000Z'
    })]
    const getMetadata = vi.fn(async () => record)
    const loadItems = vi.fn(async () => {
      throw new Error('state route must not load items')
    })
    const response = await getThreadState({
      get: vi.fn(async () => record),
      getMetadata
    } as unknown as ThreadService, record.id, {
      highestSeq: vi.fn(async () => 73),
      loadItems
    } as never)

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      schemaVersion: 1,
      id: record.id,
      status: 'running',
      updatedAt: record.updatedAt,
      latestSeq: 73,
      pendingUserInputIds: [],
      latestTurn: { id: 'turn_state', status: 'running', orchestration: 'direct' }
    })
    expect(getMetadata).toHaveBeenCalledWith(record.id)
    expect(loadItems).not.toHaveBeenCalled()
  })

  it('returns the normal 404 response for a missing thread', async () => {
    const response = await getThreadState({
      get: vi.fn(async () => null),
      getMetadata: vi.fn(async () => null)
    } as unknown as ThreadService, 'thr_missing')

    expect(response.status).toBe(404)
    expect(JSON.parse(response.body)).toMatchObject({ code: 'not_found' })
  })

  it('projects live pending user-input ids without reading item history', async () => {
    const gate = new InMemoryUserInputGate()
    void gate.request({
      id: 'in_state',
      threadId: 'thr_state',
      turnId: 'turn_state',
      itemId: 'item_state',
      prompt: 'choose',
      questions: []
    }).catch(() => undefined)

    const response = await getThreadState(
      serviceWith('thr_state'),
      'thr_state',
      undefined,
      gate
    )

    expect(JSON.parse(response.body).pendingUserInputIds).toEqual(['in_state'])
  })
})

describe('getThreadTimeline', () => {
  it('keeps the latest turn user message anchored inside the 300-item newest page', async () => {
    const record = createThreadRecord({
      id: 'thr_timeline', title: 'Timeline', workspace: '/tmp', model: 'deepseek-chat',
      status: 'running'
    })
    const turn = createTurnRecord({
      id: 'turn_timeline', threadId: record.id, prompt: 'history', status: 'running'
    })
    record.turns = [turn]
    const store = new InMemorySessionStore()
    for (let index = 0; index < 350; index += 1) {
      await store.appendItem(record.id, makeUserItem({
        id: `item_${String(index).padStart(3, '0')}`,
        threadId: record.id,
        turnId: turn.id,
        text: `message ${index}`
      }))
    }
    const service = { get: async () => record } as unknown as ThreadService

    const latest = await getThreadTimeline(
      service,
      record.id,
      new Request(`http://kun.local/v1/threads/${record.id}/timeline`),
      store
    )
    const latestBody = JSON.parse(latest.body)
    // The page stays bounded at 300 items but pins the active turn's opening
    // user message in front even though 350 process items would push it off.
    expect(latestBody.timeline).toMatchObject({
      itemCount: 300,
      hasMore: true,
      nextCursor: 'item_051'
    })
    expect(latestBody.turns[0].items[0].id).toBe('item_000')
    expect(latestBody.turns[0].items.at(-1).id).toBe('item_349')

    const older = await getThreadTimeline(
      service,
      record.id,
      new Request(
        `http://kun.local/v1/threads/${record.id}/timeline?before=${latestBody.timeline.nextCursor}`
      ),
      store
    )
    const olderBody = JSON.parse(older.body)
    // The cursor points at the retained window start, so the older page
    // covers the anchor plus everything between it and the window (51 items).
    expect(olderBody.timeline).toMatchObject({ itemCount: 51, hasMore: false })
    expect(olderBody.turns[0].items[0].id).toBe('item_000')
    expect(olderBody.turns[0].items.at(-1).id).toBe('item_050')

    const mergedIds = [
      ...olderBody.turns[0].items.map((item: { id: string }) => item.id),
      ...latestBody.turns[0].items.map((item: { id: string }) => item.id)
    ]
    expect(new Set(mergedIds).size).toBe(350)
  })

  it('does not anchor an older page requested by cursor', async () => {
    const record = createThreadRecord({
      id: 'thr_timeline_older', title: 'Timeline older', workspace: '/tmp', model: 'm'
    })
    const turn = createTurnRecord({
      id: 'turn_older', threadId: record.id, prompt: 'history', status: 'completed'
    })
    record.turns = [turn]
    const store = new InMemorySessionStore()
    for (let index = 0; index < 350; index += 1) {
      await store.appendItem(record.id, makeUserItem({
        id: `item_${String(index).padStart(3, '0')}`,
        threadId: record.id,
        turnId: turn.id,
        text: `message ${index}`
      }))
    }
    const service = { get: async () => record } as unknown as ThreadService

    const older = await getThreadTimeline(
      service,
      record.id,
      new Request(
        `http://kun.local/v1/threads/${record.id}/timeline?before=item_051&limit=300`
      ),
      store
    )
    const olderBody = JSON.parse(older.body)
    // Older pages are immutable history: no anchor re-materialization, and
    // the cursor request simply returns items strictly before the cursor.
    expect(olderBody.timeline).toMatchObject({ itemCount: 51, hasMore: false })
    expect(olderBody.turns[0].items[0].id).toBe('item_000')
    expect(olderBody.turns[0].items.at(-1).id).toBe('item_050')
  })

  it('freezes the SSE replay floor before reading the timeline page', async () => {
    const record = createThreadRecord({
      id: 'thr_timeline_boundary', title: 'Boundary', workspace: '/tmp', model: 'm'
    })
    const order: string[] = []
    const response = await getThreadTimeline(
      { get: vi.fn(async () => { order.push('thread'); return record }) } as unknown as ThreadService,
      record.id,
      new Request(`http://kun.local/v1/threads/${record.id}/timeline`),
      {
        highestSeq: vi.fn(async () => { order.push('event-boundary'); return 41 }),
        loadItemPage: vi.fn(async () => {
          order.push('items')
          return { items: [], hasMore: false, itemBytes: 0 }
        })
      } as never
    )

    expect(order).toEqual(['event-boundary', 'thread', 'items'])
    expect(JSON.parse(response.body).latestSeq).toBe(41)
  })

  it('never persists a renderer-only truncated preview while healing timeline status', async () => {
    const record = createThreadRecord({
      id: 'thr_timeline_preview', title: 'Preview', workspace: '/tmp', model: 'm'
    })
    const turn = createTurnRecord({
      id: 'turn_timeline_preview',
      threadId: record.id,
      prompt: `large prompt ${'p'.repeat(5 * 1024 * 1024)}`,
      status: 'completed'
    })
    record.turns = [turn]
    const canonicalItem = {
      id: 'item_large_result',
      turnId: turn.id,
      threadId: record.id,
      role: 'tool' as const,
      status: 'running' as const,
      createdAt: '2026-08-09T00:00:00.000Z',
      kind: 'tool_result' as const,
      toolName: 'bash',
      callId: 'call_large',
      toolKind: 'command_execution' as const,
      output: { blob: 'x'.repeat(5 * 1024 * 1024) },
      isError: false
    }
    const updateItem = vi.fn()
    const response = await getThreadTimeline(
      { get: vi.fn(async () => record) } as unknown as ThreadService,
      record.id,
      new Request(`http://kun.local/v1/threads/${record.id}/timeline`),
      {
        highestSeq: vi.fn(async () => 5),
        loadItemPage: vi.fn(async () => ({
          items: [canonicalItem],
          hasMore: false,
          itemBytes: 5 * 1024 * 1024
        })),
        updateItem
      } as never
    )

    expect(response.status).toBe(200)
    expect(Buffer.byteLength(response.body, 'utf-8')).toBeLessThan(4 * 1024 * 1024)
    expect(response.body).not.toContain('large prompt')
    expect(JSON.parse(response.body).turns[0].items[0]).toMatchObject({
      id: canonicalItem.id,
      status: 'completed',
      output: { __timelineTruncated: true }
    })
    expect(updateItem).toHaveBeenCalledWith(record.id, canonicalItem.id, {
      status: 'completed',
      finishedAt: expect.any(String)
    })
    expect(canonicalItem.output.blob).toHaveLength(5 * 1024 * 1024)
  })
})

describe('getThread session-only goal context', () => {
  it('does not expose durable goal context through the renderer hydration snapshot', async () => {
    const record = createThreadRecord({
      id: 'thr_goal_context', title: 'Goal context', workspace: '/tmp', model: 'deepseek-chat'
    })
    const turn = createTurnRecord({
      id: 'turn_goal_context', threadId: record.id, prompt: 'finish the task', status: 'completed'
    })
    record.turns = [turn]
    const user = makeUserItem({
      id: 'item_goal_user', threadId: record.id, turnId: turn.id, text: 'finish the task'
    })
    const context = makeGoalContextItem({
      id: 'item_goal_context',
      threadId: record.id,
      turnId: turn.id,
      text: 'Active goal: finish the task',
      createdAt: '2026-08-06T00:00:01.000Z'
    })
    const sessionStore = {
      highestSeq: async () => 7,
      loadItems: async () => [user, context]
    }
    const service = { get: async (id: string) => id === record.id ? record : null } as ThreadService

    const response = await getThread(service, record.id, sessionStore as never)
    const body = JSON.parse(response.body)

    expect(body.turns[0].items.map((item: { id: string }) => item.id)).toEqual([user.id])
    expect(body.turns[0].items).not.toContainEqual(expect.objectContaining({ kind: 'goal_context' }))
  })
})

describe('ThreadRecord HTTP public-item boundary', () => {
  function legacyThreadWithGoalContext() {
    const record = createThreadRecord({
      id: 'thr_legacy_goal_context', title: 'Legacy goal context', workspace: '/tmp', model: 'm'
    })
    const turn = createTurnRecord({
      id: 'turn_legacy_goal_context', threadId: record.id, prompt: 'finish the task', status: 'completed'
    })
    const user = makeUserItem({
      id: 'item_legacy_user', threadId: record.id, turnId: turn.id, text: 'finish the task'
    })
    const context = makeGoalContextItem({
      id: 'item_legacy_goal_context',
      threadId: record.id,
      turnId: turn.id,
      text: 'internal goal instructions must never be public'
    })
    return { ...record, turns: [{ ...turn, items: [user, context] }] }
  }

  it('does not return a legacy internal item from PATCH or fork responses', async () => {
    const record = legacyThreadWithGoalContext()
    const service = {
      update: async () => record,
      fork: async () => record
    } as unknown as ThreadService

    const updated = await updateThread(
      service,
      record.id,
      new Request(`http://kun.local/v1/threads/${record.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed' })
      })
    )
    const forked = await forkThread(service, record.id)

    for (const response of [updated as JsonResponse, forked]) {
      const body = JSON.parse(response.body)
      expect(body.turns[0].items.map((item: { id: string }) => item.id)).toEqual(['item_legacy_user'])
      expect(JSON.stringify(body)).not.toContain('internal goal instructions')
    }
  })
})

describe('getThread approval recovery snapshots (#1053)', () => {
  it('materializes live approvals without replaying event history', async () => {
    const record = createThreadRecord({
      id: 'thr_approval', title: 'Approval recovery', workspace: '/tmp',
      model: 'deepseek-chat', status: 'running'
    })
    record.turns = [createTurnRecord({
      id: 'turn_approval', threadId: record.id, prompt: 'Run tests', status: 'running',
      createdAt: '2026-08-01T00:00:00.000Z'
    })]
    const service = { get: async (id: string) => id === record.id ? record : null } as ThreadService
    const approvalGate = new InMemoryApprovalGate()
    const approval = createApprovalRequest({
      id: 'approval_live', threadId: record.id, turnId: 'turn_approval', toolName: 'bash',
      summary: 'Run focused tests', createdAt: '2026-08-01T00:00:01.000Z'
    })
    void approvalGate.request(approval).catch(() => undefined)
    const loadEventsSince = vi.fn(async () => [])
    const sessionStore = { highestSeq: async () => 7, loadItems: async () => [], loadEventsSince }

    const response = await getThread(service, record.id, sessionStore as never, undefined, approvalGate)
    const body = JSON.parse(response.body)

    expect(body.pendingApprovalIds).toEqual([approval.id])
    expect(body.turns[0].items).toContainEqual(expect.objectContaining({
      kind: 'approval', approvalId: approval.id, status: 'pending'
    }))
    expect(loadEventsSince).not.toHaveBeenCalled()
  })

  it('preserves in-memory turn items when no session store is available', async () => {
    const record = createThreadRecord({
      id: 'thr_no_session_store', title: 'No session store', workspace: '/tmp',
      model: 'deepseek-chat', status: 'running'
    })
    const turn = createTurnRecord({
      id: 'turn_no_session_store', threadId: record.id, prompt: 'Run tests', status: 'running',
      createdAt: '2026-08-01T00:00:00.000Z'
    })
    turn.items = [{
      id: 'item_user', turnId: turn.id, threadId: record.id, role: 'user',
      status: 'completed', createdAt: '2026-08-01T00:00:00.000Z',
      kind: 'user_message', text: 'Run tests'
    }]
    record.turns = [turn]
    const service = { get: async (id: string) => id === record.id ? record : null } as ThreadService
    const approvalGate = new InMemoryApprovalGate()
    const approval = createApprovalRequest({
      id: 'approval_no_session_store', threadId: record.id, turnId: turn.id, toolName: 'bash',
      summary: 'Run focused tests', createdAt: '2026-08-01T00:00:01.000Z'
    })
    void approvalGate.request(approval).catch(() => undefined)

    const response = await getThread(service, record.id, undefined, undefined, approvalGate)
    const body = JSON.parse(response.body)

    expect(body.turns[0].items.map((item: { id: string }) => item.id)).toEqual([
      'item_user', 'item_approval_no_session_store'
    ])
  })

  it('inserts a recovered approval at its chronological point in the turn', async () => {
    const record = createThreadRecord({
      id: 'thr_chronological', title: 'Chronological approval', workspace: '/tmp',
      model: 'deepseek-chat', status: 'running'
    })
    record.turns = [createTurnRecord({
      id: 'turn_chronological', threadId: record.id, prompt: 'Run tests', status: 'running',
      createdAt: '2026-08-01T00:00:00.000Z'
    })]
    const approvalGate = new InMemoryApprovalGate()
    const approval = createApprovalRequest({
      id: 'approval_live', threadId: record.id, turnId: 'turn_chronological', toolName: 'bash',
      summary: 'Run focused tests', createdAt: '2026-08-01T00:00:01.000Z'
    })
    void approvalGate.request(approval).catch(() => undefined)
    const sessionStore = {
      highestSeq: async () => 8,
      loadItems: async () => [
        {
          id: 'item_user', turnId: 'turn_chronological', threadId: record.id, role: 'user' as const,
          status: 'completed' as const, createdAt: '2026-08-01T00:00:00.000Z',
          kind: 'user_message' as const, text: 'Run tests'
        },
        {
          id: 'item_result', turnId: 'turn_chronological', threadId: record.id, role: 'tool' as const,
          status: 'completed' as const, createdAt: '2026-08-01T00:00:02.000Z',
          finishedAt: '2026-08-01T00:00:02.000Z', kind: 'tool_result' as const,
          toolName: 'bash', callId: 'call_1', toolKind: 'tool_call' as const, output: 'done', isError: false
        }
      ]
    }
    const service = { get: async (id: string) => id === record.id ? record : null } as ThreadService

    const response = await getThread(service, record.id, sessionStore as never, undefined, approvalGate)
    const body = JSON.parse(response.body)

    expect(body.turns[0].items.map((item: { id: string }) => item.id)).toEqual([
      'item_user', 'item_approval_live', 'item_result'
    ])
  })

  it('keeps an older persisted pending record non-actionable when the live gate is empty', async () => {
    const record = createThreadRecord({
      id: 'thr_stale', title: 'Stale approval', workspace: '/tmp',
      model: 'deepseek-chat', status: 'running'
    })
    record.turns = [createTurnRecord({
      id: 'turn_stale', threadId: record.id, prompt: 'Run tests', status: 'running',
      createdAt: '2026-08-01T00:00:00.000Z'
    })]
    const sessionStore = {
      highestSeq: async () => 1,
      loadItems: async () => [{
        id: 'item_approval_stale', turnId: 'turn_stale', threadId: record.id, role: 'tool' as const,
        status: 'pending' as const, createdAt: '2026-08-01T00:00:01.000Z',
        kind: 'approval' as const, approvalId: 'approval_stale', toolName: 'bash', summary: 'Run focused tests'
      }]
    }
    const service = { get: async (id: string) => id === record.id ? record : null } as ThreadService

    const response = await getThread(
      service, record.id, sessionStore as never, undefined, new InMemoryApprovalGate()
    )
    const body = JSON.parse(response.body)

    expect(body.pendingApprovalIds).toEqual([])
    expect(body.turns[0].items).toContainEqual(expect.objectContaining({
      approvalId: 'approval_stale', status: 'pending'
    }))
  })
})

describe('GET /v1/threads/:id active-owner forwarding (#1053)', () => {
  it('uses the execution owner so approval liveness comes from the owning gate', async () => {
    const forwarded = new Response(JSON.stringify({ owner: true }), { status: 200 })
    const forwardThreadControl = vi.fn(async () => forwarded)
    const router = buildRouter({
      runtimeToken: 'thread-route-token', insecure: false, forwardThreadControl
    } as unknown as ServerRuntime)
    const request = new Request('http://127.0.0.1/v1/threads/thr_owner', {
      headers: { authorization: 'Bearer thread-route-token' }
    })
    const match = router.match('GET', new URL(request.url).pathname)
    if (!match) throw new Error('thread route not found')

    const result = await match.handler(request, { params: match.params })

    expect(forwardThreadControl).toHaveBeenCalledWith(request, 'thr_owner')
    expect(result).toBe(forwarded)
  })

  it('registers the authenticated lightweight state route before the generic detail route', async () => {
    const forwarded = new Response(JSON.stringify({ state: true }), { status: 200 })
    const forwardThreadControl = vi.fn(async () => forwarded)
    const router = buildRouter({
      runtimeToken: 'thread-route-token', insecure: false, forwardThreadControl
    } as unknown as ServerRuntime)
    const authorized = new Request('http://127.0.0.1/v1/threads/thr_owner/state', {
      headers: { authorization: 'Bearer thread-route-token' }
    })
    const match = router.match('GET', new URL(authorized.url).pathname)
    if (!match) throw new Error('thread state route not found')

    expect(await match.handler(authorized, { params: match.params })).toBe(forwarded)
    expect(forwardThreadControl).toHaveBeenCalledWith(authorized, 'thr_owner')

    const unauthorized = new Request('http://127.0.0.1/v1/threads/thr_owner/state')
    const rejected = await match.handler(unauthorized, { params: match.params })
    expect(rejected.status).toBe(401)
  })

})
