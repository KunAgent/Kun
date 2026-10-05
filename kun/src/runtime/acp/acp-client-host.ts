/**
 * Agent → client method host (docs/ade/03 §8). Registers the fs/*,
 * terminal/*, and session/request_permission handlers on a connection's
 * JSON-RPC peer. Every handler resolves its session through
 * `contextFor(sessionId)` — a context the runtime registers while a turn is
 * live — and unknown/finished sessions get a JSON-RPC error rather than a
 * guessed owner.
 */
import type { TurnItem } from '../../contracts/items.js'
import { bindTurnMutationContext } from '../../manager/turn-mutation-context.js'
import {
  makeToolCallItem,
  makeToolResultItem
} from '../../domain/item.js'
import type { AcpConnection } from './acp-connection.js'
import type { AcpDebugLog } from './acp-jsonrpc.js'
import { readIfExists, readTextFile, resolveInside, writeTextFile } from './acp-fs.js'
import {
  ACP_CLIENT_METHODS,
  ACP_RPC_ERROR,
  AcpError,
  AcpCreateElicitationParamsSchema,
  AcpReadTextFileParamsSchema,
  AcpRequestPermissionParamsSchema,
  AcpTerminalCreateParamsSchema,
  AcpTerminalIdParamsSchema,
  AcpWriteTextFileParamsSchema,
  parseAcpParams,
  type CreateElicitationResponse
} from './acp-schema.js'
import type { AcpElicitFn } from './acp-elicitation.js'
import {
  AcpApprovalMemo,
  AcpPendingPermissions,
  acpPermissionTargets,
  approvalRequestFromAcp,
  pickPermissionOutcome,
  type AcpApproveFn
} from './acp-permission.js'
import {
  AcpTerminalRegistry,
  type AcpTerminalSpawn,
  type AcpTerminalStop
} from './acp-terminal-registry.js'

/**
 * Per-turn mediation surface the runtime registers for a live ACP session.
 * Roots are physical (realpath'd): readRoots = workspace + additional
 * workspaces + mounted read-only roots; writeRoots = the task workspace.
 */
export type AcpClientContext = {
  sessionId: string
  threadId: string
  turnId: string
  /** Lexical workspace path for approval envelopes. */
  workspace: string
  readRoots: readonly string[]
  writeRoots: readonly string[]
  /** The turn's approval pipeline (policy → reviewer → user gate). */
  approve: AcpApproveFn
  /** Ensures the turn's workspace checkpoint before mutations. */
  ensureCheckpoint?: () => Promise<void>
  /** Records an item (the Changes-panel file_change pair) on the timeline. */
  recordChange?: (item: TurnItem) => void | Promise<void>
  /** Scoped env for agent terminals — the same stripped env the agent got. */
  terminalEnv?: NodeJS.ProcessEnv
  /**
   * Form elicitation handler (P2-10): user_input gate on interactive turns,
   * ask_manager on worker turns; absent when the turn disables user input.
   */
  elicit?: AcpElicitFn
  signal?: AbortSignal
  nextId?: (prefix: string) => string
}

export type AcpClientHostDeps = {
  debug?: AcpDebugLog
  /** Test hooks: replace the owned-process spawn/stop for terminals. */
  spawnTerminal?: AcpTerminalSpawn
  stopTerminal?: AcpTerminalStop
}

export class AcpClientHost {
  private readonly contexts = new Map<string, AcpClientContext>()
  private readonly memo = new AcpApprovalMemo()
  private readonly pending = new AcpPendingPermissions()
  readonly terminals: AcpTerminalRegistry
  private counter = 0

  constructor(private readonly deps: AcpClientHostDeps = {}) {
    this.terminals = new AcpTerminalRegistry({
      spawn: deps.spawnTerminal,
      stop: deps.stopTerminal
    })
  }

  attach(conn: AcpConnection): void {
    const rpc = conn.rpc
    rpc.onRequest(ACP_CLIENT_METHODS.fsReadTextFile, (params) =>
      this.handleReadFile(params)
    )
    rpc.onRequest(ACP_CLIENT_METHODS.fsWriteTextFile, (params) =>
      this.handleWriteFile(params)
    )
    rpc.onRequest(ACP_CLIENT_METHODS.requestPermission, (params) =>
      this.handleRequestPermission(params)
    )
    rpc.onRequest(ACP_CLIENT_METHODS.terminalCreate, (params) =>
      this.handleTerminalCreate(params)
    )
    rpc.onRequest(ACP_CLIENT_METHODS.terminalOutput, (params) =>
      this.handleTerminalOutput(params)
    )
    rpc.onRequest(ACP_CLIENT_METHODS.terminalWaitForExit, (params) =>
      this.handleTerminalWait(params)
    )
    rpc.onRequest(ACP_CLIENT_METHODS.terminalKill, (params) =>
      this.handleTerminalKill(params)
    )
    rpc.onRequest(ACP_CLIENT_METHODS.terminalRelease, (params) =>
      this.handleTerminalRelease(params)
    )
    rpc.onRequest(ACP_CLIENT_METHODS.elicitationCreate, (params) =>
      this.handleElicitation(params)
    )
  }

