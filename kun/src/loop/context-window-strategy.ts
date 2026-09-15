import type { ContextWindowMode } from '../contracts/context-windows.js'
import type { ContextWindowTransitionCoordinator } from '../services/context-window-transition-coordinator.js'
import type { ContextWindowStateRestore } from '../services/context-window-state.js'
import type { ContextWindowBudget, WindowBudgetState } from './context-window-budget.js'
import { effectiveHistoryAfterLatestCompaction } from './compaction-history.js'
import { repairModelHistoryItemsForModel } from '../domain/model-history-repair.js'
import type { SessionStore } from '../ports/session-store.js'
import {
  HistoryCompactionService,
  type CompactIfNeededInput,
  type HistoryCompactionOutcome
} from './history-compaction-service.js'

const OUTPUT_RESERVE_CAP_RATIO = 0.85
const DEFAULT_CAPACITY = 256_000

export type CompactionDispatch = {
  compactIfNeeded(input: CompactIfNeededInput): Promise<HistoryCompactionOutcome>
}

export type ContextWindowStrategyDeps = {
  summary: HistoryCompactionService
  /** Accepted per-turn mode; absence means summary mode everywhere. */
  mode?: (threadId: string, turnId: string | undefined) => ContextWindowMode
  transition?: ContextWindowTransitionCoordinator
  budget?: ContextWindowBudget
  /** Effective context capacity for a model route (profile or fallback). */
  capacityTokens?: (model: string, providerId?: string) => number | undefined
  /** Active window identity per thread, when window mode has started one. */
  window?: (threadId: string) => { windowId: string; windowSeq: number } | undefined
  /** Establishes the active window identity (modes registry) for persistence. */
  establishWindow?: (threadId: string, window: { windowId: string; windowSeq: number }) => void
  sessionStore?: SessionStore
  stateRestore?: ContextWindowStateRestore
  ids?: { next(prefix: string): string }
}

/**
 * Single strategy entry consulted by every automatic compaction path
 * (auto preflight, send-boundary fallback, memory-pressure sweep, provider
 * overflow recovery). Summary mode delegates unchanged to
 * HistoryCompactionService. Window mode NEVER calls the summary model: soft
 * pressure produces a deduped budget notice, hard pressure performs exactly
 * one deterministic no-summary window transition, and a request whose
 * non-history portion cannot fit fails only the current turn through the
 * `unrecoverable` outcome marker — never a silent summary fallback.
 */
export class ContextWindowStrategyCoordinator implements CompactionDispatch {
  constructor(private readonly deps: ContextWindowStrategyDeps) {}

  async compactIfNeeded(input: CompactIfNeededInput): Promise<HistoryCompactionOutcome> {
    const mode = this.deps.mode?.(input.threadId, input.turnId) ?? 'summary'
    if (mode !== 'windows') {
      return this.deps.summary.compactIfNeeded(input)
    }
    return this.compactWindows(input)
  }

  private capacityFor(input: CompactIfNeededInput): number {
    const capacity = this.deps.capacityTokens?.(input.model, input.providerId)
    return capacity !== undefined && capacity > 0 ? Math.floor(capacity) : DEFAULT_CAPACITY
  }

  private budgetState(input: CompactIfNeededInput, capacity: number): WindowBudgetState | undefined {
    if (!this.deps.budget) return undefined
    const window = this.deps.window?.(input.threadId)
    const windowId = window?.windowId ?? 'win-0'
    const existing = this.deps.budget.stateFor(input.threadId, windowId)
    if (existing) {
      if (existing.model !== input.model || existing.capacityTokens !== capacity) {
        this.deps.budget.switchModel(input.threadId, windowId, input.model, capacity)
      }
      return this.deps.budget.stateFor(input.threadId, windowId)
    }
    if (!window) {
      // First enable (window 0): establish the identity in the modes registry
      // so covered-threshold marks can be persisted and survive restart.
      this.deps.establishWindow?.(input.threadId, { windowId, windowSeq: 0 })
    }
    const created = this.deps.budget.startWindow({
      threadId: input.threadId,
      windowId,
      windowSeq: window?.windowSeq ?? 0,
      model: input.model,
      capacityTokens: capacity
    })
    // Restart hydration: restore is read-only for the budget (capacity comes
    // from the live model profile), so persisted threshold marks are applied
    // here, on top of the freshly computed capacity.
    const marks = this.deps.stateRestore?.takeBudgetMarks(input.threadId)
    if (marks) {
      created.coveredThresholds = [
        ...new Set([...created.coveredThresholds, ...marks.coveredThresholds])
      ].sort((left, right) => left - right)
      created.noticeTokens += marks.noticeTokens
    }
    return created
  }

