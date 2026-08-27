import type { TurnItem } from '../contracts/items.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import { makeCompactionItem } from '../domain/item.js'
import { ContextEstimator } from './context-estimator.js'
import {
  compactedItemsDigestSource,
  computeShortHash,
  createToolDigestMarker
} from './compaction-marker.js'
import {
  DEFAULT_CONTEXT_THRESHOLDS,
  contextThresholdsForModel,
  modelContextProfilesFromConfig,
  type ContextCompactionConfig,
  type ModelConfig,
  type ModelContextProfile,
  type ModelContextThresholds
} from './model-context-profile.js'
import {
  aggressiveCompactionThreshold,
  appendDigestMarker,
  buildCompactionSummary,
  extractSkillPins,
  finiteNonNegative,
  normalizeFrozenMessageCount,
  repairTailStartForToolResults,
  trimTrailingToolCalls,
  trustworthyPromptTokens
} from './context-compactor-helpers.js'
export {
  PROMPT_TOKEN_TRUST_FACTOR,
  type CompactionMode,
  type CompactionPlan,
  type CompactionTriggerOptions
} from './context-compactor-types.js'
import type {
  CompactionMode,
  CompactionPlan,
  CompactionTriggerOptions
} from './context-compactor-types.js'

/**
 * ContextCompactor folds long histories into a single compaction item
 * while preserving pinned user, project, and skill constraints from
 * the immutable prefix. Compaction is triggered by either an explicit
 * `compact()` call or a heuristic on estimated prompt tokens.
 */
export class ContextCompactor {
  private readonly estimator: ContextEstimator
  private readonly softThreshold: number
  private readonly hardThreshold: number
  private readonly modelProfiles: readonly ModelContextProfile[]
  private readonly profilesForProvider?: (
    providerId: string | undefined
  ) => readonly ModelContextProfile[]

  constructor(options?: {
    estimator?: ContextEstimator
    softThreshold?: number
    hardThreshold?: number
    contextCompaction?: ContextCompactionConfig
    models?: ModelConfig
    profilesForProvider?: (
      providerId: string | undefined
    ) => readonly ModelContextProfile[]
  }) {
    const contextCompaction = options?.contextCompaction
    this.estimator = options?.estimator ?? new ContextEstimator()
    this.softThreshold =
      options?.softThreshold ??
      contextCompaction?.defaultSoftThreshold ??
      DEFAULT_CONTEXT_THRESHOLDS.softThreshold
    this.hardThreshold =
      options?.hardThreshold ??
      contextCompaction?.defaultHardThreshold ??
      DEFAULT_CONTEXT_THRESHOLDS.hardThreshold
    this.modelProfiles = modelContextProfilesFromConfig({
      contextCompaction,
      models: options?.models
    })
    this.profilesForProvider = options?.profilesForProvider
  }

  estimate(items: TurnItem[]): number {
    return this.estimator.estimateItems(items)
  }

  shouldCompact(items: TurnItem[], options?: CompactionTriggerOptions): boolean {
    return this.planCompaction(items, options) !== null
  }

  planCompaction(items: TurnItem[], options?: CompactionTriggerOptions): CompactionPlan | null {
    const thresholds = this.thresholds(options?.model, options?.providerId)
    const frozenMessageCount = normalizeFrozenMessageCount(options?.frozenMessageCount, items.length)
    const compactableItems = frozenMessageCount > 0 ? items.slice(frozenMessageCount) : items
    // `overheadTokens` accounts for the system prompt and tool schemas that
    // are sent every turn but live outside the stored items. Without it the
    // estimate-only path (used when no provider usage count is available,
    // e.g. the first turn after a restart) systematically under-counts and
    // skips compaction. It is a floor on the estimate; the real
    // `promptTokens` still wins via the Math.max below when present.
    const overheadTokens = Math.max(0, Math.floor(options?.overheadTokens ?? 0))
    const estimatedTokens = this.estimate(compactableItems) + overheadTokens
    const reportedPromptTokens = typeof options?.promptTokens === 'number' ? options.promptTokens : undefined
    // Some providers over-report prompt_tokens by folding cumulative cache
    // reads into the per-request count. MiniMax-M3 was observed reporting up to
    // ~25x the real prompt size (prompt_cache_hit_tokens alone exceeded the
    // entire stored conversation, which is physically impossible). Trusting that
    // number pins the gauge at 100% and makes compaction fire pointlessly on a
    // context that is actually tiny. A request cannot really exceed our own
    // estimate of what we sent by a wide margin, so when the reported count
    // blows past it we distrust the provider and fall back to the estimate.
    const promptTokens = trustworthyPromptTokens(reportedPromptTokens, estimatedTokens, options?.model)
    const inputPressure = Math.max(
      estimatedTokens,
      promptTokens ?? 0,
      finiteNonNegative(options?.requestInputTokens)
    )
    const outputBudgetTokens = finiteNonNegative(options?.outputBudgetTokens)
    const requestHardCapTokens = finiteNonNegative(options?.requestHardCapTokens)
    // Budget-driven force compaction: the send-time guard rejects any request
    // whose input + reserved output exceeds the hard cap. Compacting only on
    // input thresholds leaves a dead zone when the output budget is larger
    // than (hard - soft): input can sit below soft while input + output is
    // already over the cap. Mirror the exact `>` boundary of the guard so
    // equality never spuriously compacts.
    if (
      requestHardCapTokens > 0 &&
      outputBudgetTokens > 0 &&
      inputPressure + outputBudgetTokens > requestHardCapTokens
    ) {
      return {
        mode: 'force',
        keepRecent: 1,
        reason: `request budget ${inputPressure} input + ${outputBudgetTokens} output exceeds ${requestHardCapTokens}-token hard cap`
      }
    }
    if (inputPressure < thresholds.softThreshold) return null
    const aggressiveThreshold = aggressiveCompactionThreshold(thresholds)
    const mode: CompactionMode =
      inputPressure >= thresholds.hardThreshold
        ? 'force'
        : inputPressure >= aggressiveThreshold
          ? 'aggressive'
          : 'normal'
    const source = promptTokens !== undefined && promptTokens >= estimatedTokens ? 'usage prompt_tokens' : 'estimated prompt tokens'
    const keepRecent = mode === 'force' ? 1 : mode === 'aggressive' ? 2 : 4
    return {
      mode,
      keepRecent,
      reason: `${source} ${inputPressure} reached ${mode} compaction threshold`
    }
  }

