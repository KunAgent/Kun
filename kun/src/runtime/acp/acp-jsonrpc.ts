/**
 * JSON-RPC peer for ACP stdio transports: newline-delimited JSON frames over a
 * child process's stdin/stdout.
 *
 * - Client request ids are auto-incrementing integers; agent-initiated
 *   requests are answered under their own id.
 * - Every request carries an independent timeout; expired entries leave the
 *   pending map so a late response is dropped with a debug note.
 * - Writes are serialized through a queue that honors `write()` backpressure
 *   via the `drain` event.
 * - A line longer than the 8 MiB cap, a non-JSON line, or an unclassifiable
 *   frame closes the connection with `harness_protocol_error` — a peer that
 *   corrupts the stream can no longer be trusted.
 * - `exitPromise` (the process exit) rejects every pending request with
 *   `harness_crashed` plus a sanitized stderr tail.
 *
 * This is the strict JSON-RPC 2.0 dialect (`jsonrpc` envelope, fail-closed
 * framing). The shared `session/jsonrpc-peer.ts` implements the bare
 * `{id, method}` dialect used by app-server-style transports (Codex, Pi) —
 * do not port one dialect onto the other.
 */
import { StringDecoder } from 'node:string_decoder'
import type { Readable, Writable } from 'node:stream'
import { redactApprovalSensitiveText } from '../../domain/approval.js'
import {
  ACP_RPC_ERROR,
  AcpError,
  AcpJsonRpcFrameSchema,
  makeAcpErrorResponse,
  makeAcpNotification,
  makeAcpRequest,
  makeAcpResultResponse,
  type AcpJsonRpcId
} from './acp-schema.js'

export const ACP_MAX_LINE_BYTES = 8 * 1024 * 1024
export const ACP_DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const DEBUG_FRAME_PREVIEW_CHARS = 2_048

export type AcpDebugLog = (entry: {
  direction: 'in' | 'out' | 'note'
  summary: string
}) => void

export type AcpRequestContext = { id: AcpJsonRpcId; method: string }
export type AcpRequestHandler = (
  params: unknown,
  context: AcpRequestContext
) => unknown | Promise<unknown>
export type AcpNotificationHandler = (params: unknown, context: { method: string }) => void

export type AcpProcessExitInfo = {
  code: number | null
  signal: NodeJS.Signals | null
}

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  signal?: AbortSignal
  abort?: () => void
}

export type AcpJsonRpcIo = {
  stdin: Writable
  stdout: Readable
  /** Sanitized-on-demand stderr ring accessor, appended to crash errors. */
  stderrTail?: () => string
  /** Settles when the peer process exits; rejects all pending with harness_crashed. */
  exitPromise?: Promise<AcpProcessExitInfo>
  debug?: AcpDebugLog
  maxLineBytes?: number
}

export class AcpJsonRpc {
  private readonly io: AcpJsonRpcIo
  private readonly maxLineBytes: number
  private nextId = 1
  private readonly pending = new Map<AcpJsonRpcId, PendingRequest>()
  private readonly requestHandlers = new Map<string, AcpRequestHandler>()
  private readonly notificationHandlers = new Map<string, AcpNotificationHandler>()
  private readonly decoder = new StringDecoder('utf8')
  private lineBuffer = ''
  private lineBytes = 0
  private writeChain: Promise<void> = Promise.resolve()
  private closedError: AcpError | undefined
  private readonly closeListeners = new Set<(error: AcpError) => void>()

  constructor(io: AcpJsonRpcIo) {
    this.io = io
    this.maxLineBytes = io.maxLineBytes ?? ACP_MAX_LINE_BYTES
    io.stdout.on('data', (chunk: Buffer | string) => this.handleChunk(chunk))
    io.stdout.on('error', (error) => {
      this.close(
        new AcpError('connection_closed', `ACP stdout stream failed: ${error.message}`)
      )
    })
    io.stdin.on('error', () => {
      this.close(
        new AcpError('connection_closed', 'ACP stdin stream failed')
      )
    })
    io.exitPromise?.then((info) => {
      const tail = this.io.stderrTail?.()
      this.close(
        new AcpError(
          'harness_crashed',
          `ACP agent process exited (code ${info.code ?? 'null'}, signal ${info.signal ?? 'null'})` +
            (tail ? `: ${tail}` : '')
        )
      )
    })
  }