  private async compactWindows(input: CompactIfNeededInput): Promise<HistoryCompactionOutcome> {
    await this.deps.stateRestore?.restore(input.threadId)
    const capacity = this.capacityFor(input)
    const hardCap = Math.floor(capacity * OUTPUT_RESERVE_CAP_RATIO)
    const overhead = Math.max(0, Math.floor(input.requestOverheadTokens ?? 0))
    const estimatedInput = Math.max(0, Math.floor(input.requestInputTokens ?? 0))
    const outputReserve = Math.max(0, Math.floor(input.outputBudgetTokens ?? 0))
    const state = this.budgetState(input, capacity)
    // Restore may discover a committed boundary whose initialization append
    // was interrupted. Build the initialization only after the current model
    // capacity and persisted threshold marks are hydrated, then refresh the
    // history snapshot that this call returns to ModelStepService.
    await this.deps.stateRestore?.ensureRestoredInitialization(input.threadId)
    const currentItems = this.deps.sessionStore
      ? await this.deps.sessionStore.loadItems(input.threadId)
      : input.items
    const currentHistory = repairModelHistoryItemsForModel(
      effectiveHistoryAfterLatestCompaction(currentItems)
    )

    // Unrecoverable: the fresh window's initial context (everything that is
    // not conversation history) plus the output reservation already exceeds
    // the hard capacity. Fail only this turn; no repeated reset, no replay.
    if (overhead > 0 && overhead + outputReserve > hardCap) {
      return {
        history: currentHistory,
        triggered: true,
        compacted: false,
        replacedTokens: 0,
        unrecoverable: true,
        notice: `[context window: the initial request needs about ${overhead + outputReserve} tokens but the hard capacity is ${hardCap}; reduce tools/attachments or switch to a larger model]`
      }
    }

    // Hard pressure (or forced overflow recovery): exactly one deterministic
    // no-summary transition, then the caller rebuilds the request.
    if (input.force !== undefined || (estimatedInput > 0 && estimatedInput + outputReserve > hardCap)) {
      const result = await this.transitionWindow(input)
      if (result) return result
      return {
        history: currentHistory,
        triggered: true,
        compacted: false,
        replacedTokens: 0,
        notice: '[context window: transition deferred (pending interactions or concurrent changes); retrying without summarizing]'
      }
    }

    // Soft pressure: warn through the dedup budget notice only.
    if (state) {
      const notice = this.deps.budget!.thresholdNotice(state, {
        estimatedInputTokens: estimatedInput,
        outputReserveTokens: outputReserve
      })
      if (notice.notice) {
        await this.deps.stateRestore?.persist(input.threadId, 'threshold-notice')
        return {
          history: currentHistory,
          triggered: true,
          compacted: false,
          replacedTokens: 0,
          notice: notice.notice
        }
      }
    }
    return { history: currentHistory, triggered: false, compacted: false, replacedTokens: 0 }
  }

  private async transitionWindow(input: CompactIfNeededInput): Promise<HistoryCompactionOutcome | null> {
    if (!this.deps.transition) return null
    // Idempotency is per WINDOW: retrying the same crossing replays, but a
    // new transition in the same turn (after the first one committed) must
    // commit its own boundary instead of replaying the previous operation.
    const windowId = this.deps.window?.(input.threadId)?.windowId ?? 'win-0'
    const result = await this.deps.transition.transition({
      threadId: input.threadId,
      turnId: input.turnId,
      reason: input.force !== undefined ? 'overflow' : 'pressure',
      operationId: input.force
        ? `overflow_${input.threadId}_${input.turnId}_${windowId}`
        : `pressure_${input.threadId}_${input.turnId}_${windowId}`,
      model: input.model,
      signal: input.signal
    })
    if (result.status !== 'committed') return null
    const latest = this.deps.sessionStore
      ? await this.deps.sessionStore.loadItems(input.threadId)
      : input.items
    return {
      history: repairModelHistoryItemsForModel(effectiveHistoryAfterLatestCompaction(latest)),
      triggered: true,
      compacted: true,
      replacedTokens: 0,
      notice: result.notice,
      windowTransition: { windowId: result.windowId, windowSeq: result.windowSeq, itemId: result.itemId }
    }
  }
}
