/**
 * `SessionTurnRuntime` (docs/ade/impl/p6a §1.2): the shared
 * `DelegatedTurnRuntime` for session-protocol transports
 * (`codex-app-server`, `pi-rpc`). It owns the full Kun turn against a pooled
 * `HarnessAgent`: resolve the shared turn context, acquire the pooled agent
 * process, ensure/resume the native session through the session coordinator,
 * assemble the turn input (handoff brief or portable transcript), run the
 * turn through the adapter's `HarnessSession`, and commit the binding.
 *
 * ACP keeps its own proven `AcpRuntime`; this class is the common layer the
 * new native transports are built on (P6-13 evaluates migrating ACP onto it).
 */
import type { TurnItem } from '../contracts/items.js'
import { filterGoalContextsForGoalKey } from '../loop/continuation-instructions.js'
import type { HarnessTransport } from '../contracts/harness.js'
import type { ApprovalRequest } from '../domain/approval.js'
import { makeDelegatedAwaitApproval } from '../ade/delegated-approval.js'
import { resolveTurnClientSurface } from '../loop/turn-context-resolver.js'
import { userMessageTextWithComposerContexts } from '../domain/composer-context.js'
import { buildClientSurfaceInstruction } from '../prompt/kun-prompt-context.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../ports/approval-review.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { LlmDebugSink } from '../services/llm-debug-recorder.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { TurnRunOutcome } from '../loop/turn-execution-types.js'
import {
  recordHandoffInjected,
  resolveTurnHandoff,
  type TaskWorkspaceLister
} from '../handoff/turn-handoff.js'
import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from '../runtime/agent-sdk/sdk-context-assembler.js'
import {
  delegatedCapabilityFingerprint,
  priorItemsForDelegatedTurn,
  type DelegatedProviderKind,
  type DelegatedSessionCoordinator
} from '../runtime/delegated-session-binding.js'
import type {
  DelegatedRuntimeCapabilities,
  DelegatedTurnRuntime
} from '../runtime/delegated-turn-runtime.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import { AcpDraftEmitter } from '../runtime/acp/acp-turn-emitter.js'

import { HarnessAgentPool } from './harness-pool.js'
import {
  resolveDelegatedCredentialContext
} from './delegated-credentials.js'
import {
  resolveSessionTurnContext,
  type SessionTurnContext,
  type SessionTurnContextDeps
} from './session-turn-context.js'
import { mapHarnessFailure } from './harness-failure.js'
import {
  finishDelegatedTrace,
  startDelegatedTrace,
  type DelegatedTrace
} from './delegated-trace.js'
import { KunTimelineTurnSink } from './turn-sink.js'
import {
  HarnessTransportError,
  type HarnessAgent,
  type HarnessAgentFactory,
  type HarnessSession,
  type HarnessTurnInput
} from './harness-session.js'
import type { HarnessId, HarnessRoute } from '../contracts/harness.js'

export const SESSION_INTERRUPT_SETTLE_MS = 5_000

export type SessionTurnRuntimeDeps = SessionTurnContextDeps & {
  transport: HarnessTransport
  /** providerKind recorded on bindings + delegated_runtime events. */
  providerKind: DelegatedProviderKind
  /** Agent factory (spawn + handshake) per pooled connection. */
  agentFactory: HarnessAgentFactory
  /** Stable capability views this transport claims. */
  capabilities: DelegatedRuntimeCapabilities
  capabilitiesV2: HarnessCapabilities
  /** Optional; serve injects a shared pool. */
  pool?: HarnessAgentPool<HarnessAgent>
  sessionCoordinator?: DelegatedSessionCoordinator
  events: RuntimeEventRecorder
  ids: { next(prefix: string): string }
  approvalGate?: ApprovalGate
  approvalReview?: ApprovalReviewPort
  userInputGate?: UserInputGate
  attachmentStore?: AttachmentStore
  taskWorkspaces?: TaskWorkspaceLister
  deterministicHandoff?: boolean
  binaryPath?: (harnessId: HarnessId) => string | undefined
  stripEnv?: readonly string[]
  debugSink?: LlmDebugSink
  nowIso?: () => string
  debug?: (entry: { direction: 'in' | 'out' | 'note'; summary: string }) => void
  /** Settle window after interrupt before the pooled agent is recycled. */
  interruptSettleMs?: number
  onLaunchFailure?: (harnessId: HarnessId, detail: string) => void
  /** Assemble the transport's wire prompt from the shared turn input. */
  buildTurnInput?: (ctx: SessionTurnContext, session: HarnessSession) => HarnessTurnInput
  /** Images support declared by the transport (static for now). */
  imageCapable?: boolean
}

