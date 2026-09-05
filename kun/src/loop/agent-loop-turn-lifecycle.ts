import type { DelegatedTurnRuntime } from '../runtime/delegated-turn-runtime.js'
import {
  isHostShutdownTurnSuspension,
  ownerLeaseExpiredTurnAbortFrom,
  ownerLeaseExpiredTurnMessage,
  type TurnSettlement
} from '../services/turn-service.js'
import { makeErrorItem } from '../domain/item.js'
import type {
  TurnExecutionStatus,
  TurnRunOutcome
} from './turn-execution-types.js'
import { modelClientDiagnostics } from './model-client-diagnostics.js'
import { rewriteStreamDisconnectFailure } from './stream-disconnection-failure.js'
import { TurnFinalizer, type TurnFinalizationRequest } from './turn-finalizer.js'
import { normalizeTurnLimits } from './turn-limits.js'
import { ToolStormBreaker } from './tool-storm-breaker.js'
import {
  runTurnEndLifecycleHooks,
  runTurnStartLifecycleHooks
} from './turn-lifecycle-hooks.js'
import type { GoalElapsedTimer } from './goal-turn-coordinator.js'
import { AgentLoopBase } from './agent-loop-base.js'

export abstract class AgentLoopTurnLifecycle extends AgentLoopBase {
  protected abstract loop(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<TurnRunOutcome>

  runTurn(threadId: string, turnId: string): Promise<TurnRunOutcome> {
    const key = activeTurnRunKey(threadId, turnId)
    const existing = this.activeTurnRuns.get(key)
    if (existing) {
      const signal = this.opts.turns.getAbortController(turnId)
      if (existing.signal === signal) return existing.promise
      return existing.promise.then((outcome) => {
        // A suspended Graph slice releases its execution lease before this
        // promise leaves activeTurnRuns. Steering can reacquire the lease in
        // that narrow interval, so the caller that delivered the wake-up must
        // start the continuation after the parked runner fully settles.
        if (
          (
            outcome === 'suspended' ||
            outcome === 'suspended_pending_supervision'
          ) &&
          this.opts.turns.isTurnExecutionActive(turnId)
        ) {
          return this.runTurn(threadId, turnId)
        }
        return outcome
      })
    }
    const run = this.opts.turns.withTurnMutationFence(
      threadId,
      turnId,
      () => this.runTurnOwned(threadId, turnId)
    )
    const active = {
      promise: run,
      signal: this.opts.turns.getAbortController(turnId)
    }
    this.activeTurnRuns.set(key, active)
    void run.then(
      () => { if (this.activeTurnRuns.get(key) === active) this.activeTurnRuns.delete(key) },
      () => { if (this.activeTurnRuns.get(key) === active) this.activeTurnRuns.delete(key) }
    )
    return run
  }

  protected async runTurnOwned(threadId: string, turnId: string): Promise<TurnRunOutcome> {
    const finalizer = new TurnFinalizer(this.opts.turns)
    const settle = (input: Omit<TurnFinalizationRequest, 'threadId' | 'turnId'>) =>
      finalizer.settle({ threadId, turnId, ...input })
    const statusFromSettlement = (
      settlement: TurnSettlement,
      fallback: TurnExecutionStatus
    ): TurnExecutionStatus => settlement.kind === 'missing' ? fallback : settlement.status
    const errorFromSettlement = (settlement: TurnSettlement): string | undefined =>
      settlement.kind === 'missing' ? undefined : settlement.error
    const signal = this.opts.turns.getAbortController(turnId)
    let finalStatus: 'completed' | 'failed' | 'aborted' | undefined
    let finalError: string | undefined
    const failOwnerLease = async (): Promise<TurnExecutionStatus | null> => {
      if (!signal) return null
      const reason = ownerLeaseExpiredTurnAbortFrom(signal)
      if (!reason) return null
      const error = ownerLeaseExpiredTurnMessage(reason)
      const settlement = await settle({
        status: 'failed',
        error,
        code: reason.code,
        severity: 'warning'
      })
      finalStatus = statusFromSettlement(settlement, 'failed')
      finalError = errorFromSettlement(settlement)
      return finalStatus
    }
    if (!signal) {
      const settlement = await settle({ status: 'failed', error: 'no abort controller for turn' })
      return statusFromSettlement(settlement, 'failed')
    }
    if (signal.aborted) {
      if (isHostShutdownTurnSuspension(signal)) return 'suspended'
      const ownerLeaseFailure = await failOwnerLease()
      if (ownerLeaseFailure) return ownerLeaseFailure
      const settlement = await settle({ status: 'aborted' })
      return statusFromSettlement(settlement, 'aborted')
    }
    const owningThread = await this.opts.threadStore.get(threadId)
    // Subscription engine dispatch. All other providers fall through to Kun's
    // native HTTP model loop below.
    const sdkRuntime = this.opts.sdkRuntime
    let delegatedSdkRuntime: DelegatedTurnRuntime | undefined
    let delegatedProviderId: string | undefined
    if (sdkRuntime) {
      const turn = owningThread?.turns.find((candidate) => candidate.id === turnId)
      const providerId = turn?.providerId?.trim() || owningThread?.providerId?.trim()
      const resolvedRuntime = sdkRuntime.resolveProvider?.(providerId) ??
        (sdkRuntime.handlesProvider(providerId) ? sdkRuntime : undefined)
      if (resolvedRuntime) {
        delegatedSdkRuntime = resolvedRuntime
        delegatedProviderId = providerId
      }
    }
    // The Agent SDK owns its own wall-clock timeout so it can distinguish a
    // runtime deadline from a user cancellation. Starting this native timer
    // for the delegated path races that SDK timer and turns deadline failures
    // into misleading `aborted` turns.
    const configuredWallTimeMs = normalizeTurnLimits(this.opts.turnLimits).maxWallTimeMs
    const maxWallTimeMs = owningThread?.extensionBudget
      ? Math.min(configuredWallTimeMs, owningThread.extensionBudget.maxElapsedMs)
      : configuredWallTimeMs
    let wallTimeExceeded = false
    let deadline: ReturnType<typeof setTimeout> | undefined
    if (!delegatedSdkRuntime && this.opts.disableWallTimeLimit !== true) {
      deadline = setTimeout(() => {
        void (async () => {
          const graphRunOwnsLimit =
            owningThread?.extensionBudget === undefined &&
            await this.opts.turns.graphRunOwnsLeadLimits({ threadId, turnId })
          if (graphRunOwnsLimit) return
          wallTimeExceeded = true
          this.opts.turns.abortTurnExecution(turnId)
        })().catch(() => {
          wallTimeExceeded = true
          this.opts.turns.abortTurnExecution(turnId)
        })
      }, maxWallTimeMs)
      if (typeof (deadline as { unref?: () => void }).unref === 'function') {
        ;(deadline as { unref: () => void }).unref()
      }
    }
    let goalTimer: GoalElapsedTimer | null = null
    let suspended = false
    const failWallTimeLimit = async (): Promise<TurnExecutionStatus> => {
      const extensionLimited = Boolean(
        owningThread?.extensionBudget && owningThread.extensionBudget.maxElapsedMs <= configuredWallTimeMs
      )
      const code = extensionLimited ? 'extension_budget_exhausted' : 'turn_wall_time_limit'
      const message = extensionLimited
        ? `Extension elapsed-time budget exhausted after ${maxWallTimeMs}ms.`
        : `turn exceeded ${maxWallTimeMs}ms wall time`
      this.rememberTurnFailure(turnId, {
        error: message,
        code,
        severity: 'warning'
      })
      await this.recordTurnLimitExceeded(threadId, turnId, code, message)
      const settlement = await settle({
        status: 'failed',
        error: message,
        code,
        severity: 'warning'
      })
      finalStatus = statusFromSettlement(settlement, 'failed')
      finalError = errorFromSettlement(settlement)
      return finalStatus
    }
    try {
      goalTimer = await this.goalTurns.begin(threadId)
      await this.recordPipelineStage(threadId, turnId, 'setup')
      if (!delegatedSdkRuntime && this.opts.toolStorm?.enabled !== false) {
        this.toolStormBreakers.set(turnId, new ToolStormBreaker(this.opts.toolStorm))
      }
      await this.recordPipelineStage(threadId, turnId, 'pre_start')
      const resumedGraphLead = owningThread?.turns
        .find((candidate) => candidate.id === turnId)
        ?.graphLeadLifecycle?.resumedAt !== undefined
      const denial = resumedGraphLead
        ? undefined
        : await runTurnStartLifecycleHooks(this.lifecycleHookDeps(), { threadId, turnId })
      if (denial) {
        await this.opts.events.record({
          kind: 'error',
          threadId,
          turnId,
          message: denial,
          code: 'hook_denied',
          severity: 'error'
        })
        await this.opts.turns.applyItem(
          threadId,
          makeErrorItem({
            id: this.opts.ids.next('item_error'),
            turnId,
            threadId,
            message: denial,
            code: 'hook_denied',
            severity: 'error'
          })
        )
        const settlement = await settle({ status: 'failed', error: denial })
        finalStatus = statusFromSettlement(settlement, 'failed')
        finalError = errorFromSettlement(settlement)
        return finalStatus
      }
      await this.drainSteering(threadId, turnId, signal)
      await this.recordPipelineStage(threadId, turnId, 'post_start')
      // Fire-and-forget: start LLM title generation as soon as the first-turn
      // user message is in place, in parallel with the main reply. Only uses
      // user input; never blocks the agent loop.
      if (!resumedGraphLead) {
        void this.threadTitle.generateAfterTurn(threadId, turnId, signal).catch(() => {})
      }
      if (delegatedSdkRuntime) {
        // The delegated SDK owns its model stream and cannot consume Kun's
        // native tool mutation gate. Preserve snapshot-before-mutation safety
        // by resolving a pending desktop checkpoint before handing it control.
        const checkpointRequestId = owningThread?.turns
          .find((candidate) => candidate.id === turnId)
          ?.workspaceCheckpointRequestId
        if (checkpointRequestId && this.opts.awaitWorkspaceCheckpoint) {
          const checkpointId = await this.opts.awaitWorkspaceCheckpoint(checkpointRequestId, signal)
          if (checkpointId) {
            await this.opts.turns.updateTurnMetadata(threadId, turnId, {
              workspaceCheckpointId: checkpointId
            })
            await this.opts.turns.updateItem(threadId, `item_${turnId}_user`, {
              workspaceCheckpointId: checkpointId
            })
          }
        }
        // Drain anything that arrived before startup, then seal admission so
        // later guidance remains renderer-owned.
        await this.drainAndSealSteering(threadId, turnId, signal)
        const reportedStatus = await delegatedSdkRuntime.runTurn(
          threadId,
          turnId,
          signal,
          delegatedProviderId
        )
        if (
          reportedStatus === 'suspended' ||
          reportedStatus === 'suspended_pending_supervision'
        ) {
          suspended = true
          return reportedStatus
        }
        if (isHostShutdownTurnSuspension(signal)) {
          suspended = true
          return 'suspended'
        }
        const ownerLeaseFailure = await failOwnerLease()
        if (ownerLeaseFailure) return ownerLeaseFailure
        const settlement = await finalizer.observeExternal({ threadId, turnId })
        finalStatus = statusFromSettlement(settlement, reportedStatus)
        finalError = errorFromSettlement(settlement)
        return finalStatus
      }
      const status = await this.loop(threadId, turnId, signal)
      if (
        status === 'suspended' ||
        status === 'suspended_pending_supervision'
      ) {
        suspended = true
        return status
      }
      if (isHostShutdownTurnSuspension(signal)) {
        suspended = true
        return 'suspended'
      }
      if (wallTimeExceeded) return failWallTimeLimit()
      const ownerLeaseFailure = await failOwnerLease()
      if (ownerLeaseFailure) return ownerLeaseFailure
      // An aborted turn (user stop / tool cancel / host shutdown) must settle
      // as `aborted` even when a racing provider disconnect error reached the
      // loop first and classified the round as `failed`. The abort owns the
      // terminal outcome; its raw transport message must not become a
      // turn_failed error card.
      if (status === 'failed' && signal.aborted && !isHostShutdownTurnSuspension(signal)) {
        const settlement = await settle({ status: 'aborted' })
        finalStatus = statusFromSettlement(settlement, 'aborted')
        finalError = errorFromSettlement(settlement)
        return finalStatus
      }
      const failure = status === 'failed' ? this.turnFailures.get(turnId) : undefined
      const disconnectRewrite = failure ? rewriteStreamDisconnectFailure(failure) : null
      const settlement = await settle({
        status,
        ...(disconnectRewrite ?? failure ?? {})
      })
      finalStatus = statusFromSettlement(settlement, status)
      finalError = errorFromSettlement(settlement)
      return finalStatus
    } catch (error) {
      if (wallTimeExceeded) return failWallTimeLimit()
      if (signal.aborted) {
        if (isHostShutdownTurnSuspension(signal)) {
          suspended = true
          return 'suspended'
        }
        const ownerLeaseFailure = await failOwnerLease()
        if (ownerLeaseFailure) return ownerLeaseFailure
        const settlement = await settle({ status: 'aborted' })
        finalStatus = statusFromSettlement(settlement, 'aborted')
        finalError = errorFromSettlement(settlement)
        return finalStatus
      }
      const raw = error instanceof Error ? error.message : String(error)
      // Best-effort enrichment so the renderer can show "what failed where"
      // instead of the bare "Kun turn failed" string. See issue #26.
      const thread = await this.opts.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      const modelName = turn?.model?.trim() || thread?.model?.trim() || this.opts.model.model || 'unknown'
      const providerId = turn?.providerId?.trim() || thread?.providerId?.trim()
      const diagnostics = modelClientDiagnostics(this.opts.model, providerId)
      const stack = error instanceof Error
        ? (error.stack?.split('\n').slice(0, 3).join(' | ') ?? '')
        : ''
      const message = [
        '[Kun turn failed]',
        `turn=${turnId}`,
        `thread=${threadId}`,
        `model=${modelName}`,
        `providerId=${providerId || 'default'}`,
        diagnostics.providerBaseUrl ? `baseUrl=${diagnostics.providerBaseUrl}` : '',
        diagnostics.endpointFormat ? `endpointFormat=${diagnostics.endpointFormat}` : '',
        `error=${raw}`,
        stack ? `stack=${stack}` : ''
      ].filter(Boolean).join(' ')
      const settlement = await settle({ status: 'failed', error: message })
      finalStatus = statusFromSettlement(settlement, 'failed')
      finalError = errorFromSettlement(settlement)
      return finalStatus
    } finally {
      if (deadline !== undefined) clearTimeout(deadline)
      try {
        // Accounting/resume are post-settlement conveniences. A late store or
        // event failure must not hide an already durable terminal outcome, nor
        // skip the unconditional transient-state cleanup below.
        if (suspended) {
          await this.goalTurns.afterSuspended(threadId, goalTimer)
        } else {
          await this.goalTurns.afterTerminal({
            threadId,
            turnId,
            finalStatus: finalStatus ?? 'failed',
            timer: goalTimer
          })
        }
      } finally {
        this.modelRouting.clear(threadId, turnId)
        this.toolStormBreakers.delete(turnId)
        this.modelRoundEngine.clearTurn(turnId)
        this.roundOutcome.clearTurn(turnId)
        this.goalTurns.clearTurn(turnId)
        if (typeof this.opts.skillRuntime?.clearTurnActivation === 'function') {
          this.opts.skillRuntime.clearTurnActivation(threadId, turnId)
        }
        this.turnFailures.delete(turnId)
        this.telemetry.clearPromptPressure(threadId)
        if (!suspended) {
          await runTurnEndLifecycleHooks(this.lifecycleHookDeps(), {
            threadId,
            turnId,
            status: finalStatus ?? 'failed',
            ...(finalError ? { error: finalError } : {})
          })
        }
      }
    }
  }
}

function activeTurnRunKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}
