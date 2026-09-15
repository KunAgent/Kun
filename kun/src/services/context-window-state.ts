import { z } from 'zod'
import type { SessionStore } from '../ports/session-store.js'
import type { ContextWindowBudget } from '../loop/context-window-budget.js'
import type { ContextWindowTurnModes } from './context-window-turn-modes.js'

export const PersistedWindowStateSchema = z.object({
  schemaVersion: z.literal(1),
  threadId: z.string().min(1),
  windowId: z.string().min(1),
  windowSeq: z.number().int().nonnegative(),
  model: z.string(),
  capacityTokens: z.number().int().positive(),
  coveredThresholds: z.array(z.number()),
  noticeTokens: z.number().int().nonnegative(),
  lastReason: z.string(),
  updatedAt: z.string()
})
export type PersistedWindowState = z.infer<typeof PersistedWindowStateSchema>

/**
 * Dedicated per-thread window-state record. Intentionally separate from the
 * notes store: this file is written atomically on transitions and budget
 * notices, and loaded lazily after a restart so window numbering,
 * previousWindowId chains, and covered threshold marks survive.
 */
export interface ContextWindowStateStore {
  load(threadId: string): Promise<PersistedWindowState | null>
  save(state: PersistedWindowState): Promise<void>
  deleteThreadData(threadId: string): Promise<void>
}

export type RestoredWindowCheckpoint = {
  threadId: string
  windowId: string
  windowSeq: number
  operationId: string
  turnId: string
}

export type RestoredBudgetMarks = {
  coveredThresholds: number[]
  noticeTokens: number
}

export type ContextWindowStateRestoreDeps = {
  store: ContextWindowStateStore
  modes: ContextWindowTurnModes
  budget: ContextWindowBudget
  /** Fallback derivation from canonical history when no state file exists. */
  sessionStore?: SessionStore
  nowIso?: () => string
}

/**
 * Restores per-thread window identity and per-window budget marks once per
 * thread after startup, then persists them on every change. Without a state
 * file the current window is derived from the latest committed `context_window`
 * checkpoint (its item provides the window id; the checkpoint count provides
 * the sequence number), so even a lost state file cannot corrupt numbering.
 *
 * Restore is deliberately read-only for the budget: it never creates budget
 * states (capacity depends on the live model profile). Persisted threshold
 * marks are handed to the first consumer through `takeBudgetMarks`, which
 * hydrates the strategy-created state with the current model's capacity.
 *
 * The initialization backfill is late-bound to the transition coordinator:
 * restoring the current checkpoint must synchronously ensure the durable
 * window initialization exists before any model request is served for that
 * window, without requiring an operation replay.
 */
export class ContextWindowStateRestore {
  private readonly restored = new Set<string>()
  private readonly pendingMarks = new Map<string, RestoredBudgetMarks>()
  private readonly pendingInitialization = new Map<string, RestoredWindowCheckpoint>()

  /**
   * Late-bound (composition wires this after both objects exist): idempotently
   * ensures the durable initialization item for a committed checkpoint.
   */
  ensureInitialization?: (checkpoint: RestoredWindowCheckpoint) => Promise<void>

  constructor(private readonly deps: ContextWindowStateRestoreDeps) {}

  async restore(threadId: string): Promise<void> {
    if (this.restored.has(threadId)) return
    // The committed checkpoint is the source of truth: reconcile whatever the
    // state file claims against the newest boundary in canonical history so a
    // crash between the checkpoint commit and the state write cannot restore
    // stale numbering.
    const derived = await this.deriveFromHistory(threadId)
    const persisted = await this.deps.store.load(threadId)
    if (derived && (!persisted || persisted.windowId !== derived.windowId)) {
      this.deps.modes.setWindow(threadId, derived)
      // Marks from a different (stale) window must not suppress the current
      // window's thresholds; a matching window restores its marks below.
      this.pendingInitialization.set(threadId, derived)
      this.restored.add(threadId)
      return
    }
    if (persisted) {
      this.deps.modes.setWindow(threadId, {
        windowId: persisted.windowId,
        windowSeq: persisted.windowSeq
      })
      this.pendingMarks.set(threadId, {
        coveredThresholds: [...persisted.coveredThresholds],
        noticeTokens: persisted.noticeTokens
      })
      if (derived) this.pendingInitialization.set(threadId, derived)
      this.restored.add(threadId)
      return
    }
    if (derived) {
      this.deps.modes.setWindow(threadId, derived)
      this.pendingInitialization.set(threadId, derived)
    }
    this.restored.add(threadId)
  }

  /**
   * Complete a crash-interrupted initialization after the strategy has built
   * the current model's budget state. This ordering keeps the persisted
   * initialization's capacity text accurate while still completing before
   * the caller constructs the first model request.
   */
  async ensureRestoredInitialization(threadId: string): Promise<void> {
    const checkpoint = this.pendingInitialization.get(threadId)
    if (!checkpoint || !this.ensureInitialization) return
    await this.ensureInitialization(checkpoint)
    this.pendingInitialization.delete(threadId)
  }

  /**
   * Consumes the persisted threshold marks for a thread. The strategy calls
   * this when it creates the window's budget state so marks hydrate onto the
   * current model's capacity instead of a stale or placeholder one.
   */
  takeBudgetMarks(threadId: string): RestoredBudgetMarks | undefined {
    const marks = this.pendingMarks.get(threadId)
    this.pendingMarks.delete(threadId)
    return marks
  }

  async persist(threadId: string, reason: string): Promise<void> {
    const window = this.deps.modes.windowFor(threadId)
    if (!window) return
    const budgetState = this.deps.budget.stateFor(threadId, window.windowId)
    await this.deps.store.save({
      schemaVersion: 1,
      threadId,
      windowId: window.windowId,
      windowSeq: window.windowSeq,
      model: budgetState?.model ?? '',
      capacityTokens: budgetState?.capacityTokens ?? 0,
      coveredThresholds: budgetState ? [...budgetState.coveredThresholds] : [],
      noticeTokens: budgetState?.noticeTokens ?? 0,
      lastReason: reason,
      updatedAt: this.deps.nowIso?.() ?? new Date().toISOString()
    })
  }

  private async deriveFromHistory(
    threadId: string
  ): Promise<RestoredWindowCheckpoint | null> {
    if (!this.deps.sessionStore) return null
    const items = await this.deps.sessionStore.loadItems(threadId)
    let latest: Extract<(typeof items)[number], { kind: 'context_window' }> | null = null
    let count = 0
    for (const item of items) {
      if (item.kind !== 'context_window') continue
      count += 1
      latest = item
    }
    if (!latest) return null
    return {
      threadId,
      windowId: latest.windowId,
      windowSeq: count,
      operationId: latest.operationId,
      turnId: latest.turnId
    }
  }
}
