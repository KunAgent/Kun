/**
 * CodexAgent (P6-05): a pooled `codex app-server` process implementing the
 * shared `HarnessAgent` contract. Thread-level lifecycle maps to codex
 * `thread/*` methods; the agent routes inbound server requests (approvals,
 * user input) to the owning session by codex threadId.
 */
import { tmpdir } from 'node:os'
import { startHarnessProcess } from '../../session/harness-process.js'
import type { HarnessProcess } from '../../session/harness-process.js'
import type {
  HarnessAgent,
  HarnessAgentConnectInput,
  HarnessAgentFactory,
  HarnessAgentInfo,
  HarnessSession,
  HarnessSessionStartInput
} from '../../session/harness-session.js'
import { HarnessTransportError } from '../../session/harness-session.js'
import { CodexClient, type CodexDebugLog } from './codex-client.js'
import { CodexSession, type CodexRequestRouter } from './codex-session.js'

export type CodexAgentOptions = {
  /** Test seam: pre-built client/process pair skips spawn + handshake. */
  client?: CodexClient
  process?: HarnessProcess
  debug?: CodexDebugLog
}

export class CodexAgent implements HarnessAgent {
  readonly info: HarnessAgentInfo
  private readonly client: CodexClient
  private readonly process: HarnessProcess
  /** codex threadId → owning Kun threadId (pool dormancy + rebase marking). */
  private readonly sessionOwners = new Map<string, string>()
  /** codex threadId → per-turn inbound-request handler. */
  private readonly turnHandlers = new Map<
    string,
    (method: string, params: unknown) => Promise<unknown> | unknown
  >()

  private constructor(
    client: CodexClient,
    proc: HarnessProcess,
    info: HarnessAgentInfo
  ) {
    this.client = client
    this.process = proc
    this.info = info
    this.client.onRequest(async (method, params) => {
      const threadId = (params as { threadId?: string })?.threadId
      const handler = threadId ? this.turnHandlers.get(threadId) : undefined
      if (!handler) {
        // Methods Kun deliberately does not implement get a clean refusal;
        // the adapter layer retries or degrades, never bypasses approvals.
        throw new HarnessTransportError(
          'harness_protocol_error',
          `unhandled codex server request ${method}`
        )
      }
      return handler(method, params)
    })
  }

  static async connect(
    input: HarnessAgentConnectInput,
    options: CodexAgentOptions = {}
  ): Promise<CodexAgent> {
    if (options.client && options.process) {
      // Test seam: a caller-owned client/process pair skips spawn+handshake.
      return new CodexAgent(options.client, options.process, {
        protocolName: 'codex-app-server'
      })
    }
    const args = [...input.args]
    if (!args.includes('app-server')) args.unshift('app-server')
    const proc = await startHarnessProcess({
      command: input.command,
      args,
      env: input.env,
      secretEnv: input.secretEnv,
      credentialEnv: input.credentialEnv,
      stripEnv: input.stripEnv,
      // Spawn cwd must outlive every pooled session: codex stats it while
      // loading config on each thread/start, so a deleted per-thread
      // workspace would poison the whole pooled process (EACCES/ENOENT
      // "failed to load configuration"). Per-thread cwd is carried by
      // thread/start params, not the process spawn.
      cwd: tmpdir(),
      ...(input.spawn ? { spawn: input.spawn } : {})
    })
    const client =
      options.client ??
      new CodexClient({ process: proc, debug: options.debug })
    try {
      const init = await client.initialize()
      const info: HarnessAgentInfo = {
        protocolName: 'codex-app-server',
        agentVersion: init.userAgent,
        requiresAuthentication: false
      }
      // `account/read` tells us whether login is required before turns; a
      // failed read never blocks the connection (native-login harnesses may
      // not be signed in yet).
      try {
        const account = await client.accountRead()
        info.requiresAuthentication =
          account.requiresOpenaiAuth && !account.account
      } catch {
        info.requiresAuthentication = undefined
      }
      return new CodexAgent(client, proc, info)
    } catch (error) {
      await proc.stop().catch(() => undefined)
      throw error
    }
  }

