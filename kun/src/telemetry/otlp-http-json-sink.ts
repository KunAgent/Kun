import type {
  AgentObservabilityAttributeValue,
  AgentObservabilitySink,
  AgentObservabilitySpan
} from './agent-observability.js'

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_BATCH_SIZE = 64
const DEFAULT_MAX_QUEUE_SIZE = 2_048
const MAX_RETRY_DELAY_MS = 30_000

class PermanentOtlpExportError extends Error {}

export type OtlpHttpJsonSinkOptions = {
  endpoint?: string
  headers?: Record<string, string>
  timeoutMs?: number
  batchSize?: number
  maxQueueSize?: number
  fetch?: typeof globalThis.fetch
}

/**
 * A bounded, non-blocking OTLP/HTTP JSON exporter. Runtime event persistence
 * must never wait for an external collector, so emit only queues work and a
 * single background worker owns delivery and retry ordering.
 */
export class OtlpHttpJsonAgentObservabilitySink implements AgentObservabilitySink {
  private readonly endpoint: string
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number
  private readonly batchSize: number
  private readonly maxQueueSize: number
  private readonly fetchImpl: typeof globalThis.fetch
  private queue: AgentObservabilitySpan[] = []
  private scheduled = false
  private inFlight: Promise<void> | undefined
  private retryAttempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private warnedAboutOverflow = false

  constructor(options: OtlpHttpJsonSinkOptions = {}) {
    this.endpoint = options.endpoint ?? DEFAULT_OTLP_ENDPOINT
    this.headers = options.headers ?? {}
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  emit(span: AgentObservabilitySpan): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift()
      if (!this.warnedAboutOverflow) {
        this.warnedAboutOverflow = true
        console.warn('[kun] OTLP trace queue full; dropping oldest spans')
      }
    }
    this.queue.push(span)
    this.scheduleFlush()
  }

  async flush(): Promise<void> {
    if (this.inFlight) return this.inFlight
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    if (this.queue.length === 0) return

    const batch = this.queue.splice(0, this.batchSize)
    this.inFlight = this.exportBatch(batch)
      .then(() => {
        this.retryAttempt = 0
        this.warnedAboutOverflow = false
      })
      .catch((error: unknown) => {
        if (error instanceof PermanentOtlpExportError) {
          console.warn(`[kun] OTLP trace export rejected; dropping batch: ${error.message}`)
          return
        }
        this.requeue(batch)
        const delayMs = Math.min(1_000 * 2 ** this.retryAttempt, MAX_RETRY_DELAY_MS)
        this.retryAttempt += 1
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[kun] OTLP trace export failed; retrying in ${delayMs}ms: ${message}`)
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined
          this.scheduleFlush()
        }, delayMs)
        this.retryTimer.unref?.()
      })
      .finally(() => {
        this.inFlight = undefined
        if (!this.retryTimer && this.queue.length > 0) this.scheduleFlush()
      })
    return this.inFlight
  }

  private scheduleFlush(): void {
    if (this.scheduled || this.inFlight || this.retryTimer) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.flush()
    })
  }

  private requeue(batch: AgentObservabilitySpan[]): void {
    const available = Math.max(0, this.maxQueueSize - this.queue.length)
    this.queue = [...batch.slice(Math.max(0, batch.length - available)), ...this.queue]
  }

  private async exportBatch(batch: AgentObservabilitySpan[]): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    timeout.unref?.()
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify(toExportTraceServiceRequest(batch)),
        signal: controller.signal
      })
      if (!response.ok) {
        const message = `collector returned HTTP ${response.status}`
        if (response.status !== 408 && response.status !== 429 && response.status < 500) {
          throw new PermanentOtlpExportError(message)
        }
        throw new Error(message)
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function resolveOtlpTracesEndpoint(input: {
  tracesEndpoint?: string
  commonEndpoint?: string
}): string {
  if (input.tracesEndpoint) return input.tracesEndpoint
  if (!input.commonEndpoint) return DEFAULT_OTLP_ENDPOINT
  return input.commonEndpoint.replace(/\/$/, '') + '/v1/traces'
}

export function parseOtlpHeaders(value: string | undefined): Record<string, string> | undefined {
  if (!value?.trim()) return undefined
  const headers: Record<string, string> = {}
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const key = safeDecodeURIComponent(entry.slice(0, separator).trim())
    const headerValue = safeDecodeURIComponent(entry.slice(separator + 1).trim())
    if (key) headers[key] = headerValue
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function toExportTraceServiceRequest(spans: AgentObservabilitySpan[]): Record<string, unknown> {
  return {
    resourceSpans: [{
      resource: {
        attributes: [attribute('service.name', 'kun-runtime')]
      },
      scopeSpans: [{
        scope: { name: 'kun.agent-observability' },
        spans: spans.map(toOtlpSpan),
        schemaUrl: spans[0]?.schemaUrl
      }]
    }]
  }
}

function toOtlpSpan(span: AgentObservabilitySpan): Record<string, unknown> {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    kind: span.kind === 'client' ? 3 : 1,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: Object.entries(span.attributes).map(([key, value]) => attribute(key, value)),
    status: {
      code: span.status.code === 'OK' ? 1 : span.status.code === 'ERROR' ? 2 : 0,
      ...(span.status.message ? { message: span.status.message } : {})
    },
    ...(span.events?.length
      ? {
          events: span.events.map((event) => ({
            name: event.name,
            timeUnixNano: event.timeUnixNano,
            attributes: Object.entries(event.attributes ?? {}).map(([key, value]) => attribute(key, value))
          }))
        }
      : {})
  }
}

function attribute(key: string, value: AgentObservabilityAttributeValue): Record<string, unknown> {
  return { key, value: anyValue(value) }
}

function anyValue(value: AgentObservabilityAttributeValue): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((entry) => ({ stringValue: entry })) } }
  }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  return { stringValue: value }
}
