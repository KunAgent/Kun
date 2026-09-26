import type { PaperSearchSource } from './paper-search-types.js'

/**
 * Per-source request pacing + auto-degradation. Every source gets a minimum
 * interval between requests (a serialized spacing queue, not a parallel
 * token bucket); sources that keep returning HTTP 429 are marked degraded
 * and skipped for `degradeMs` so later searches fail fast instead of
 * hammering a limited API.
 *
 * Wait budget: if the pacing queue would delay a request beyond
 * `queueTimeoutMs` the wait is abandoned with a rate-limit error so the
 * caller reports a failure instead of hanging past the source timeout.
 */

/** Minimum spacing between requests, in milliseconds. */
const MIN_INTERVAL_MS: Record<PaperSearchSource, number> = {
  arxiv: 3_000,
  openalex: 200,
  semantic_scholar: 1_000,
  venues: 200,
  paperscool: 200,
  crossref: 200,
  europepmc: 200,
  openreview: 200,
  pubmed: 340, // NCBI guidance: 3 req/s without an API key.
  hal: 200,
  zenodo: 200,
  core: 200,
  biorxiv: 200,
  dblp: 200
}

/** Semantic Scholar raises the shared pool to 10 req/s with an API key. */
const MIN_INTERVAL_WITH_KEY_MS: Partial<Record<PaperSearchSource, number>> = {
  semantic_scholar: 100
}

export class PaperRateLimitError extends Error {
  constructor(
    readonly source: PaperSearchSource,
    message: string
  ) {
    super(message)
    this.name = 'PaperRateLimitError'
  }
}

export type PaperRateLimiterOptions = {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Max time a request may spend waiting in the pacing queue. */
  queueTimeoutMs?: number
  /** Consecutive 429s before a source is degraded. */
  degradeThreshold?: number
  /** How long a degraded source stays skipped. */
  degradeMs?: number
}

export class PaperRateLimiter {
  private readonly nextAt = new Map<PaperSearchSource, number>()
  private readonly chains = new Map<PaperSearchSource, Promise<void>>()
  private readonly consecutiveRateLimits = new Map<PaperSearchSource, number>()
  private readonly degradedUntil = new Map<PaperSearchSource, number>()
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly queueTimeoutMs: number
  private readonly degradeThreshold: number
  private readonly degradeMs: number

  constructor(options: PaperRateLimiterOptions = {}) {
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.queueTimeoutMs = options.queueTimeoutMs ?? 20_000
    this.degradeThreshold = options.degradeThreshold ?? 2
    this.degradeMs = options.degradeMs ?? 5 * 60_000
  }

  minIntervalMs(source: PaperSearchSource, credentials?: { semanticScholarApiKey?: string }): number {
    if (credentials?.semanticScholarApiKey) {
      const keyed = MIN_INTERVAL_WITH_KEY_MS[source]
      if (keyed !== undefined) return keyed
    }
    return MIN_INTERVAL_MS[source]
  }

  /** True while the source is auto-skipped after repeated rate limiting. */
  isDegraded(source: PaperSearchSource): boolean {
    const until = this.degradedUntil.get(source)
    if (until === undefined) return false
    if (until <= this.now()) {
      this.degradedUntil.delete(source)
      this.consecutiveRateLimits.delete(source)
      return false
    }
    return true
  }

  degradedUntilMs(source: PaperSearchSource): number | undefined {
    return this.isDegraded(source) ? this.degradedUntil.get(source) : undefined
  }

  /**
   * Serialize per-source pacing. Concurrent callers queue in call order so a
   * round of N requests to one source spaces out at `minIntervalMs`. Chain
   * links never reject, so a failed or aborted caller cannot poison the queue.
   */
  async acquire(
    source: PaperSearchSource,
    options: { credentials?: { semanticScholarApiKey?: string }; signal?: AbortSignal } = {}
  ): Promise<void> {
    const previous = this.chains.get(source) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.chains.set(source, tail)
    void tail.then(() => {
      if (this.chains.get(source) === tail) this.chains.delete(source)
    })
    try {
      await previous
      const interval = this.minIntervalMs(source, options.credentials)
      const earliest = Math.max(this.now(), this.nextAt.get(source) ?? 0)
      this.nextAt.set(source, earliest + interval)
      const wait = earliest - this.now()
      if (wait > this.queueTimeoutMs) {
        throw new PaperRateLimitError(source, `rate limited (queued ${Math.round(wait / 1000)}s)`)
      }
      if (wait > 0) await this.sleepInterruptibly(wait, options.signal)
    } finally {
      release()
    }
  }

  private async sleepInterruptibly(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (!signal) return this.sleep(ms)
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    await Promise.race([
      this.sleep(ms),
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    ])
  }

  /**
   * Record the outcome of a finished source request. Only HTTP 429 counts
   * toward degradation; any success or non-429 failure resets the streak.
   */
  recordOutcome(source: PaperSearchSource, error?: unknown): void {
    const status = (error as { status?: number } | undefined)?.status
    if (status === 429) {
      const count = (this.consecutiveRateLimits.get(source) ?? 0) + 1
      this.consecutiveRateLimits.set(source, count)
      if (count >= this.degradeThreshold) {
        this.degradedUntil.set(source, this.now() + this.degradeMs)
        this.consecutiveRateLimits.delete(source)
      }
      return
    }
    this.consecutiveRateLimits.delete(source)
  }

  reset(): void {
    this.nextAt.clear()
    this.chains.clear()
    this.consecutiveRateLimits.clear()
    this.degradedUntil.clear()
  }
}
