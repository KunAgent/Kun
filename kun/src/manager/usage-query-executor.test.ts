import { describe, expect, it, vi } from 'vitest'
import type {
  SessionUsageAggregateQuery,
  SessionUsageAggregateResponse
} from '../contracts/usage-query.js'
import { UsageQueryExecutor } from './usage-query-executor.js'

describe('UsageQueryExecutor invalidation', () => {
  it('does not reuse or cache an in-flight result from an invalidated epoch', async () => {
    const deferred: Array<{
      resolve: (value: SessionUsageAggregateResponse) => void
      promise: Promise<SessionUsageAggregateResponse>
    }> = []
    const runner = vi.fn(() => {
      let resolve!: (value: SessionUsageAggregateResponse) => void
      const promise = new Promise<SessionUsageAggregateResponse>((done) => { resolve = done })
      deferred.push({ resolve, promise })
      return promise
    })
    const executor = new UsageQueryExecutor('/tmp/not-opened.sqlite3', runner)
    const query = { groupBy: 'thread' as const, threadId: 'thread-1' }
    const stale = executor.execute(query)
    executor.invalidate()
    const fresh = executor.execute(query)

    expect(runner).toHaveBeenCalledTimes(2)
    deferred[0]!.resolve(threadResponse(1))
    deferred[1]!.resolve(threadResponse(2))
    await expect(stale).resolves.toMatchObject({ totals: { turns: 1 } })
    await expect(fresh).resolves.toMatchObject({ totals: { turns: 2 } })
    await expect(executor.execute(query)).resolves.toMatchObject({ totals: { turns: 2 } })
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('bounds the recent-result cache', async () => {
    const runner = vi.fn(async () => threadResponse(1))
    const executor = new UsageQueryExecutor('/tmp/not-opened.sqlite3', runner)
    for (let index = 0; index < 33; index += 1) {
      await executor.execute({ groupBy: 'thread', threadId: `thread-${index}` })
    }
    await executor.execute({ groupBy: 'thread', threadId: 'thread-0' })
    expect(runner).toHaveBeenCalledTimes(34)
  })
  it('serializes global day and model queries while allowing thread queries through', async () => {
    const pending: Array<{
      query: SessionUsageAggregateQuery
      resolve: (value: SessionUsageAggregateResponse) => void
    }> = []
    const runner = vi.fn((query: SessionUsageAggregateQuery) =>
      new Promise<SessionUsageAggregateResponse>((resolve) => pending.push({ query, resolve })))
    const executor = new UsageQueryExecutor('/tmp/not-opened.sqlite3', runner)

    const daily = executor.execute(rangeQuery('day'))
    const model = executor.execute(rangeQuery('model'))
    const thread = executor.execute({ groupBy: 'thread', threadId: 'thread-1' })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    expect(pending.map((item) => item.query.groupBy)).toEqual(['thread', 'day'])
    pending[0]!.resolve(threadResponse(1))
    await expect(thread).resolves.toMatchObject({ totals: { turns: 1 } })
    pending[1]!.resolve(threadResponse(2))
    await expect(daily).resolves.toMatchObject({ totals: { turns: 2 } })
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(3))
    expect(pending[2]!.query.groupBy).toBe('model')
    pending[2]!.resolve(threadResponse(3))
    await expect(model).resolves.toMatchObject({ totals: { turns: 3 } })
  })

  it('serializes an unscoped thread aggregate behind another global query', async () => {
    const pending: Array<{
      query: SessionUsageAggregateQuery
      resolve: (value: SessionUsageAggregateResponse) => void
    }> = []
    const runner = vi.fn((query: SessionUsageAggregateQuery) =>
      new Promise<SessionUsageAggregateResponse>((resolve) => pending.push({ query, resolve })))
    const executor = new UsageQueryExecutor('/tmp/not-opened.sqlite3', runner)

    const daily = executor.execute(rangeQuery('day'))
    const allThreads = executor.execute({ groupBy: 'thread' })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    expect(pending[0]!.query.groupBy).toBe('day')
    pending[0]!.resolve(threadResponse(1))
    await daily
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    expect(pending[1]!.query).toEqual({ groupBy: 'thread' })
    pending[1]!.resolve(threadResponse(2))
    await expect(allThreads).resolves.toMatchObject({ totals: { turns: 2 } })
  })

  it('continues the global queue after a failed worker', async () => {
    let first = true
    const runner = vi.fn(async () => {
      if (first) {
        first = false
        throw new Error('worker failed')
      }
      return threadResponse(2)
    })
    const executor = new UsageQueryExecutor('/tmp/not-opened.sqlite3', runner)

    const daily = executor.execute(rangeQuery('day'))
    const model = executor.execute(rangeQuery('model'))

    await expect(daily).rejects.toThrow('worker failed')
    await expect(model).resolves.toMatchObject({ totals: { turns: 2 } })
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('does not cache a queued global result after invalidation', async () => {
    const deferred: Array<{
      resolve: (value: SessionUsageAggregateResponse) => void
    }> = []
    const runner = vi.fn(() => new Promise<SessionUsageAggregateResponse>((resolve) => {
      deferred.push({ resolve })
    }))
    const executor = new UsageQueryExecutor('/tmp/not-opened.sqlite3', runner)
    const query = rangeQuery('day')
    const stale = executor.execute(query)
    executor.invalidate()
    const fresh = executor.execute(query)

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    deferred[0]!.resolve(threadResponse(1))
    await expect(stale).resolves.toMatchObject({ totals: { turns: 1 } })
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2))
    deferred[1]!.resolve(threadResponse(2))
    await expect(fresh).resolves.toMatchObject({ totals: { turns: 2 } })
    await expect(executor.execute(query)).resolves.toMatchObject({ totals: { turns: 2 } })
    expect(runner).toHaveBeenCalledTimes(2)
  })
})

function rangeQuery(groupBy: 'day' | 'model'): SessionUsageAggregateQuery {
  return {
    groupBy,
    from: '2026-08-01',
    to: '2026-08-02',
    timezone: 'UTC',
    fromInclusive: '2026-08-01T00:00:00.000Z',
    toExclusive: '2026-08-03T00:00:00.000Z'
  }
}

function threadResponse(turns: number): SessionUsageAggregateResponse {
  return {
    group_by: 'thread',
    buckets: [],
    totals: {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_write_tokens: 0,
      cache_miss_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      cost_cny: 0,
      value_estimate_usd: 0,
      value_estimate_cny: 0,
      value_estimate_coverage: 'unavailable',
      value_estimate_priced_requests: 0,
      value_estimate_unpriced_requests: 0,
      cache_savings_usd: 0,
      cache_savings_cny: 0,
      token_economy_savings_tokens: 0,
      token_economy_savings_usd: 0,
      token_economy_savings_cny: 0,
      turns,
      thread_count: 0,
      cache_hit_rate: null
    }
  }
}
