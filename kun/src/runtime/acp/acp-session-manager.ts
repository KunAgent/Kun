/**
 * Thread ↔ ACP session management (docs/ade/03 §5). Reuses
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

/** Per-turn input the runtime hands to the session manager. */
export type AcpSessionRequest = {
  threadId: string
  turnId: string
  /** Absolute workspace path — always the task workspace root (§5.2). */
  workspacePath: string
  harnessId: string
  model?: string
  /** Resolved harness permission-level id (02 §5.3). */
  permissionModeId?: string
  reasoningEffort?: string
  /** Kun Tools MCP server descriptors; user MCP servers are not forwarded. */
  mcpServers?: McpServer[]
  /** Full item list; prior items are derived via priorItemsForDelegatedTurn. */
  items: readonly TurnItem[]
}

export type AcpSessionHandle = {
  sessionId: string
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
  /** Config options reported by session/new or session/load. */
  configOptions?: AcpConfigOption[] | null
  modes?: AcpSessionModes | null
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
  constructor(private readonly deps: AcpSessionManagerDeps) {}

  /**
   * Create or resume the ACP session for this turn (§5.1). `sink` is the
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
    const preparation = await this.deps.coordinator.prepare({
      threadId: ctx.threadId,
      route: {
        providerKind: 'acp',
        providerId: ctx.harnessId,
        credentialIdentity: conn.identity,
        workspace: ctx.workspacePath,
        model: ctx.model ?? 'default',
        capabilityFingerprint: delegatedCapabilityFingerprint(capabilities ?? {}),
        continuationMode: capabilities?.loadSession ? 'native' : 'portable'
      },
      priorItems: priorItemsForDelegatedTurn(ctx.items, ctx.turnId)
    })

    if (preparation.resumed && preparation.nativeSessionId) {
      const handle: AcpSessionHandle = {
        sessionId: preparation.nativeSessionId,
        preparation,
        phase: 'loading',
        replayedHistory: false,
        detach: () => unsubscribe()
      }
      const unsubscribe = conn.subscribeSession(handle.sessionId, {
        onUpdate: (update) => {
          if (handle.phase === 'loading') {
            absorbLoadingUpdate(handle, update)
            return
          }
          sink?.(update)
        }
      })
      try {
        const raw = await conn.rpc.request(
          ACP_AGENT_METHODS.sessionLoad,
          {
            sessionId: preparation.nativeSessionId,
            cwd: ctx.workspacePath,
            mcpServers: ctx.mcpServers ?? []
          },
          { timeoutMs: this.deps.sessionRequestTimeoutMs ?? SESSION_REQUEST_TIMEOUT_MS }
        )
        const parsed = AcpLoadSessionResultSchema.safeParse(raw)
        if (!parsed.success) {
          throw new AcpError(
            'harness_protocol_error',
            'session/load response is missing required fields'
          )
        }
        handle.configOptions = parsed.data.configOptions ?? handle.configOptions
        handle.modes = parsed.data.modes ?? handle.modes
        handle.phase = 'ready'
        conn.registerSession(handle.sessionId, ctx.threadId)
        await this.applyConfigOptions(conn, handle, ctx)
        return handle
      } catch (error) {
        this.debug(`session/load failed, rebasing to session/new: ${String(error)}`)
        unsubscribe()
        const rebased = await this.deps.coordinator.rejectResume(preparation)
        return this.createFresh(conn, ctx, rebased, sink)
      }
    }
    return this.createFresh(conn, ctx, preparation, sink)
  }

  private async createFresh(
    conn: AcpConnection,
    ctx: AcpSessionRequest,
    preparation: DelegatedSessionPreparation,
    sink?: AcpSessionUpdateSink
  ): Promise<AcpSessionHandle> {
    const raw = await conn.rpc.request(
      ACP_AGENT_METHODS.sessionNew,
      { cwd: ctx.workspacePath, mcpServers: ctx.mcpServers ?? [] },
      { timeoutMs: this.deps.sessionRequestTimeoutMs ?? SESSION_REQUEST_TIMEOUT_MS }
    )
    const parsed = AcpNewSessionResultSchema.safeParse(raw)
    if (!parsed.success) {
      throw new AcpError(
        'harness_protocol_error',
        'session/new response is missing required fields'
      )
    }
    const unsubscribe = conn.subscribeSession(parsed.data.sessionId, {
      onUpdate: (update) => sink?.(update)
    })
    const handle: AcpSessionHandle = {
      sessionId: parsed.data.sessionId,
      preparation,
      phase: 'ready',
      // Fresh agent session: the prompt carries the handoff brief (08).
      replayedHistory: true,
      configOptions: parsed.data.configOptions,
      modes: parsed.data.modes,
      detach: () => unsubscribe()
    }
    conn.registerSession(handle.sessionId, ctx.threadId)
    await this.applyConfigOptions(conn, handle, ctx)
    return handle
  }

  /**
   * Push model / thought_level / mode selections into session config options
   * (§5.3). Values that have no exact match in the option's value list are
   * never guessed — the agent keeps its default and a debug note is recorded.
   */
  async applyConfigOptions(
    conn: AcpConnection,
    session: AcpSessionHandle,
    ctx: AcpSessionRequest
  ): Promise<void> {
    const options = session.configOptions
    if (!options?.length) {
      // Legacy fallback: only the mode category existed before config options.
      const modeId = ctx.permissionModeId
      const modes = session.modes
      if (
        modeId &&
        modes &&
        modes.currentModeId !== modeId &&
        modes.availableModes.some((mode) => mode.id === modeId)
      ) {
        await conn.rpc.request(ACP_AGENT_METHODS.sessionSetMode, {
          sessionId: session.sessionId,
          modeId
        })
      }
      return
    }
    const byCategory = new Map<string, AcpConfigOption>()
    for (const option of options) {
      if (option.category && !byCategory.has(option.category)) {
        byCategory.set(option.category, option)
      }
    }
    await this.setIfDifferent(conn, session, byCategory.get('model'), [
      ...(ctx.model ? [ctx.model] : [])
    ])
    await this.setIfDifferent(conn, session, byCategory.get('thought_level'), [
      ...(ctx.reasoningEffort ? effortCandidates(ctx.reasoningEffort) : [])
    ])
    await this.setIfDifferent(conn, session, byCategory.get('mode'), [
      ...(ctx.permissionModeId ? [ctx.permissionModeId] : [])
    ])
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

  /** Persist the committed session binding after a turn (§5.1). */
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
   * The hosting process exited: every session bound to this connection is
   * marked native_state_unavailable so the next turn rebuilds portable (§4.3).
   */
  async handleConnectionExit(conn: AcpConnection, harnessId: string): Promise<void> {
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
 * Loading-phase update handling (§5.1): while `session/load` replays history,
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
