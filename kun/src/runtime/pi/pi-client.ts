/**
 * PiClient (P6-09): thin RPC peer for `pi --mode rpc` over `JsonlTransport`.
 *
 * Frame shapes (verified on pi 0.99.0, docs/ade/impl/pi-protocol-notes.md):
 * - request:  `{id:'<string>', type:'<command>', ...args}`
 * - response: `{id:'<string>', type:'response', command:'<echo>', success, data|error}`
 * - event:    `{type:'<event>', ...}` (no id)
 * - extension UI reply: `{type:'extension_ui_response', id, confirmed|value|cancelled}`
 *   (fire-and-forget — produces no `response` record)
 *
 * Pi has no handshake; readiness is proven by the first `get_state` success.
 * Orderly shutdown = close stdin (Handled by HarnessProcess.stop).
 */
import { JsonlTransport } from '../../session/jsonl-transport.js'
import type { HarnessProcess } from '../../session/harness-process.js'
import { HarnessTransportError } from '../../session/harness-session.js'
import {
  PI_COMMANDS,
  type PiCommandName,
  type PiEvent,
  type PiPromptDisposition,
  type PiResponse,
  type PiSessionState,
  type PiSessionStats
} from './pi-protocol.js'

export const PI_REQUEST_TIMEOUT_MS = 30_000

export type PiEventHandler = (event: PiEvent) => void
export type PiDebugLog = (direction: 'in' | 'out', line: string) => void

