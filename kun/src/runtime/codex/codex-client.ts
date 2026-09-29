/**
 * Codex App Server client (P6-04): a typed JSON-RPC facade over the shared
 * `JsonlTransport`/`JsonRpcPeer` running against `codex app-server` stdio.
 *
 * The client owns only wire concerns — request ids, timeouts, response
 * validation of fields Kun reads, and inbound request/notification dispatch.
 * Session lifecycle (thread/turn → Kun binding) lives in `codex-agent.ts`.
 */
import { KUN_VERSION } from '../../version.js'
import type { HarnessProcess } from '../../session/harness-process.js'
import { JsonlTransport } from '../../session/jsonl-transport.js'
import {
  JsonRpcPeer,
  type JsonRpcRequestHandler,
  type JsonRpcNotificationHandler
} from '../../session/jsonrpc-peer.js'
import { HarnessTransportError } from '../../session/harness-session.js'
import {
  CODEX_CLIENT_METHODS,
  CODEX_INITIALIZED_NOTIFICATION,
  CodexGetAccountResponseSchema,
  CodexLoginAccountResponseSchema,
  CodexModelListResponseSchema,
  CodexRateLimitsResponseSchema,
  CodexThreadSchema,
  CodexTurnSchema,
  type CodexAccount,
  type CodexAskForApproval,
  type CodexLoginAccountResponse,
  type CodexModel,
  type CodexRateLimitSnapshot,
  type CodexSandboxPolicy,
  type CodexThread,
  type CodexThreadForkParams,
  type CodexThreadResumeParams,
  type CodexThreadStartParams,
  type CodexTurn,
  type CodexTurnInterruptParams,
  type CodexTurnStartParams,
  type CodexTurnSteerParams
} from './codex-protocol.js'

export const CODEX_INITIALIZE_TIMEOUT_MS = 20_000
export const CODEX_REQUEST_TIMEOUT_MS = 60_000

export type CodexDebugLog = (entry: {
  direction: 'in' | 'out' | 'note'
  summary: string
}) => void

export type CodexInitializeResult = {
  codexHome: string
  platformFamily: string
  platformOs: string
  userAgent: string
}

export type CodexClientOptions = {
  /** Pooled process owning the stdio streams. */
  process: HarnessProcess
  debug?: CodexDebugLog
  /** Override for tests; defaults to the shared transport pair. */
  peer?: JsonRpcPeer
}

export class CodexClient {
  readonly process: HarnessProcess
  private readonly peer: JsonRpcPeer
  private readonly debug?: CodexDebugLog
  private readonly notificationHandlers = new Map<
    string,
    Set<JsonRpcNotificationHandler>
  >()

  constructor(options: CodexClientOptions) {
    this.process = options.process
    this.debug = options.debug
    this.peer =
      options.peer ??
      new JsonRpcPeer(new JsonlTransport(this.process), {
        diagnostic: (summary) =>
          this.debug?.({ direction: 'note', summary })
      })
    this.peer.onNotification((method, params) => {
      this.debug?.({
        direction: 'in',
        summary: `${method} ${preview(params)}`
      })
      const set = this.notificationHandlers.get(method)
      if (!set) return
      for (const handler of [...set]) handler(method, params)
    })
  }

  get closed(): boolean {
    return this.peer.closed
  }

  onRequest(handler: JsonRpcRequestHandler): void {
    this.peer.onRequest(handler)
  }

