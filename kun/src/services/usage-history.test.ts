import { describe, expect, it, vi } from 'vitest'
import { emptyUsageSnapshot, type UsageSnapshot } from '../contracts/usage.js'
import { loadUsageHistory } from './usage-history.js'
import { buildThreadUsageResponse } from './usage-service-responses.js'

describe('loadUsageHistory provider attribution', () => {
  it('uses metadata reads instead of hydrating message history', async () => {
    const metadata = {
      id: 'thread-metadata',
      model: 'model-a',
      providerId: 'provider-a',
      updatedAt: '2026-08-22T00:00:01.000Z',
      turns: [{ id: 'turn-metadata', model: 'model-a', providerId: 'provider-a' }]
    }
    const get = vi.fn(async () => { throw new Error('full thread hydration is forbidden') })
    const getMetadata = vi.fn(async () => metadata)
    const source = {
      threadService: { list: async () => [], get, getMetadata },
      sessionStore: {
        loadUsageRecords: async () => [{
          threadId: metadata.id,
          turnId: 'turn-metadata',
          completedAt: '2026-08-22T00:00:00.000Z',
          usage: { ...emptyUsageSnapshot(), promptTokens: 10, totalTokens: 10, turns: 1 }
        }],
        loadLatestUsageSnapshots: async () => []
      },
      usageService: { forThread: () => emptyUsageSnapshot() },
      nowIso: () => '2026-08-22T00:00:02.000Z'
    }

    await expect(loadUsageHistory(source as never, { threadId: metadata.id }))
      .resolves.toMatchObject([{ providerId: 'provider-a' }])
    expect(getMetadata).toHaveBeenCalledWith(metadata.id)
    expect(get).not.toHaveBeenCalled()
  })

  it('recovers providerId from the matching turn for indexed usage records', async () => {
    const thread = {
      id: 'thread-glm',
      model: 'glm-5.3',
      providerId: 'fallback-provider',
      updatedAt: '2026-08-22T00:00:01.000Z',
      turns: [{
        id: 'turn-glm',
        model: 'glm-5.3',
        providerId: 'zhipu-coding-plan'
      }]
    }
    const source = {
      threadService: {
        list: async () => [],
        get: async () => thread
      },
      sessionStore: {
        loadUsageRecords: async () => [{
          threadId: 'thread-glm',
          turnId: 'turn-glm',
          model: 'glm-5.3',
          completedAt: '2026-08-22T00:00:00.000Z',
          usage: {
            ...emptyUsageSnapshot(),
            promptTokens: 1_000,
            completionTokens: 100,
            totalTokens: 1_100,
            turns: 1
          }
        }],
        loadLatestUsageSnapshots: async () => [{
          threadId: 'thread-glm',
          usage: {
            ...emptyUsageSnapshot(),
            promptTokens: 1_000,
            completionTokens: 100,
            totalTokens: 1_100,
            turns: 1
          }
        }]
      },
      usageService: { forThread: () => emptyUsageSnapshot() },
      nowIso: () => '2026-08-22T00:00:02.000Z'
    }

    const records = await loadUsageHistory(source as never, { threadId: 'thread-glm' })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      threadId: 'thread-glm',
      turnId: 'turn-glm',
      model: 'glm-5.3',
      providerId: 'zhipu-coding-plan'
    })
  })

  it('attributes each turn to its own provider for a single-thread indexed query', async () => {
    const source = makeSwitchedThreadSource()

    const records = await loadUsageHistory(source as never, { threadId: 'thread-switch' })

    expect(providerByTurn(records)).toEqual({
      'turn-1': 'provider-a',
      'turn-2': 'provider-b'
    })
    expect(source.threadService.get).toHaveBeenCalledWith('thread-switch')
  })

  it('falls back to full reads when metadata-only reads are unavailable', async () => {
    const source = makeSwitchedThreadSource()

    const records = await loadUsageHistory(source as never)

    expect(providerByTurn(records)).toEqual({
      'turn-1': 'provider-a',
      'turn-2': 'provider-b'
    })
    // The summary has no turns, so the full record must have been hydrated.
    expect(source.threadService.get).toHaveBeenCalledWith('thread-switch')
  })

  it('prefers metadata-only reads and never hydrates message items for attribution', async () => {
    const source = makeSwitchedThreadSource()
    const getMetadata = vi.fn(async () => ({
      id: 'thread-switch',
      model: 'glm-5.3',
      providerId: 'provider-b',
      updatedAt: '2026-08-23T00:00:02.000Z',
      turns: [
        { id: 'turn-1', model: 'glm-5.3', providerId: 'provider-a' },
        { id: 'turn-2', model: 'glm-5.3', providerId: 'provider-b' }
      ]
    }))
    source.threadService.getMetadata = getMetadata

    const records = await loadUsageHistory(source as never)

    expect(providerByTurn(records)).toEqual({
      'turn-1': 'provider-a',
      'turn-2': 'provider-b'
    })
    expect(getMetadata).toHaveBeenCalledWith('thread-switch')
    expect(source.threadService.get).not.toHaveBeenCalled()
  })

  it('prefers a persisted provider id over the hydrated turn and thread fallbacks', async () => {
    const source = makeSwitchedThreadSource()
    source.sessionStore.loadUsageRecords.mockResolvedValue([
      indexedRecord('turn-1', 'provider-a', 1_000, 100),
      { ...indexedRecord('turn-2', 'provider-b', 2_000, 200), providerId: 'persisted-provider' }
    ])

    const records = await loadUsageHistory(source as never)

    expect(providerByTurn(records)).toEqual({
      'turn-1': 'provider-a',
      'turn-2': 'persisted-provider'
    })
  })

  // The index-less JSONL fallback computes cumulative deltas over the whole
  // event log before filtering by range, so range results must match what the
  // pre-computed usage index yields for the same thread.
  it('filters JSONL fallback only after computing cumulative deltas', async () => {
    const source = makeSwitchedThreadSource({
      loadUsageRecords: vi.fn(async () => { throw new Error('index unavailable') })
    })
    source.sessionStore.loadEventsSince = vi.fn(async () => [
      jsonlUsageEvent(1, 'turn-1', 1_000, 100),
      jsonlUsageEvent(2, 'turn-2', 1_200, 140)
    ])

    const records = await loadUsageHistory(source as never, {
      fromInclusive: '2026-08-23T00:00:02.000Z',
      toExclusive: '2026-08-23T00:00:03.000Z'
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      turnId: 'turn-2',
      usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 }
    })
  })

  it('bypasses every SQLite usage read in jsonl-only mode', async () => {
    const source = makeSwitchedThreadSource()
    source.sessionStore.loadEventsSince = vi.fn(async () => [
      jsonlUsageEvent(1, 'turn-1', 1_000, 100)
    ])

    const records = await loadUsageHistory(source as never, {}, 'jsonl-only')

    expect(records).toHaveLength(1)
    expect(source.sessionStore.loadUsageRecords).not.toHaveBeenCalled()
    expect(source.sessionStore.loadEventsSince).toHaveBeenCalledTimes(1)
  })

  it('shares one JSONL scan across concurrent ranges before filtering', async () => {
    const source = makeSwitchedThreadSource()
    source.sessionStore.loadEventsSince = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      return [
        jsonlUsageEvent(1, 'turn-1', 1_000, 100),
        jsonlUsageEvent(2, 'turn-2', 1_200, 140)
      ]
    })

    const [first, second] = await Promise.all([
      loadUsageHistory(source as never, {
        fromInclusive: '2026-08-23T00:00:01.000Z',
        toExclusive: '2026-08-23T00:00:02.000Z'
      }, 'jsonl-only'),
      loadUsageHistory(source as never, {
        fromInclusive: '2026-08-23T00:00:02.000Z',
        toExclusive: '2026-08-23T00:00:03.000Z'
      }, 'jsonl-only')
    ])

    expect(first.map((record) => record.turnId)).toEqual(['turn-1'])
    expect(second.map((record) => record.turnId)).toEqual(['turn-2'])
    expect(source.sessionStore.loadUsageRecords).not.toHaveBeenCalled()
    expect(source.sessionStore.loadEventsSince).toHaveBeenCalledTimes(1)
  })

  it('clears a failed JSONL-only load so a later refresh can retry', async () => {
    const source = makeSwitchedThreadSource()
    source.sessionStore.loadEventsSince = vi.fn()
      .mockRejectedValueOnce(new Error('temporary JSONL read failure'))
      .mockResolvedValueOnce([jsonlUsageEvent(1, 'turn-1', 1_000, 100)])

    await expect(loadUsageHistory(source as never, {}, 'jsonl-only'))
      .rejects.toThrow('temporary JSONL read failure')
    await expect(loadUsageHistory(source as never, {}, 'jsonl-only'))
      .resolves.toHaveLength(1)

    expect(source.sessionStore.loadEventsSince).toHaveBeenCalledTimes(2)
  })

  it('uses compatible thread reads in the JSONL fallback path too', async () => {
    const source = makeSwitchedThreadSource({
      loadUsageRecords: vi.fn(async () => {
        throw new Error('index unavailable')
      })
    })
    source.sessionStore.loadEventsSince = vi.fn(async () => [
      jsonlUsageEvent(1, 'turn-1', 1_000, 100),
      jsonlUsageEvent(2, 'turn-2', 2_000, 200)
    ])

    const records = await loadUsageHistory(source as never)

    expect(providerByTurn(records)).toEqual({
      'turn-1': 'provider-a',
      'turn-2': 'provider-b'
    })
    expect(source.threadService.get).toHaveBeenCalledWith('thread-switch')
  })

  it('hydrates each thread once and caps hydration concurrency at 4', async () => {
    const threadIds = Array.from({ length: 6 }, (_value, index) => `thread-bulk-${index}`)
    const threads = new Map(threadIds.map((id) => [id, {
      id,
      model: 'glm-5.3',
      providerId: 'provider-current',
      updatedAt: '2026-08-23T00:00:00.000Z',
      turns: [{ id: `turn-${id}`, model: 'glm-5.3', providerId: `provider-of-${id}` }]
    }]))
    let inFlight = 0
    let peakInFlight = 0
    const get = vi.fn(async (threadId: string) => {
      inFlight += 1
      peakInFlight = Math.max(peakInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return threads.get(threadId) ?? null
    })
    const source = {
      threadService: {
        list: async () => threadIds.map((id) => ({
          id,
          model: 'glm-5.3',
          providerId: 'provider-current',
          status: 'active'
        })),
        get
      },
      sessionStore: {
        loadUsageRecords: async () => threadIds.flatMap((id) => [
          indexedRecord(`turn-${id}`, undefined, 1_000, 100, id),
          indexedRecord(`turn-${id}`, undefined, 2_000, 200, id)
        ]),
        loadLatestUsageSnapshots: async () => []
      },
      usageService: { forThread: () => emptyUsageSnapshot() },
      nowIso: () => '2026-08-23T00:00:01.000Z'
    }

    const records = await loadUsageHistory(source as never)

    // Two indexed deltas per thread survive the differential fold untouched.
    expect(records).toHaveLength(threadIds.length * 2)
    expect(get).toHaveBeenCalledTimes(threadIds.length)
    expect(peakInFlight).toBeLessThanOrEqual(4)
  })

  it('degrades corrupt thread metadata to the summary instead of failing aggregation', async () => {
    const source = {
      threadService: {
        list: async () => [
          { id: 'thread-broken', model: 'glm-5.3', providerId: 'summary-provider', status: 'active', updatedAt: '2026-08-23T00:00:00.000Z' },
          { id: 'thread-healthy', model: 'glm-5.3', providerId: 'summary-provider', status: 'active', updatedAt: '2026-08-23T00:00:00.000Z' }
        ],
        get: async () => { throw new Error('full thread read must not run') },
        getMetadata: async (threadId: string) => {
          if (threadId === 'thread-broken') throw new Error('corrupt thread document')
          return {
            id: threadId,
            model: 'glm-5.3',
            providerId: 'thread-provider',
            updatedAt: '2026-08-23T00:00:00.000Z',
            turns: [{ id: 'turn-healthy', model: 'glm-5.3', providerId: 'turn-provider' }]
          }
        }
      },
      sessionStore: {
        loadUsageRecords: async () => [
          indexedRecord('turn-broken', undefined, 1_000, 100, 'thread-broken'),
          indexedRecord('turn-healthy', undefined, 1_000, 100, 'thread-healthy')
        ],
        loadLatestUsageSnapshots: async () => []
      },
      usageService: { forThread: () => emptyUsageSnapshot() },
      nowIso: () => '2026-08-23T00:00:03.000Z'
    }

    const records = await loadUsageHistory(source as never)

    expect(providerByTurn(records)).toEqual({
      // The corrupt document falls back to thread-current attribution.
      'turn-broken': 'summary-provider',
      'turn-healthy': 'turn-provider'
    })
  })

  it('reuses hydrated threads across loads keyed by updatedAt', async () => {
    const source = {
      threadService: {
        list: async () => [
          { id: 'thread-memo', model: 'glm-5.3', providerId: 'provider-b', status: 'active', updatedAt: '2026-08-23T00:00:02.000Z' }
        ],
        get: vi.fn(async () => ({
          id: 'thread-memo',
          model: 'glm-5.3',
          providerId: 'provider-b',
          updatedAt: '2026-08-23T00:00:02.000Z',
          turns: [
            { id: 'turn-1', model: 'glm-5.3', providerId: 'provider-a' },
            { id: 'turn-2', model: 'glm-5.3', providerId: 'provider-b' }
          ]
        }))
      },
      sessionStore: {
        loadUsageRecords: vi.fn(async () => [
          indexedRecord('turn-1', undefined, 1_000, 100, 'thread-memo'),
          indexedRecord('turn-2', undefined, 2_000, 200, 'thread-memo')
        ]),
        loadLatestUsageSnapshots: async () => [{
          threadId: 'thread-memo',
          usage: cumulativeUsage(2_000, 200)
        }]
      },
      usageService: { forThread: () => emptyUsageSnapshot() },
      nowIso: () => '2026-08-23T00:00:03.000Z'
    }

    const first = await loadUsageHistory(source as never)
    const second = await loadUsageHistory(source as never)

    expect(providerByTurn(first)).toEqual({
      'turn-1': 'provider-a',
      'turn-2': 'provider-b'
    })
    expect(providerByTurn(second)).toEqual(providerByTurn(first))
    // Only the first load pays the full-record read.
    expect(source.threadService.get).toHaveBeenCalledTimes(1)
  })

  it('keeps compact attribution reusable beyond the old 512-thread cache limit', async () => {
    const threadIds = Array.from({ length: 520 }, (_value, index) =>
      `thread-compact-memo-${index}`)
    const getMetadata = vi.fn(async (threadId: string) => ({
      id: threadId,
      model: 'glm-5.3',
      providerId: 'provider-current',
      updatedAt: '2026-08-23T00:00:04.000Z',
      turns: [{ id: `turn-${threadId}`, model: 'glm-5.3', providerId: 'provider-historical' }]
    }))
    const source = {
      threadService: {
        list: async () => threadIds.map((id) => ({
          id,
          model: 'glm-5.3',
          providerId: 'provider-current',
          status: 'idle',
          updatedAt: '2026-08-23T00:00:04.000Z'
        })),
        get: vi.fn(async () => { throw new Error('full thread read must not run') }),
        getMetadata
      },
      sessionStore: {
        loadUsageRecords: async () => threadIds.map((threadId) =>
          indexedRecord(`turn-${threadId}`, undefined, 1_000, 100, threadId)),
        loadLatestUsageSnapshots: async () => []
      },
      usageService: { forThread: () => emptyUsageSnapshot() },
      nowIso: () => '2026-08-23T00:00:05.000Z'
    }

    await loadUsageHistory(source as never)
    await loadUsageHistory(source as never)

    expect(getMetadata).toHaveBeenCalledTimes(threadIds.length)
    expect(source.threadService.get).not.toHaveBeenCalled()
  })

  it('feeds per-turn provider attribution into coding-plan zero-price aggregation', async () => {
    const source = {
      threadService: {
        list: async () => [
          { id: 'thread-payg', model: 'glm-5.3', providerId: 'zhipu-coding-plan', status: 'active' },
          { id: 'thread-plan', model: 'glm-5.3', providerId: 'zhipu-coding-plan', status: 'active' }
        ],
        get: async (threadId: string) => ({
          id: threadId,
          model: 'glm-5.3',
          // Both summaries claim the coding-plan provider is current; only
          // each turn's own route decides the billing attribution.
          providerId: 'zhipu-coding-plan',
          updatedAt: '2026-08-23T00:00:00.000Z',
          turns: [{
            id: `turn-${threadId}`,
            model: 'glm-5.3',
            providerId: threadId === 'thread-payg' ? 'zhipuai' : 'zhipu-coding-plan'
          }]
        })
      },
      sessionStore: {
        loadUsageRecords: async () => [
          indexedRecord('turn-thread-payg', undefined, 1_000, 100, 'thread-payg'),
          indexedRecord('turn-thread-plan', undefined, 1_000, 100, 'thread-plan')
        ],
        loadLatestUsageSnapshots: async () => []
      },
      usageService: { forThread: () => emptyUsageSnapshot() },
      nowIso: () => '2026-08-23T00:00:01.000Z'
    }

    const records = await loadUsageHistory(source as never)
    const response = buildThreadUsageResponse(records)
    const byThread = new Map(response.buckets.map((bucket) => [bucket.thread_id, bucket]))

    // The PayGo turn keeps its own attribution instead of being zeroed by the
    // thread's current coding-plan provider.
    expect(byThread.get('thread-payg')).toMatchObject({
      value_estimate_priced_requests: 0,
      value_estimate_coverage: 'unavailable'
    })
    expect(byThread.get('thread-plan')).toMatchObject({
      value_estimate_priced_requests: 1,
      value_estimate_coverage: 'complete'
    })
  })
})

