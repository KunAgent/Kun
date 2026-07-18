import { randomUUID } from 'node:crypto'
import {
  ExtensionApiError,
  ExtensionErrorSchema,
  type ExtensionErrorData
} from '@kun/extension-api'
import { z } from 'zod'
import { asExtensionError, extensionError, type ExtensionErrorDetails } from './errors.js'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import { EXTENSION_RPC_VERSION, type JsonValue } from './types.js'

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
)

const CorrelationId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const ErrorPayloadSchema = z.object({
  code: z.string().min(1).max(200),
  message: z.string().max(4_000),
  retryable: z.boolean().optional(),
  details: z.record(z.string(), JsonValueSchema).optional()
}).strict()

const RequestEnvelopeSchema = z.object({
  rpcVersion: z.literal(EXTENSION_RPC_VERSION),
  kind: z.literal('request'),
  id: CorrelationId,
  method: z.string().min(1).max(300),
  params: JsonValueSchema
}).strict()

const ResponseEnvelopeSchema = z.object({
  rpcVersion: z.literal(EXTENSION_RPC_VERSION),
  kind: z.literal('response'),
  id: CorrelationId,
  result: JsonValueSchema.optional(),
  error: ErrorPayloadSchema.optional()
}).strict().superRefine((value, context) => {
  if ((value.result === undefined) === (value.error === undefined)) {
    context.addIssue({ code: 'custom', message: 'Response must have exactly one result or error' })
  }
})

const NotificationEnvelopeSchema = z.object({
  rpcVersion: z.literal(EXTENSION_RPC_VERSION),
  kind: z.literal('notification'),
  method: z.string().min(1).max(300),
  params: JsonValueSchema
}).strict()

const CancelEnvelopeSchema = z.object({
  rpcVersion: z.literal(EXTENSION_RPC_VERSION),
  kind: z.literal('cancel'),
  id: CorrelationId
}).strict()

const StreamEnvelopeSchema = z.object({
  rpcVersion: z.literal(EXTENSION_RPC_VERSION),
  kind: z.literal('stream'),
  requestId: CorrelationId,
  sequence: z.number().int().positive(),
  payload: JsonValueSchema,
  terminal: z.boolean().optional()
}).strict()

const AckEnvelopeSchema = z.object({
  rpcVersion: z.literal(EXTENSION_RPC_VERSION),
  kind: z.literal('ack'),
  requestId: CorrelationId,
  sequence: z.number().int().positive()
}).strict()

const RpcEnvelopeSchema = z.discriminatedUnion('kind', [
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema,
  NotificationEnvelopeSchema,
  CancelEnvelopeSchema,
  StreamEnvelopeSchema,
  AckEnvelopeSchema
])

export type RpcErrorPayload = z.infer<typeof ErrorPayloadSchema>
export type RpcEnvelope = z.infer<typeof RpcEnvelopeSchema>
export type RpcRequestContext = { id: string; signal: AbortSignal }

export type RpcPeerOptions = {
  send(envelope: RpcEnvelope): Promise<void>
  onRequest?(method: string, params: JsonValue, context: RpcRequestContext): Promise<JsonValue>
  onNotification?(method: string, params: JsonValue): void | Promise<void>
  onStream?(
    requestId: string,
    sequence: number,
    payload: JsonValue,
    terminal: boolean
  ): void | Promise<void>
  maxMessageBytes?: number
  maxConcurrentRequests?: number
  defaultRequestTimeoutMs?: number
  streamWindow?: number
  maxStreamBufferBytes?: number
  cancellationGraceMs?: number
  onCancellationTimeout?(requestId: string): void | Promise<void>
}

export const DEFAULT_EXTENSION_MESSAGE_BYTES = 1024 * 1024
export const DEFAULT_EXTENSION_CONCURRENT_REQUESTS = 16
export const DEFAULT_EXTENSION_REQUEST_TIMEOUT_MS = 60_000
export const DEFAULT_EXTENSION_STREAM_WINDOW = 32
export const DEFAULT_EXTENSION_STREAM_BUFFER_BYTES = 4 * 1024 * 1024

type PendingRequest = {
  resolve(value: JsonValue): void
  reject(error: unknown): void
  timer: NodeJS.Timeout
  method: string
  timeoutMs: number
  resetTimeoutOnStream: boolean
  abortCleanup?: () => void
}

