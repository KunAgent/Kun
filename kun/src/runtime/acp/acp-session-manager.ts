import { randomUUID } from 'node:crypto'
import type { HarnessContinuationFailure, HarnessContinuationPayload } from '../../contracts/harness-continuation.js'
import { acpContinuationDiagnostic, acpContinuationFailure, recordAcpContinuation, type AcpContinuationContext } from './acp-continuation.js'
/**
 * Thread ↔ ACP session management. Reuses
 * DelegatedSessionCoordinator for route matching, parked sessions, and
 * generation checks; the ACP-specific parts are `session/load` vs
 * `session/new`, config-option application, and the loading-phase update
 * filter that keeps an agent's replayed history out of Kun's timeline.
 */
import {
  delegatedCapabilityFingerprint,
  priorItemsForDelegatedTurn,
  type DelegatedSessionBinding,
  type DelegatedSessionCoordinator,
  type DelegatedSessionPreparation
} from '../delegated-session-binding.js'
import type { TurnItem } from '../../contracts/items.js'
import type { HarnessDefinition } from '../../contracts/harness.js'
import type { AcpDebugLog } from './acp-jsonrpc.js'
import type { AcpConnection, AcpSessionUpdateSink } from './acp-connection.js'
import {
  ACP_AGENT_METHODS,
  acpConfigOptionValues,
  AcpLoadSessionResultSchema,
  AcpNewSessionResultSchema,
  AcpError,
  type ConfigOptionUpdate,
  type CurrentModeUpdate,
  type AcpConfigOption,
  type AcpSessionModes,
  type McpServer,
  type SessionUpdate
} from './acp-schema.js'
import { providerModule } from '../../harness/providers/registry.js'
import { applyAcpProviderPermission } from './acp-provider-permissions.js'
import { applyAcpSessionAgent } from './acp-session-agent.js'
import { isAcpAuthenticationRequired } from './acp-authentication.js'
import { AcpModelSelectionError, acpLegacyVariantModel, applyAcpSessionModel, parseAcpLegacyModels, type AcpLegacyModels } from './acp-legacy-models.js'
import { applyAcpSessionSettings } from './acp-session-settings.js'
import type { HarnessSettingValues } from '../../contracts/harness-session-settings.js'

/** Per-turn input the runtime hands to the session manager. */
export type AcpSessionRequest = AcpContinuationContext & {
  threadId: string
  turnId: string
  /** Absolute workspace path — always the task workspace root. */
  workspacePath: string
  harnessId: string
  model?: string
  /** Resolved harness permission-level id. */
  permissionModeId?: string
  customPermissionMode?: boolean
  acpPermission?: HarnessDefinition['acpPermission']
  /** Composer-selected native Agent; replaces the permission-mapped mode. */
  nativeAgentId?: string
  reasoningEffort?: string
  /** Composer values for Agent-published settings. */
  harnessSettings?: HarnessSettingValues
  /** Kun Tools MCP server descriptors; user MCP servers are not forwarded. */
  mcpServers?: McpServer[]
  /** Stable native-session descriptor, activated for this turn only. */
  sessionMcpServers?: (sessionKey: string) => McpServer[]
  /** Full item list; prior items are derived via priorItemsForDelegatedTurn. */
  items: readonly TurnItem[]
  /** Revalidate after coordinator awaits and before starting/resuming a session. */
  validateLaunch?: () => Promise<unknown>
}

export type AcpSessionHandle = {
  sessionId: string
  mcpSessionKey?: string
  preparation: DelegatedSessionPreparation
  /**
   * 'loading' until `session/load` resolves — update consumers must drop
   * replayed message/tool chunks in this phase and only process
   * available_commands_update / current_mode_update / config_option_update.
   */
  phase: 'loading' | 'ready'
  /**
   * True when this turn must carry a handoff brief in the prompt — the agent
   * session is fresh and has none of Kun's prior history.
   */
  replayedHistory: boolean
  /** First failure, retained even if recovery succeeds. Not reused on later turns. */
  continuation?: HarnessContinuationPayload
  /** Config options reported by session/new or session/load. */
  configOptions?: AcpConfigOption[] | null
  modes?: AcpSessionModes | null
  models?: AcpLegacyModels
  /** Agent sent available_commands_update at least once (capability fact). */
  sawAvailableCommands?: boolean
  /** Detach the per-turn update sink registered via ensureSession. */
  detach(): void
}

export type AcpSessionManagerDeps = {
  coordinator: DelegatedSessionCoordinator
  debug?: AcpDebugLog
  /** session/load + session/new timeout. */
  sessionRequestTimeoutMs?: number
}

