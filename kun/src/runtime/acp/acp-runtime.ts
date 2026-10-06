import { harnessExecutableIdentity } from '../../harness/harness-executable-identity.js'
import { sessionInstructions } from '../../session/session-instructions.js'
/**
 * ACP delegated runtime (docs/ade/03 §6). `runTurn` owns a full Kun turn
 * against an external ACP agent: pool-acquire a connection by
 * (harnessId, credentialIdentity), ensure/resume the ACP session, forward the
 * prompt (deterministic handoff brief first on fresh sessions), mediate the
 * agent's fs/terminal/permission client methods through the client host, and
 * map the session/update stream onto the Kun timeline. Completion is decided
 * by the `session/prompt` result — worker self-reports never end a turn.
 */
import type { HarnessRoute } from '../../contracts/harness.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import type { ApprovalRequest } from '../../domain/approval.js'
import { makeDelegatedAwaitApproval } from '../../ade/delegated-approval.js'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import {
  recordHandoffInjected,
  resolveTurnHandoff
} from '../../handoff/turn-handoff.js'
import type {
  DelegatedRuntimeCapabilities,
  DelegatedTurnRuntime
} from '../delegated-turn-runtime.js'
import type { DelegatedSessionCoordinator } from '../delegated-session-binding.js'
import { resolveSessionTurnContext } from '../../session/session-turn-context.js'

import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from '../agent-sdk/sdk-context-assembler.js'
import { AcpConnectionPool } from './acp-connection-pool.js'
import { AcpClientHost, type AcpClientContext } from './acp-client-host.js'
import { acpElicitForTurn } from './acp-elicitation.js'
import {
  AcpSessionManager,
  type AcpSessionHandle
} from './acp-session-manager.js'
import { AcpEventMapper } from './acp-event-mapper.js'
import { AcpDraftEmitter } from './acp-turn-emitter.js'
import { buildAcpPromptBlocks, attachmentFallbackPaths } from './acp-prompt.js'
import type { AcpSpawnFn } from './acp-process.js'
import {
  acpLegacyCapabilities,
  acpStaticCapabilities,
  finishAcpTrace,
  kunToolsDescriptorOf,
  mapAcpFailure,
  resolveAcpCredentialContext,
  startAcpTrace,
  type AcpCredentialEnvInput,
  type AcpTrace
} from './acp-runtime-support.js'
import {
  acpCheckpointGate,
  acpChildEnv,
  acquireAcpConnection,
  commitAcpSession,
  delegatedPhase,
  recordAcpDelegatedRuntime,
  resolveAcpImages,
  resolveAcpRoots
} from './acp-runtime-lifecycle.js'
import {
  ACP_AGENT_METHODS,
  AcpError,
  AcpPromptResultSchema,
  type SessionUpdate
} from './acp-schema.js'
import type { AcpDebugLog } from './acp-jsonrpc.js'
import type { AcpMcpCapabilities, KunToolsMcpProvider } from './kun-tools-mcp.js'

/** How long the runtime waits for prompt settlement after session/cancel. */
export const ACP_CANCEL_SETTLE_MS = 5_000

export type { AcpCredentialEnvInput }

export type { AcpRuntimeDeps } from './acp-runtime-deps.js'
import type { AcpRuntimeDeps } from './acp-runtime-deps.js'

export class AcpRuntime implements DelegatedTurnRuntime {
  private readonly pool: AcpConnectionPool
  private readonly host: AcpClientHost
  private readonly sessions: AcpSessionManager

  constructor(private readonly deps: AcpRuntimeDeps) {
    this.pool = deps.connectionPool ?? new AcpConnectionPool()
    this.host = deps.clientHost ?? new AcpClientHost({ debug: deps.debug })
    this.sessions =
      deps.sessionManager ??
      new AcpSessionManager({
        coordinator: deps.sessionCoordinator ?? missingCoordinator(),
        debug: deps.debug
      })
  }