type InboundRequest = { controller: AbortController; terminal: boolean }
type OutboundStream = {
  nextSequence: number
  unacked: Map<number, { bytes: number; resolve(): void; reject(error: unknown): void }>
  bufferedBytes: number
  terminalSent: boolean
}

export class JsonRpcPeer {
  private readonly maxMessageBytes: number
  private readonly maxConcurrentRequests: number
  private readonly defaultRequestTimeoutMs: number
  private readonly streamWindow: number
  private readonly maxStreamBufferBytes: number
  private readonly pending = new Map<string, PendingRequest>()
  private readonly inbound = new Map<string, InboundRequest>()
  private readonly incomingStreamSequence = new Map<string, number>()
  private readonly outgoingStreams = new Map<string, OutboundStream>()
  private readonly cancelled = new Map<string, NodeJS.Timeout>()
  private closedError: Error | undefined

  constructor(private readonly options: RpcPeerOptions) {
    this.maxMessageBytes = positiveInteger(
      options.maxMessageBytes,
      DEFAULT_EXTENSION_MESSAGE_BYTES,
      'maxMessageBytes'
    )
    this.maxConcurrentRequests = positiveInteger(
      options.maxConcurrentRequests,
      DEFAULT_EXTENSION_CONCURRENT_REQUESTS,
      'maxConcurrentRequests'
    )
    this.defaultRequestTimeoutMs = positiveInteger(
      options.defaultRequestTimeoutMs,
      DEFAULT_EXTENSION_REQUEST_TIMEOUT_MS,
      'defaultRequestTimeoutMs'
    )
    this.streamWindow = positiveInteger(
      options.streamWindow,
      DEFAULT_EXTENSION_STREAM_WINDOW,
      'streamWindow'
    )
    this.maxStreamBufferBytes = positiveInteger(
      options.maxStreamBufferBytes,
      DEFAULT_EXTENSION_STREAM_BUFFER_BYTES,
      'maxStreamBufferBytes'
    )
  }

  get pendingRequestCount(): number {
    return this.pending.size
  }