  registerContext(ctx: AcpClientContext): void {
    this.contexts.set(ctx.sessionId, { ...ctx,
      approve: bindTurnMutationContext(ctx.approve),
      ...(ctx.ensureCheckpoint ? { ensureCheckpoint: bindTurnMutationContext(ctx.ensureCheckpoint) } : {}),
      ...(ctx.recordChange ? { recordChange: bindTurnMutationContext(ctx.recordChange) } : {}),
      ...(ctx.elicit ? { elicit: bindTurnMutationContext(ctx.elicit) } : {}) })
  }

  unregisterContext(sessionId: string): void {
    this.contexts.delete(sessionId)
    this.pending.cancelAll(sessionId)
  }

  /** Turn finished or cancelled: reclaim terminals and forget memo state. */
  async turnEnded(turnId: string): Promise<void> {
    await this.terminals.releaseForTurn(turnId)
    this.memo.clear(turnId)
  }

  /** Before session/cancel: every pending permission answers 'cancelled'. */
  cancelPendingPermissions(sessionId: string): void {
    this.pending.cancelAll(sessionId)
  }

  /** Session torn down while permissions/terminals may still be open. */
  async sessionEnded(sessionId: string): Promise<void> {
    this.unregisterContext(sessionId)
    await this.terminals.releaseForSession(sessionId)
  }

  private contextFor(sessionId: string): AcpClientContext {
    const ctx = this.contexts.get(sessionId)
    if (!ctx) {
      throw new AcpError(
        'policy_denied',
        'session has no live turn context',
        { rpcCode: ACP_RPC_ERROR.sessionUnavailable }
      )
    }
    return ctx
  }

  // ---- fs -----------------------------------------------------------------

  private async handleReadFile(params: unknown): Promise<{ content: string }> {
    const parsed = parseAcpParams(AcpReadTextFileParamsSchema, params)
    const ctx = this.contextFor(parsed.sessionId)
    const abs = await resolveInside(ctx.readRoots, parsed.path)
    return readTextFile(abs, { line: parsed.line, limit: parsed.limit })
  }

  private async handleWriteFile(params: unknown): Promise<Record<string, never>> {
    const parsed = parseAcpParams(AcpWriteTextFileParamsSchema, params)
    const ctx = this.contextFor(parsed.sessionId)
    const abs = await resolveInside(ctx.writeRoots, parsed.path)
    if (!this.memo.has(ctx.turnId, 'file', abs)) {
      const approval = approvalRequestFromAcp(
        {
          params: {
            sessionId: parsed.sessionId,
            toolCall: {
              toolCallId: `acp_fs_${++this.counter}`,
              kind: 'edit',
              title: `Write ${parsed.path.slice(0, 256)}`,
              locations: [{ path: abs }],
              rawInput: { path: abs }
            },
            options: []
          },
          threadId: ctx.threadId,
          turnId: ctx.turnId,
          workspace: ctx.workspace,
          approvalId: ctx.nextId?.('appr') ?? `appr_acp_${++this.counter}`
        },
        'acp:fs.write'
      )
      const decision = await ctx.approve(approval)
      if (decision !== 'allow') {
        throw new AcpError('policy_denied', 'write rejected by Kun policy', {
          rpcCode: ACP_RPC_ERROR.policyDenied
        })
      }
    }
    await ctx.ensureCheckpoint?.()
    const before = await readIfExists(abs)
    await writeTextFile(abs, parsed.content)
    if (ctx.recordChange) {
      const callId = `acp_fs_write_${++this.counter}`
      const toolName = 'acp:fs.write'
      await ctx.recordChange(makeToolCallItem({
        id: ctx.nextId?.('item_acp_call') ?? `item_acp_call_${this.counter}`,
        turnId: ctx.turnId,
        threadId: ctx.threadId,
        callId,
        toolName,
        toolKind: 'file_change',
        arguments: { path: abs },
        status: 'completed'
      }))
      await ctx.recordChange(makeToolResultItem({
        id: ctx.nextId?.('item_acp_result') ?? `item_acp_result_${this.counter}`,
        turnId: ctx.turnId,
        threadId: ctx.threadId,
        callId,
        toolName,
        toolKind: 'file_change',
        output: { diffs: [{ path: abs, oldText: before, newText: parsed.content }] },
        status: 'completed'
      }))
    }
    return {}
  }

  // ---- permission -----------------------------------------------------------

