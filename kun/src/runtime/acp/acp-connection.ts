/**
 * One ACP connection: an owned agent process plus its JSON-RPC channel and
 * the cached `initialize` result (docs/ade/03 §4.2-4.3). A connection can
 * host many sessions; `session/update` notifications are fanned out to
 * per-session subscribers registered by the session manager.
 */
import { KUN_VERSION } from '../../version.js'
import { bindTurnMutationContext } from '../../manager/turn-mutation-context.js'
import type { AcpProcess } from './acp-process.js'
import { AcpJsonRpc, type AcpDebugLog, type AcpProcessExitInfo } from './acp-jsonrpc.js'
import {
  ACP_AGENT_METHODS,
  ACP_CLIENT_METHODS,
  ACP_PROTOCOL_VERSION,
  AcpError,
  AcpInitializeResultSchema,
  parseAcpSessionNotification,
  type AcpInitializeResult,
  type SessionUpdate
} from './acp-schema.js'

/** Cold starts include first-run bootstraps (OpenCode ~32s); see acp-readiness-probe. */
export const ACP_INITIALIZE_TIMEOUT_MS = 60_000

export type AcpSessionUpdateSink = (
  update: SessionUpdate | { sessionUpdate: string }
) => void

export type AcpSessionSubscriber = {
  onUpdate: AcpSessionUpdateSink
  /** Protocol-level parse failure for this session's traffic. */
  onError?: (error: AcpError) => void
}

export type AcpConnectionExit = AcpProcessExitInfo & { error: AcpError }

export class AcpConnection {
  readonly process: AcpProcess
  readonly rpc: AcpJsonRpc
  /** Pool key fragment: delegatedCredentialIdentity() of the resolved login. */
  readonly identity: string
  private initResultValue: AcpInitializeResult | undefined
  private readonly sessionSubscribers = new Map<string, Set<AcpSessionSubscriber>>()
  /** sessionId → owning Kun thread; used to mark bindings when we die. */
  private readonly sessionOwners = new Map<string, string>()

  private constructor(input: {
    process: AcpProcess
    identity: string
    debug?: AcpDebugLog
  }) {
    this.process = input.process
    this.identity = input.identity
    this.rpc = new AcpJsonRpc({
      stdin: input.process.stdin!,
      stdout: input.process.stdout!,
      stderrTail: () => input.process.sanitizedStderrTail(),
      exitPromise: input.process.exit,
      debug: input.debug
    })
    this.rpc.onNotification(ACP_CLIENT_METHODS.sessionUpdate, (params) => {
      this.dispatchSessionUpdate(params)
    })
  }

  static start(input: {
    process: AcpProcess
    identity: string
    debug?: AcpDebugLog
  }): AcpConnection {
    return new AcpConnection(input)
  }

  /** True once the peer closed or the process exited. */
  get closed(): boolean {
    return this.rpc.closed
  }

  get initResult(): AcpInitializeResult | undefined {
    return this.initResultValue
  }

  onExit(listener: (exit: AcpConnectionExit) => void): () => void {
    return this.rpc.onClose((error) => {
      void this.process.exit.then((info) =>
        listener({ code: info.code, signal: info.signal, error })
      )
    })
  }

  /**
   * ACP handshake (03 §4.2). Throws `harness_protocol_error` when the agent
   * reports a protocol version Kun does not speak.
   */
  async initialize(input: { timeoutMs?: number } = {}): Promise<AcpInitializeResult> {
    const raw = await this.rpc.request(
      ACP_AGENT_METHODS.initialize,
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
          // Form elicitation only (P2-10): url mode has no Kun surface.
          elicitation: { form: {} }
        },
        clientInfo: { name: 'kun', title: 'Kun', version: KUN_VERSION }
      },
      { timeoutMs: input.timeoutMs ?? ACP_INITIALIZE_TIMEOUT_MS }
    )
    const parsed = AcpInitializeResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AcpError(
        'harness_protocol_error',
        'initialize response is missing required fields'
      )
    }
    if (parsed.data.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new AcpError(
        'harness_protocol_error',
        `protocol_version_unsupported: agent reported ${parsed.data.protocolVersion}, Kun speaks ${ACP_PROTOCOL_VERSION}`
      )
    }
    this.initResultValue = parsed.data
    return parsed.data
  }

  subscribeSession(sessionId: string, subscriber: AcpSessionSubscriber): () => void {
    let set = this.sessionSubscribers.get(sessionId)
    if (!set) {
      set = new Set()
      this.sessionSubscribers.set(sessionId, set)
    }
    const bound = { onUpdate: bindTurnMutationContext(subscriber.onUpdate),
      ...(subscriber.onError ? { onError: bindTurnMutationContext(subscriber.onError) } : {}) }
    set.add(bound)
    return () => {
      set.delete(bound)
      if (set.size === 0) this.sessionSubscribers.delete(sessionId)
    }
  }

  /** Record which Kun thread owns an ACP session (for exit marking). */
  registerSession(sessionId: string, threadId: string): void {
    this.sessionOwners.set(sessionId, threadId)
  }

  unregisterSession(sessionId: string): void {
    this.sessionOwners.delete(sessionId)
    this.sessionSubscribers.delete(sessionId)
  }

  /** Threads whose sessions were hosted here — all need rebasing on exit. */
  sessionThreadIds(): string[] {
    return [...new Set(this.sessionOwners.values())]
  }

  async close(graceMs = 1_000): Promise<void> {
    this.rpc.close()
    await this.process.stop(graceMs)
  }

  private dispatchSessionUpdate(params: unknown): void {
    let notification: ReturnType<typeof parseAcpSessionNotification>
    try {
      notification = parseAcpSessionNotification(params)
    } catch (error) {
      const acpError =
        error instanceof AcpError
          ? error
          : new AcpError('harness_protocol_error', String(error))
      // A notification that does not even carry a sessionId cannot be routed;
      // surface it on every live session so the turn fails closed.
      const targets =
        this.sessionSubscribers.size > 0
          ? [...this.sessionSubscribers.values()]
          : []
      for (const set of targets) {
        for (const subscriber of set) subscriber.onError?.(acpError)
      }
      return
    }
    const set = this.sessionSubscribers.get(notification.sessionId)
    if (!set?.size) return
    for (const subscriber of [...set]) {
      subscriber.onUpdate(notification.update)
    }
  }
}
