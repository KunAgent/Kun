/**
 * Minimal JSON-RPC peer over `JsonlTransport` (P6-03): outbound requests with
 * incrementing ids + per-request timeout, outbound notifications, inbound
 * request dispatch (server→client calls like approvals) and notification
 * dispatch. Transport close rejects every pending request.
 *
 * Wire shape follows the app-server convention: `{id, method, params}`
 * requests, `{id, result}` / `{id, error:{code,message,...}}` responses, and
 * `{method, params}` notifications — no `jsonrpc` envelope field.
 */
import { JsonlTransport } from './jsonl-transport.js'
import { HarnessTransportError } from './harness-session.js'

export const JSONRPC_DEFAULT_TIMEOUT_MS = 30_000

export type JsonRpcId = number | string
export type JsonRpcNotificationHandler = (
  method: string,
  params: unknown
) => void
/** Inbound (server→client) request handler; the return becomes `result`. */
export type JsonRpcRequestHandler = (
  method: string,
  params: unknown
) => Promise<unknown> | unknown

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export class JsonRpcPeer {
  private nextId = 1
  private readonly pending = new Map<JsonRpcId, PendingRequest>()
  private notificationHandler: JsonRpcNotificationHandler | undefined
  private requestHandler: JsonRpcRequestHandler | undefined
  private closedError: HarnessTransportError | undefined

  constructor(
    private readonly transport: JsonlTransport,
    private readonly options: { diagnostic?: (summary: string) => void } = {}
  ) {
    transport.onFrame((value) => this.handleFrame(value))
    transport.onClose(() => this.failAll())
  }

  get closed(): boolean {
    return this.closedError !== undefined || this.transport.closed
  }

  onNotification(handler: JsonRpcNotificationHandler): void {
    this.notificationHandler = handler
  }

  onRequest(handler: JsonRpcRequestHandler): void {
    this.requestHandler = handler
  }

  notify(method: string, params?: unknown): void {
    void this.transport
      .write(params === undefined ? { method } : { method, params })
      .catch((error) =>
        this.options.diagnostic?.(
          `notify ${method} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      )
  }

  request(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number; idPrefix?: string } = {}
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        this.closedError ??
          new HarnessTransportError('connection_closed', 'peer is closed')
      )
    }
    const id: JsonRpcId = options.idPrefix
      ? `${options.idPrefix}${this.nextId++}`
      : this.nextId++
    const payload =
      params === undefined ? { id, method } : { id, method, params }
    return new Promise<unknown>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? JSONRPC_DEFAULT_TIMEOUT_MS
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new HarnessTransportError(
            'request_timeout',
            `${method} timed out after ${timeoutMs}ms`
          )
        )
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { method, resolve, reject, timer })
      this.transport.write(payload).catch((error) => {
        const entry = this.pending.get(id)
        if (!entry) return
        this.pending.delete(id)
        clearTimeout(entry.timer)
        reject(error)
      })
    })
  }

  /** Respond to an inbound request; adapters usually call this from onRequest. */
  respond(id: JsonRpcId, result: unknown): void {
    void this.transport.write({ id, result }).catch(() => undefined)
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    void this.transport
      .write({ id, error: { code, message: message.slice(0, 2_000) } })
      .catch(() => undefined)
  }

  private handleFrame(value: unknown): void {
    const record = asRecord(value)
    if (!record) {
      this.options.diagnostic?.('non-object frame dropped')
      return
    }
    const hasId = 'id' in record
    const method = typeof record.method === 'string' ? record.method : undefined
    if (hasId && method) {
      void this.dispatchInboundRequest(record.id as JsonRpcId, method, record.params)
      return
    }
    if (method) {
      try {
        this.notificationHandler?.(method, record.params)
      } catch (error) {
        this.options.diagnostic?.(
          `notification handler threw: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
      return
    }
    if (hasId) {
      const id = record.id as JsonRpcId
      const entry = this.pending.get(id)
      if (!entry) return
      this.pending.delete(id)
      clearTimeout(entry.timer)
      if ('error' in record && record.error !== undefined && record.error !== null) {
        const err = asRecord(record.error)
        entry.reject(
          new HarnessTransportError(
            'agent_error',
            typeof err?.message === 'string'
              ? err.message
              : `${entry.method} failed`,
            record.error
          )
        )
      } else {
        entry.resolve(record.result)
      }
      return
    }
    this.options.diagnostic?.('unrecognized frame dropped')
  }

  private async dispatchInboundRequest(
    id: JsonRpcId,
    method: string,
    params: unknown
  ): Promise<void> {
    const handler = this.requestHandler
    if (!handler) {
      this.respondError(id, -32601, `no handler for ${method}`)
      return
    }
    try {
      const result = await handler(method, params)
      this.respond(id, result)
    } catch (error) {
      if (error instanceof HarnessTransportError) {
        this.respondError(id, -32_000, error.message)
        return
      }
      this.respondError(
        id,
        -32_000,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private failAll(): void {
    this.closedError ??= new HarnessTransportError(
      'connection_closed',
      'transport closed'
    )
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(this.closedError)
    }
    this.pending.clear()
  }

  async close(): Promise<void> {
    this.closedError ??= new HarnessTransportError(
      'connection_closed',
      'peer closed'
    )
    this.failAll()
  }
}