const SESSION_REQUEST_TIMEOUT_MS = 30_000

export class AcpSessionManager {
  private readonly live = new WeakMap<AcpConnection, Map<string, AcpSessionHandle>>()

  constructor(private readonly deps: AcpSessionManagerDeps) {}

  /**
   * Create or resume the ACP session for this turn. `sink` is the
   * turn's session/update consumer — it is subscribed before `session/load`
   * so the manager can enforce the loading-phase filter: replayed
   * message/tool chunks are dropped while config-bearing updates are absorbed
   * into the handle (replayed history must not reach Kun's timeline).
   */
  async ensureSession(
    ctx: AcpSessionRequest,
    conn: AcpConnection,
    sink?: AcpSessionUpdateSink
  ): Promise<AcpSessionHandle> {
    const capabilities = conn.initResult?.agentCapabilities
    let preparedDiagnostic: HarnessContinuationPayload | undefined
    const preparation = await this.deps.coordinator.prepare({
      threadId: ctx.threadId,
      route: {
        providerKind: 'acp',
        providerId: ctx.harnessId,
        credentialIdentity: conn.identity,
        workspace: ctx.workspacePath,
        model: ctx.model ?? 'default',
        // applyConfigOptions sets the turn's model on live, loaded and fresh
        // sessions alike, so a model change keeps the native session.
        modelScope: 'session',
        capabilityFingerprint: delegatedCapabilityFingerprint(capabilities ?? {}),
        // All ACP agents accept more prompts on a live session. loadSession
        // only determines whether it can be restored after process exit.
        continuationMode: 'native'
      },
      priorItems: priorItemsForDelegatedTurn(ctx.items, ctx.turnId),
      beforeRebase: async (binding, reason) => {
        if (reason !== 'history_changed' && reason !== 'capabilities_changed' && reason !== 'native_state_unavailable') return
        await ctx.validateLaunch?.()
        preparedDiagnostic = acpContinuationDiagnostic({ ...binding, rebaseReason: reason }, ctx.harnessId,
          acpContinuationFailure(conn, 'binding_validation', undefined, reason))
        await recordAcpContinuation(ctx, 'harness_continuation_failed', preparedDiagnostic)
      }
    })

    if (preparedDiagnostic) {
      return this.recreate(conn, ctx, preparation, preparedDiagnostic.failure, sink, preparedDiagnostic)
    }
    if (preparation.resumed && preparation.nativeSessionId) {
      const cached = this.live.get(conn)?.get(preparation.nativeSessionId)
      if (cached && !conn.closed) {
        await ctx.validateLaunch?.()
        if (cached.mcpSessionKey) ctx.sessionMcpServers?.(cached.mcpSessionKey)
        const handle = { ...cached, preparation, continuation: undefined, replayedHistory: false, detach: () => unsubscribe() }
        const unsubscribe = conn.subscribeSession(handle.sessionId, {
          onUpdate: (update) => { absorbLoadingUpdate(handle, update); sink?.(update) }
        })
        try {
          await this.applyConfigOptions(conn, handle, ctx)
          this.remember(conn, handle)
          return handle
        } catch (error) {
          unsubscribe()
          throw error
        }
      }
      if (!capabilities?.loadSession) {
        return this.recreate(conn, ctx, preparation,
          acpContinuationFailure(conn, 'binding_validation', undefined, 'load_session_unsupported'), sink)
      }
      await ctx.validateLaunch?.()
      const handle: AcpSessionHandle = {
        sessionId: preparation.nativeSessionId,
        mcpSessionKey: randomUUID(),
        preparation,
        phase: 'loading',
        replayedHistory: false,
        detach: () => unsubscribe()
      }
      const unsubscribe = conn.subscribeSession(handle.sessionId, {
        onUpdate: (update) => {
          absorbLoadingUpdate(handle, update)
          if (handle.phase === 'loading') {
            return
          }
          sink?.(update)
        }
      })
      let stage: HarnessContinuationFailure['stage'] = 'session/load'
      try {
        const raw = await conn.rpc.request(
          ACP_AGENT_METHODS.sessionLoad,
          {
            sessionId: preparation.nativeSessionId,
            cwd: ctx.workspacePath,
            mcpServers: ctx.sessionMcpServers?.(handle.mcpSessionKey!) ?? ctx.mcpServers ?? []
          },
          { timeoutMs: this.deps.sessionRequestTimeoutMs ?? SESSION_REQUEST_TIMEOUT_MS }
        )
        stage = 'session/load_result'
        const parsed = AcpLoadSessionResultSchema.safeParse(raw)
        if (!parsed.success) {
          throw new AcpError(
            'harness_protocol_error',
            'session/load response is missing required fields'
          )
        }
        handle.configOptions = parsed.data.configOptions ?? handle.configOptions
        handle.modes = parsed.data.modes ?? handle.modes
        handle.models = parseAcpLegacyModels(parsed.data.models)
        handle.phase = 'ready'
        conn.registerSession(handle.sessionId, ctx.threadId)
        stage = 'session/configure'
        await this.applyConfigOptions(conn, handle, ctx)
        this.remember(conn, handle)
        return handle
      } catch (error) {
        if (error instanceof AcpError && (
          error.code === 'policy_denied' ||
          error instanceof AcpModelSelectionError ||
          isAcpAuthenticationRequired(error) ||
          error.code === 'request_aborted'
        )) {
          unsubscribe()
          conn.unregisterSession(handle.sessionId)
          throw error
        }
        unsubscribe()
        conn.unregisterSession(handle.sessionId)
        return this.recreate(conn, ctx, preparation, acpContinuationFailure(conn, stage, error), sink)
      }
    }
    return this.createFresh(conn, ctx, preparation, sink)
  }