export class SessionTurnRuntime implements DelegatedTurnRuntime {
  private readonly pool: HarnessAgentPool<HarnessAgent>

  constructor(private readonly deps: SessionTurnRuntimeDeps) {
    this.pool = deps.pool ?? new HarnessAgentPool()
  }

  handlesProvider(): boolean {
    return false
  }

  handlesRoute(route: HarnessRoute): boolean {
    return this.deps.catalog.get(route.harnessId)?.transport === this.deps.transport
  }

  capabilities(): DelegatedRuntimeCapabilities {
    return this.deps.capabilities
  }

  capabilitiesV2(): HarnessCapabilities {
    return this.deps.capabilitiesV2
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
    const resolved = await resolveSessionTurnContext(this.deps, {
      threadId,
      turnId,
      signal,
      transport: this.deps.transport,
      noInputMessage: `no input for ${this.deps.transport} delegated turn`,
      graphUnavailableMessage:
        `Graph mode is unavailable for ${this.deps.transport} harnesses because ` +
        'they cannot execute Kun structured Graph tools. Choose Kun or a ' +
        'tool-capable provider and continue the same planning draft.',
      resolveCredentialContext: resolveDelegatedCredentialContext
    })
    if (!resolved.ok) return resolved.outcome
    const ctx = resolved.ctx
    const { definition } = ctx

    const lease = await this.pool
      .acquire(ctx.poolKey, () =>
        this.deps.agentFactory.connect({
          definition,
          command:
            this.deps.binaryPath?.(definition.id) ??
            definition.launch?.command ??
            '',
          args: definition.launch?.args ?? [],
          env: definition.launch?.env ?? {},
          secretEnv: ctx.secretEnv,
          credentialEnv: ctx.credentialEnv,
          stripEnv: [
            ...(this.deps.stripEnv ?? []),
            // Gateway creds active → strip the keys the generated config
            // replaces (same rule as acpStripEnv): without this, e.g. a real
            // CODEX_HOME/OPENAI_API_KEY leaks in and silently bypasses the
            // kun-gateway route.
            ...(Object.keys(ctx.credentialEnv).length > 0
              ? (definition.gateway?.stripEnv ?? [])
              : [])
          ],
          cwd: ctx.workspace,
          signal
        })
      )
      .catch(async (error) => {
        if (
          !(
            error instanceof HarnessTransportError &&
            error.code === 'request_aborted'
          )
        ) {
          this.deps.onLaunchFailure?.(
            definition.id,
            error instanceof Error ? error.message : String(error)
          )
        }
        await this.failFromError(threadId, turnId, error, true)
        return undefined
      })
    if (!lease) return 'failed'
    const agent = lease.agent

    if (agent.info.requiresAuthentication) {
      lease.release()
      return this.fail(
        threadId,
        turnId,
        `${definition.displayName} requires interactive login before Kun can delegate turns`,
        'harness_not_ready'
      )
    }

    let session: HarnessSession
    try {
      session = await this.ensureSession(agent, ctx, signal)
    } catch (error) {
      lease.release()
      await this.failFromError(threadId, turnId, error, true)
      return 'failed'
    }

    const emitter = new AcpDraftEmitter(
      { turns: this.deps.turns, events: this.deps.events },
      threadId,
      turnId
    )
    const approveCore = makeDelegatedAwaitApproval(
      {
        approvalGate: this.deps.approvalGate,
        approvalReview: this.deps.approvalReview,
        events: this.deps.events
      },
      {
        approvalPolicy: ctx.approvalPolicy ?? 'on-request',
        sandboxMode: ctx.sandboxMode,
        approvalReviewer: ctx.approvalReviewer,
        actingModelRoute: ctx.actingModelRoute,
        intent: ctx.intent,
        signal
      }
    )
    const sink = new KunTimelineTurnSink({
      emitter,
      approve: async (approval: ApprovalRequest) => {
        const resolution = await approveCore(approval)
        if (resolution === 'allow' || resolution === 'deny') return resolution
        return resolution.decision === 'allow' ? 'allow' : 'deny'
      },
      userInputGate: this.deps.userInputGate,
      threadId,
      turnId,
      ids: this.deps.ids,
      ...(this.deps.debug
        ? { diagnostic: (s) => this.deps.debug?.({ direction: 'note', summary: s }) }
        : {})
    })

    const turnHandoff = session.replayedHistory
      ? resolveTurnHandoff({
          enabled: this.deps.deterministicHandoff !== false,
          preparation: session.preparation,
          items: ctx.items,
          currentTurnId: turnId,
          ownerThreadId: threadId,
          workspacePath: ctx.workspace,
          taskWorkspaces: this.deps.taskWorkspaces
        })
      : undefined
    await recordHandoffInjected(
      (event) => this.deps.events.record(event),
      { threadId, turnId, harnessId: definition.id },
      turnHandoff
    )
    await this.recordDelegatedRuntime(ctx, session)

    const input = this.deps.buildTurnInput
      ? this.deps.buildTurnInput(ctx, session)
      : this.defaultTurnInput(ctx, session, turnHandoff?.brief.text)

    let trace = await startDelegatedTrace(this.deps.debugSink, {
      threadId,
      turnId,
      harnessId: definition.id,
      model: ctx.model ?? 'default',
      prompt: [input.userText],
      redactedRequestValues: ctx.redactedRequestValues,
      phase: this.delegatedPhase(session.preparation),
      preparationReason: session.preparation.rebaseReason,
      providerKind: this.deps.providerKind,
      endpointFormat: this.deps.transport,
      target: `${this.deps.transport}://${definition.id}/session`,
      capabilities: this.deps.capabilities
    })

    let interruptTimer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      void session.interrupt().catch(() => undefined)
      interruptTimer = setTimeout(() => {
        this.pool.markUnhealthy(ctx.poolKey)
      }, this.deps.interruptSettleMs ?? SESSION_INTERRUPT_SETTLE_MS)
      interruptTimer.unref?.()
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    try {
      const result = await session.runTurn(input, sink, signal)
      await finishDelegatedTrace(
        trace,
        result.status === 'completed'
          ? { kind: 'completed', text: '' }
          : { kind: 'error', error: result.message ?? result.status }
      )
      trace = undefined
      if (result.status === 'cancelled' || signal.aborted) {
        await this.commitBinding(ctx, session)
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
        return 'aborted'
      }
      if (result.status === 'refused') {
        await this.commitBinding(ctx, session)
        return this.fail(
          threadId,
          turnId,
          result.message ?? 'The harness refused this turn',
          'harness_refusal'
        )
      }
      if (result.status === 'failed') {
        await this.commitBinding(ctx, session)
        return this.fail(
          threadId,
          turnId,
          result.message ?? 'delegated turn failed',
          result.code ?? 'agent_error'
        )
      }
      await this.commitBinding(ctx, session)
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
      await finishDelegatedTrace(trace, { kind: 'error', error })
      trace = undefined
      if (
        signal.aborted ||
        (error instanceof HarnessTransportError &&
          error.code === 'request_aborted')
      ) {
        await this.commitBinding(ctx, session).catch(() => undefined)
        await this.deps.turns.finishTurn({ threadId, turnId, status: 'aborted' })
        return 'aborted'
      }
      await this.commitBinding(ctx, session).catch(() => undefined)
      await this.failFromError(threadId, turnId, error, false)
      return 'failed'
    } finally {
      if (interruptTimer) clearTimeout(interruptTimer)
      signal.removeEventListener('abort', onAbort)
      session.detach()
      lease.release()
    }
  }

