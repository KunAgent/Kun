import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import type { TurnClientSurface } from '../contracts/turns.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelToolSpec } from '../ports/model-client.js'
import type { SessionStore } from '../ports/session-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { rewriteItemHistoryWithRetry } from '../services/history-commit-coordinator.js'
import type { UsageService } from '../services/usage-service.js'
import {
  hasHooksForPhase,
  runObserverHooks,
  type ResolvedHook
} from '../hooks/hook-engine.js'
import {
  effectiveHistoryAfterLatestCompaction,
  insertCompactionIntoVisibleHistory
} from './compaction-history.js'
import { resolveCompactionModel, summarizeCompactionWithModel } from './compaction-summary.js'
import { ContextCompactor } from './context-compactor.js'
import { repairModelHistoryItemsForModel } from '../domain/model-history-repair.js'
import { recordLifecycleHookWarnings } from './turn-lifecycle-hooks.js'
import type { ContextCompactionConfig } from './model-context-profile.js'
import { estimateRequestOverheadTokens } from './model-request-estimator.js'
import type { LoopTelemetry } from './loop-telemetry.js'
import { extractSkillPins } from './context-compactor.js'

export type HistoryCompactionServiceDeps = {
  sessionStore: SessionStore
  compactor: ContextCompactor
  prefix: ImmutablePrefix
  model: ModelClient
  usage: UsageService
  events: RuntimeEventRecorder
  ids: IdGenerator
  telemetry: Pick<LoopTelemetry, 'consumePromptPressure'>
  recordGoalUsage: (threadId: string, tokens: number) => Promise<void>
  /** Read live runtime config so hot-apply affects future compactions. */
  getContextCompaction?: () => ContextCompactionConfig | undefined
  /** Read live runtime hooks so hot-apply affects future compactions. */
  getHooks?: () => readonly ResolvedHook[] | undefined
  clearReadTracker?: (threadId?: string) => void
  rewriteThreadItemsFromSession: (threadId: string) => Promise<void>
  /** Resolves the model context window used for ratio-based tail budgets. */
  contextWindowTokens?: (model: string, providerId?: string) => number
}

export type HistoryCompactionOutcome = {
  history: TurnItem[]
  /** A compaction plan was produced (input or budget threshold reached). */
  triggered: boolean
  /** A plan was committed and actually replaced history tokens. */
  compacted: boolean
  replacedTokens: number
}

/**
 * Applies automatic history compaction through the revision-aware coordinator.
 * The service never retries model/tool work after a lost history CAS: only the
 * pure heuristic transform is rebuilt from the latest persisted snapshot.
 */
export class HistoryCompactionService {
  constructor(private readonly deps: HistoryCompactionServiceDeps) {}

  /**
   * Resolve the verbatim-tail token budget from live config. An absolute
   * target wins over the ratio; both are bounded to a sane fraction of the
   * model's context window so the tail cannot re-pin the request near the
   * compaction threshold.
   */
  private tailTokenBudget(model?: string, providerId?: string): number | undefined {
    const config = this.deps.getContextCompaction?.()
    if (config?.targetInputTokens !== undefined) {
      return Math.max(1, Math.floor(config.targetInputTokens))
    }
    if (config?.targetInputRatio !== undefined) {
      const window = this.deps.contextWindowTokens?.(model ?? '', providerId) ??
        this.deps.compactor.hardCap(model, providerId)
      return Math.max(1, Math.floor(window * Math.min(1, Math.max(0, config.targetInputRatio))))
    }
    return undefined
  }

