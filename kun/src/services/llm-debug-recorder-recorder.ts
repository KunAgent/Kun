import { randomUUID } from 'node:crypto'
import type { UsageSnapshot } from '../contracts/usage.js'
import { redactBrowserUseActionForPersistence } from '../contracts/browser-use.js'
import {
  MAX_MODEL_REQUEST_TRACE_PROVIDER_ID_LENGTH,
  MAX_MODEL_REQUEST_TRACE_PROVIDER_KIND_LENGTH,
  MAX_MODEL_REQUEST_TRACE_TOOL_CATALOG_ENTRIES,
  MAX_MODEL_REQUEST_TRACE_TOOL_NAME_LENGTH,
  MODEL_REQUEST_TRACE_SCHEMA_VERSION,
  type ModelRequestTraceDecoded,
  type ModelRequestTraceDelegated,
  type ModelRequestTraceFailureOrigin,
  type ModelRequestTraceLimits,
  type ModelRequestTracePage,
  type ModelRequestTracePhase,
  type ModelRequestTraceRecord,
  type ModelRequestTraceToolCatalogEntry
} from '../contracts/model-request-trace.js'
import type { ModelStreamChunk } from '../ports/model-client.js'
import {
  BoundedModelTraceBodyAccumulator,
  boundedModelTraceText,
  redactModelTraceValues,
  sanitizeModelTraceHeaders,
  sanitizeModelTraceUrl
} from './model-request-trace-safety.js'
import {
  MAX_MODEL_REQUEST_TRACE_PAGE_SIZE,
  ModelRequestTraceStore
} from './model-request-trace-store.js'
import { type CaptureState, DEFAULT_LLM_DEBUG_RECORDER_LIMITS, type LlmCliInvocationMeta, type LlmDebugRecorderLimits, type LlmDebugRecorderOptions, type LlmDebugRound, type LlmDebugRoundMeta, type LlmDebugSink, type LlmDebugToolCall, type LlmDebugToolResult, type LlmHttpAttemptMeta, type LlmHttpAttemptReason, type LlmPhaseDiagnosticMeta, type LlmSdkInvocationMeta } from './llm-debug-recorder-contracts.js'
import { addCaptureWarning, appendStringBlock, cloneDecoded, cloneDecodedLive, createCaptureState, elapsedMs, finishRecord, joinStringBlocks, jsonBytes, jsonStringContentBytes, markTruncated, newestRecordFirst, parseLegacyRequestBody, positiveInteger, redactBrowserUseDebugContent, safeError, truncateJsonStringContent } from './llm-debug-recorder-support.js'
import { TrajectoryContentStore } from './trajectory-content-store.js'
import type { PromptManifest } from '../contracts/trajectory.js'
import {
  emptyBody,
  emptyHeaders,
  interruptedRecord,
  isFirstContentChunk,
  persistentMetadataRecord,
  retainedReasoningLength,
  retainedTextLength
} from './llm-debug-recorder-trajectory.js'

/**
 * Count/byte-bounded live recorder plus private per-thread JSONL persistence.
 * Wire records never contain provider credentials: URL/header sanitization is
 * performed synchronously before a record is put into active memory.
 */
export class LlmDebugRecorder implements LlmDebugSink {
  private readonly rounds: LlmDebugRound[] = []
  private readonly states = new WeakMap<LlmDebugRound, CaptureState>()
  private readonly activeByThread = new Map<string, Set<LlmDebugRound>>()
  private readonly limits: LlmDebugRecorderLimits
  private readonly store?: ModelRequestTraceStore
  private readonly contentStore?: TrajectoryContentStore
  private readonly capturePolicy?: LlmDebugRecorderOptions['shouldCapture']
  private nextId = 1
  private nextTraceSequence = 1
  private totalRetainedBytes = 0
  private activeCaptureCountValue = 0