  async request(
    method: string,
    params: JsonValue,
    options: { signal?: AbortSignal; timeoutMs?: number; resetTimeoutOnStream?: boolean } = {}
  ): Promise<JsonValue> {
    this.assertOpen()
    if (this.pending.size >= this.maxConcurrentRequests) {
      throw extensionError('EXTENSION_HOST_CONCURRENCY_LIMIT', 'Extension host request limit reached', {
        maximum: this.maxConcurrentRequests
      })
    }
    if (options.signal?.aborted) {
      throw extensionError('EXTENSION_HOST_CANCELLED', 'Extension host request was cancelled')
    }
    const id = `r_${randomUUID().replaceAll('-', '')}`
    const timeoutMs = positiveInteger(options.timeoutMs, this.defaultRequestTimeoutMs, 'timeoutMs')
    const envelope: RpcEnvelope = {
      rpcVersion: EXTENSION_RPC_VERSION,
      kind: 'request',
      id,
      method,
      params
    }
    return new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.markCancelled(id)
        void this.send({ rpcVersion: EXTENSION_RPC_VERSION, kind: 'cancel', id }).catch(() => undefined)
        this.settlePending(id, undefined, extensionError(
          'EXTENSION_HOST_TIMEOUT',
          'Extension host request timed out',
          { method, timeoutMs }
        ))
      }, timeoutMs)
      timer.unref?.()
      const pending: PendingRequest = {
        resolve,
        reject,
        timer,
        method,
        timeoutMs,
        resetTimeoutOnStream: options.resetTimeoutOnStream ?? false
      }
      if (options.signal !== undefined) {
        const onAbort = () => {
          this.markCancelled(id)
          void this.send({ rpcVersion: EXTENSION_RPC_VERSION, kind: 'cancel', id }).catch(() => undefined)
          this.settlePending(
            id,
            undefined,
            extensionError('EXTENSION_HOST_CANCELLED', 'Extension host request was cancelled', { method })
          )
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
        pending.abortCleanup = () => options.signal?.removeEventListener('abort', onAbort)
      }
      this.pending.set(id, pending)
      void this.send(envelope).catch((error: unknown) => this.settlePending(id, undefined, error))
    })
  }

  async notify(method: string, params: JsonValue): Promise<void> {
    this.assertOpen()
    await this.send({
      rpcVersion: EXTENSION_RPC_VERSION,
      kind: 'notification',
      method,
      params
    })
  }

  async sendStream(requestId: string, payload: JsonValue, terminal = false): Promise<void> {
    this.assertOpen()
    const stream = this.outgoingStreams.get(requestId) ?? {
      nextSequence: 1,
      unacked: new Map(),
      bufferedBytes: 0,
      terminalSent: false
    }
    if (stream.terminalSent) {
      throw extensionError('EXTENSION_STREAM_TERMINATED', 'Stream already has a terminal item', {
        requestId
      })
    }
    const sequence = stream.nextSequence
    const envelope: RpcEnvelope = {
      rpcVersion: EXTENSION_RPC_VERSION,
      kind: 'stream',
      requestId,
      sequence,
      payload,
      ...(terminal ? { terminal: true } : {})
    }
    const bytes = envelopeBytes(envelope)
    if (
      stream.unacked.size >= this.streamWindow ||
      stream.bufferedBytes + bytes > this.maxStreamBufferBytes
    ) {
      throw extensionError('EXTENSION_STREAM_BACKPRESSURE', 'Extension stream acknowledgement window is full', {
        requestId,
        unacked: stream.unacked.size,
        bufferedBytes: stream.bufferedBytes,
        window: this.streamWindow,
        maximumBytes: this.maxStreamBufferBytes
      })
    }
    stream.nextSequence += 1
    stream.bufferedBytes += bytes
    stream.terminalSent = terminal
    this.outgoingStreams.set(requestId, stream)

    return new Promise<void>((resolve, reject) => {
      stream.unacked.set(sequence, { bytes, resolve, reject })
      void this.send(envelope).catch((error: unknown) => {
        const acknowledgement = stream.unacked.get(sequence)
        if (acknowledgement !== undefined) {
          stream.unacked.delete(sequence)
          stream.bufferedBytes -= acknowledgement.bytes
          acknowledgement.reject(error)
        }
        if (stream.unacked.size === 0) this.outgoingStreams.delete(requestId)
      })
    })
  }

  async receive(raw: unknown): Promise<void> {
    this.assertOpen()
    const envelope = parseRpcEnvelope(raw, this.maxMessageBytes)
    switch (envelope.kind) {
      case 'response':
        this.clearCancelled(envelope.id)
        if (envelope.error !== undefined) {
          this.settlePending(
            envelope.id,
            undefined,
            errorFromPayload(envelope.error)
          )
        } else {
          this.settlePending(envelope.id, envelope.result ?? null)
        }
        return
      case 'request':
        await this.handleRequest(envelope)
        return
      case 'notification':
        await this.options.onNotification?.(envelope.method, envelope.params)
        return
      case 'cancel':
        this.inbound.get(envelope.id)?.controller.abort()
        this.closeOutgoingStream(
          envelope.id,
          extensionError('EXTENSION_HOST_CANCELLED', 'Extension host request was cancelled')
        )
        return
      case 'stream':
        await this.handleStream(envelope)
        return
      case 'ack':
        this.handleAck(envelope.requestId, envelope.sequence)
        return
    }
  }

  close(error: unknown = extensionError('EXTENSION_HOST_CLOSED', 'Extension host connection closed')): void {
    if (this.closedError !== undefined) return
    this.closedError = error instanceof Error ? error : new Error(String(error))
    for (const [id] of this.pending) this.settlePending(id, undefined, this.closedError)
    for (const request of this.inbound.values()) request.controller.abort()
    this.inbound.clear()
    for (const stream of this.outgoingStreams.values()) {
      for (const acknowledgement of stream.unacked.values()) acknowledgement.reject(this.closedError)
      stream.unacked.clear()
    }
    this.outgoingStreams.clear()
    this.incomingStreamSequence.clear()
    for (const timer of this.cancelled.values()) clearTimeout(timer)
    this.cancelled.clear()
  }

  cancelPending(
    error: unknown = extensionError('EXTENSION_HOST_CANCELLED', 'Extension host request was cancelled')
  ): void {
    for (const id of [...this.pending.keys()]) {
      void this.send({ rpcVersion: EXTENSION_RPC_VERSION, kind: 'cancel', id }).catch(() => undefined)
      this.settlePending(id, undefined, error)
    }
  }

  private async handleRequest(envelope: Extract<RpcEnvelope, { kind: 'request' }>): Promise<void> {
    if (this.inbound.size >= this.maxConcurrentRequests) {
      await this.send({
        rpcVersion: EXTENSION_RPC_VERSION,
        kind: 'response',
        id: envelope.id,
        error: {
          code: 'EXTENSION_HOST_CONCURRENCY_LIMIT',
          message: 'Extension host inbound request limit reached',
          details: { maximum: this.maxConcurrentRequests }
        }
      })
      return
    }
    const controller = new AbortController()
    const inbound: InboundRequest = { controller, terminal: false }
    this.inbound.set(envelope.id, inbound)
    try {
      if (this.options.onRequest === undefined) {
        throw extensionError('EXTENSION_HOST_METHOD_UNSUPPORTED', 'RPC method is not supported', {
          method: envelope.method
        })
      }
      const result = await this.options.onRequest(envelope.method, envelope.params, {
        id: envelope.id,
        signal: controller.signal
      })
      if (!inbound.terminal) {
        inbound.terminal = true
        await this.send({
          rpcVersion: EXTENSION_RPC_VERSION,
          kind: 'response',
          id: envelope.id,
          result
        })
      }
    } catch (error) {
      if (!inbound.terminal) {
        inbound.terminal = true
        await this.send({
          rpcVersion: EXTENSION_RPC_VERSION,
          kind: 'response',
          id: envelope.id,
          error: errorPayload(error)
        }).catch(() => undefined)
      }
    } finally {
      this.inbound.delete(envelope.id)
      this.closeOutgoingStream(
        envelope.id,
        extensionError('EXTENSION_STREAM_TERMINATED', 'Host request completed before its stream terminated')
      )
    }
  }

  private async handleStream(envelope: Extract<RpcEnvelope, { kind: 'stream' }>): Promise<void> {
    if (this.cancelled.has(envelope.requestId)) {
      await this.send({
        rpcVersion: EXTENSION_RPC_VERSION,
        kind: 'ack',
        requestId: envelope.requestId,
        sequence: envelope.sequence
      })
      if (envelope.terminal) this.incomingStreamSequence.delete(envelope.requestId)
      return
    }
    this.resetPendingStreamTimeout(envelope.requestId)
    const expected = (this.incomingStreamSequence.get(envelope.requestId) ?? 0) + 1
    if (envelope.sequence !== expected) {
      throw extensionError('EXTENSION_STREAM_SEQUENCE_INVALID', 'Extension stream sequence is invalid', {
        requestId: envelope.requestId,
        expected,
        actual: envelope.sequence
      })
    }
    this.incomingStreamSequence.set(envelope.requestId, envelope.sequence)
    await this.options.onStream?.(
      envelope.requestId,
      envelope.sequence,
      envelope.payload,
      envelope.terminal ?? false
    )
    await this.send({
      rpcVersion: EXTENSION_RPC_VERSION,
      kind: 'ack',
      requestId: envelope.requestId,
      sequence: envelope.sequence
    })
    if (envelope.terminal) this.incomingStreamSequence.delete(envelope.requestId)
  }

  private handleAck(requestId: string, sequence: number): void {
    const stream = this.outgoingStreams.get(requestId)
    const acknowledgement = stream?.unacked.get(sequence)
    if (stream === undefined || acknowledgement === undefined) return
    stream.unacked.delete(sequence)
    stream.bufferedBytes -= acknowledgement.bytes
    acknowledgement.resolve()
    if (stream.terminalSent && stream.unacked.size === 0) this.outgoingStreams.delete(requestId)
  }

  private settlePending(id: string, result?: JsonValue, error?: unknown): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    this.incomingStreamSequence.delete(id)
    clearTimeout(pending.timer)
    pending.abortCleanup?.()
    if (error !== undefined) pending.reject(error)
    else pending.resolve(result ?? null)
  }

  private resetPendingStreamTimeout(id: string): void {
    const pending = this.pending.get(id)
    if (!pending?.resetTimeoutOnStream) return
    clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      this.markCancelled(id)
      void this.send({ rpcVersion: EXTENSION_RPC_VERSION, kind: 'cancel', id }).catch(() => undefined)
      this.settlePending(id, undefined, extensionError(
        'EXTENSION_HOST_TIMEOUT',
        'Extension host streaming request was idle for too long',
        { method: pending.method, timeoutMs: pending.timeoutMs }
      ))
    }, pending.timeoutMs)
    pending.timer.unref?.()
  }

  private closeOutgoingStream(requestId: string, error: unknown): void {
    const stream = this.outgoingStreams.get(requestId)
    if (stream === undefined) return
    this.outgoingStreams.delete(requestId)
    for (const acknowledgement of stream.unacked.values()) acknowledgement.reject(error)
    stream.unacked.clear()
    stream.bufferedBytes = 0
  }

  private markCancelled(id: string): void {
    if (this.cancelled.has(id)) return
    const graceMs = this.options.cancellationGraceMs ?? 2_000
    const timer = setTimeout(() => {
      this.cancelled.delete(id)
      void this.options.onCancellationTimeout?.(id)
    }, graceMs)
    timer.unref?.()
    this.cancelled.set(id, timer)
  }

  private clearCancelled(id: string): void {
    const timer = this.cancelled.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    this.cancelled.delete(id)
  }

  private async send(envelope: RpcEnvelope): Promise<void> {
    parseRpcEnvelope(envelope, this.maxMessageBytes)
    await this.options.send(envelope)
  }

  private assertOpen(): void {
    if (this.closedError !== undefined) throw this.closedError
  }
}

