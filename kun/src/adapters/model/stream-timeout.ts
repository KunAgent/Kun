/**
 * Streaming timeout policy for model requests.
 *
 * Three-tier timeout strategy (Addresses GitHub Issue #299):
 * - T1 (first token): time from request start to first data chunk
 * - T2 (inter-token): maximum idle time between consecutive chunks
 * - T3 (total): maximum total wait time for the entire request
 *
 * Timeout events are recorded to telemetry for observability.
 */

export type TimeoutFallbackStrategy = 'retry' | 'fallback_provider' | 'error'

export type StreamTimeoutConfig = {
  firstTokenTimeoutMs: number
  interTokenTimeoutMs: number
  totalTimeoutMs: number
  fallback: TimeoutFallbackStrategy
  maxRetries: number
  retryDelayMs: number
}

export const DEFAULT_STREAM_TIMEOUT_CONFIG: StreamTimeoutConfig = {
  firstTokenTimeoutMs: 30_000,
  interTokenTimeoutMs: 45_000,
  totalTimeoutMs: 600_000,
  fallback: 'retry',
  maxRetries: 2,
  retryDelayMs: 1_000,
}

export type TimeoutKind = 'first_token' | 'inter_token' | 'total'

export type StreamTimeoutEvent = {
  kind: TimeoutKind
  provider: string
  model: string
  threadId: string
  turnId: string
  durationMs: number
  fallback: TimeoutFallbackStrategy
  retryAttempt: number
}

export type TimeoutCheckResult =
  | { kind: 'ok' }
  | { kind: 'timeout'; timeoutKind: TimeoutKind; message: string }

/**
 * Tracks timing for a single streaming request.
 */
export class StreamTimeoutTracker {
  private readonly config: StreamTimeoutConfig
  private readonly metadata: { provider: string; model: string; threadId: string; turnId: string }
  private startTime = 0
  private lastChunkTime = 0
  private chunkCount = 0
  private retryCount = 0

  constructor(
    config: Partial<StreamTimeoutConfig>,
    metadata: { provider: string; model: string; threadId: string; turnId: string }
  ) {
    this.config = { ...DEFAULT_STREAM_TIMEOUT_CONFIG, ...config }
    this.metadata = metadata
  }

  start(): void {
    this.startTime = Date.now()
    this.lastChunkTime = this.startTime
    this.chunkCount = 0
  }

  onChunk(): TimeoutCheckResult {
    const elapsed = Date.now() - this.startTime

    if (this.config.totalTimeoutMs > 0 && elapsed > this.config.totalTimeoutMs) {
      return { kind: 'timeout', timeoutKind: 'total', message: `Total timeout after ${elapsed}ms (limit: ${this.config.totalTimeoutMs}ms)` }
    }

    if (this.chunkCount > 0 && this.config.interTokenTimeoutMs > 0) {
      const idleMs = Date.now() - this.lastChunkTime
      if (idleMs > this.config.interTokenTimeoutMs) {
        return { kind: 'timeout', timeoutKind: 'inter_token', message: `Inter-token timeout after ${idleMs}ms (limit: ${this.config.interTokenTimeoutMs}ms)` }
      }
    }

    this.lastChunkTime = Date.now()
    this.chunkCount++
    return { kind: 'ok' }
  }

  checkFirstToken(): TimeoutCheckResult {
    if (this.chunkCount > 0) return { kind: 'ok' }
    const elapsed = Date.now() - this.startTime
    if (this.config.firstTokenTimeoutMs > 0 && elapsed > this.config.firstTokenTimeoutMs) {
      return { kind: 'timeout', timeoutKind: 'first_token', message: `First token timeout after ${elapsed}ms (limit: ${this.config.firstTokenTimeoutMs}ms)` }
    }
    return { kind: 'ok' }
  }

  get retries(): number { return this.retryCount }
  canRetry(): boolean { return this.retryCount < this.config.maxRetries }
  recordRetry(): void { this.retryCount++ }
  elapsedMs(): number { return Date.now() - this.startTime }
  getConfig(): StreamTimeoutConfig { return this.config }

  createTelemetryEvent(timeoutKind: TimeoutKind): StreamTimeoutEvent {
    return {
      kind: timeoutKind, provider: this.metadata.provider, model: this.metadata.model,
      threadId: this.metadata.threadId, turnId: this.metadata.turnId,
      durationMs: this.elapsedMs(), fallback: this.config.fallback, retryAttempt: this.retryCount,
    }
  }
}

export function normalizeStreamTimeoutConfig(
  config?: Partial<StreamTimeoutConfig> | null | undefined
): StreamTimeoutConfig {
  return { ...DEFAULT_STREAM_TIMEOUT_CONFIG, ...(config ?? {}) }
}