  /** ACP is route-driven; legacy provider dispatch never resolves to it. */
  handlesProvider(): boolean {
    return false
  }

  handlesRoute(route: HarnessRoute): boolean {
    return this.deps.catalog.get(route.harnessId)?.transport === 'acp'
  }

  capabilities(): DelegatedRuntimeCapabilities | undefined {
    return acpLegacyCapabilities()
  }

  capabilitiesV2() {
    // kunTools is honest (P3-09): only claim it when this runtime can hand
    // the agent an MCP descriptor — i.e. it is serve-hosted.
    return acpStaticCapabilities(this.deps.kunToolsMcp?.canDeliver() === true)
  }

  async runTurn(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<TurnRunOutcome> {
    const execute = () => this.runTurnOwned(threadId, turnId, signal)
    return this.deps.sessionCoordinator
      ? this.deps.sessionCoordinator.runExclusive(threadId, execute)
      : execute()
  }

  private async runTurnOwned(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<TurnRunOutcome> {
    // P6-02: the protocol-agnostic front half (thread/turn/items, goal
    // context, history, model route, credentials, permission mode) is shared
    // with the native session transports via kun/src/session/.
    const resolved = await resolveSessionTurnContext(this.deps, {
      threadId,
      turnId,
      signal,
      transport: 'acp',
      noInputMessage: 'no input for ACP delegated turn',
      graphUnavailableMessage:
        'Graph mode is unavailable for ACP harnesses because they cannot execute Kun structured Graph tools. Choose Kun or a tool-capable provider and continue the same planning draft.',
      resolveCredentialContext: resolveAcpCredentialContext
    })
    if (!resolved.ok) return resolved.outcome
    const {
      thread,
      turn,
      userItem,
      definition,
      workspace,
      instructionBlocks,
      turnDynamicContext,
      goalContextKeyForHistory,
      model,
      actingModelRoute,
      permissionModeId,
      approvalPolicy,
      sandboxMode,
      approvalReviewer,
      credentialIdentity,
      credentialEnv,
      secretEnv,
      poolKey: basePoolKey,
      limits,
      intent,
      redactedRequestValues
    } = resolved.ctx
    const command = this.deps.readiness?.commandForTurn(threadId, turnId) ?? this.deps.binaryPath?.(definition.id) ?? definition.launch?.command
    // Single-session ACP servers can continue one thread, but must never host
    // another thread's active session on the same connection.
    const scopedPoolKey = definition.poolScope === 'thread'
      ? `${basePoolKey}:thread:${JSON.stringify([threadId, workspace])}` : basePoolKey
    const poolKey = `${scopedPoolKey}:executable:${harnessExecutableIdentity(command)}`
    await this.pool.retireIdlePrefix?.(`${scopedPoolKey}:executable:`, poolKey)
    let items = resolved.ctx.items

    const lease = await acquireAcpConnection(this.deps, this.pool, this.host, this.sessions, {
      poolKey,
      definition,
      command: this.deps.readiness?.commandForTurn(threadId, turnId),
      validateLaunch: () => this.deps.readiness?.validateTurn(threadId, turnId, signal) ?? Promise.resolve(),
      credentialEnv,
      identity: credentialIdentity,
      workspace,
      signal
    }).catch(async (error) => {
      // A user abort is not a harness defect; everything else observed at
      // launch outweighs any earlier probe verdict (P4-03).
      if (!signal.aborted && !(error instanceof AcpError && error.code === 'request_aborted')) {
        this.deps.onLaunchFailure?.(
          definition.id,
          error instanceof Error ? error.message : String(error)
        )
      }
      if (signal.aborted) await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
      else await this.failFromAcpError(threadId, turnId, error, true, definition.id)
      return undefined
    })
    if (!lease) return signal.aborted ? 'aborted' : 'failed'
    const conn = lease.connection
    const mapper = new AcpEventMapper({
      threadId,
      turnId,
      harnessId: definition.id,
      model: model ?? 'default',
      nextId: (prefix) => this.deps.ids.next(prefix),
      nowIso: this.deps.nowIso,
      debug: this.deps.debug
    })
    const emitter = new AcpDraftEmitter(
      { turns: this.deps.turns, events: this.deps.events },
      threadId,
      turnId
    )
    let emitQueue: Promise<void> = Promise.resolve()
    let acceptEvidence = true
    let streamError: AcpError | undefined
    let rejectStream!: (error: AcpError) => void
    const streamFailure = new Promise<never>((_resolve, reject) => { rejectStream = reject })
    // Setup may emit notifications before the prompt wait is attached.
    void streamFailure.catch(() => undefined)
    const failStream = (error: unknown): void => {
      if (streamError) return
      streamError = error instanceof AcpError ? error : new AcpError('harness_protocol_error', String(error))
      rejectStream(streamError)
    }
    const sink = (update: SessionUpdate | { sessionUpdate: string }): void => {
      if (streamError) return
      let drafts
      try {
        drafts = mapper.apply(update)
      } catch (error) {
        failStream(error)
        return
      }
      emitQueue = emitQueue.then(() => emitter.emitAll(drafts)).catch(failStream)
    }

    let kunToolsServers: import('./acp-schema.js').McpServer[] = []
    const sessionMcpServers = (sessionKey: string) => {
      kunToolsServers = this.deps.kunToolsMcp?.servers({
        sessionKey,
        threadId,
        turnId,
        harnessId: definition.id,
        credentialIdentity,
        mcpCapabilities: conn.initResult?.agentCapabilities?.mcpCapabilities as
          | AcpMcpCapabilities
          | undefined
      }) ?? []
      return kunToolsServers
    }
    let session: AcpSessionHandle
    try {
      await this.deps.readiness?.validateTurn(threadId, turnId, signal)
      signal.throwIfAborted()
      session = await this.sessions.ensureSession(
        {
          threadId,
          turnId,
          workspacePath: workspace,
          harnessId: definition.id,
          model,
          permissionModeId,
          acpPermission: definition.acpPermission,
          reasoningEffort: turn.reasoningEffort,
          sessionMcpServers,
          items,
          validateLaunch: async () => {
            await this.deps.readiness?.validateTurn(threadId, turnId, signal)
            signal.throwIfAborted()
          }
        },
        conn,
        sink
      )
    } catch (error) {
      this.deps.kunToolsMcp?.revokeTurn(turnId)
      lease.release()
      if (signal.aborted) {
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
        return 'aborted'
      }
      await this.failFromAcpError(threadId, turnId, error, true, definition.id)
      return 'failed'
    }
    // Protocol errors on this session's traffic fail the turn (§9).
    const unsubscribeSessionErrors = conn.subscribeSession(session.sessionId, {
      onUpdate: () => undefined,
      onError: failStream
    })

    const preparation = session.preparation
    const turnHandoff = session.replayedHistory || session.preparation.parkedDelta
      ? resolveTurnHandoff({
          enabled: this.deps.deterministicHandoff !== false,
          preparation,
          items,
          currentTurnId: turnId,
          ownerThreadId: threadId,
          workspacePath: workspace,
          taskWorkspaces: this.deps.taskWorkspaces,
          harnessName: definition.displayName
        })
      : undefined
    await recordHandoffInjected(
      (event) => this.deps.events.record(event),
      { threadId, turnId, harnessId: definition.id },
      turnHandoff
    )
    await recordAcpDelegatedRuntime(this.deps.events, {
      threadId,
      turnId,
      harnessId: definition.id,
      preparation,
      initResult: conn.initResult,
      declaredCapabilities: definition.capabilities,
      session: {
        configOptions: session.configOptions,
        modes: session.modes,
        sawAvailableCommands: session.sawAvailableCommands,
        kunToolsDescriptor: kunToolsDescriptorOf(kunToolsServers)
      },
      sandbox: definition.capabilities.facts?.sandbox ?? 'native'
    })

    const imageCapable =
      conn.initResult?.agentCapabilities?.promptCapabilities?.image === true
    const prompt = buildAcpPromptBlocks({
      handoffBrief: turnHandoff?.brief.text,
      historyTranscript:
        session.replayedHistory && !turnHandoff
          ? buildHistoryTranscript(
              items,
              turnId,
              DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
            )
          : undefined,
      instructionBlocks: sessionInstructions(preparation, [
        ...instructionBlocks, buildClientSurfaceInstruction(resolveTurnClientSurface(turn))
      ], false, turnDynamicContext.instructions),
      userText: userMessageTextWithComposerContexts(userItem),
      images: await resolveAcpImages(
        this.deps.attachmentStore,
        threadId,
        workspace,
        userItem.attachmentIds ?? [],
        imageCapable
      ),
      attachmentPaths: attachmentFallbackPaths(userItem),
      imageCapable,
      fileReferences: userItem.fileReferences ?? [],
      workspacePath: workspace
    })

    const approveCore = makeDelegatedAwaitApproval(
      {
        approvalGate: this.deps.approvalGate,
        approvalReview: this.deps.approvalReview,
        events: this.deps.events
      },
      {
        approvalPolicy: approvalPolicy ?? 'on-request',
        sandboxMode,
        approvalReviewer,
        actingModelRoute,
        intent,
        signal
      }
    )
    const approve = async (
      approval: ApprovalRequest
    ): Promise<'allow' | 'deny'> => {
      const resolution = await approveCore(approval)
      if (resolution === 'allow' || resolution === 'deny') return resolution
      return resolution.decision === 'allow' ? 'allow' : 'deny'
    }
    const context: AcpClientContext = {
      sessionId: session.sessionId,
      threadId,
      turnId,
      workspace,
      readRoots: await resolveAcpRoots(
        [workspace, ...(thread.additionalWorkspaces ?? [])],
        this.deps.allowedReadPaths
      ),
      writeRoots:
        this.deps.enforceReadOnly === true
          ? []
          : await resolveAcpRoots([workspace], this.deps.allowedWritePaths),
      approve,
      ensureCheckpoint: acpCheckpointGate(
        this.deps,
        threadId,
        turnId,
        turn,
        signal
      ),
      recordChange: (item) => this.deps.turns.applyItem(threadId, item),
      onReadFile: (path, content) => {
        if (!acceptEvidence || signal.aborted || streamError) return
        const drafts = mapper.recordFileRead(path, content)
        emitQueue = emitQueue.then(() => emitter.emitAll(drafts)).catch(failStream)
      },
      onTerminalUpdate: (snapshot) => {
        if (!acceptEvidence || signal.aborted || streamError) return
        const drafts = mapper.recordTerminal(snapshot)
        emitQueue = emitQueue.then(() => emitter.emitAll(drafts)).catch(failStream)
      },
      elicit: acpElicitForTurn(this.deps, thread, turn, signal),
      terminalEnv: acpChildEnv(this.deps, definition, credentialEnv, secretEnv),
      signal,
      nextId: (prefix) => this.deps.ids.next(prefix)
    }
    this.host.registerContext(context)

    let trace = await startAcpTrace(this.deps.debugSink, {
      threadId,
      turnId,
      harnessId: definition.id,
      model: model ?? 'default',
      prompt,
      redactedRequestValues,
      phase: delegatedPhase(preparation),
      preparationReason: preparation.rebaseReason
    })

    let promptSettled = false
    let cancelTimer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      this.host.cancelPendingPermissions(session.sessionId)
      conn.rpc.notify(ACP_AGENT_METHODS.sessionCancel, {
        sessionId: session.sessionId
      })
      cancelTimer = setTimeout(() => {
        if (!promptSettled) this.pool.markUnhealthy(poolKey)
      }, this.deps.cancelSettleMs ?? ACP_CANCEL_SETTLE_MS)
      cancelTimer.unref?.()
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    try {
      await this.deps.readiness?.validateTurn(threadId, turnId, signal)
      signal.throwIfAborted()
      if (streamError) throw streamError
      const raw = await Promise.race([conn.rpc.request(
        ACP_AGENT_METHODS.sessionPrompt,
        { sessionId: session.sessionId, prompt },
        { timeoutMs: limits.maxWallTimeMs }
      ), streamFailure])
      promptSettled = true
      this.host.terminals.flushForTurn(turnId)
      acceptEvidence = false
      await emitQueue
      const parsed = AcpPromptResultSchema.safeParse(raw)
      if (!parsed.success) {
        throw new AcpError(
          'harness_protocol_error',
          'session/prompt response is missing required fields'
        )
      }
      await emitter.emitAll(mapper.applyPromptResult(parsed.data.usage))
      await emitter.emitAll(mapper.flush())
      if (streamError) throw streamError
      await commitAcpSession(
        this.sessions,
        this.deps.sessionStore,
        session,
        goalContextKeyForHistory,
        threadId,
        turnId,
        turnHandoff
      )
      if (parsed.data.stopReason === 'cancelled' || signal.aborted) {
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
        return 'aborted'
      }
      if (parsed.data.stopReason === 'refusal') {
        return this.failTurn(
          threadId,
          turnId,
          'The harness refused this turn',
          'harness_refusal'
        )
      }
      await finishAcpTrace(trace, { kind: 'completed', text: '' })
      trace = undefined
      const suspension = await this.deps.turns.suspendGraphLeadTurn?.({
        threadId,
        turnId
      })
      const outcome: TurnRunOutcome =
        suspension === 'suspended' || suspension === 'suspended_pending_supervision'
          ? suspension
          : 'completed'
      if (outcome === 'completed') {
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'completed' })
      }
      return outcome
    } catch (error) {
      promptSettled = true
      this.host.terminals.flushForTurn(turnId)
      acceptEvidence = false
      if (streamError) {
        conn.rpc.notify(ACP_AGENT_METHODS.sessionCancel, { sessionId: session.sessionId })
        this.pool.markUnhealthy(poolKey)
      }
      await emitQueue.catch(() => undefined)
      await emitter.emitAll(mapper.flush()).catch(() => undefined)
      await finishAcpTrace(trace, { kind: 'error', error })
      trace = undefined
      if (
        signal.aborted ||
        (error instanceof AcpError && error.code === 'request_aborted')
      ) {
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
        return 'aborted'
      }
      await commitAcpSession(
        this.sessions,
        this.deps.sessionStore,
        session,
        goalContextKeyForHistory,
        threadId,
        turnId,
        turnHandoff
      )
      await this.failFromAcpError(threadId, turnId, error, false, definition.id)
      return 'failed'
    } finally {
      acceptEvidence = false
      if (cancelTimer) clearTimeout(cancelTimer)
      signal.removeEventListener('abort', onAbort)
      unsubscribeSessionErrors()
      this.host.unregisterContext(session.sessionId)
      await this.host.turnEnded(turnId)
      this.deps.kunToolsMcp?.revokeTurn(turnId)
      session.detach()
      lease.release()
    }
  }

  private async failTurn(threadId: string, turnId: string, error: string, code?: string): Promise<'failed'> {
    await this.deps.turns.finishTurn({
      threadId,
      turnId,
      status: 'failed',
      error,
      ...(code ? { code } : {}),
      severity: 'error'
    })
    return 'failed'
  }

  private async failFromAcpError(
    threadId: string,
    turnId: string,
    error: unknown,
    startup: boolean,
    harnessId?: string
  ): Promise<void> {
    const mapped = mapAcpFailure(error, startup, harnessId)
    await this.deps.turns.finishTurn({
      threadId,
      turnId,
      status: 'failed',
      error: mapped.message,
      code: mapped.code,
      severity: 'error'
    })
  }
}

function missingCoordinator(): DelegatedSessionCoordinator {
  throw new Error('AcpRuntime requires sessionCoordinator')
}