  get closed(): boolean {
    return this.client.closed
  }

  onExit(
    listener: (exit: { code: number | null; signal: string | null }) => void
  ): void {
    void this.process.exit.then((info) =>
      listener({ code: info.code, signal: info.signal })
    )
  }

  sessionThreadIds(): readonly string[] {
    return [...new Set(this.sessionOwners.values())]
  }

  sessionCapabilities(): { continuation: 'native'; fingerprint: unknown } {
    return {
      continuation: 'native',
      fingerprint: {
        protocol: 'codex-app-server',
        version: this.info.agentVersion
      }
    }
  }

  async listModels(): Promise<string[]> {
    return this.client.listModelsFlat()
  }

  /** codex thread/read rate-limit snapshot for manager routing. */
  async rateLimits() {
    return this.client.accountRateLimitsRead()
  }

  async accountRead() {
    return this.client.accountRead()
  }

  async startSession(input: HarnessSessionStartInput): Promise<HarnessSession> {
    const thread = await this.client.threadStart(threadParams(input))
    return this.bindSession(thread.id, input)
  }

  async resumeSession(
    input: HarnessSessionStartInput
  ): Promise<HarnessSession> {
    const nativeId = input.preparation.nativeSessionId
    if (!nativeId) {
      throw new HarnessTransportError(
        'harness_not_ready',
        'no native codex session to resume'
      )
    }
    try {
      const thread = await this.client.threadResume({
        threadId: nativeId,
        ...threadParams(input)
      })
      return this.bindSession(thread.id, input)
    } catch (error) {
      // Dead/garbage-collected native state → SessionTurnRuntime rebases
      // portable history onto a fresh thread via coordinator.rejectResume.
      throw new HarnessTransportError(
        'harness_not_ready',
        `codex thread/resume failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error
      )
    }
  }

  /** Fork the native thread (branch point = lastTurnId when provided). */
  async forkSession(
    input: HarnessSessionStartInput,
    lastTurnId?: string
  ): Promise<HarnessSession> {
    const nativeId = input.preparation.nativeSessionId
    if (!nativeId) {
      throw new HarnessTransportError(
        'harness_not_ready',
        'no native codex session to fork'
      )
    }
    const thread = await this.client.threadFork({
      threadId: nativeId,
      ...(lastTurnId ? { lastTurnId } : {}),
      ...threadParams(input)
    })
    return this.bindSession(thread.id, input)
  }

  private bindSession(
    codexThreadId: string,
    input: HarnessSessionStartInput
  ): CodexSession {
    this.sessionOwners.set(codexThreadId, input.threadId)
    const router: CodexRequestRouter = {
      register: (_key, handler) => {
        this.turnHandlers.set(codexThreadId, handler)
        return () => {
          if (this.turnHandlers.get(codexThreadId) === handler) {
            this.turnHandlers.delete(codexThreadId)
          }
        }
      }
    }
    const session = new CodexSession(
      this.client,
      codexThreadId,
      input,
      router
    )
    return session
  }

  async close(): Promise<void> {
    this.turnHandlers.clear()
    this.sessionOwners.clear()
    await this.client.close()
  }
}

function threadParams(
  input: HarnessSessionStartInput
): {
  cwd: string
  model?: string
  approvalPolicy: 'untrusted'
  approvalsReviewer: 'user'
} {
  return {
    cwd: input.workspacePath,
    ...(input.model ? { model: input.model } : {}),
    approvalPolicy: 'untrusted',
    approvalsReviewer: 'user'
  }
}

/** Factory wiring for `SessionTurnRuntime`'s pooled connect path. */
export function makeCodexAgentFactory(options: {
  debug?: CodexDebugLog
} = {}): HarnessAgentFactory {
  return {
    connect: (input) => CodexAgent.connect(input, options)
  }
}

/** Legacy capability flags for the delegated-runtime surface. */
export const CODEX_APP_SERVER_LEGACY_CAPABILITIES = {
  nativeResume: true,
  structuredStreaming: true,
  kunTools: false,
  externalApproval: true,
  liveSteering: true,
  nativeContextTelemetry: true,
  fork: true
} as const