  private async recreate(
    conn: AcpConnection,
    ctx: AcpSessionRequest,
    preparation: DelegatedSessionPreparation,
    failure: HarnessContinuationFailure,
    sink?: AcpSessionUpdateSink,
    recordedDiagnostic?: HarnessContinuationPayload
  ): Promise<AcpSessionHandle> {
    await ctx.validateLaunch?.()
    const diagnostic = recordedDiagnostic ?? acpContinuationDiagnostic(preparation, ctx.harnessId, failure)
    // Persist before rejectResume clears state, and before session/new can fail differently.
    if (!recordedDiagnostic) await recordAcpContinuation(ctx, 'harness_continuation_failed', diagnostic)
    try {
      const rebased = preparation.resumed ? await this.deps.coordinator.rejectResume(preparation) : preparation
      const handle = await this.createFresh(conn, ctx, rebased, sink)
      handle.continuation = diagnostic
      return handle
    } catch (error) {
      await recordAcpContinuation(ctx, 'harness_session_recreation_failed', diagnostic, {
        recreationError: acpContinuationFailure(conn, 'session/new', error)
      })
      throw error
    }
  }

  private async createFresh(
    conn: AcpConnection,
    ctx: AcpSessionRequest,
    preparation: DelegatedSessionPreparation,
    sink?: AcpSessionUpdateSink
  ): Promise<AcpSessionHandle> {
    await ctx.validateLaunch?.()
    const mcpSessionKey = randomUUID()
    const raw = await conn.rpc.request(
      ACP_AGENT_METHODS.sessionNew,
      { cwd: ctx.workspacePath, mcpServers: ctx.sessionMcpServers?.(mcpSessionKey) ?? ctx.mcpServers ?? [] },
      { timeoutMs: this.deps.sessionRequestTimeoutMs ?? SESSION_REQUEST_TIMEOUT_MS }
    )
    const parsed = AcpNewSessionResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AcpError(
        'harness_protocol_error',
        'session/new response is missing required fields'
      )
    }
    const handle: AcpSessionHandle = {
      sessionId: parsed.data.sessionId,
      mcpSessionKey,
      preparation,
      phase: 'ready',
      // Fresh agent session: the prompt carries the handoff brief (08).
      replayedHistory: true,
      configOptions: parsed.data.configOptions,
      modes: parsed.data.modes,
      models: parseAcpLegacyModels(parsed.data.models),
      detach: () => unsubscribe()
    }
    const unsubscribe = conn.subscribeSession(parsed.data.sessionId, {
      onUpdate: (update) => { absorbLoadingUpdate(handle, update); sink?.(update) }
    })
    conn.registerSession(handle.sessionId, ctx.threadId)
    try {
      await this.applyConfigOptions(conn, handle, ctx)
    } catch (error) {
      unsubscribe()
      conn.unregisterSession(handle.sessionId)
      throw error
    }
    this.remember(conn, handle)
    return handle
  }

  private remember(conn: AcpConnection, handle: AcpSessionHandle): void {
    let sessions = this.live.get(conn)
    if (!sessions) {
      sessions = new Map()
      this.live.set(conn, sessions)
    }
    sessions.set(handle.sessionId, handle)
  }

  /**
   * Model and permission selections must be accepted before a prompt is sent.
   * Only optional reasoning options can retain an unmatched agent default.
   */
  async applyConfigOptions(
    conn: AcpConnection,
    session: AcpSessionHandle,
    ctx: AcpSessionRequest
  ): Promise<void> {
    await applyAcpSessionModel(conn, session, acpLegacyVariantModel(session, ctx.model, ctx.reasoningEffort))
    if (ctx.nativeAgentId) {
      await applyAcpSessionAgent(conn, session, ctx.nativeAgentId)
    } else {
      await applyAcpProviderPermission(conn, session, ctx.permissionModeId, providerModule(ctx.harnessId), ctx.acpPermission,
        undefined, ctx.customPermissionMode ?? false)
    }
    const options = session.configOptions
    if (!options?.length) return
    const byCategory = new Map<string, AcpConfigOption>()
    for (const option of options) {
      if (option.category && !byCategory.has(option.category)) {
        byCategory.set(option.category, option)
      }
    }
    await this.setIfDifferent(conn, session, byCategory.get('thought_level'), [
      ...(ctx.reasoningEffort ? effortCandidates(ctx.reasoningEffort) : [])
    ])
    await applyAcpSessionSettings(conn, session, ctx.harnessSettings, ctx.acpPermission?.configOptionId)
  }

  private async setIfDifferent(
    conn: AcpConnection,
    session: AcpSessionHandle,
    option: AcpConfigOption | undefined,
    candidates: readonly string[]
  ): Promise<void> {
    const wanted = candidates.find(Boolean)
    if (!option || !wanted) return
    if (option.type === 'boolean') return
    if (option.currentValue === wanted) return
    const values = acpConfigOptionValues(option)
    const match = candidates.find((candidate) => values.includes(candidate))
    if (!match) {
      this.debug(
        `config option ${option.id} has no exact value ${candidates.join('/')}; keeping agent default`
      )
      return
    }
    await conn.rpc.request(ACP_AGENT_METHODS.sessionSetConfigOption, {
      sessionId: session.sessionId,
      configId: option.id,
      value: match
    })
  }

  /** Persist the committed session binding after a turn. */
  async commit(
    session: AcpSessionHandle,
    input: {
      committedItems: readonly TurnItem[]
      lastCommittedTurnId: string
      handoffBriefDigest?: string
    }
  ): Promise<DelegatedSessionBinding> {
    return this.deps.coordinator.commit({
      preparation: session.preparation,
      committedItems: input.committedItems,
      lastCommittedTurnId: input.lastCommittedTurnId,
      nativeSessionId: session.sessionId,
      handoffBriefDigest: input.handoffBriefDigest
    })
  }

  /**
   * Forget live handles on process exit. Persisted sessions remain loadable;
   * only agents without disk restoration require a one-time history rebase.
   */
  async handleConnectionExit(conn: AcpConnection, harnessId: string): Promise<void> {
    this.live.delete(conn)
    // Disk-backed native sessions survive the process that hosted them.
    if (conn.initResult?.agentCapabilities?.loadSession) return
    for (const threadId of conn.sessionThreadIds()) {
      await this.deps.coordinator.markNativeStateUnavailable({
        threadId,
        providerKind: 'acp',
        providerId: harnessId,
        credentialIdentity: conn.identity
      })
    }
  }

  private debug(summary: string): void {
    this.deps.debug?.({ direction: 'note', summary })
  }
}