export function parseRpcEnvelope(value: unknown, maxMessageBytes: number): RpcEnvelope {
  let bytes: number
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch (error) {
    throw extensionError('EXTENSION_HOST_MESSAGE_INVALID', 'IPC message is not JSON serializable', {}, error)
  }
  if (bytes > maxMessageBytes) {
    throw extensionError('EXTENSION_HOST_MESSAGE_LIMIT', 'IPC message exceeds size limit', {
      bytes,
      maximum: maxMessageBytes
    })
  }
  const result = RpcEnvelopeSchema.safeParse(value)
  if (!result.success) {
    throw extensionError('EXTENSION_HOST_MESSAGE_INVALID', 'IPC message has an invalid envelope', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    })
  }
  return result.data
}

function envelopeBytes(envelope: RpcEnvelope): number {
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8')
}

function errorPayload(error: unknown): RpcErrorPayload {
  const publicError = publicExtensionError(error)
  if (publicError !== undefined) {
    return {
      code: publicError.code,
      message: redactSecretText(publicError.message).slice(0, 4_000),
      retryable: publicError.retryable,
      ...(publicError.details === undefined
        ? {}
        : { details: jsonSafeDetails(redactSecrets(publicError.details)) })
    }
  }
  const normalized = asExtensionError(error)
  return {
    code: normalized.code,
    message: redactSecretText(normalized.message).slice(0, 4_000),
    details: jsonSafeDetails(redactSecrets(normalized.details))
  }
}

