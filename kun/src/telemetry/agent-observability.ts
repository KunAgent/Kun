import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { RuntimeEvent } from '../contracts/events.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { ObservabilityConfig } from '../config/kun-config.js'
import type { RuntimeEventObserver } from '../services/runtime-event-recorder.js'

export type AgentObservabilityAttributeValue = string | number | boolean | string[]

export type AgentObservabilitySpan = {
  schemaUrl: string
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'internal' | 'client'
  startTimeUnixNano: string
  endTimeUnixNano: string
  durationMs: number
  status: {
    code: 'OK' | 'ERROR' | 'UNSET'
    message?: string
  }
  attributes: Record<string, AgentObservabilityAttributeValue>
  events?: Array<{
    name: string
    timeUnixNano: string
    attributes?: Record<string, AgentObservabilityAttributeValue>
  }>
}

export type AgentObservabilitySink = {
  emit(span: AgentObservabilitySpan): Promise<void> | void
}

type PendingSpan = {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'internal' | 'client'
  startMs: number
  startTimeUnixNano: string
  attributes: Record<string, AgentObservabilityAttributeValue>
  events: NonNullable<AgentObservabilitySpan['events']>
  firstTextSeen?: boolean
}

const SCHEMA_URL = 'https://opentelemetry.io/schemas/1.37.0'

export class JsonlAgentObservabilitySink implements AgentObservabilitySink {
  private ready: Promise<void> | undefined

  constructor(private readonly outputPath: string) {}

  async emit(span: AgentObservabilitySpan): Promise<void> {
    this.ready ??= mkdir(dirname(this.outputPath), { recursive: true }).then(() => undefined)
    await this.ready
    await appendFile(this.outputPath, JSON.stringify({ span }) + '\n', 'utf8')
  }
}

export class AgentObservabilityRecorder implements RuntimeEventObserver {
  private readonly turns = new Map<string, PendingSpan>()
  private readonly tools = new Map<string, PendingSpan>()

  constructor(private readonly sink: AgentObservabilitySink) {}

  async record(event: RuntimeEvent): Promise<void> {
    switch (event.kind) {
      case 'turn_started':
        this.startTurn(event)
        return
      case 'assistant_text_delta':
        this.recordTtft(event)
        return
      case 'item_created':
      case 'item_updated':
      case 'item_completed':
        await this.recordItemEvent(event)
        return
      case 'model_request_retry':
        this.addTurnEvent(event.threadId, event.turnId, 'gen_ai.model.retry', {
          'http.response.status_code': event.status,
          'kun.retry.attempt': event.attempt,
          'kun.retry.max_attempts': event.maxAttempts,
          'kun.retry.delay_ms': event.delayMs
        }, event.timestamp)
        return
      case 'pipeline_stage':
        this.addTurnEvent(event.threadId, event.turnId, 'kun.pipeline_stage', {
          'kun.pipeline.stage': event.stage,
          ...(event.label ? { 'kun.pipeline.label': event.label } : {})
        }, event.timestamp)
        return
      case 'usage':
        this.recordUsage(event)
        return
      case 'turn_completed':
        await this.finishTurn(event, 'OK')
        return
      case 'turn_failed':
      case 'turn_aborted':
        await this.finishTurn(event, 'ERROR', event.message ?? event.code ?? event.kind)
        return
      case 'error':
        this.addTurnEvent(event.threadId, event.turnId, 'exception', {
          'exception.message': event.message,
          ...(event.code ? { 'exception.type': event.code } : {}),
          ...(event.severity ? { 'kun.error.severity': event.severity } : {})
        }, event.timestamp)
        return
      default:
        return
    }
  }

  clearThread(threadId: string): void {
    for (const key of [...this.turns.keys()]) {
      if (key.startsWith(threadId + ':')) this.turns.delete(key)
    }
    for (const key of [...this.tools.keys()]) {
      if (key.startsWith(threadId + ':')) this.tools.delete(key)
    }
  }

  private startTurn(event: RuntimeEvent): void {
    if (!event.turnId) return
    const key = turnKey(event.threadId, event.turnId)
    if (this.turns.has(key)) return
    const startMs = timestampMs(event.timestamp)
    this.turns.set(key, {
      traceId: traceId(event.threadId, event.turnId),
      spanId: spanId(key + ':turn'),
      name: 'kun.turn',
      kind: 'internal',
      startMs,
      startTimeUnixNano: unixNano(event.timestamp),
      attributes: {
        'service.name': 'kun-runtime',
        'gen_ai.operation.name': 'chat',
        'kun.thread.id': event.threadId,
        'kun.turn.id': event.turnId
      },
      events: []
    })
  }

  private recordTtft(event: RuntimeEvent): void {
    if (!event.turnId) return
    const span = this.turns.get(turnKey(event.threadId, event.turnId))
    if (!span || span.firstTextSeen) return
    span.firstTextSeen = true
    span.attributes['kun.ttft_ms'] = Math.max(0, timestampMs(event.timestamp) - span.startMs)
  }