  constructor(options: LlmDebugRecorderOptions = {}) {
    this.limits = {
      capacity: positiveInteger(options.capacity, DEFAULT_LLM_DEBUG_RECORDER_LIMITS.capacity),
      maxRequestBodyBytes: positiveInteger(
        options.maxRequestBodyBytes,
        DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxRequestBodyBytes
      ),
      maxResponseBodyBytes: positiveInteger(
        options.maxResponseBodyBytes,
        DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxResponseBodyBytes
      ),
      maxRoundBytes: positiveInteger(options.maxRoundBytes, DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxRoundBytes),
      maxTotalBytes: positiveInteger(options.maxTotalBytes, DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxTotalBytes),
      maxPageSize: positiveInteger(options.maxPageSize, DEFAULT_LLM_DEBUG_RECORDER_LIMITS.maxPageSize)
    }
    if (options.dataDir) {
      this.store = new ModelRequestTraceStore(options.dataDir)
      this.contentStore = new TrajectoryContentStore(options.dataDir)
    }
    this.capturePolicy = options.shouldCapture
  }

  shouldCapture(threadId: string): boolean | Promise<boolean> {
    return this.capturePolicy?.(threadId) ?? true
  }

  start(meta: LlmDebugRoundMeta): LlmDebugRound {
    const startedAt = new Date().toISOString()
    const round: LlmDebugRound = {
      id: this.nextId++,
      roundId: meta.roundId ?? randomUUID(),
      step: Math.max(0, Math.floor(meta.step ?? 0)),
      purpose: meta.purpose ?? 'assistant',
      captureContent: meta.captureContent !== false,
      threadId: meta.threadId,
      turnId: meta.turnId,
      provider: meta.provider,
      model: meta.model,
      url: '',
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      requestBody: null,
      output: { text: '', reasoning: '', toolCalls: [], toolResults: [] },
      exchanges: []
    }
    this.states.set(round, createCaptureState(meta.toolCatalog, meta.redactedRequestValues))
    const active = this.activeByThread.get(meta.threadId) ?? new Set<LlmDebugRound>()
    active.add(round)
    this.activeByThread.set(meta.threadId, active)
    this.activeCaptureCountValue += 1
    return round
  }

  beginHttpAttempt(round: LlmDebugRound, meta: LlmHttpAttemptMeta): ModelRequestTraceRecord {
    return this.beginAttempt(round, {
      transport: 'http',
      method: 'POST',
      endpointFormat: meta.endpointFormat,
      attempt: meta.attempt,
      reason: meta.reason,
      target: meta.url,
      headers: meta.headers,
      bodyText: meta.bodyText,
      ...(meta.secretValues ? { secretValues: meta.secretValues } : {}),
      ...(meta.phase ? { phase: meta.phase } : {}),
      ...(meta.failureOrigin ? { failureOrigin: meta.failureOrigin } : {}),
      ...(meta.diagnosticCode ? { diagnosticCode: meta.diagnosticCode } : {})
    })
  }

  beginCliInvocation(round: LlmDebugRound, meta: LlmCliInvocationMeta): ModelRequestTraceRecord {
    return this.beginAttempt(round, {
      transport: 'cli',
      method: 'CLI',
      endpointFormat: meta.endpointFormat,
      attempt: 1,
      reason: 'initial',
      target: meta.target,
      headers: {},
      bodyText: meta.bodyText,
      ...(meta.delegated ? { delegated: meta.delegated } : {}),
      ...(meta.phase ? { phase: meta.phase } : {})
    })
  }

  beginSdkInvocation(round: LlmDebugRound, meta: LlmSdkInvocationMeta): ModelRequestTraceRecord {
    return this.beginAttempt(round, {
      transport: 'sdk',
      method: 'SDK',
      endpointFormat: meta.endpointFormat,
      attempt: 1,
      reason: 'initial',
      target: meta.target,
      headers: {},
      bodyText: meta.bodyText,
      ...(meta.secretValues ? { secretValues: meta.secretValues } : {}),
      ...(meta.delegated ? { delegated: meta.delegated } : {}),
      ...(meta.phase ? { phase: meta.phase } : {})
    })
  }