  private async handleRequestPermission(params: unknown): Promise<{
    outcome:
      | { outcome: 'selected'; optionId: string }
      | { outcome: 'cancelled' }
  }> {
    const parsed = parseAcpParams(AcpRequestPermissionParamsSchema, params)
    const ctx = this.contextFor(parsed.sessionId)
    const slot = this.pending.track(parsed.sessionId)
    try {
      const approval = approvalRequestFromAcp(
        {
          params: parsed,
          threadId: ctx.threadId,
          turnId: ctx.turnId,
          workspace: ctx.workspace,
          approvalId: ctx.nextId?.('appr') ?? `appr_acp_${++this.counter}`
        }
      )
      const decision = await Promise.race([
        ctx.approve(approval),
        slot.cancelled.then(() => 'cancelled' as const)
      ])
      if (decision === 'allow') {
        // Later mediated calls against these targets skip a second prompt.
        const targets = await acpPermissionTargets(parsed, (path) =>
          resolveInside(ctx.writeRoots, path)
        )
        for (const target of targets) {
          this.memo.mark(ctx.turnId, target.kind, target.target)
        }
      }
      return pickPermissionOutcome(parsed.options, decision)
    } finally {
      slot.done()
    }
  }

  // ---- terminal ---------------------------------------------------------------

  private async handleTerminalCreate(params: unknown): Promise<{ terminalId: string }> {
    const parsed = parseAcpParams(AcpTerminalCreateParamsSchema, params)
    const ctx = this.contextFor(parsed.sessionId)
    const cwd = parsed.cwd
      ? await resolveInside(ctx.writeRoots, parsed.cwd)
      : ctx.writeRoots[0]
    if (!cwd) {
      throw new AcpError('policy_denied', 'no writable workspace for terminals', {
        rpcCode: ACP_RPC_ERROR.policyDenied
      })
    }
    const args = parsed.args ?? []
    const commandLine = [parsed.command, ...args].join(' ')
    if (
      !this.memo.has(ctx.turnId, 'command', parsed.command) &&
      !this.memo.has(ctx.turnId, 'command', commandLine)
    ) {
      const approval = approvalRequestFromAcp(
        {
          params: {
            sessionId: parsed.sessionId,
            toolCall: {
              toolCallId: `acp_term_${++this.counter}`,
              kind: 'execute',
              title: commandLine.slice(0, 256),
              rawInput: { command: parsed.command, args }
            },
            options: []
          },
          threadId: ctx.threadId,
          turnId: ctx.turnId,
          workspace: ctx.workspace,
          approvalId: ctx.nextId?.('appr') ?? `appr_acp_${++this.counter}`
        }
      )
      const decision = await ctx.approve(approval)
      if (decision !== 'allow') {
        throw new AcpError('policy_denied', 'command rejected by Kun policy', {
          rpcCode: ACP_RPC_ERROR.policyDenied
        })
      }
    }
    await ctx.ensureCheckpoint?.()
    const env = { ...ctx.terminalEnv } as NodeJS.ProcessEnv
    for (const entry of parsed.env ?? []) {
      env[entry.name] = entry.value
    }
    return this.terminals.create({
      sessionId: parsed.sessionId,
      turnId: ctx.turnId,
      command: parsed.command,
      args,
      env,
      cwd,
      outputByteLimit: parsed.outputByteLimit
    })
  }

  private handleTerminalOutput(params: unknown): {
    output: string
    truncated: boolean
    exitStatus?: { exitCode: number | null; signal: string | null }
  } {
    const parsed = parseAcpParams(AcpTerminalIdParamsSchema, params)
    this.contextFor(parsed.sessionId)
    return this.terminals.output(parsed.terminalId)
  }

  private async handleTerminalWait(params: unknown): Promise<{
    exitCode: number | null
    signal: string | null
  }> {
    const parsed = parseAcpParams(AcpTerminalIdParamsSchema, params)
    const ctx = this.contextFor(parsed.sessionId)
    return this.terminals.waitForExit(parsed.terminalId, ctx.signal)
  }

  private async handleTerminalKill(params: unknown): Promise<Record<string, never>> {
    const parsed = parseAcpParams(AcpTerminalIdParamsSchema, params)
    this.contextFor(parsed.sessionId)
    return this.terminals.kill(parsed.terminalId)
  }

  private async handleTerminalRelease(params: unknown): Promise<Record<string, never>> {
    const parsed = parseAcpParams(AcpTerminalIdParamsSchema, params)
    this.contextFor(parsed.sessionId)
    return this.terminals.release(parsed.terminalId)
  }

  // ---- elicitation -----------------------------------------------------------

  /**
   * `elicitation/create` (P2-10): only the form mode is advertised, so url
   * and custom modes decline politely; request-scoped elicitations carry no
   * sessionId and cancel since no turn context can own them.
   */
  private async handleElicitation(
    params: unknown
  ): Promise<CreateElicitationResponse> {
    const parsed = parseAcpParams(AcpCreateElicitationParamsSchema, params)
    if (parsed.mode !== 'form' || parsed.requestedSchema === undefined) {
      return { action: 'decline' }
    }
    if (!parsed.sessionId) return { action: 'cancel' }
    const ctx = this.contextFor(parsed.sessionId)
    if (!ctx.elicit) return { action: 'decline' }
    return ctx.elicit({
      message: parsed.message,
      requestedSchema: parsed.requestedSchema
    })
  }
}
