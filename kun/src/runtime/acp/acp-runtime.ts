/**
 * ACP delegated runtime (docs/ade/03 §6). `runTurn` owns a full Kun turn
 * against an external ACP agent: pool-acquire a connection by
 * (harnessId, credentialIdentity), ensure/resume the ACP session, forward the
 * prompt (deterministic handoff brief first on fresh sessions), mediate the
 * agent's fs/terminal/permission client methods through the client host, and
 * map the session/update stream onto the Kun timeline. Completion is decided
 * by the `session/prompt` result — worker self-reports never end a turn.
 */
import {
  goalContextTexts,
  type UserTurnItem
} from '../../contracts/items.js'
import type {
  HarnessDefinition,
  HarnessId,
  HarnessRoute
} from '../../contracts/harness.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../../contracts/policy.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import type { ApprovalRequest } from '../../domain/approval.js'
import { makeDelegatedAwaitApproval } from '../../ade/delegated-approval.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../../loop/continuation-instructions.js'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { normalizeTurnLimits, type TurnLimitsConfig } from '../../loop/turn-limits.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import { projectTurnDynamicContext } from '../../prompt/turn-persona-context.js'
import { historyReferenceInstructions } from '../../prompt/history-reference-context.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { UserInputGate } from '../../ports/user-input-gate.js'
import type { WorkerCallbackService } from '../../services/worker-callback-service.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../../ports/approval-review.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import {
  recordHandoffInjected,
  resolveTurnHandoff,
  type TaskWorkspaceLister
} from '../../handoff/turn-handoff.js'
import { defaultCredentialMode } from '../../harness/resolve-turn-harness.js'
import { resolvePermissionMode } from '../../harness/harness-admission.js'
import { isUnattendedTurn } from '../../harness/usage-for-turn.js'
import type {
  DelegatedRuntimeCapabilities,
  DelegatedTurnRuntime
} from '../delegated-turn-runtime.js'
import type { DelegatedSessionCoordinator } from '../delegated-session-binding.js'
import { delegatedCredentialIdentity } from '../delegated-session-binding.js'
import { parkDelegatedGraphTurnAfterRecovery } from '../delegated-graph-turn-policy.js'
import { ACP_DEFAULT_CAPABILITIES } from '../../harness/builtin-harnesses.js'
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
import { capabilitiesFromAcp } from './acp-capabilities.js'
import {
  acpLegacyCapabilities,
  finishAcpTrace,
  mapAcpFailure,
  startAcpTrace,
  type AcpTrace
} from './acp-runtime-support.js'
import {
  acpCheckpointGate,
  acpChildEnv,
  acquireAcpConnection,
  commitAcpSession,
  delegatedPhase,
  resolveAcpImages,
  resolveAcpRoots
} from './acp-runtime-lifecycle.js'
import {
  ACP_AGENT_METHODS,
  AcpError,
  AcpPromptResultSchema,
  type McpServer,
  type SessionUpdate
} from './acp-schema.js'
import type { AcpDebugLog } from './acp-jsonrpc.js'

/** How long the runtime waits for prompt settlement after session/cancel. */
export const ACP_CANCEL_SETTLE_MS = 5_000

export type AcpCredentialEnvInput = {
  harnessId: HarnessId
  credentialMode: HarnessRoute['credentialMode']
  accountId?: string
}