  recordPhaseDiagnostic(round: LlmDebugRound, meta: LlmPhaseDiagnosticMeta): ModelRequestTraceRecord {
    const startedAt = new Date().toISOString()
    const message = redactModelTraceValues(meta.message, meta.secretValues ?? [])
    const record: ModelRequestTraceRecord = {
      schemaVersion: MODEL_REQUEST_TRACE_SCHEMA_VERSION,
      id: randomUUID(),
      sequence: this.nextTraceSequence++,
      threadId: round.threadId,
      turnId: round.turnId,
      provider: round.provider,
      model: round.model,
      phase: meta.phase,
      failureOrigin: meta.failureOrigin,
      diagnosticCode: meta.code,
      endpointFormat: 'diagnostic',
      attempt: 1,
      attemptReason: 'initial',
      status: 'not_started',
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      error: message.slice(0, 2_048)
    }
    round.exchanges.push(record)
    return record
  }

  private beginAttempt(
    round: LlmDebugRound,
    meta: {
      transport: 'http' | 'cli' | 'sdk'
      method: 'POST' | 'CLI' | 'SDK'
      endpointFormat: string
      attempt: number
      reason: LlmHttpAttemptReason
      target: string
      headers: Record<string, string>
      bodyText: string
      secretValues?: readonly string[]
      delegated?: ModelRequestTraceDelegated
      phase?: ModelRequestTracePhase
      failureOrigin?: ModelRequestTraceFailureOrigin
      diagnosticCode?: string
    }
  ): ModelRequestTraceRecord {
    const state = this.stateFor(round)
    const sanitizedUrl = sanitizeModelTraceUrl(meta.target)
    const body = round.captureContent
      ? boundedModelTraceText(
          redactModelTraceValues(
            redactBrowserUseDebugContent(meta.bodyText),
            state.redactedRequestValues
          ),
          this.limits.maxRequestBodyBytes
        )
      : undefined
    const record: ModelRequestTraceRecord = {
      schemaVersion: MODEL_REQUEST_TRACE_SCHEMA_VERSION,
      id: randomUUID(),
      roundId: round.roundId,
      step: round.step,
      purpose: round.purpose,
      captureMode: round.captureContent ? 'full' : 'metadata',
      sequence: this.nextTraceSequence++,
      threadId: round.threadId,
      turnId: round.turnId,
      provider: round.provider,
      model: round.model,
      transport: meta.transport,
      ...(meta.phase ? { phase: meta.phase } : {}),
      ...(meta.failureOrigin ? { failureOrigin: meta.failureOrigin } : {}),
      ...(meta.diagnosticCode ? { diagnosticCode: meta.diagnosticCode } : {}),
      endpointFormat: meta.endpointFormat,
      attempt: meta.attempt,
      attemptReason: meta.reason,
      status: 'pending',
      startedAt: new Date().toISOString(),
      ...(state.toolCatalog.length
        ? { toolCatalog: state.toolCatalog.map((tool) => ({ ...tool })) }
        : {}),
      request: {
        method: meta.method,
        url: sanitizedUrl.value,
        urlRedacted: sanitizedUrl.redacted,
        ...(round.captureContent
          ? {
              headers: sanitizeModelTraceHeaders(meta.headers, meta.secretValues),
              body: body!
            }
          : {
              headers: emptyHeaders(),
              body: emptyBody()
            })
      },
      ...(meta.delegated
        ? {
            delegated: {
              ...meta.delegated,
              capabilities: { ...meta.delegated.capabilities }
            }
          }
        : {})
    }
    round.exchanges.push(record)
    round.url = sanitizedUrl.value
    if (body) {
      round.requestBodyOriginalBytes = body.originalBytes
      round.requestBodyTruncated = body.truncated
      round.requestBody = parseLegacyRequestBody(body.text, body)
      state.requestBytes = Math.max(state.requestBytes, body.capturedBytes)
    }
    if (round.captureContent && this.contentStore) {
      const capture = this.contentStore.captureRequest({
        threadId: round.threadId,
        requestId: record.id,
        bodyText: meta.bodyText,
        secretValues: [...state.redactedRequestValues, ...(meta.secretValues ?? [])]
      }).then((manifest) => {
        record.manifestId = manifest.manifestId
      }).catch((error) => {
        addCaptureWarning(record, `prompt manifest capture failed: ${safeError(error)}`)
      })
      state.pendingCaptures.push(capture)
    }
    void this.persistCheckpoint(record)
    return record
  }

