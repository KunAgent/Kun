import type { ModelRoundOutcome, TurnRunOutcome } from './turn-execution-types.js'
import { makeErrorItem } from '../domain/item.js'
import { normalizeTurnLimits } from './turn-limits.js'
import { AgentLoopTurnLifecycle } from './agent-loop-turn-lifecycle.js'
import { STREAM_DISCONNECTED_CODE } from './stream-disconnection-failure.js'

const RECOVERABLE_GRAPH_LEAD_MODEL_FAILURE_CODES = new Set([
  'stream_idle_timeout',
  'stream_read_error',
  'stream_truncated',
  STREAM_DISCONNECTED_CODE
])

// A GraphRun may live for hours, but one process-local Lead wake-up must not.
// Durable Graph events can start a fresh episode after this one releases its
// lease. This cap is intentionally independent of ToolStormBreaker because a
// confused Lead can alternate valid, non-identical tools forever.
const GRAPH_LEAD_EPISODE_MAX_MODEL_STEPS = 8
const GRAPH_LEAD_EPISODE_MAX_ELAPSED_MS = 10 * 60_000

export class AgentLoopExecution extends AgentLoopTurnLifecycle {
  protected async loop(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<TurnRunOutcome> {
    const configuredLimits = normalizeTurnLimits(this.opts.turnLimits)
    const thread = await this.opts.threadStore.get(threadId)
    const limits = thread?.extensionBudget
      ? {
          ...configuredLimits,
          maxSteps: configuredLimits.maxSteps === undefined
            ? thread.extensionBudget.maxModelRequests
            : Math.min(configuredLimits.maxSteps, thread.extensionBudget.maxModelRequests),
          maxWallTimeMs: Math.min(configuredLimits.maxWallTimeMs, thread.extensionBudget.maxElapsedMs)
        }
      : configuredLimits
    const graphRunOwnsLimits = async (): Promise<boolean> =>
      thread?.extensionBudget === undefined &&
      await this.opts.turns.graphRunOwnsLeadLimits({ threadId, turnId })
    const startedAt = this.opts.nowMs?.() ?? Date.now()
    let graphSupervisionReminderUsed = false
    let graphLeadEpisodeStartedAt: number | undefined
    let graphLeadEpisodeModelSteps = 0
    for (let step = 0; ; step += 1) {
      if (signal.aborted) {
        await this.drainAndSealSteering(threadId, turnId, signal)
        return 'aborted'
      }
      const now = this.opts.nowMs?.() ?? Date.now()
      const graphLeadEpisodeActive = await graphRunOwnsLimits()
      if (graphLeadEpisodeActive && graphLeadEpisodeStartedAt === undefined) {
        graphLeadEpisodeStartedAt = now
      }
      if (
        graphLeadEpisodeActive &&
        (
          graphLeadEpisodeModelSteps >= GRAPH_LEAD_EPISODE_MAX_MODEL_STEPS ||
          now - (graphLeadEpisodeStartedAt ?? now) >= GRAPH_LEAD_EPISODE_MAX_ELAPSED_MS
        )
      ) {
        const parked = await this.opts.turns.suspendGraphLeadTurn({
          threadId,
          turnId,
          force: true,
          preserveDeliveryCursor: true,
          allowPendingSupervision: true
        })
        if (
          parked === 'suspended' ||
          parked === 'suspended_pending_supervision'
        ) return parked
        // The run can become terminal between the ownership check and the
        // suspension fence. Give that terminal state its normal finalization
        // path instead of spinning forever on an already-consumed episode.
        graphLeadEpisodeStartedAt = undefined
        graphLeadEpisodeModelSteps = 0
      }
      if (
        limits.maxSteps !== undefined &&
        step >= limits.maxSteps &&
        !graphLeadEpisodeActive
      ) {
        await this.drainAndSealSteering(threadId, turnId, signal)
        const extensionLimited = Boolean(
          thread?.extensionBudget && (
            configuredLimits.maxSteps === undefined ||
            thread.extensionBudget.maxModelRequests <= configuredLimits.maxSteps
          )
        )
        await this.recordTurnLimitExceeded(
          threadId,
          turnId,
          extensionLimited ? 'extension_budget_exhausted' : 'turn_step_limit',
          extensionLimited
            ? `Extension model-request budget exhausted after ${limits.maxSteps} requests.`
            : `turn exceeded ${limits.maxSteps} model steps`
        )
        return 'failed'
      }
      if (
        this.opts.disableWallTimeLimit !== true &&
        now - startedAt >= limits.maxWallTimeMs &&
        !graphLeadEpisodeActive
      ) {
        await this.drainAndSealSteering(threadId, turnId, signal)
        const extensionLimited = Boolean(
          thread?.extensionBudget && thread.extensionBudget.maxElapsedMs <= configuredLimits.maxWallTimeMs
        )
        await this.recordTurnLimitExceeded(
          threadId,
          turnId,
          extensionLimited ? 'extension_budget_exhausted' : 'turn_wall_time_limit',
          extensionLimited
            ? `Extension elapsed-time budget exhausted after ${limits.maxWallTimeMs}ms.`
            : `turn exceeded ${limits.maxWallTimeMs}ms wall time`
        )
        return 'failed'
      }
      await this.drainSteering(threadId, turnId, signal)
      let stepResult: ModelRoundOutcome
      if (graphLeadEpisodeActive && graphLeadEpisodeStartedAt !== undefined) {
        const deadlineAt = graphLeadEpisodeStartedAt + GRAPH_LEAD_EPISODE_MAX_ELAPSED_MS
        const scopedController = new AbortController()
        const abortScopedStep = () => scopedController.abort(signal.reason)
        if (signal.aborted) abortScopedStep()
        else signal.addEventListener('abort', abortScopedStep, { once: true })
        let episodeDeadlineExceeded = false
        const deadline = setTimeout(() => {
          episodeDeadlineExceeded = true
          scopedController.abort()
        }, Math.max(1, deadlineAt - (this.opts.nowMs?.() ?? Date.now())))
        if (typeof (deadline as { unref?: () => void }).unref === 'function') {
          ;(deadline as { unref: () => void }).unref()
        }
        try {
          stepResult = await this.modelStep(
            threadId,
            turnId,
            scopedController.signal,
            step,
            limits.maxToolCallsPerStep
          )
        } finally {
          clearTimeout(deadline)
          signal.removeEventListener('abort', abortScopedStep)
        }
        graphLeadEpisodeModelSteps += 1
        if (
          !signal.aborted &&
          (
            episodeDeadlineExceeded ||
            (this.opts.nowMs?.() ?? Date.now()) >= deadlineAt
          )
        ) {
          const parked = await this.opts.turns.suspendGraphLeadTurn({
            threadId,
            turnId,
            force: true,
            preserveDeliveryCursor: true,
            allowPendingSupervision: true
          })
          if (
            parked === 'suspended' ||
            parked === 'suspended_pending_supervision'
          ) return parked
        }
      } else {
        stepResult = await this.modelStep(
          threadId,
          turnId,
          signal,
          step,
          limits.maxToolCallsPerStep
        )
      }
      if (stepResult === 'stop') {
        const graphSuspension = await this.opts.turns.suspendGraphLeadTurn({
          threadId,
          turnId
        })
        if (
          graphSuspension === 'suspended' ||
          graphSuspension === 'suspended_pending_supervision'
        ) return graphSuspension
        if (graphSuspension === 'pending_steering') continue
        if (graphSuspension === 'supervision_pending') {
          if (!graphSupervisionReminderUsed) {
            graphSupervisionReminderUsed = true
            try {
              await this.opts.turns.steerTurn({
                threadId,
                turnId,
                messageSource: 'graph_runtime',
                text: [
                  'Host supervision gate: this Graph still has unresolved durable work.',
                  'Inspect its current node and attempt status before ending this Lead slice.',
                  'Use `graph_review_node` only for submitted/reviewing attempts.',
                  'For an exhausted failed or repair-required node, use `graph_patch_run` to create a semantic replacement instead of reviewing it again.'
                ].join(' ')
              })
              continue
            } catch {
              // A concurrent shutdown or user steering may close admission.
              // Fall through to a cursor-preserving suspension.
            }
          }
          const parked = await this.opts.turns.suspendGraphLeadTurn({
            threadId,
            turnId,
            allowPendingSupervision: true,
            preserveDeliveryCursor: true
          })
          if (
            parked === 'suspended' ||
            parked === 'suspended_pending_supervision'
          ) return parked
          if (parked === 'pending_steering') continue
        }
        // Either accepted guidance wins and forces another model interaction,
        // or the synchronous seal wins and late steer requests are rejected.
        if (this.opts.steering.sealIfEmpty(turnId)) return 'completed'
        continue
      }
      if (stepResult === 'failed') {
        const failure = this.turnFailures.get(turnId)
        if (
          failure?.code &&
          RECOVERABLE_GRAPH_LEAD_MODEL_FAILURE_CODES.has(failure.code)
        ) {
          const activeTurn = await this.opts.turns.getTurn(threadId, turnId)
          if (activeTurn?.status === 'running' && activeTurn.orchestration === 'graph') {
            // The stream error event is durable, but thread rehydration is
            // item-based. Persist before releasing the execution lease so a
            // concurrent Graph wake-up cannot reuse this runner while it is
            // still appending the diagnostic.
            await this.opts.turns.applyItem(
              threadId,
              makeErrorItem({
                id: `item_${turnId}_error`,
                turnId,
                threadId,
                message: failure.error,
                code: failure.code,
                ...(failure.details !== undefined ? { details: failure.details } : {}),
                ...(failure.modelRequestFailure
                  ? { modelRequestFailure: failure.modelRequestFailure }
                  : {}),
                severity: failure.severity ?? 'error'
              })
            ).catch(() => undefined)
          }
          const graphSuspension = await this.opts.turns.suspendGraphLeadTurn({
            threadId,
            turnId
          })
          if (graphSuspension !== 'not_graph') {
            if (
              graphSuspension === 'suspended' ||
              graphSuspension === 'suspended_pending_supervision'
            ) return graphSuspension
            if (graphSuspension === 'supervision_pending') {
              const parked = await this.opts.turns.suspendGraphLeadTurn({
                threadId,
                turnId,
                allowPendingSupervision: true,
                preserveDeliveryCursor: true
              })
              if (
                parked === 'suspended' ||
                parked === 'suspended_pending_supervision'
              ) return parked
            }
            // Accepted guidance wins the suspension race, and a terminal Graph
            // still needs its source Lead to synthesize the final response.
            if (
              graphSuspension === 'pending_steering' ||
              graphSuspension === 'graph_terminal'
            ) {
              this.turnFailures.delete(turnId)
              continue
            }
          }
        }
        await this.drainAndSealSteering(threadId, turnId, signal)
        return stepResult
      }
      if (stepResult === 'aborted') {
        await this.drainAndSealSteering(threadId, turnId, signal)
        return stepResult
      }
    }
  }
}