  async compactIfNeeded(input: {
    items: TurnItem[]
    model: string
    providerId?: string
    accountId?: string
    serviceTier?: 'priority'
    signal: AbortSignal
    threadId: string
    turnId: string
    clientSurface?: TurnClientSurface
    toolSpecs?: readonly ModelToolSpec[]
    /**
     * Complete non-history token estimate from the request that is about to be
     * sent. When supplied this is authoritative over the legacy prefix/tool
     * fallback so dynamic instructions, skills, and attachments participate
     * in the compaction preflight.
     */
    requestOverheadTokens?: number
    /**
     * Exact local input-token estimate of the already-constructed request.
     * Acts as a floor on input pressure so compaction cannot under-count
     * dynamic context, attachments, or tools that live outside stored items.
     */
    requestInputTokens?: number
    /** Tokens reserved for model output; mirrors the send-time guard. */
    outputBudgetTokens?: number
    /** Hard cap shared with the send-time `input + output` guard. */
    requestHardCapTokens?: number
    /**
     * When false, skip the model-backed summary (no reservation and no
     * summarizer request) and commit the deterministic heuristic directly.
     * Used by the send-boundary fallback so a second model call cannot be
     * issued just to make room for the first one. Defaults to true.
     */
    allowModelSummary?: boolean
    reserveModelRequest?: () => Promise<{ allowed: boolean; reason?: string }>
    /** Provider overflow recovery bypasses thresholds but still performs one bounded compaction. */
    force?: { reason: string; keepRecent?: number }
  }): Promise<HistoryCompactionOutcome> {
    const pressure = this.deps.telemetry.consumePromptPressure(input.threadId, input.model)
    const thresholdModel = pressure?.model || input.model
    const overheadTokens = input.requestOverheadTokens === undefined
      ? estimateRequestOverheadTokens({
          systemPrompt: this.deps.prefix.systemPrompt,
          prefix: this.deps.prefix.fewShots,
          tools: input.toolSpecs
        })
      : Math.max(0, Math.floor(input.requestOverheadTokens))
    const plan = input.force ? {
      mode: 'force' as const,
      keepRecent: Math.max(0, input.force.keepRecent ?? 1),
      reason: input.force.reason
    } : this.deps.compactor.planCompaction(input.items, {
      model: thresholdModel,
      providerId: input.providerId,
      promptTokens: pressure?.promptTokens,
      overheadTokens,
      requestInputTokens: input.requestInputTokens,
      outputBudgetTokens: input.outputBudgetTokens,
      requestHardCapTokens: input.requestHardCapTokens
    })
    if (!plan) {
      return {
        history: input.items,
        triggered: false,
        compacted: false,
        replacedTokens: 0
      }
    }
    const hooks = this.deps.getHooks?.()
    if (hasHooksForPhase(hooks, 'PreCompact')) {
      const observed = await runObserverHooks(hooks, {
        phase: 'PreCompact',
        threadId: input.threadId,
        turnId: input.turnId,
        reason: String(plan.reason),
        mode: String(plan.mode),
        ...(input.clientSurface ? { clientSurface: input.clientSurface } : {})
      })
      await recordLifecycleHookWarnings(
        this.deps.events,
        { threadId: input.threadId, turnId: input.turnId },
        observed.warnings
      )
    }
    const summaryItemId = this.deps.ids.next('compaction')
    // model_context deltas folded into a canonical baseline by the winning
    // build attempt; surfaced on the completion event for diagnostics.
    let squashed = 0
    const committed = await rewriteItemHistoryWithRetry<{
      history: TurnItem[]
      result: ReturnType<ContextCompactor['compact']> | null
    }>({
      sessionStore: this.deps.sessionStore,
      threadId: input.threadId,
      maxAttempts: 2,
      build: async (snapshot, attempt) => {
        const currentItems = repairModelHistoryItemsForModel(
          effectiveHistoryAfterLatestCompaction(snapshot.items)
        )
        const currentPlan = input.force
          ? {
              mode: 'force' as const,
              keepRecent: Math.max(0, input.force.keepRecent ?? 1),
              reason: input.force.reason
            }
          : attempt === 1
          ? plan
          : this.deps.compactor.planCompaction(currentItems, {
              model: thresholdModel,
              providerId: input.providerId,
              overheadTokens,
              // Provider usage from the stale snapshot is dropped on retry,
              // but this round's capacity constraints must survive the retry
              // so the budget-driven force compaction still applies.
              requestInputTokens: input.requestInputTokens,
              outputBudgetTokens: input.outputBudgetTokens,
              requestHardCapTokens: input.requestHardCapTokens
            })
        if (!currentPlan) {
          return {
            changed: false,
            items: snapshot.items,
            value: { history: currentItems, result: null }
          }
        }
        let result = this.deps.compactor.compact({
          threadId: input.threadId,
          turnId: input.turnId,
          history: currentItems,
          prefix: this.deps.prefix,
          reason: currentPlan.reason,
          mode: currentPlan.mode,
          keepRecent: currentPlan.keepRecent,
          summaryItemId,
          ...(this.tailTokenBudget(input.model, input.providerId) !== undefined
            ? { tailTokenBudget: this.tailTokenBudget(input.model, input.providerId) }
            : {})
        })
        if (result.replacedTokens === 0) {
          return {
            changed: false,
            items: snapshot.items,
            value: { history: currentItems, result: null }
          }
        }
        // A model summary generated for a stale snapshot must not be applied
        // to newer history. On retry the deterministic heuristic is used
        // instead of issuing a duplicate summarizer request.
        const contextCompaction = this.deps.getContextCompaction?.()
        if (attempt === 1 && input.allowModelSummary !== false && contextCompaction?.summaryMode === 'model') {
          if (input.signal.aborted) {
            return {
              changed: false,
              items: snapshot.items,
              value: { history: currentItems, result: null }
            }
          }
          const compactionModel = resolveCompactionModel({
            contextCompaction,
            fallbackModel: input.model,
            fallbackProviderId: input.providerId,
            fallbackAccountId: input.accountId
          })
          const recordFallback = async (message: string): Promise<void> => {
            await this.deps.events.record({
              kind: 'error',
              threadId: input.threadId,
              turnId: input.turnId,
              message,
              code: 'compaction_summary_fallback',
              severity: 'warning'
            })
          }
          let modelSummary: string | undefined
          if (compactionModel.bindingError) {
            await recordFallback(compactionModel.bindingError)
          } else {
            const reservation = await input.reserveModelRequest?.() ?? { allowed: true }
            if (!reservation.allowed) {
              await recordFallback(
                reservation.reason
                  ? `${reservation.reason} Model compaction summary was not sent; using heuristic summary.`
                  : 'Model compaction summary skipped because its model-request budget is exhausted; using heuristic summary.'
              )
            } else {
              const foldedItemIds = new Set(
                result.summaryItem.kind === 'compaction'
                  ? result.summaryItem.sourceItemIds ?? []
                  : []
              )
              // The compaction summary is sent alongside the retained tail in
              // the main request. Feed only the folded source items to the
              // summarizer so the latest user instruction is not reproduced
              // inside both the summary and the verbatim tail.
              const summaryItems = currentItems.filter((item) => foldedItemIds.has(item.id))
              if (summaryItems.length === 0) {
                await recordFallback(
                  'Model compaction summary skipped because no folded source items were available; using heuristic summary.'
                )
              } else {
                modelSummary = await summarizeCompactionWithModel({
                  threadId: input.threadId,
                  turnId: input.turnId,
                  model: compactionModel.model,
                  ...(compactionModel.providerId ? { providerId: compactionModel.providerId } : {}),
                  ...(compactionModel.accountId ? { accountId: compactionModel.accountId } : {}),
                  ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
                  modelClient: this.deps.model,
                  prefix: this.deps.prefix,
                  contextCompaction,
                  items: summaryItems,
                  pinnedSkillPins: extractSkillPins(summaryItems),
                  heuristicSummary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
                  signal: input.signal,
                  recordUsage: async (usageSnapshot) => {
                    const usage = this.deps.usage.record(input.threadId, usageSnapshot)
                    await this.deps.recordGoalUsage(input.threadId, usageSnapshot.totalTokens)
                    await this.deps.events.record({
                      kind: 'usage',
                      threadId: input.threadId,
                      turnId: input.turnId,
                      model: compactionModel.model,
                      ...(compactionModel.providerId ? { providerId: compactionModel.providerId } : {}),
                      ...(compactionModel.accountId ? { accountId: compactionModel.accountId } : {}),
                      usage
                    })
                  },
                  recordFallback
                })
              }
            }
          }
          if (input.signal.aborted) {
            return {
              changed: false,
              items: snapshot.items,
              value: { history: currentItems, result: null }
            }
          }
          if (modelSummary) {
            result = this.deps.compactor.compact({
              threadId: input.threadId,
              turnId: input.turnId,
              history: currentItems,
              prefix: this.deps.prefix,
              reason: currentPlan.reason,
              mode: currentPlan.mode,
              keepRecent: currentPlan.keepRecent,
              summaryOverride: modelSummary,
              summaryItemId
            })
          }
        }
        const nextItems = insertCompactionIntoVisibleHistory({
          visibleItems: snapshot.items,
          compactedItems: result.next,
          summaryItem: result.summaryItem,
          threadId: input.threadId,
          activeTurnId: input.turnId,
          nowIso: () => new Date().toISOString()
        })
        squashed = nextItems.filter((item) => item.kind === 'model_context' && item.baseline).length > 0
          ? Math.max(0, snapshot.items.filter((item) => item.kind === 'model_context').length -
              nextItems.filter((item) => item.kind === 'model_context').length + 1)
          : 0
        return {
          changed: true,
          items: nextItems,
          value: { history: result.next, result }
        }
      }
    })
    if (committed.status === 'applied') {
      const result = committed.value.result
      if (result) {
        this.deps.clearReadTracker?.(input.threadId)
        await this.deps.rewriteThreadItemsFromSession(input.threadId)
        await this.deps.events.record({
          kind: 'compaction_completed',
          threadId: input.threadId,
          turnId: input.turnId,
          itemId: result.summaryItem.id,
          summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
          replacedTokens: result.replacedTokens,
          pinnedConstraints: this.deps.prefix.pinnedConstraints,
          contextEstimate: this.deps.compactor.estimate(committed.value.history),
          ...(this.tailTokenBudget(input.model, input.providerId) !== undefined
            ? { tailTokenBudget: this.tailTokenBudget(input.model, input.providerId)! }
            : {}),
          ...(squashed > 0 ? { squashedContextItems: squashed } : {}),
          ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceDigest
            ? { sourceDigest: result.summaryItem.sourceDigest }
            : {}),
          ...(result.summaryItem.kind === 'compaction' && result.summaryItem.digestMarker
            ? { digestMarker: result.summaryItem.digestMarker }
            : {}),
          ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
            ? { sourceItemIds: result.summaryItem.sourceItemIds }
            : {})
        })
      }
      return {
        history: committed.value.history,
        triggered: true,
        compacted: result ? result.replacedTokens > 0 : false,
        replacedTokens: result?.replacedTokens ?? 0
      }
    }
    if (committed.status === 'unchanged') {
      return {
        history: committed.value.history,
        triggered: true,
        compacted: false,
        replacedTokens: 0
      }
    }
    // Do not fall back to the stale input after a lost CAS race. The next
    // loop step can retry compaction from this current safe history.
    return {
      history: repairModelHistoryItemsForModel(
        effectiveHistoryAfterLatestCompaction(await this.deps.sessionStore.loadItems(input.threadId))
      ),
      triggered: true,
      compacted: false,
      replacedTokens: 0
    }
  }
}