type SwitchedSource = {
  threadService: {
    list: ReturnType<typeof vi.fn>
    get: ReturnType<typeof vi.fn>
    getMetadata?: ReturnType<typeof vi.fn>
  }
  sessionStore: {
    loadUsageRecords: ReturnType<typeof vi.fn>
    loadLatestUsageSnapshots: (options?: { threadIds?: string[] }) => Promise<
      Array<{ threadId: string; usage: ReturnType<typeof cumulativeUsage> }>
    >
    loadEventsSince?: ReturnType<typeof vi.fn>
  }
  usageService: { forThread: () => ReturnType<typeof emptyUsageSnapshot> }
  nowIso: () => string
}

function makeSwitchedThreadSource(sessionOverrides: Record<string, unknown> = {}): SwitchedSource {
  const thread = {
    id: 'thread-switch',
    model: 'glm-5.3',
    providerId: 'provider-b',
    updatedAt: '2026-08-23T00:00:02.000Z',
    turns: [
      { id: 'turn-1', model: 'glm-5.3', providerId: 'provider-a' },
      { id: 'turn-2', model: 'glm-5.3', providerId: 'provider-b' }
    ]
  }
  const summary = {
    id: 'thread-switch',
    model: 'glm-5.3',
    providerId: 'provider-b',
    status: 'active'
  }
  return {
    threadService: {
      list: vi.fn(async () => [summary]),
      get: vi.fn(async (threadId: string) => (threadId === 'thread-switch' ? thread : null))
    },
    sessionStore: {
      loadUsageRecords: vi.fn(async () => [
        indexedRecord('turn-1', undefined, 1_000, 100),
        indexedRecord('turn-2', undefined, 2_000, 200)
      ]),
      loadLatestUsageSnapshots: async () => [{
        threadId: 'thread-switch',
        usage: cumulativeUsage(2_000, 200)
      }],
      loadEventsSince: vi.fn(async () => []),
      ...sessionOverrides
    },
    usageService: { forThread: () => emptyUsageSnapshot() },
    nowIso: () => '2026-08-23T00:00:03.000Z'
  }
}