  captureHttpResponse(round: LlmDebugRound, record: ModelRequestTraceRecord, response: Response): void {
    const responseStartedAt = new Date().toISOString()
    record.responseStartedAt = responseStartedAt
    record.timeToHeadersMs = elapsedMs(record.startedAt, responseStartedAt)
    record.response = {
      status: response.status,
      statusText: response.statusText,
      headers: round.captureContent ? sanitizeModelTraceHeaders(response.headers) : emptyHeaders()
    }
    if (!round.captureContent) return
    let clone: Response
    try {
      clone = response.clone()
    } catch (error) {
      record.status = 'capture_error'
      record.response.captureError = safeError(error)
      addCaptureWarning(record, 'response clone failed')
      finishRecord(record)
      return
    }
    const capture = this.captureResponseBody(record, clone)
    this.stateFor(round).pendingCaptures.push(capture)
  }

  captureHttpError(record: ModelRequestTraceRecord, error: unknown): void {
    this.captureTransportError(record, error)
  }

  captureTransportError(record: ModelRequestTraceRecord, error: unknown): void {
    record.status = 'transport_error'
    record.error = safeError(error)
    finishRecord(record)
  }

  captureChunk(round: LlmDebugRound, chunk: ModelStreamChunk): void {
    const state = this.stateFor(round)
    if (isFirstContentChunk(chunk)) {
      const current = round.exchanges.at(-1)
      if (current && !current.firstTokenAt) {
        current.firstTokenAt = new Date().toISOString()
        void this.persistCheckpoint(current)
      }
    }
    switch (chunk.kind) {
      case 'assistant_text_delta':
        this.captureText(round, state, 'text', chunk.text)
        break
      case 'assistant_reasoning_delta':
        this.captureText(round, state, 'reasoning', chunk.text)
        break
      case 'tool_call_complete':
        this.captureToolCall(round, state, {
          callId: chunk.callId,
          toolName: chunk.toolName,
          arguments: chunk.arguments
        })
        break
      case 'usage':
        this.captureValue(round, state, chunk.usage)
        break
      case 'completed':
        this.captureString(round, state, 'stopReason', chunk.stopReason)
        break
      case 'error':
        this.captureString(round, state, 'error', chunk.message)
        break
    }
    const current = round.exchanges.at(-1)
    if (current) {
      current.receivedTextLength = retainedTextLength(state)
      current.receivedReasoningLength = retainedReasoningLength(state)
      const now = Date.now()
      if (now - state.lastCheckpointAt >= 2_000) {
        state.lastCheckpointAt = now
        void this.persistCheckpoint(current)
      }
    }
  }

  captureToolResult(round: LlmDebugRound, result: LlmDebugToolResult): void {
    const state = this.stateFor(round)
    const safeOutput = result.toolName === 'browser_use'
      ? redactBrowserUseDebugContent(result.output)
      : result.output
    const base = {
      callId: result.callId,
      toolName: result.toolName,
      output: '',
      isError: result.isError
    }
    const available = Math.max(0, this.remainingOutputBytes(state) - jsonBytes(base))
    const output = truncateJsonStringContent(safeOutput, available)
    const retained = { ...base, output }
    const bytes = jsonBytes(retained)
    if (bytes <= this.remainingOutputBytes(state)) {
      round.output.toolResults.push(retained)
      state.outputBytes += bytes
    } else {
      markTruncated(round.output, 'toolResults')
      return
    }
    if (output !== safeOutput) markTruncated(round.output, 'toolResults')
  }