  /** Subscribe to a specific server notification method; returns unsubscribe. */
  onNotification(
    method: string,
    handler: JsonRpcNotificationHandler
  ): () => void {
    let set = this.notificationHandlers.get(method)
    if (!set) {
      set = new Set()
      this.notificationHandlers.set(method, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
      if (set.size === 0) this.notificationHandlers.delete(method)
    }
  }

  /** Generic request escape hatch for snapshot-validated methods. */
  request<T = unknown>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number } = {}
  ): Promise<T> {
    this.debug?.({
      direction: 'out',
      summary: `${method} ${preview(params)}`
    })
    // codex app-server rejects frames without a `params` member
    // ("Invalid request: missing field `params`") — always send an object.
    return this.peer.request(method, params ?? {}, options) as Promise<T>
  }

  /** Server → client response helper. */
  respond(id: number | string, result: unknown): void {
    this.peer.respond(id, result)
  }

  respondError(id: number | string, code: number, message: string): void {
    this.peer.respondError(id, code, message)
  }

  async initialize(): Promise<CodexInitializeResult> {
    const raw = await this.request<CodexInitializeResult>(
      CODEX_CLIENT_METHODS.initialize,
      {
        clientInfo: { name: 'kun', title: 'Kun', version: KUN_VERSION },
        capabilities: {
          // Kun surfaces approvals through its own gates; no experimental
          // surface is requested (dynamic tools stay MCP-based, P6-06).
          optOutNotificationMethods: null
        }
      },
      { timeoutMs: CODEX_INITIALIZE_TIMEOUT_MS }
    )
    if (typeof raw?.codexHome !== 'string' || !raw.userAgent) {
      throw new HarnessTransportError(
        'harness_protocol_error',
        'codex initialize response missing codexHome/userAgent'
      )
    }
    this.peer.notify(CODEX_INITIALIZED_NOTIFICATION)
    return raw
  }

  // -- thread lifecycle -------------------------------------------------------

  async threadStart(params: CodexThreadStartParams): Promise<CodexThread> {
    const raw = await this.request<{ thread?: unknown }>(
      CODEX_CLIENT_METHODS.threadStart,
      params
    )
    return CodexThreadSchema.parse(raw?.thread)
  }

  async threadResume(params: CodexThreadResumeParams): Promise<CodexThread> {
    const raw = await this.request<{ thread?: unknown }>(
      CODEX_CLIENT_METHODS.threadResume,
      params
    )
    return CodexThreadSchema.parse(raw?.thread)
  }

  async threadFork(params: CodexThreadForkParams): Promise<CodexThread> {
    const raw = await this.request<{ thread?: unknown }>(
      CODEX_CLIENT_METHODS.threadFork,
      params
    )
    return CodexThreadSchema.parse(raw?.thread)
  }

  async threadRollback(
    threadId: string,
    numTurns: number
  ): Promise<CodexThread> {
    const raw = await this.request<{ thread?: unknown }>(
      CODEX_CLIENT_METHODS.threadRollback,
      { threadId, numTurns }
    )
    return CodexThreadSchema.parse(raw?.thread)
  }

  // -- turns -------------------------------------------------------------------

  async turnStart(params: CodexTurnStartParams): Promise<CodexTurn> {
    const raw = await this.request<{ turn?: unknown }>(
      CODEX_CLIENT_METHODS.turnStart,
      params,
      // turn/start only *begins* the turn; its ack should still be quick.
      { timeoutMs: CODEX_REQUEST_TIMEOUT_MS }
    )
    return CodexTurnSchema.parse(raw?.turn)
  }

  async turnSteer(params: CodexTurnSteerParams): Promise<void> {
    await this.request(CODEX_CLIENT_METHODS.turnSteer, params)
  }

  async turnInterrupt(params: CodexTurnInterruptParams): Promise<void> {
    await this.request(CODEX_CLIENT_METHODS.turnInterrupt, params)
  }

  // -- models / account -----------------------------------------------------------

  async modelList(input: {
    cursor?: string
    includeHidden?: boolean
  } = {}): Promise<{ models: CodexModel[]; nextCursor?: string }> {
    const raw = await this.request(CODEX_CLIENT_METHODS.modelList, {
      cursor: input.cursor ?? null,
      includeHidden: input.includeHidden ?? null
    })
    const parsed = CodexModelListResponseSchema.parse(raw)
    return {
      models: parsed.data,
      ...(parsed.nextCursor ? { nextCursor: parsed.nextCursor } : {})
    }
  }

  /** `model/list` flattened across pages. */
  async listModelsFlat(): Promise<string[]> {
    const models: string[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await this.modelList({ ...(cursor ? { cursor } : {}) })
      models.push(...page.models.map((model) => model.id))
      if (!page.nextCursor) return models
      cursor = page.nextCursor
    }
  }

  async accountRead(): Promise<{
    requiresOpenaiAuth: boolean
    account: CodexAccount | undefined
  }> {
    const raw = await this.request(CODEX_CLIENT_METHODS.accountRead)
    const parsed = CodexGetAccountResponseSchema.parse(raw)
    return {
      requiresOpenaiAuth: parsed.requiresOpenaiAuth,
      account: parsed.account ?? undefined
    }
  }

  async accountRateLimitsRead(): Promise<{
    rateLimits: CodexRateLimitSnapshot
    byLimitId?: Record<string, CodexRateLimitSnapshot>
  }> {
    const raw = await this.request(
      CODEX_CLIENT_METHODS.accountRateLimitsRead
    )
    const parsed = CodexRateLimitsResponseSchema.parse(raw)
    return {
      rateLimits: parsed.rateLimits,
      ...(parsed.rateLimitsByLimitId
        ? { byLimitId: parsed.rateLimitsByLimitId }
        : {})
    }
  }

  /**
   * Start a ChatGPT browser/device-code login. The returned URL is surfaced to
   * the user; completion arrives as `account/login/completed`.
   */
  async accountLoginStart(
    params:
      | { type: 'apiKey'; apiKey: string }
      | { type: 'chatgpt'; codexStreamlinedLogin?: boolean }
      | { type: 'chatgptDeviceCode' }
  ): Promise<CodexLoginAccountResponse> {
    const raw = await this.request(
      CODEX_CLIENT_METHODS.accountLoginStart,
      params,
      { timeoutMs: CODEX_REQUEST_TIMEOUT_MS }
    )
    return CodexLoginAccountResponseSchema.parse(raw)
  }

  async accountLoginCancel(loginId: string): Promise<void> {
    await this.request(CODEX_CLIENT_METHODS.accountLoginCancel, { loginId })
  }

  async close(): Promise<void> {
    await this.peer.close()
    await this.process.stop()
  }
}

const DEBUG_PREVIEW_CHARS = 2_048

function preview(value: unknown): string {
  let serialized: string
  try {
    // JSON.stringify(undefined) returns undefined, not a string.
    serialized = JSON.stringify(value) ?? ''
  } catch {
    return '[unserializable params]'
  }
  return serialized.length > DEBUG_PREVIEW_CHARS
    ? `${serialized.slice(0, DEBUG_PREVIEW_CHARS)}…[truncated]`
    : serialized
}