/**
 * Loading-phase update handling: while `session/load` replays history,
 * message/tool chunks are dropped entirely; only config-bearing updates are
 * absorbed into the handle so capability/config state stays current.
 */
function absorbLoadingUpdate(
  handle: AcpSessionHandle,
  update: SessionUpdate | { sessionUpdate: string }
): void {
  if (update.sessionUpdate === 'config_option_update') {
    const options = (update as ConfigOptionUpdate).configOptions
    if (options) handle.configOptions = options
  } else if (update.sessionUpdate === 'current_mode_update') {
    const modeId = (update as CurrentModeUpdate).currentModeId
    if (modeId && handle.modes) {
      handle.modes = { ...handle.modes, currentModeId: modeId }
    }
  } else if (update.sessionUpdate === 'available_commands_update') {
    handle.sawAvailableCommands = true
  }
}

/** Kun effort → candidate ACP option value ids, most preferred first. */
function effortCandidates(effort: string): string[] {
  switch (effort.trim().toLowerCase()) {
    case 'off':
      return ['off', 'none', 'minimal']
    case 'low':
      return ['low', 'minimal']
    case 'medium':
      return ['medium', 'med', 'default']
    case 'high':
      return ['high', 'max']
    case 'max':
      return ['max', 'high']
    default:
      return [effort.trim().toLowerCase()]
  }
}