  async finish(round: LlmDebugRound): Promise<void> {
    const state = this.stateFor(round)
    await Promise.allSettled(state.pendingCaptures)
    round.output.text = joinStringBlocks(state.text)
    round.output.reasoning = joinStringBlocks(state.reasoning)
    const lastExchange = round.exchanges.at(-1)
    if (lastExchange) lastExchange.decoded = cloneDecoded(round.output)
    for (const record of round.exchanges) {
      if (record.status === 'pending') {
        record.status = record.response?.captureError
          ? 'capture_error'
          : round.output.error
            ? 'failed'
            : round.output.stopReason
              ? 'completed'
              : 'cancelled'
        finishRecord(record)
      }
      await this.store?.append(persistentMetadataRecord(record))
    }
    if (this.states.delete(round)) this.activeCaptureCountValue = Math.max(0, this.activeCaptureCountValue - 1)
    const active = this.activeByThread.get(round.threadId)
    active?.delete(round)
    if (active?.size === 0) this.activeByThread.delete(round.threadId)
    round.finishedAt = new Date().toISOString()
    round.durationMs = elapsedMs(round.startedAt, round.finishedAt)
    round.retainedBytes = jsonBytes(round)
    this.totalRetainedBytes += round.retainedBytes
    this.rounds.push(round)
    while (this.rounds.length > this.limits.capacity || this.totalRetainedBytes > this.limits.maxTotalBytes) {
      const removed = this.rounds.shift()
      if (!removed) break
      this.totalRetainedBytes = Math.max(0, this.totalRetainedBytes - (removed.retainedBytes ?? jsonBytes(removed)))
    }
  }

  /** Most-recent-first compatibility projection. */
  snapshot(): LlmDebugRound[] {
    return [...this.rounds].reverse()
  }