function publicExtensionError(error: unknown): ExtensionErrorData | undefined {
  try {
    if (!error || typeof error !== 'object') return undefined
    const candidate = error as Record<string, unknown>
    // Node extensions are expected to bundle their runtime dependencies, so
    // their ExtensionApiError constructor may not be referentially equal to
    // the Host's SDK constructor. The public name plus the strict schema is
    // the cross-package boundary; no stack, cause, or extra field is copied.
    if (candidate.name !== 'ExtensionApiError' || typeof candidate.retryable !== 'boolean') {
      return undefined
    }
    const parsed = ExtensionErrorSchema.safeParse({
      code: candidate.code,
      message: candidate.message,
      retryable: candidate.retryable,
      ...(candidate.details === undefined ? {} : { details: candidate.details })
    })
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

function errorFromPayload(payload: RpcErrorPayload): Error {
  if (payload.retryable !== undefined) {
    const parsed = ExtensionErrorSchema.safeParse({
      code: payload.code,
      message: payload.message,
      retryable: payload.retryable,
      ...(payload.details === undefined ? {} : { details: payload.details })
    })
    if (parsed.success) return new ExtensionApiError(parsed.data)
  }
  return extensionError(payload.code, payload.message, payload.details ?? {})
}

function jsonSafeDetails(details: ExtensionErrorDetails): Record<string, JsonValue> {
  try {
    const parsed = JsonValueSchema.parse(details)
    return parsed as Record<string, JsonValue>
  } catch {
    return {}
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw extensionError('EXTENSION_HOST_LIMIT_INVALID', 'Extension host limit is invalid', {
      name,
      value: resolved
    })
  }
  return resolved
}