  get closed(): boolean {
    return this.closedError !== undefined
  }

  get closeReason(): AcpError | undefined {
    return this.closedError
  }

  onClose(listener: (error: AcpError) => void): () => void {
    if (this.closedError) {
      listener(this.closedError)
      return () => undefined
    }
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  /**
   * Send a request and await its response. `signal` aborts the wait (the
   * pending entry is dropped); the agent is not notified — callers that need
   * cooperative cancellation send `session/cancel` themselves.
   */
  request<T = unknown>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError)
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? ACP_DEFAULT_REQUEST_TIMEOUT_MS
      const entry: PendingRequest = {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(id)
          reject(
            new AcpError(
              'request_timeout',
              `ACP request '${method}' timed out after ${timeoutMs}ms`
            )
          )
        }, timeoutMs)
      }
      if (options.signal) {
        if (options.signal.aborted) {
          clearTimeout(entry.timer)
          reject(new AcpError('request_aborted', `ACP request '${method}' aborted`))
          return
        }
        entry.signal = options.signal
        entry.abort = () => {
          this.pending.delete(id)
          clearTimeout(entry.timer)
          reject(new AcpError('request_aborted', `ACP request '${method}' aborted`))
        }
        options.signal.addEventListener('abort', entry.abort, { once: true })
      }
      this.pending.set(id, entry)
      this.enqueue(makeAcpRequest(id, method, params)).catch((error: Error) => {
        this.dropPending(id)
        reject(error)
      })
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closedError) return
    void this.enqueue(makeAcpNotification(method, params)).catch((error: Error) => {
      this.io.debug?.({
        direction: 'note',
        summary: `failed to send notification ${method}: ${error.message}`
      })
    })
  }

  onRequest(method: string, handler: AcpRequestHandler): this {
    this.requestHandlers.set(method, handler)
    return this
  }

  onNotification(method: string, handler: AcpNotificationHandler): this {
    this.notificationHandlers.set(method, handler)
    return this
  }

  /** Idempotent; rejects all pending requests and detaches stream listeners. */
  close(error?: AcpError): void {
    if (this.closedError) return
    this.closedError =
      error ?? new AcpError('connection_closed', 'ACP connection closed')
    for (const [id, entry] of [...this.pending]) {
      this.dropPending(id)
      entry.reject(this.closedError)
    }
    for (const listener of this.closeListeners) {
      try {
        listener(this.closedError)
      } catch {
        // listener defects must not interrupt the close
      }
    }
    this.closeListeners.clear()
    try {
      this.io.stdin.end()
    } catch {
      // already gone
    }
    this.io.stdout.removeAllListeners('data')
  }

  // -- framing --------------------------------------------------------------

  private handleChunk(chunk: Buffer | string): void {
    if (this.closedError) return
    const text =
      typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
    this.lineBuffer += text
    this.lineBytes += Buffer.byteLength(text, 'utf8')
    for (;;) {
      const newline = this.lineBuffer.indexOf('\n')
      if (newline < 0) break
      const line = this.lineBuffer.slice(0, newline)
      const consumedBytes = Buffer.byteLength(line, 'utf8') + 1
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      this.lineBytes = Math.max(0, this.lineBytes - consumedBytes)
      this.handleLine(line)
      if (this.closedError) return
    }
    if (this.lineBytes > this.maxLineBytes) {
      this.failProtocol('ACP frame exceeds the 8 MiB line limit')
    }
  }

  private handleLine(rawLine: string): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.trim()) return
    if (Buffer.byteLength(line, 'utf8') > this.maxLineBytes) {
      this.failProtocol('ACP frame exceeds the 8 MiB line limit')
      return
    }
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      this.failProtocol('ACP frame is not valid JSON')
      return
    }
    const frame = AcpJsonRpcFrameSchema.safeParse(value)
    if (!frame.success) {
      this.failProtocol('ACP frame is not a JSON-RPC envelope')
      return
    }
    this.io.debug?.({
      direction: 'in',
      summary: previewFrame(frame.data)
    })
    const data = frame.data
    if (data.method !== undefined && data.id !== undefined && data.id !== null) {
      void this.dispatchRequest(data.method, data.id, data.params)
      return
    }
    if (data.method !== undefined) {
      this.dispatchNotification(data.method, data.params)
      return
    }
    if (
      data.id !== undefined &&
      data.id !== null &&
      (data.result !== undefined || data.error !== undefined)
    ) {
      this.handleResponse(data.id, data)
      return
    }
    this.failProtocol('ACP frame is neither request, response, nor notification')
  }

  private failProtocol(message: string): void {
    this.close(new AcpError('harness_protocol_error', message))
  }

  // -- dispatch ---------------------------------------------------------------

  private async dispatchRequest(
    method: string,
    id: AcpJsonRpcId,
    params: unknown
  ): Promise<void> {
    const handler = this.requestHandlers.get(method)
    if (!handler) {
      await this.enqueue(
        makeAcpErrorResponse(id, ACP_RPC_ERROR.methodNotFound, `Method not found: ${method}`)
      )
      return
    }
    try {
      const result = await handler(params, { id, method })
      await this.enqueue(makeAcpResultResponse(id, result))
    } catch (error) {
      const rpcCode =
        error instanceof AcpError && error.rpcCode !== undefined
          ? error.rpcCode
          : ACP_RPC_ERROR.internalError
      const message =
        error instanceof AcpError
          ? error.message
          : 'internal error'
      await this.enqueue(
        makeAcpErrorResponse(id, rpcCode, redactApprovalSensitiveText(message).slice(0, 1_024))
      ).catch(() => undefined)
    }
  }

  private dispatchNotification(method: string, params: unknown): void {
    const handler = this.notificationHandlers.get(method)
    if (!handler) {
      this.io.debug?.({
        direction: 'note',
        summary: `ignoring unhandled notification ${method}`
      })
      return
    }
    try {
      handler(params, { method })
    } catch (error) {
      this.io.debug?.({
        direction: 'note',
        summary: `notification handler for ${method} threw: ${
          error instanceof Error ? error.message : String(error)
        }`
      })
    }
  }

  private handleResponse(
    id: AcpJsonRpcId,
    frame: { result?: unknown; error?: { code: number; message: string; data?: unknown } }
  ): void {
    const entry = this.pending.get(id)
    if (!entry) {
      this.io.debug?.({
        direction: 'note',
        summary: `dropping response for unknown/expired request id ${String(id)}`
      })
      return
    }
    this.dropPending(id)
    if (frame.error) {
      entry.reject(
        new AcpError('agent_error', frame.error.message, {
          rpcCode: frame.error.code,
          data: frame.error.data
        })
      )
      return
    }
    entry.resolve(frame.result)
  }

  private dropPending(id: AcpJsonRpcId): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (entry.signal && entry.abort) {
      entry.signal.removeEventListener('abort', entry.abort)
    }
  }

  // -- writes -----------------------------------------------------------------

  private enqueue(message: Record<string, unknown>): Promise<void> {
    this.io.debug?.({
      direction: 'out',
      summary: previewFrame(message)
    })
    const line = `${JSON.stringify(message)}\n`
    const written = this.writeChain.then(() => this.writeRaw(line))
    this.writeChain = written.catch(() => undefined)
    return written
  }

  private writeRaw(line: string): Promise<void> {
    if (this.closedError) return Promise.reject(this.closedError)
    const sink = this.io.stdin
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const onError = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }
      const done = (): void => {
        if (settled) return
        settled = true
        sink.off('error', onError)
        resolve()
      }
      sink.once('error', onError)
      try {
        // `false` means the kernel buffer is full — wait for drain before
        // resolving so the serialized queue applies real backpressure.
        if (sink.write(line)) done()
        else sink.once('drain', done)
      } catch (error) {
        sink.off('error', onError)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

function previewFrame(frame: Record<string, unknown>): string {
  let serialized: string
  try {
    serialized = JSON.stringify(frame)
  } catch {
    return '[unserializable frame]'
  }
  const sanitized = redactApprovalSensitiveText(serialized)
  return sanitized.length > DEBUG_FRAME_PREVIEW_CHARS
    ? `${sanitized.slice(0, DEBUG_FRAME_PREVIEW_CHARS)}…[truncated]`
    : sanitized
}