  async listThread(
    threadId: string,
    options: { limit?: number; cursor?: string } = {}
  ): Promise<ModelRequestTracePage> {
    const limit = Math.min(this.limits.maxPageSize, Math.max(1, Math.floor(options.limit ?? 50)))
    const active = options.cursor ? [] : this.activeRecords(threadId)
    if (active.length >= limit) {
      return {
        schemaVersion: MODEL_REQUEST_TRACE_SCHEMA_VERSION,
        records: active.slice(0, limit),
        activeCount: active.length,
        limits: this.traceLimits(),
        warnings: this.store?.warnings() ?? []
      }
    }
    const remaining = limit - active.length
    const persisted = this.store
      ? await this.store.list(threadId, { limit: remaining, cursor: options.cursor })
      : {
          records: this.rounds
            .filter((round) => round.threadId === threadId)
            .flatMap((round) => round.exchanges)
            .sort(newestRecordFirst)
            .slice(0, remaining),
          warnings: []
        }
    const activeIds = new Set(active.map((record) => record.id))
    const merged = new Map<string, ModelRequestTraceRecord>()
    for (const record of persisted.records) {
      merged.set(record.id, record.status === 'pending' && !activeIds.has(record.id)
        ? interruptedRecord(record)
        : record)
    }
    for (const record of active) merged.set(record.id, record)
    return {
      schemaVersion: MODEL_REQUEST_TRACE_SCHEMA_VERSION,
      records: [...merged.values()].sort(newestRecordFirst).slice(0, limit),
      ...(persisted.nextCursor ? { nextCursor: persisted.nextCursor } : {}),
      activeCount: active.length,
      limits: this.traceLimits(),
      warnings: persisted.warnings
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const active = this.activeByThread.get(threadId)
    if (active) {
      for (const round of active) {
        for (const record of round.exchanges) addCaptureWarning(record, 'thread deleted during capture')
      }
      this.activeByThread.delete(threadId)
    }
    for (let index = this.rounds.length - 1; index >= 0; index -= 1) {
      if (this.rounds[index].threadId !== threadId) continue
      this.totalRetainedBytes = Math.max(
        0,
        this.totalRetainedBytes - (this.rounds[index].retainedBytes ?? jsonBytes(this.rounds[index]))
      )
      this.rounds.splice(index, 1)
    }
    await Promise.all([
      this.store?.deleteThread(threadId),
      this.contentStore?.deleteThread(threadId)
    ])
  }

  loadPromptManifest(threadId: string, manifestId: string): Promise<PromptManifest | null> {
    return this.contentStore?.loadManifest(threadId, manifestId) ?? Promise.resolve(null)
  }

  loadPromptManifestContent(
    threadId: string,
    manifestId: string
  ): ReturnType<TrajectoryContentStore['loadManifestContent']> {
    return this.contentStore?.loadManifestContent(threadId, manifestId) ?? Promise.resolve(null)
  }

  async shutdown(): Promise<void> {
    await this.store?.shutdown()
  }

  clear(): void {
    this.rounds.length = 0
    this.totalRetainedBytes = 0
  }

  get activeCaptureCount(): number {
    return this.activeCaptureCountValue
  }

  traceLimits(): ModelRequestTraceLimits {
    return {
      maxRequestBodyBytes: this.limits.maxRequestBodyBytes,
      maxResponseBodyBytes: this.limits.maxResponseBodyBytes,
      maxPageSize: this.limits.maxPageSize
    }
  }

  private activeRecords(threadId: string): ModelRequestTraceRecord[] {
    return [...(this.activeByThread.get(threadId) ?? [])]
      .flatMap((round) => round.exchanges.map((record) => ({
        ...record,
        ...(record === round.exchanges.at(-1) ? { decoded: cloneDecodedLive(round, this.states.get(round)) } : {})
      })))
      .sort(newestRecordFirst)
  }

  private async persistCheckpoint(record: ModelRequestTraceRecord): Promise<void> {
    await this.store?.append(persistentMetadataRecord(record))
  }

  private async captureResponseBody(record: ModelRequestTraceRecord, response: Response): Promise<void> {
    const accumulator = new BoundedModelTraceBodyAccumulator(this.limits.maxResponseBodyBytes)
    try {
      if (response.body) {
        const reader = response.body.getReader()
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (value) accumulator.append(value)
          }
        } finally {
          try { reader.releaseLock() } catch { /* already released */ }
        }
      }
      if (record.response) record.response.body = accumulator.finish()
      record.status = 'completed'
    } catch (error) {
      if (record.response) {
        record.response.body = accumulator.finish()
        record.response.captureError = safeError(error)
      }
      record.status = 'capture_error'
      addCaptureWarning(record, 'response body capture failed')
    } finally {
      finishRecord(record)
    }
  }

  private captureText(
    round: LlmDebugRound,
    state: CaptureState,
    field: 'text' | 'reasoning',
    value: string
  ): void {
    if (!value) return
    const retained = truncateJsonStringContent(value, this.remainingOutputBytes(state))
    if (retained) {
      appendStringBlock(field === 'text' ? state.text : state.reasoning, retained)
      state.outputBytes += jsonStringContentBytes(retained)
    }
    if (retained !== value) markTruncated(round.output, field)
  }

  private captureToolCall(round: LlmDebugRound, state: CaptureState, call: LlmDebugToolCall): void {
    const safeCall = call.toolName === 'browser_use'
      ? {
          ...call,
          arguments: redactBrowserUseActionForPersistence(call.arguments) as Record<string, unknown>
        }
      : call
    const bytes = jsonBytes(safeCall)
    if (bytes > this.remainingOutputBytes(state)) {
      markTruncated(round.output, 'toolCalls')
      return
    }
    round.output.toolCalls.push(safeCall)
    state.outputBytes += bytes
  }

  private captureValue(round: LlmDebugRound, state: CaptureState, value: UsageSnapshot): void {
    if (round.output.usage !== undefined) return
    const bytes = jsonBytes(value)
    if (bytes > this.remainingOutputBytes(state)) {
      markTruncated(round.output, 'usage')
      return
    }
    round.output.usage = value
    state.outputBytes += bytes
  }

  private captureString(
    round: LlmDebugRound,
    state: CaptureState,
    field: 'stopReason' | 'error',
    value: string
  ): void {
    if (round.output[field] !== undefined) return
    const retained = truncateJsonStringContent(value, this.remainingOutputBytes(state))
    if (retained) {
      round.output[field] = retained
      state.outputBytes += jsonStringContentBytes(retained)
    }
    if (retained !== value) markTruncated(round.output, field)
  }

  private remainingOutputBytes(state: CaptureState): number {
    return Math.max(0, this.limits.maxRoundBytes - state.requestBytes - state.outputBytes)
  }

  private stateFor(round: LlmDebugRound): CaptureState {
    const existing = this.states.get(round)
    if (existing) return existing
    const created = createCaptureState()
    this.states.set(round, created)
    this.activeCaptureCountValue += 1
    return created
  }
}