  private async recordItemEvent(event: RuntimeEvent): Promise<void> {
    if (!('item' in event)) return
    const item = event.item
    if (item.kind === 'tool_call' && event.kind === 'item_created') {
      const key = toolKey(item.threadId, item.turnId, item.callId)
      if (this.tools.has(key)) return
      const parent = this.turns.get(turnKey(item.threadId, item.turnId))
      this.tools.set(key, {
        traceId: parent?.traceId ?? traceId(item.threadId, item.turnId),
        spanId: spanId(key + ':tool'),
        ...(parent ? { parentSpanId: parent.spanId } : {}),
        name: 'kun.tool ' + item.toolName,
        kind: 'client',
        startMs: timestampMs(event.timestamp),
        startTimeUnixNano: unixNano(event.timestamp),
        attributes: {
          'tool.name': item.toolName,
          'kun.tool.call_id': item.callId,
          'kun.tool.kind': item.toolKind,
          'kun.thread.id': item.threadId,
          'kun.turn.id': item.turnId
        },
        events: []
      })
      return
    }
    if (item.kind === 'tool_result' && (event.kind === 'item_created' || event.kind === 'item_completed')) {
      const key = toolKey(item.threadId, item.turnId, item.callId)
      const span = this.tools.get(key)
      if (!span) return
      span.attributes['kun.tool.is_error'] = item.isError
      await this.emitSpan(span, event.timestamp, item.isError ? 'ERROR' : 'OK')
      this.tools.delete(key)
    }
  }

  private recordUsage(event: RuntimeEvent): void {
    if (event.kind !== 'usage') return
    if (!event.turnId) return
    const span = this.turns.get(turnKey(event.threadId, event.turnId))
    if (!span) return
    Object.assign(span.attributes, usageAttributes(event.usage, event.model))
  }

  private async finishTurn(
    event: RuntimeEvent,
    code: AgentObservabilitySpan['status']['code'],
    message?: string
  ): Promise<void> {
    if (!event.turnId) return
    const key = turnKey(event.threadId, event.turnId)
    const span = this.turns.get(key)
    await this.finishDanglingToolSpans(event.threadId, event.turnId, event.timestamp, code === 'OK' ? 'UNSET' : 'ERROR', message)
    if (!span) return
    await this.emitSpan(span, event.timestamp, code, message)
    this.turns.delete(key)
  }

  private async finishDanglingToolSpans(
    threadId: string,
    turnId: string,
    timestamp: string,
    code: AgentObservabilitySpan['status']['code'],
    message?: string
  ): Promise<void> {
    const prefix = toolKey(threadId, turnId, '')
    for (const [key, span] of [...this.tools.entries()]) {
      if (!key.startsWith(prefix)) continue
      await this.emitSpan(span, timestamp, code, message)
      this.tools.delete(key)
    }
  }

  private addTurnEvent(
    threadId: string,
    turnId: string | undefined,
    name: string,
    attributes: Record<string, AgentObservabilityAttributeValue>,
    timestamp: string
  ): void {
    if (!turnId) return
    const span = this.turns.get(turnKey(threadId, turnId))
    if (!span) return
    span.events.push({ name, timeUnixNano: unixNano(timestamp), attributes })
  }

  private async emitSpan(
    span: PendingSpan,
    timestamp: string,
    code: AgentObservabilitySpan['status']['code'],
    message?: string
  ): Promise<void> {
    const endMs = timestampMs(timestamp)
    await this.sink.emit({
      schemaUrl: SCHEMA_URL,
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      name: span.name,
      kind: span.kind,
      startTimeUnixNano: span.startTimeUnixNano,
      endTimeUnixNano: unixNano(timestamp),
      durationMs: Math.max(0, endMs - span.startMs),
      status: {
        code,
        ...(message ? { message } : {})
      },
      attributes: span.attributes,
      ...(span.events.length ? { events: span.events } : {})
    })
  }
}

export function createAgentObservabilityRecorder(input: {
  config?: ObservabilityConfig
  dataDir: string
}): AgentObservabilityRecorder | undefined {
  if (!input.config?.enabled) return undefined
  const outputPath = input.config.outputPath
    ? resolveOutputPath(input.config.outputPath, input.dataDir)
    : join(input.dataDir, 'observability', 'agent-spans.jsonl')
  return new AgentObservabilityRecorder(new JsonlAgentObservabilitySink(outputPath))
}

function usageAttributes(usage: UsageSnapshot, model: string | undefined): Record<string, AgentObservabilityAttributeValue> {
  return {
    ...(model ? { 'gen_ai.response.model': model } : {}),
    'gen_ai.usage.input_tokens': usage.promptTokens,
    'gen_ai.usage.output_tokens': usage.completionTokens,
    'gen_ai.usage.total_tokens': usage.totalTokens,
    ...(usage.cacheHitTokens !== undefined ? { 'gen_ai.usage.input_token_details.cache_read': usage.cacheHitTokens } : {}),
    ...(usage.cacheMissTokens !== undefined ? { 'kun.cache.miss_tokens': usage.cacheMissTokens } : {}),
    ...(usage.cacheHitRate !== null && usage.cacheHitRate !== undefined ? { 'kun.cache.hit_rate': usage.cacheHitRate } : {}),
    ...(usage.costUsd !== undefined ? { 'kun.usage.cost_usd': usage.costUsd } : {}),
    ...(usage.costCny !== undefined ? { 'kun.usage.cost_cny': usage.costCny } : {})
  }
}

function resolveOutputPath(path: string, dataDir: string): string {
  return isAbsolute(path) ? path : join(dataDir, path)
}

function turnKey(threadId: string, turnId: string): string {
  return threadId + ':' + turnId
}

function toolKey(threadId: string, turnId: string, callId: string): string {
  return threadId + ':' + turnId + ':' + callId
}

function traceId(threadId: string, turnId: string): string {
  return createHash('sha256').update(threadId + ':' + turnId).digest('hex').slice(0, 32)
}

function spanId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function unixNano(timestamp: string): string {
  return String(BigInt(timestampMs(timestamp)) * 1_000_000n)
}

function timestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Date.now()
}