function indexedRecord(
  turnId: string,
  providerId: string | undefined,
  promptTokens: number,
  completionTokens: number,
  threadId = 'thread-switch'
): Record<string, unknown> {
  return {
    threadId,
    turnId,
    model: 'glm-5.3',
    ...(providerId ? { providerId } : {}),
    completedAt: `2026-08-23T00:00:0${promptTokens === 1_000 ? 1 : 2}.000Z`,
    usage: {
      ...emptyUsageSnapshot(),
      promptTokens: 1_000,
      completionTokens: 100,
      totalTokens: 1_100,
      turns: 1
    }
  }
}

function jsonlUsageEvent(
  seq: number,
  turnId: string,
  promptTokens: number,
  completionTokens: number
): Record<string, unknown> {
  return {
    kind: 'usage',
    threadId: 'thread-switch',
    seq,
    timestamp: `2026-08-23T00:00:0${seq}.000Z`,
    turnId,
    model: 'glm-5.3',
    usage: cumulativeUsage(promptTokens, completionTokens)
  }
}

function cumulativeUsage(promptTokens: number, completionTokens: number): UsageSnapshot {
  return {
    ...emptyUsageSnapshot(),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    turns: 1
  }
}

function providerByTurn(records: Array<{ turnId?: string; providerId?: string }>): Record<string, string | undefined> {
  return Object.fromEntries(records.map((record) => [record.turnId, record.providerId]))
}