  /** Coordinator.prepare → resume or start; resume failure rebases portable. */
  private async ensureSession(
    agent: HarnessAgent,
    ctx: SessionTurnContext,
    signal: AbortSignal
  ): Promise<HarnessSession> {
    const coordinator = this.deps.sessionCoordinator
    if (!coordinator) {
      throw new HarnessTransportError(
        'agent_error',
        `${this.deps.transport} runtime requires sessionCoordinator`
      )
    }
    const caps = agent.sessionCapabilities()
    const preparation = await coordinator.prepare({
      threadId: ctx.thread.id,
      route: {
        providerKind: this.deps.providerKind,
        providerId: ctx.definition.id,
        credentialIdentity: ctx.credentialIdentity,
        workspace: ctx.workspace,
        model: ctx.model ?? 'default',
        capabilityFingerprint: delegatedCapabilityFingerprint(
          caps.fingerprint ?? {}
        ),
        continuationMode: caps.continuation
      },
      priorItems: priorItemsForDelegatedTurn(ctx.items, ctx.turn.id)
    })
    const input = {
      threadId: ctx.thread.id,
      turnId: ctx.turn.id,
      workspacePath: ctx.workspace,
      harnessId: ctx.definition.id,
      model: ctx.wireModel ?? ctx.model,
      permissionModeId: ctx.permissionModeId,
      reasoningEffort: ctx.turn.reasoningEffort,
      items: ctx.items,
      preparation,
      signal
    }
    if (preparation.resumed && preparation.nativeSessionId && agent.resumeSession) {
      try {
        return await agent.resumeSession(input)
      } catch (error) {
        this.debug(`native resume failed, rebasing: ${String(error)}`)
        const rebased = await coordinator.rejectResume(preparation)
        return agent.startSession({ ...input, preparation: rebased })
      }
    }
    return agent.startSession(input)
  }