type PendingRequest = {
  command: string
  resolve: (data: Record<string, unknown> | undefined) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export class PiClient {
  private readonly transport: JsonlTransport
  private nextId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private readonly eventHandlers = new Map<string, Set<PiEventHandler>>()
  private closedError: HarnessTransportError | undefined

  constructor(
    private readonly proc: HarnessProcess,
    private readonly options: {
      debug?: PiDebugLog
      /** Test seam: inject a transport instead of wiring JsonlTransport. */
      transport?: JsonlTransport
    } = {}
  ) {
    this.transport =
      options.transport ??
      new JsonlTransport(proc, {
        diagnostic: (summary) =>
          options.debug?.('in', `dropped pi frame: ${summary}`)
      })
    this.transport.onFrame((value) => this.handleFrame(value))
    this.transport.onClose(() => this.failAll())
  }

  get closed(): boolean {
    return this.closedError !== undefined || this.transport.closed
  }

  get process(): HarnessProcess {
    return this.proc
  }

  /** Per-event-type subscription fan-out. */
  onEvent(type: string, handler: PiEventHandler): () => void {
    let set = this.eventHandlers.get(type)
    if (!set) {
      set = new Set()
      this.eventHandlers.set(type, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
      if (!set.size) this.eventHandlers.delete(type)
    }
  }

  /**
   * Fire-and-forget frame (extension_ui_response and notify-style records);
   * resolves when the line is written.
   */
  async send(record: Record<string, unknown>): Promise<void> {
    this.options.debug?.('out', JSON.stringify(record))
    await this.transport.write(record)
  }

  async request(
    command: PiCommandName | string,
    args: Record<string, unknown> = {},
    timeoutMs = PI_REQUEST_TIMEOUT_MS
  ): Promise<Record<string, unknown> | undefined> {
    if (this.closed) {
      throw (
        this.closedError ??
        new HarnessTransportError('connection_closed', 'pi peer is closed')
      )
    }
    const id = `kun-${this.nextId++}`
    const frame = { id, type: command, ...args }
    this.options.debug?.('out', JSON.stringify(frame))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new HarnessTransportError(
            'request_timeout',
            `pi ${command} timed out after ${timeoutMs}ms`
          )
        )
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { command, resolve, reject, timer })
      this.transport.write(frame).catch((error) => {
        const entry = this.pending.get(id)
        if (!entry) return
        this.pending.delete(id)
        clearTimeout(entry.timer)
        reject(error)
      })
    })
  }

  // -- typed command wrappers -----------------------------------------------------

  /** Handshake: proves the rpc channel is alive; returns session state. */
  async getState(timeoutMs?: number): Promise<PiSessionState> {
    const data = await this.request(PI_COMMANDS.getState, {}, timeoutMs)
    return (data ?? {}) as PiSessionState
  }

  async getSessionStats(): Promise<PiSessionStats> {
    const data = await this.request(PI_COMMANDS.getSessionStats)
    return (data ?? {}) as PiSessionStats
  }

  async getAvailableModels(): Promise<readonly Record<string, unknown>[]> {
    const data = await this.request(PI_COMMANDS.getAvailableModels)
    const models = (data as { models?: unknown } | undefined)?.models
    return Array.isArray(models) ? (models as Record<string, unknown>[]) : []
  }

  /** Returns the disposition; 'handled' means no agent run will follow. */
  async prompt(
    message: string,
    images?: readonly { mediaType: string; base64: string }[]
  ): Promise<PiPromptDisposition> {
    const data = await this.request(PI_COMMANDS.prompt, {
      message,
      ...(images?.length
        ? {
            images: images.map((img) => ({
              type: 'image',
              data: img.base64,
              mimeType: img.mediaType
            }))
          }
        : {})
    })
    const disposition = (data as { disposition?: string } | undefined)
      ?.disposition
    return disposition === 'queued' || disposition === 'handled'
      ? disposition
      : 'started'
  }

  async steer(
    message: string,
    images?: readonly { mediaType: string; base64: string }[]
  ): Promise<void> {
    await this.request(PI_COMMANDS.steer, {
      message,
      ...(images?.length
        ? {
            images: images.map((img) => ({
              type: 'image',
              data: img.base64,
              mimeType: img.mediaType
            }))
          }
        : {})
    })
  }

  async abort(): Promise<void> {
    await this.request(PI_COMMANDS.abort)
  }

  /** Starts a fresh session; returns true when an extension vetoed it. */
  async newSession(): Promise<boolean> {
    const data = await this.request(PI_COMMANDS.newSession)
    return (data as { cancelled?: boolean } | undefined)?.cancelled === true
  }

  /**
   * Resume a persisted session file. Returns false when an extension vetoed
   * the switch (success response with `data.cancelled: true`).
   */
  async switchSession(sessionPath: string): Promise<boolean> {
    const data = await this.request(PI_COMMANDS.switchSession, { sessionPath })
    return (data as { cancelled?: boolean } | undefined)?.cancelled === true
  }

  async setModel(providerId: string, modelId: string): Promise<void> {
    await this.request(PI_COMMANDS.setModel, {
      provider: providerId,
      modelId
    })
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.request(PI_COMMANDS.setThinkingLevel, { level })
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    await this.request(PI_COMMANDS.setAutoCompaction, { enabled })
  }

  /** Fork at entryId; returns the forked-from user text (or vetoed → null). */
  async fork(entryId: string): Promise<string | null> {
    const data = await this.request(PI_COMMANDS.fork, { entryId })
    const d = data as { text?: string; cancelled?: boolean } | undefined
    if (d?.cancelled === true) return null
    return typeof d?.text === 'string' ? d.text : ''
  }

  async compact(): Promise<void> {
    await this.request(PI_COMMANDS.compact)
  }

  /** `extension_ui_response` — answers a bridge `extension_ui_request`. */
  async answerExtensionUi(
    id: string,
    answer: { confirmed?: boolean; value?: string; cancelled?: boolean }
  ): Promise<void> {
    await this.send({ type: 'extension_ui_response', id, ...answer })
  }

  // -- internals -------------------------------------------------------------------

  private handleFrame(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const record = value as Record<string, unknown>
    this.options.debug?.('in', JSON.stringify(record).slice(0, 4_096))
    if (record.type === 'response') {
      this.handleResponse(record as unknown as PiResponse)
      return
    }
    if (typeof record.type === 'string') {
      const handlers = this.eventHandlers.get(record.type)
      if (!handlers) return
      for (const handler of [...handlers]) {
        try {
          handler(record as PiEvent)
        } catch {
          // Event handlers must never take down the transport.
        }
      }
    }
  }

  private handleResponse(resp: PiResponse): void {
    const id = resp.id
    if (typeof id !== 'string') return
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    clearTimeout(entry.timer)
    if (typeof resp.command === 'string' && resp.command !== entry.command) {
      entry.reject(
        new HarnessTransportError(
          'harness_protocol_error',
          `pi response command mismatch (expected ${entry.command}, got ${resp.command})`
        )
      )
      return
    }
    if (resp.success === false) {
      entry.reject(
        new HarnessTransportError(
          'agent_error',
          resp.error ?? `pi ${entry.command} failed`,
          resp
        )
      )
      return
    }
    entry.resolve(resp.data)
  }

  private failAll(): void {
    this.closedError ??= new HarnessTransportError(
      'connection_closed',
      'pi transport closed'
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
      'pi peer closed'
    )
    this.failAll()
    await this.proc.stop().catch(() => undefined)
  }
}