export interface AcpRuntimeDeps {
  /** Harness catalog lookup for the frozen route's definition. */
  catalog: { get(id: string): HarnessDefinition | undefined }
  /** Settings `harnesses.binaryPaths` override for `launch.command`. */
  binaryPath?: (harnessId: HarnessId) => string | undefined
  threadStore: ThreadStore
  sessionStore: SessionStore
  turns: TurnService
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  /** Immutable Kun/role prompt supplied by the owning runtime boundary. */
  systemPrompt?: string
  sessionCoordinator?: DelegatedSessionCoordinator
  /** Serve-process-scoped singletons; tests may inject doubles. */
  connectionPool?: AcpConnectionPool
  clientHost?: AcpClientHost
  sessionManager?: AcpSessionManager
  spawn?: AcpSpawnFn
  approvalGate?: ApprovalGate
  approvalReview?: ApprovalReviewPort
  /** Elicitation (P2-10): user_input gate / ask_manager bridges per turn. */
  userInputGate?: UserInputGate
  workerCallbacks?: Pick<WorkerCallbackService, 'askManager'>
  /**
   * Credential env for `kun-gateway`/`provider` modes (`native-login`
   * receives none). Default: none — gateway bridging lands in P1-08.
   */
  credentialEnv?: (input: AcpCredentialEnvInput) => Promise<Record<string, string>>
  /** Extra env keys to strip from the harness child beyond the shared denylist. */
  stripEnv?: readonly string[]
  attachmentStore?: AttachmentStore
  /** Kun Tools MCP descriptors forwarded to session/new (P1-07). */
  kunToolsMcpServers?: () => McpServer[]
  taskWorkspaces?: TaskWorkspaceLister
  deterministicHandoff?: boolean
  /** Delegated read-only children deny mutation regardless of parent defaults. */
  enforceReadOnly?: boolean
  /** Narrower mediation roots for child/delegated scopes. */
  allowedReadPaths?: readonly string[]
  allowedWritePaths?: readonly string[]
  allowUnattendedFullAccess?: boolean
  defaultApprovalPolicy?: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  turnLimits?: TurnLimitsConfig
  /** Desktop Git snapshot gate awaited by the first mutating mediated call. */
  awaitWorkspaceCheckpoint?: (
    checkpointRequestId: string,
    signal: AbortSignal
  ) => Promise<string | null>
  debugSink?: LlmDebugSink
  nowIso?: () => string
  debug?: AcpDebugLog
  cancelSettleMs?: number
}

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
    return ACP_DEFAULT_CAPABILITIES
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
    const thread = await this.deps.threadStore.get(threadId)
    const turn = thread?.turns.find((candidate) => candidate.id === turnId)
    if (!thread || !turn) {
      return this.failTurn(threadId, turnId, 'no input for ACP delegated turn')
    }
    let items = await this.deps.sessionStore.loadItems(threadId)
    const userItem = [...items]
      .reverse()
      .find(
        (item): item is UserTurnItem =>
          item.turnId === turnId && item.kind === 'user_message'
      )
    if (!userItem) {
      return this.failTurn(threadId, turnId, 'no input for ACP delegated turn')
    }
    const harnessId = turn.harnessId ?? thread.harnessId
    const definition = harnessId ? this.deps.catalog.get(harnessId) : undefined
    if (!definition || definition.transport !== 'acp' || !definition.launch) {
      return this.failTurn(
        threadId,
        turnId,
        `harness route is not ACP-backed: ${harnessId ?? 'none'}`,
        'route_unsupported'
      )
    }
    if (turn.orchestration === 'graph') {
      return this.failGraphTurn(threadId, turnId)
    }
    if (!this.deps.enforceReadOnly && thread.goal?.status === 'active') {
      await this.deps.turns.ensureGoalContext(threadId, turnId, signal)
      items = await this.deps.sessionStore.loadItems(threadId)
    }
    if (signal.aborted) {
      await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
      return 'aborted'
    }
    const goalContextKeyForHistory = goalContextKey(
      (await this.deps.threadStore.get(threadId))?.goal
    )
    items = filterGoalContextsForGoalKey(items, goalContextKeyForHistory)
    const turnDynamicContext = projectTurnDynamicContext({
      turnId,
      persona: turn.persona,
      items
    })
    items = [...turnDynamicContext.historyItems]
    const workspace = thread.workspace
    const instructionBlocks = [
      this.deps.systemPrompt?.trim(),
      thread.systemPrompt?.trim(),
      ...historyReferenceInstructions(thread),
      ...turnDynamicContext.instructions
    ].filter((value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index
    )
    const model =
      turn.actingModelRoute?.model ?? turn.model ?? thread.model ?? undefined
    const actingModelRoute = turn.actingModelRoute ?? {
      model: model ?? 'default',
      ...(turn.providerId ?? thread.providerId
        ? { providerId: turn.providerId ?? thread.providerId }
        : {}),
      ...(turn.accountId ?? thread.accountId
        ? { accountId: turn.accountId ?? thread.accountId }
        : {})
    }
    if (!turn.actingModelRoute) {
      await this.deps.turns.updateTurnMetadata(threadId, turnId, { actingModelRoute })
    }
    const credentialMode =
      turn.credentialMode ?? defaultCredentialMode(definition.id, definition)
    const accountId = actingModelRoute.accountId
    const permissionModeId = resolvePermissionMode(
      definition,
      undefined,
      isUnattendedTurn(turn),
      this.deps.allowUnattendedFullAccess === true
    )
    const approvalPolicy =
      this.deps.enforceReadOnly === true
        ? 'never'
        : turn.approvalPolicy ??
          thread.approvalPolicy ??
          this.deps.defaultApprovalPolicy
    const sandboxMode =
      this.deps.enforceReadOnly === true
        ? 'read-only'
        : turn.sandboxMode ?? thread.sandboxMode ?? this.deps.defaultSandboxMode
    const approvalReviewer =
      turn.approvalReviewer ??
      thread.approvalReviewer ??
      this.deps.defaultApprovalReviewer ??
      DEFAULT_APPROVAL_REVIEWER

    const credentialEnvInput = { harnessId: definition.id, credentialMode, accountId }
    const credentialEnv =
      credentialMode === 'native-login'
        ? {}
        : await (this.deps.credentialEnv?.(credentialEnvInput) ?? Promise.resolve({}))
    const credentialIdentity = delegatedCredentialIdentity({
      providerId: `${credentialMode}:${definition.id}`,
      accountId
    })
    const poolKey = `${definition.id}:${credentialIdentity}`
    const limits = normalizeTurnLimits(this.deps.turnLimits)

    const lease = await acquireAcpConnection(this.deps, this.pool, this.host, this.sessions, {
      poolKey,
      definition,
      credentialEnv,
      identity: credentialIdentity,
      workspace,
      signal
    }).catch(async (error) => {
      await this.failFromAcpError(threadId, turnId, error, true)
      return undefined
    })
    if (!lease) return 'failed'
    const conn = lease.connection
    if (conn.requiresAuthentication) {
      lease.release()
      return this.failTurn(
        threadId,
        turnId,
        `${definition.displayName} requires interactive login before Kun can delegate turns`,
        'harness_not_ready'
      )
    }

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
    let streamError: AcpError | undefined
    const sink = (update: SessionUpdate | { sessionUpdate: string }): void => {
      let drafts
      try {
        drafts = mapper.apply(update)
      } catch (error) {
        streamError ??=
          error instanceof AcpError
            ? error
            : new AcpError('harness_protocol_error', String(error))
        return
      }
      emitQueue = emitQueue.then(() => emitter.emitAll(drafts))
    }

    let session: AcpSessionHandle
    try {
      session = await this.sessions.ensureSession(
        {
          threadId,
          turnId,
          workspacePath: workspace,
          harnessId: definition.id,
          model,
          permissionModeId,
          reasoningEffort: turn.reasoningEffort,
          mcpServers: this.deps.kunToolsMcpServers?.() ?? [],
          items
        },
        conn,
        sink
      )
    } catch (error) {
      lease.release()
      await this.failFromAcpError(threadId, turnId, error, true)
      return 'failed'
    }
    // Protocol errors on this session's traffic fail the turn (§9).
    const unsubscribeSessionErrors = conn.subscribeSession(session.sessionId, {
      onUpdate: () => undefined,
      onError: (error: AcpError) => { streamError ??= error }
    })

    const preparation = session.preparation
    const turnHandoff = session.replayedHistory
      ? resolveTurnHandoff({
          enabled: this.deps.deterministicHandoff !== false,
          preparation,
          items,
          currentTurnId: turnId,
          ownerThreadId: threadId,
          workspacePath: workspace,
          taskWorkspaces: this.deps.taskWorkspaces
        })
      : undefined
    await recordHandoffInjected(
      (event) => this.deps.events.record(event),
      { threadId, turnId, harnessId: definition.id },
      turnHandoff
    )
    await this.deps.events.record({
      kind: 'delegated_runtime',
      threadId,
      turnId,
      providerKind: 'acp',
      providerId: definition.id,
      harnessId: definition.id,
      phase: delegatedPhase(preparation),
      ...(preparation.rebaseReason ? { reason: preparation.rebaseReason } : {}),
      capabilities: acpLegacyCapabilities(),
      capabilitiesV2: capabilitiesFromAcp(
        conn.initResult,
        {
          configOptions: session.configOptions,
          modes: session.modes,
          sawAvailableCommands: session.sawAvailableCommands
        },
        { sandbox: definition.capabilities.facts?.sandbox ?? 'native' }
      )
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
      instructionBlocks,
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
      workspacePath: workspace,
      clientSurfaceInstruction: buildClientSurfaceInstruction(
        resolveTurnClientSurface(turn)
      )
    })

    const approveCore = makeDelegatedAwaitApproval(
      {
        approvalGate: this.deps.approvalGate,
        approvalReview: this.deps.approvalReview,
        events: this.deps.events
      },
      {
        approvalPolicy: approvalPolicy ?? 'ask',
        sandboxMode,
        approvalReviewer,
        actingModelRoute,
        intent: turn.prompt || userMessageTextWithComposerContexts(userItem),
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
      elicit: acpElicitForTurn(this.deps, thread, turn, signal),
      terminalEnv: acpChildEnv(this.deps, definition, credentialEnv),
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
      redactedRequestValues: [
        ...goalContextTexts(items),
        ...turnDynamicContext.privateValues
      ],
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
      const raw = await conn.rpc.request(
        ACP_AGENT_METHODS.sessionPrompt,
        { sessionId: session.sessionId, prompt },
        { timeoutMs: limits.maxWallTimeMs }
      )
      promptSettled = true
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
      await this.failFromAcpError(threadId, turnId, error, false)
      return 'failed'
    } finally {
      if (cancelTimer) clearTimeout(cancelTimer)
      signal.removeEventListener('abort', onAbort)
      unsubscribeSessionErrors()
      this.host.unregisterContext(session.sessionId)
      await this.host.turnEnded(turnId)
      session.detach()
      lease.release()
    }
  }

  private async failTurn(

    threadId: string,
    turnId: string,
    error: string,
    code?: string
  ): Promise<'failed'> {
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

  private async failGraphTurn(
    threadId: string,
    turnId: string
  ): Promise<TurnRunOutcome> {
    const message =
      'Graph mode is unavailable for ACP harnesses because they cannot execute Kun structured Graph tools. Choose Kun or a tool-capable provider and continue the same planning draft.'
    const completion = await parkDelegatedGraphTurnAfterRecovery(this.deps.turns, {
      threadId,
      turnId
    })
    if (completion === 'suspended' || completion === 'suspended_pending_supervision') {
      return completion
    }
    return this.failTurn(threadId, turnId, message, 'capability_missing')
  }

  private async failFromAcpError(
    threadId: string,
    turnId: string,
    error: unknown,
    startup: boolean
  ): Promise<void> {
    const mapped = mapAcpFailure(error, startup)
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