  private async commitBinding(
    ctx: SessionTurnContext,
    session: HarnessSession
  ): Promise<void> {
    try {
      await this.deps.sessionCoordinator?.commit({
        preparation: session.preparation,
        committedItems: filterGoalContextsForGoalKey(
          await this.deps.sessionStore.loadItems(ctx.thread.id),
          ctx.goalContextKeyForHistory
        ),
        lastCommittedTurnId: ctx.turn.id,
        nativeSessionId: session.providerSessionId
      })
    } catch {
      // Portable history stays authoritative if the binding cannot be saved.
    }
  }

  private defaultTurnInput(
    ctx: SessionTurnContext,
    session: HarnessSession,
    handoffBrief: string | undefined
  ): HarnessTurnInput {
    return {
      instructionBlocks: ctx.instructionBlocks,
      userText: userMessageTextWithComposerContexts(ctx.userItem),
      images: [],
      attachmentPaths: [],
      fileReferences: ctx.userItem.fileReferences ?? [],
      workspacePath: ctx.workspace,
      model: ctx.wireModel ?? ctx.model,
      reasoningEffort: ctx.turn.reasoningEffort,
      ...(handoffBrief ? { handoffBrief } : {}),
      historyTranscript:
        session.replayedHistory && !handoffBrief
          ? buildHistoryTranscript(
              ctx.items,
              ctx.turn.id,
              DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
            )
          : undefined,
      clientSurfaceInstruction: buildClientSurfaceInstruction(
        resolveTurnClientSurface(ctx.turn)
      ),
      kunPermissionMode: ctx.permissionModeId ?? 'default',
      approvalPolicy: ctx.approvalPolicy ?? 'ask',
      sandboxMode: ctx.sandboxMode
    }
  }

  private delegatedPhase(preparation: {
    resumed: boolean
    rebaseReason?: string
  }): 'portable' | 'resumed' | 'rebased' {
    if (preparation.resumed) return 'resumed'
    return preparation.rebaseReason ? 'rebased' : 'portable'
  }

  private async recordDelegatedRuntime(
    ctx: SessionTurnContext,
    session: HarnessSession
  ): Promise<void> {
    await this.deps.events.record({
      kind: 'delegated_runtime',
      threadId: ctx.thread.id,
      turnId: ctx.turn.id,
      providerKind: this.deps.providerKind,
      providerId: ctx.definition.id,
      harnessId: ctx.definition.id,
      phase: this.delegatedPhase(session.preparation),
      ...(session.preparation.rebaseReason
        ? { reason: session.preparation.rebaseReason }
        : {}),
      capabilities: this.deps.capabilities,
      capabilitiesV2: this.deps.capabilitiesV2
    })
  }

  private debug(summary: string): void {
    this.deps.debug?.({ direction: 'note', summary })
  }

  private async fail(
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

  private async failFromError(
    threadId: string,
    turnId: string,
    error: unknown,
    startup: boolean
  ): Promise<void> {
    const mapped = mapHarnessFailure(error, startup, this.deps.transport)
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
