import { describe, expect, it, vi } from 'vitest'
import { emptyUsageSnapshot } from '../../contracts/usage.js'
import type { ServerRuntime } from './server-runtime.js'
import { usageJsonResponse } from './usage.js'

describe('usageJsonResponse', () => {
  it('returns persisted latest cache telemetry when reopening a thread', async () => {
    const usage = {
      ...emptyUsageSnapshot(),
      promptTokens: 1_000,
      completionTokens: 20,
      totalTokens: 1_020,
      cachedTokens: 900,
      cacheHitTokens: 900,
      cacheMissTokens: 100,
      cacheHitRate: 0.9,
      turns: 1
    }
    const loadUsageRecords = vi.fn(async () => [{
      threadId: 'thread-1',
      model: 'fixture-model',
      completedAt: '2026-08-09T00:00:00.000Z',
      usage
    }])
    const runtime = runtimeFixture({
      get: vi.fn(async () => ({ id: 'thread-1', model: 'fixture-model', updatedAt: '2026-08-09T00:00:00.000Z' })),
      list: vi.fn(async () => []),
      loadUsageRecords
    })

    const response = await usageJsonResponse(request('thread'), runtime)
    const body = JSON.parse(response.body) as { buckets: Array<Record<string, unknown>> }

    expect(response.status).toBe(200)
    expect(loadUsageRecords).toHaveBeenCalledWith({ threadId: 'thread-1' })
    expect(body.buckets).toContainEqual(expect.objectContaining({
      thread_id: 'thread-1',
      cache_hit_rate: 0.9,
      last_turn_cache_hit_rate: 0.9,
      cached_tokens: 900,
      cache_miss_tokens: 100
    }))
  })

  it('keeps cache telemetry unknown when persisted usage does not report it', async () => {
    const runtime = runtimeFixture({
      get: vi.fn(async () => ({ id: 'thread-1', model: 'fixture-model', updatedAt: '2026-08-09T00:00:00.000Z' })),
      list: vi.fn(async () => []),
      loadUsageRecords: vi.fn(async () => [{
        threadId: 'thread-1',
        completedAt: '2026-08-09T00:00:00.000Z',
        usage: { ...emptyUsageSnapshot(), promptTokens: 100, totalTokens: 100, turns: 1 }
      }])
    })

    const response = await usageJsonResponse(request('thread'), runtime)
    const body = JSON.parse(response.body) as { buckets: Array<Record<string, unknown>> }

    expect(body.buckets[0]).toMatchObject({
      cache_hit_rate: null,
      last_turn_cache_hit_rate: null
    })
  })

  it('coalesces concurrent all-thread usage record loads', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const loadUsageRecords = vi.fn(async () => {
      await gate
      return []
    })
    const runtime = runtimeFixture({
      loadUsageRecords,
      list: vi.fn(async () => [])
    })

    const daily = usageJsonResponse(request('day', '2026-08-01', '2026-08-09'), runtime)
    const model = usageJsonResponse(request('model', '2026-08-01', '2026-08-09'), runtime)

    await vi.waitFor(() => expect(loadUsageRecords).toHaveBeenCalledTimes(1))
    release()
    const responses = await Promise.all([daily, model])

    expect(responses.map((response) => response.status)).toEqual([200, 200])
  })

  it('coalesces concurrent loads for the same explicit thread', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const loadUsageRecords = vi.fn(async () => {
      await gate
      return []
    })
    const runtime = runtimeFixture({
      get: vi.fn(async () => ({
        id: 'thread-1', model: 'fixture-model', updatedAt: '2026-08-09T00:00:00.000Z'
      })),
      loadUsageRecords,
      list: vi.fn(async () => [])
    })

    const thread = usageJsonResponse(request('thread'), runtime)
    const turn = usageJsonResponse(request('turn'), runtime)

    await vi.waitFor(() => expect(loadUsageRecords).toHaveBeenCalledTimes(1))
    release()
    expect((await Promise.all([thread, turn])).map((response) => response.status)).toEqual([200, 200])
  })

  it('includes active, archived, and side threads while excluding deleted threads from model usage', async () => {
    // `threadService.list({ includeArchived: true, includeSide: true })` keeps
    // subagent side threads in the global aggregation now that child usage
    // settles on its own ledger instead of the parent, and the route drops
    // deleted threads defensively. Records for excluded threads must not
    // reach the model aggregation.
    const list = vi.fn(async () => [
      { id: 'thread-active', model: 'deepseek-v4', status: 'completed', relation: 'primary' },
      { id: 'thread-archived', model: 'glm-5.2', status: 'archived', relation: 'primary' },
      { id: 'thread-side', model: 'qwen3-coder', status: 'completed', relation: 'side' },
      { id: 'thread-gemini', model: 'gemini-3-pro', status: 'completed', relation: 'primary' },
      { id: 'thread-claude', model: 'claude-opus-4', status: 'completed', relation: 'primary' },
      { id: 'thread-custom', model: 'custom/model', status: 'completed', relation: 'primary' }
    ])
    const records = [
      ['thread-active', 'deepseek-v4', 700],
      ['thread-archived', 'glm-5.2', 600],
      ['thread-side', 'qwen3-coder', 500],
      ['thread-gemini', 'gemini-3-pro', 400],
      ['thread-claude', 'claude-opus-4', 300],
      ['thread-custom', 'custom/model', 200],
      ['thread-deleted', 'deleted-model', 1_000]
    ].map(([threadId, model, totalTokens]) => ({
      threadId: String(threadId),
      model: String(model),
      completedAt: '2026-08-09T00:00:00.000Z',
      usage: {
        ...emptyUsageSnapshot(),
        promptTokens: Number(totalTokens),
        totalTokens: Number(totalTokens),
        turns: 1
      }
    }))
    const runtime = runtimeFixture({
      list,
      loadUsageRecords: vi.fn(async () => records)
    })

    const response = await usageJsonResponse(
      request('model', '2026-08-01', '2026-08-09'),
      runtime
    )
    const body = JSON.parse(response.body) as { buckets: Array<{ model: string }> }

    expect(response.status).toBe(200)
    expect(list).toHaveBeenCalledWith({ includeArchived: true, includeSide: true })
    expect(body.buckets.map((bucket) => bucket.model)).toEqual([
      'deepseek-v4',
      'glm-5.2',
      'qwen3-coder',
      'gemini-3-pro',
      'claude-opus-4',
      'custom/model'
    ])
    expect(body.buckets.map((bucket) => bucket.model)).not.toContain('deleted-model')
  })

  it('reuses thread summaries when the optional usage index is unavailable', async () => {
    const get = vi.fn(async () => null)
    const list = vi.fn(async () => [{
      id: 'thread-1',
      model: 'fixture-model',
      updatedAt: '2026-08-09T00:00:00.000Z'
    }])
    const runtime = runtimeFixture({
      loadUsageRecords: vi.fn(async () => { throw new Error('index unavailable') }),
      loadEventsSince: vi.fn(async () => []),
      get,
      list
    })

    const response = await usageJsonResponse(
      request('day', '2026-08-01', '2026-08-09'),
      runtime
    )

    expect(response.status).toBe(200)
    expect(list).toHaveBeenCalledTimes(1)
    expect(get).not.toHaveBeenCalled()
  })

  it('bounds parallel JSONL reads when rebuilding usage without an index', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let activeReads = 0
    let maxActiveReads = 0
    const loadEventsSince = vi.fn(async () => {
      activeReads += 1
      maxActiveReads = Math.max(maxActiveReads, activeReads)
      await gate
      activeReads -= 1
      return []
    })
    const runtime = runtimeFixture({
      loadUsageRecords: vi.fn(async () => { throw new Error('index unavailable') }),
      loadEventsSince,
      list: vi.fn(async () => Array.from({ length: 20 }, (_, index) => ({
        id: `thread-${index}`,
        model: 'fixture-model',
        updatedAt: '2026-08-09T00:00:00.000Z'
      })))
    })

    const response = usageJsonResponse(
      request('day', '2026-08-01', '2026-08-09'),
      runtime
    )
    await vi.waitFor(() => expect(maxActiveReads).toBe(4))
    release()

    expect((await response).status).toBe(200)
    expect(loadEventsSince).toHaveBeenCalledTimes(20)
    expect(maxActiveReads).toBe(4)
  })

  it('returns a validated turn report with persisted turn ids', async () => {
    const runtime = runtimeFixture({
      get: vi.fn(async () => ({
        id: 'thread-1',
        model: 'gpt-5.6-sol',
        updatedAt: '2026-08-09T00:00:00.000Z'
      })),
      list: vi.fn(async () => []),
      loadUsageRecords: vi.fn(async () => [{
        threadId: 'thread-1',
        turnId: 'turn-1',
        model: 'gpt-5.6-sol',
        completedAt: '2026-08-09T00:00:00.000Z',
        usage: {
          ...emptyUsageSnapshot(),
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          turns: 1,
          actualProviderId: 'codex-work',
          actualModelId: 'gpt-5.6-sol',
          billingKind: 'subscription'
        }
      }])
    })

    const response = await usageJsonResponse(request('turn'), runtime)
    const body = JSON.parse(response.body) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      group_by: 'turn',
      thread_id: 'thread-1',
      buckets: [expect.objectContaining({
        turn_id: 'turn-1',
        requests: 1,
        total_tokens: 120,
        estimate_coverage: 'complete',
        reference_price_breakdown: expect.objectContaining({
          currency: 'USD',
          priced_requests: 1,
          unpriced_requests: 0,
          groups: [expect.objectContaining({
            model: 'gpt-5.6-sol',
            pricing_mode: 'standard',
            request_count: 1
          })]
        })
      })]
    })
  })

  it('requires thread_id for turn grouping', async () => {
    const runtime = runtimeFixture({ list: vi.fn(async () => []), loadUsageRecords: vi.fn(async () => []) })
    const response = await usageJsonResponse(
      new Request('http://kun.local/v1/usage?group_by=turn'),
      runtime
    )

    expect(response.status).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'validation_error',
      message: 'turn usage requires thread_id'
    })
  })

  it('preserves turn ids through the JSONL usage fallback', async () => {
    const runtime = runtimeFixture({
      get: vi.fn(async () => ({
        id: 'thread-1',
        model: 'gpt-5.6-terra',
        updatedAt: '2026-08-09T00:00:00.000Z',
        turns: [{ id: 'turn-jsonl', model: 'gpt-5.6-terra' }]
      })),
      list: vi.fn(async () => []),
      loadUsageRecords: vi.fn(async () => { throw new Error('index unavailable') }),
      loadEventsSince: vi.fn(async () => [{
        kind: 'usage',
        seq: 1,
        timestamp: '2026-08-09T00:00:00.000Z',
        threadId: 'thread-1',
        turnId: 'turn-jsonl',
        model: 'gpt-5.6-terra',
        usage: {
          ...emptyUsageSnapshot(),
          promptTokens: 200,
          totalTokens: 200,
          turns: 1,
          actualProviderId: 'codex-work',
          actualModelId: 'gpt-5.6-terra',
          billingKind: 'subscription'
        }
      }])
    })

    const response = await usageJsonResponse(request('turn'), runtime)
    const body = JSON.parse(response.body) as { buckets: Array<{ turn_id: string }> }

    expect(response.status).toBe(200)
    expect(body.buckets.map((bucket) => bucket.turn_id)).toEqual(['turn-jsonl'])
  })
})

function request(groupBy: 'thread' | 'day' | 'model' | 'turn', from?: string, to?: string): Request {
  const params = new URLSearchParams({ group_by: groupBy })
  if (groupBy === 'thread' || groupBy === 'turn') params.set('thread_id', 'thread-1')
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (groupBy !== 'thread' && groupBy !== 'turn') params.set('timezone', 'UTC')
  return new Request(`http://kun.local/v1/usage?${params.toString()}`)
}

function runtimeFixture(overrides: {
  get?: (threadId: string) => Promise<unknown>
  list: (options?: unknown) => Promise<unknown[]>
  loadEventsSince?: (threadId: string, sinceSeq: number) => Promise<unknown[]>
  loadUsageRecords: () => Promise<unknown[]>
}): ServerRuntime {
  return {
    threadService: {
      get: overrides.get ?? vi.fn(async () => null),
      list: overrides.list
    },
    sessionStore: {
      loadEventsSince: overrides.loadEventsSince ?? vi.fn(async () => []),
      loadUsageRecords: overrides.loadUsageRecords
    },
    usageService: {
      forThread: () => emptyUsageSnapshot()
    },
    nowIso: () => '2026-08-09T00:00:00.000Z'
  } as unknown as ServerRuntime
}