  /**
   * Compact the given history in place. Returns a new item list where
   * older items are replaced by a single `compaction` summary item.
   * The summary always lists the pinned constraints so they survive
   * even when the original text is removed.
   */
  compact(input: {
    threadId: string
    turnId: string
    history: TurnItem[]
    prefix: ImmutablePrefix
    budgetTokens?: number
    keepRecent?: number
    mode?: CompactionMode
    reason?: string
    summaryOverride?: string
    summaryItemId?: string
    frozenMessageCount?: number
    /** `false` marks a user-requested (`/compact`) compaction; omit for auto. */
    auto?: boolean
    /** Token budget for the verbatim tail; complete turns are folded when exceeded. */
    tailTokenBudget?: number
  }): {
    next: TurnItem[]
    summaryItem: TurnItem
    replacedTokens: number
  } {
    // Internal model records (goal context and interruption checkpoints) are
    // durable model history, but neither is conversation content nor an
    // instruction that a compaction summary may paraphrase. Pull them out
    // before calculating frozen/head/tail boundaries so exactly one original
    // record survives after the newly-created summary.
    const internalRecords = input.history.filter(isInternalModelRecord)
    const compactableInput = input.history.filter((item) => !isInternalModelRecord(item))
    const frozenMessageCount = normalizeFrozenMessageCount(
      input.frozenMessageCount,
      compactableInput.length
    )
    const frozen = frozenMessageCount > 0 ? compactableInput.slice(0, frozenMessageCount) : []
    const history = trimTrailingToolCalls(compactableInput.slice(frozenMessageCount))
    // Preserve exact order on no-op paths. It avoids a needless cache miss on
    // a short goal turn merely because compaction was considered.
    const unchangedNext = internalRecords.length > 0 ? [...input.history] : [...frozen, ...history]
    const requestedKeepRecent = Math.max(0, input.keepRecent ?? 4)
    const keepRecent =
      history.length <= 1 ? history.length : Math.min(requestedKeepRecent, history.length - 1)
    if (history.length <= 1 || history.length - keepRecent <= 0) {
      return {
        next: unchangedNext,
        summaryItem: makeCompactionItem({
          id: `compaction_${input.turnId}_noop`,
          turnId: input.turnId,
          threadId: input.threadId,
          summary: 'no compaction needed',
          replacedTokens: 0,
          pinnedConstraints: input.prefix.pinnedConstraints,
          auto: input.auto
        }),
        replacedTokens: 0
      }
    }
    let tailStart = keepRecent === 0
      ? history.length
      : repairTailStartForToolResults(history, history.length - keepRecent)
    const activeContextIndex = history.findIndex(
      (item) => item.kind === 'model_context' && item.turnId === input.turnId
    )
    if (activeContextIndex >= 0) {
      let activeTurnStart = activeContextIndex
      for (let index = activeContextIndex - 1; index >= 0; index -= 1) {
        const item = history[index]
        if (item?.turnId === input.turnId && item.kind === 'user_message') {
          activeTurnStart = index
          break
        }
      }
      tailStart = Math.min(
        tailStart,
        activeTurnStart
      )
    }
    // Token-targeted tail: the item-count floor only sets the minimum.
    // When a configured budget exists, walk backwards over complete-turn
    // boundaries so a handful of multi-KB assistant/tool items cannot pin
    // the post-compaction request near the threshold. Completed turns that
    // do not fit are folded into the summary head instead.
    if (input.tailTokenBudget !== undefined && input.tailTokenBudget > 0) {
      const maxTailStart = Math.max(1, tailStart)
      let candidate = maxTailStart
      let used = 0
      while (candidate > 0) {
        const turnId = history[candidate - 1]?.turnId
        let boundary = candidate - 1
        while (boundary > 0 && history[boundary - 1]?.turnId === turnId) boundary -= 1
        const turnTokens = this.estimator.estimateItems(history.slice(boundary, candidate))
        if (used > 0 && used + turnTokens > input.tailTokenBudget) break
        used += turnTokens
        candidate = boundary
      }
      const repaired = repairTailStartForToolResults(history, candidate)
      if (repaired < tailStart) tailStart = repaired
      else if (candidate > 0 && candidate < tailStart) tailStart = candidate
    }
    if (tailStart === 0) {
      return {
        next: unchangedNext,
        summaryItem: makeCompactionItem({
          id: `compaction_${input.turnId}_noop`,
          turnId: input.turnId,
          threadId: input.threadId,
          summary: 'compaction skipped to preserve a complete tool interaction',
          replacedTokens: 0,
          pinnedConstraints: input.prefix.pinnedConstraints,
          auto: input.auto
        }),
        replacedTokens: 0
      }
    }
    const head = history.slice(0, tailStart)
    const tail = history.slice(tailStart)
    // Re-summarizing only the previous summary cannot reclaim any conversation
    // history. Provider usage counters can remain above a threshold after a
    // successful compaction (notably when cached tokens are cumulative), which
    // used to create a fresh compaction item on every following model step.
    if (head.length > 0 && head.every((item) => item.kind === 'compaction')) {
      return {
        next: unchangedNext,
        summaryItem: makeCompactionItem({
          id: `compaction_${input.turnId}_noop`,
          turnId: input.turnId,
          threadId: input.threadId,
          summary: 'no new history to compact',
          replacedTokens: 0,
          pinnedConstraints: input.prefix.pinnedConstraints,
          auto: input.auto
        }),
        replacedTokens: 0
      }
    }
    const replacedTokens = this.estimator.estimateItems(head)
    const sourceDigest = computeShortHash(compactedItemsDigestSource(head))
    const digestMarker = createToolDigestMarker(sourceDigest)
    // The tail is sent verbatim after this summary. Summarizing it as well
    // duplicates the current user request (and can make the model treat one
    // instruction as two). Keep the summary source explicitly limited to the
    // folded head; the retained tail remains the single source of truth for
    // recent instructions.
    const summaryBase = input.summaryOverride?.trim() || buildCompactionSummary({
      history: head,
      head,
      tail,
      prefix: input.prefix,
      // A skill pin in the retained tail is already sent verbatim with the
      // request. Copy only folded pins into the summary so the tail has one
      // source of truth, just like ordinary user instructions.
      skillPins: extractSkillPins(head),
      reason: input.reason,
      mode: input.mode,
      budgetTokens: input.budgetTokens
    })
    const summary = appendDigestMarker(summaryBase, digestMarker)
    const summaryItem = makeCompactionItem({
      id: input.summaryItemId ?? `compaction_${input.turnId}_${Date.now()}`,
      turnId: input.turnId,
      threadId: input.threadId,
      summary,
      replacedTokens,
      pinnedConstraints: input.prefix.pinnedConstraints,
      auto: input.auto,
      sourceDigest,
      digestMarker,
      sourceItemIds: head.map((item) => item.id)
    })
    return { next: [...frozen, summaryItem, ...internalRecords, ...tail], summaryItem, replacedTokens }
  }

  /** Hard cap used by the loop to enforce an upper bound on the conversation. */
  hardCap(model?: string, providerId?: string): number {
    return this.thresholds(model, providerId).hardThreshold
  }

  thresholds(model?: string, providerId?: string): ModelContextThresholds {
    const profiles = providerId
      ? this.profilesForProvider?.(providerId) ?? this.modelProfiles
      : this.modelProfiles
    return contextThresholdsForModel(model, {
      softThreshold: this.softThreshold,
      hardThreshold: this.hardThreshold
    }, profiles)
  }
}
function isInternalModelRecord(item: TurnItem): boolean {
  return item.kind === 'goal_context' || item.kind === 'runtime_context_source' ||
    item.kind === 'interruption_note'
}

export { extractSkillPins, trimTrailingToolCalls } from './context-compactor-helpers.js'
