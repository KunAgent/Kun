import { Worker } from 'node:worker_threads'
import type {
  SessionUsageAggregateQuery,
  SessionUsageAggregateResponse
} from '../contracts/usage-query.js'
import type { SessionUsageRecord } from '../ports/session-store.js'
import { UsageIndexUnavailableError } from './usage-errors.js'

export const USAGE_QUERY_TIMEOUT_MS = 20_000
const USAGE_QUERY_RESULT_TTL_MS = 1_000
const USAGE_QUERY_RECENT_MAX = 32

type WorkerOutput =
  | { ok: true; result: SessionUsageAggregateResponse }
  | { ok: false; error: string }

type RecentResult = { value: SessionUsageAggregateResponse; settledAt: number }

export class UsageQueryExecutor {
  private readonly inflight = new Map<string, Promise<SessionUsageAggregateResponse>>()
  private readonly recent = new Map<string, RecentResult>()
  private globalQueryTail: Promise<void> = Promise.resolve()
  private epoch = 0

  constructor(
    private readonly sqlitePath: string,
    private readonly workerRunner?: (
      query: SessionUsageAggregateQuery,
      liveRecords: SessionUsageRecord[]
    ) => Promise<SessionUsageAggregateResponse>
  ) {}

  invalidate(): void {
    this.epoch += 1
    this.recent.clear()
  }

  execute(
    query: SessionUsageAggregateQuery,
    liveRecords: SessionUsageRecord[] = []
  ): Promise<SessionUsageAggregateResponse> {
    const epoch = this.epoch
    this.pruneRecent()
    const queryKey = JSON.stringify({ query, liveRecords })
    const key = `${epoch}:${queryKey}`
    const cached = this.recent.get(key)
    if (cached && Date.now() - cached.settledAt <= USAGE_QUERY_RESULT_TTL_MS) {
      return Promise.resolve(cached.value)
    }
    const active = this.inflight.get(key)
    if (active) return active
    const run = (): Promise<SessionUsageAggregateResponse> =>
      this.workerRunner?.(query, liveRecords) ?? this.runWorker(query, liveRecords)
    const execution = isGlobalUsageQuery(query)
      ? this.enqueueGlobalQuery(run)
      : run()
    const request = execution.then((value) => {
      if (this.epoch === epoch) {
        this.recent.set(key, { value, settledAt: Date.now() })
        this.pruneRecent()
      }
      return value
    }).finally(() => {
      if (this.inflight.get(key) === request) this.inflight.delete(key)
    })
    this.inflight.set(key, request)
    return request
  }

  private enqueueGlobalQuery(
    run: () => Promise<SessionUsageAggregateResponse>
  ): Promise<SessionUsageAggregateResponse> {
    const request = this.globalQueryTail.then(run, run)
    this.globalQueryTail = request.then(() => undefined, () => undefined)
    return request
  }

  private pruneRecent(): void {
    const now = Date.now()
    for (const [key, value] of this.recent) {
      if (now - value.settledAt > USAGE_QUERY_RESULT_TTL_MS) this.recent.delete(key)
    }
    while (this.recent.size > USAGE_QUERY_RECENT_MAX) {
      const oldest = this.recent.keys().next().value
      if (oldest === undefined) break
      this.recent.delete(oldest)
    }
  }

  private runWorker(
    query: SessionUsageAggregateQuery,
    liveRecords: SessionUsageRecord[]
  ): Promise<SessionUsageAggregateResponse> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./usage-query-worker.js', import.meta.url), {
        workerData: { sqlitePath: this.sqlitePath, query, liveRecords }
      })
      const timer = setTimeout(() => {
        void worker.terminate()
        reject(new UsageIndexUnavailableError('usage_query_timeout', 'Usage index query timed out'))
      }, USAGE_QUERY_TIMEOUT_MS)
      worker.once('message', (message: WorkerOutput) => {
        clearTimeout(timer)
        void worker.terminate()
        if (message.ok) resolve(message.result)
        else reject(new UsageIndexUnavailableError('usage_index_unavailable', message.error))
      })
      worker.once('error', (error) => {
        clearTimeout(timer)
        const message = error instanceof Error ? error.message : String(error)
        reject(new UsageIndexUnavailableError('usage_index_unavailable', message, { cause: error }))
      })
      worker.once('exit', (code) => {
        if (code === 0) return
        clearTimeout(timer)
        reject(new UsageIndexUnavailableError(
          'usage_index_unavailable',
          `Usage query worker exited with code ${code}`
        ))
      })
    })
  }
}

function isGlobalUsageQuery(query: SessionUsageAggregateQuery): boolean {
  return query.groupBy === 'day' ||
    query.groupBy === 'model' ||
    query.groupBy === 'provider_local_cost' ||
    query.groupBy === 'thread' && !query.threadId
}
