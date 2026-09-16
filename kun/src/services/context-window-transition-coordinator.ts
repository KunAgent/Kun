import type { ToolHostContext } from '../ports/tool-host.js'
import type { TurnItem } from '../contracts/items.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { ContextWindowService } from './context-window-service.js'
import type { ContextWindowTurnModes } from './context-window-turn-modes.js'
import type { ContextWindowBudget } from '../loop/context-window-budget.js'
import type { ContextWindowStateRestore } from './context-window-state.js'
import { buildWindowInitializationText } from './context-window-initialization.js'
import { WINDOW_INIT_ITEM_PREFIX } from '../loop/context-window-instructions.js'

/** runtime_context_source content ceiling from the item contract. */
const INIT_MAX_CHARS = 32_768

export const NEW_CONTEXT_TOOL_NAME = 'new_context'

/**
 * Progress measure for the no-transition-without-work guard. Control records
 * never count: window boundaries, durable window-initialization host records,
 * and the new_context control tool's own call/result pair. Only ordinary
 * model/user/tool work unlocks the next transition.
 */
export function countOrdinaryWorkItems(items: readonly TurnItem[]): number {
  let count = 0
  for (const item of items) {
    if (item.kind === 'context_window' || item.kind === 'runtime_context_source') continue
    if (
      (item.kind === 'tool_call' || item.kind === 'tool_result') &&
      item.toolName === NEW_CONTEXT_TOOL_NAME
    ) {
      continue
    }
    count += 1
  }
  return count
}

/**
 * Tool-batch precheck: `new_context` is the exclusive window-transition
 * control and must never share a batch with other calls. The check is pure so
 * dispatch can run it before any side effect happens. Returns an Error to
 * reject with, or null when the batch is admissible.
 */
export function exclusiveNewContextBatchError(
  calls: ReadonlyArray<{ toolName: string }>
): Error | null {
  const transitions = calls.filter((call) => call.toolName === NEW_CONTEXT_TOOL_NAME)
  if (transitions.length === 0) return null
  if (calls.length === 1) return null
  return new Error(
    'new_context must be invoked on its own; retry it as a separate call without other tool calls in the same batch'
  )
}

export type WindowTransitionResult =
  | { status: 'committed'; windowId: string; windowSeq: number; itemId: string; notice: string }
  | { status: 'replayed'; windowId: string; windowSeq: number; itemId: string }
  | { status: 'blocked'; reason: string }
  | { status: 'cancelled' }
  | { status: 'conflict' }

type ProgressMarker = { itemCount: number }

/**
 * Coordinates one safe window transition inside a running turn.
 *
 * Ordering per design: the canonical raw history is already durable (the
 * commit only inserts the boundary, never rewrites), the checkpoint commits
 * through the revision-atomic CAS, the SSE event is recorded only after the
 * CAS wins, then old request pressure/read-tracker state is cleared and the
 * caller rebuilds the request context for the same turn. Input appended
 * after the committed cut stays in the new window because the transform only
 * inserts. Cancellation before the CAS leaves the old window untouched, and
 * two transitions without ordinary model/tool progress between them are
 * rejected.
 */
export class ContextWindowTransitionCoordinator {
  private readonly progressAtTransition = new Map<string, ProgressMarker>()

  constructor(private readonly deps: {
    contextWindows: ContextWindowService
    events: RuntimeEventRecorder
    modes: ContextWindowTurnModes
    budget?: ContextWindowBudget
    ids?: IdGenerator
    sessionStore?: SessionStore
    stateRestore?: ContextWindowStateRestore
    /**
     * Pending approvals/user-inputs/inflight tools block a transition. When
     * the transition is invoked by the new_context control tool, its own
     * inflight record is excluded by call id -- otherwise the tool could
     * never commit because it is itself "pending".
     */
    hasPendingInteractions?: (threadId: string, excludedCallId?: string) => boolean | Promise<boolean>
    clearRequestPressure?: (threadId: string) => void | Promise<void>
    /** Ordinary-work item count (see countOrdinaryWorkItems), not a raw count. */
    requestItemCount?: (threadId: string) => Promise<number>
    committedOperation?: (threadId: string, operationId: string) => Promise<boolean>
  }) {}

  private currentWindow(threadId: string): { windowId: string; windowSeq: number } {
    return this.deps.modes.windowFor(threadId) ?? { windowId: 'win-0', windowSeq: 0 }
  }

  /**
   * Whether ordinary model/tool work exists after the latest committed
   * boundary. Derived from durable items when the session store is wired so
   * a restart cannot reset the guard; otherwise falls back to the marker
   * written after each committed transition.
   */
  private async progressSinceLastBoundary(
    threadId: string,
    items: readonly TurnItem[] | undefined
  ): Promise<boolean> {
    if (items !== undefined) {
      let boundaryIndex = -1
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index]!.kind === 'context_window') {
          boundaryIndex = index
          break
        }
      }
      if (boundaryIndex < 0) return true
      return countOrdinaryWorkItems(items.slice(boundaryIndex + 1)) > 0
    }
    const itemCount = await this.deps.requestItemCount?.(threadId)
    const marker = this.progressAtTransition.get(threadId)
    return itemCount === undefined || marker === undefined || itemCount > marker.itemCount
  }

  async transition(input: {
    threadId: string
    turnId: string
    reason: 'model' | 'pressure' | 'overflow'
    operationId: string
    model?: string
    signal?: AbortSignal
    /** The invoking control call's inflight id, excluded from the pending gate. */
    excludeInflightCallId?: string
  }): Promise<WindowTransitionResult> {
    if (input.signal?.aborted) return { status: 'cancelled' }
    await this.deps.stateRestore?.restore(input.threadId)
    if (await this.deps.hasPendingInteractions?.(input.threadId, input.excludeInflightCallId)) {
      return { status: 'blocked', reason: 'tool results, approvals, or user-input requests are still unresolved' }
    }

    // No-progress guard: a previous transition in this thread must have been
    // followed by ordinary model/tool work (new persisted items). Derived
    // from durable history (ordinary items after the latest boundary) so the
    // guard survives restarts; the in-memory marker only covers stores
    // without item loading. Idempotent replays of the same operation bypass
    // the guard and return the committed boundary unchanged.
    const historyItems = this.deps.sessionStore
      ? await this.deps.sessionStore.loadItems(input.threadId)
      : undefined
    if (!(await this.progressSinceLastBoundary(input.threadId, historyItems))) {
      const alreadyCommitted = historyItems !== undefined
        ? historyItems.some(
            (item) => item.kind === 'context_window' && item.operationId === input.operationId
          )
        : await this.deps.committedOperation
            ?.call(null, input.threadId, input.operationId)
      if (!alreadyCommitted) {
        return {
          status: 'blocked',
          reason: 'no model or tool progress since the last window transition; continue the task before starting another window'
        }
      }
    }

    const previous = this.currentWindow(input.threadId)
    const windowSeq = previous.windowSeq + 1
    const windowId = this.deps.ids?.next('win') ?? `win-${windowSeq}-${input.operationId}`
    const committed = await this.deps.contextWindows.commitWindowCheckpoint({
      threadId: input.threadId,
      turnId: input.turnId,
      windowId,
      previousWindowId: previous.windowId,
      reason: input.reason,
      initializationRef: `window://${windowId}`,
      operationId: input.operationId,
      signal: input.signal
    })
    if (committed.status === 'replayed') {
      // Crash-recovery: the boundary committed earlier but the durable
      // initialization may have been lost mid-sequence. Backfill it exactly
      // once (fixed item id per operation).
      await this.ensureInitialization({
        threadId: input.threadId,
        turnId: input.turnId,
        operationId: input.operationId,
        windowId: committed.item.windowId,
        windowSeq: this.currentWindow(input.threadId).windowSeq
      })
      const replayedWindow = this.currentWindow(input.threadId)
      return {
        status: 'replayed',
        windowId: committed.item.windowId,
        windowSeq: replayedWindow.windowSeq,
        itemId: committed.item.id
      }
    }
    if (committed.status === 'cancelled') return { status: 'cancelled' }
    if (committed.status === 'conflict') return { status: 'conflict' }

    this.deps.modes.setWindow(input.threadId, { windowId, windowSeq })
    // The marker counts ordinary work AFTER the boundary insert (control
    // records excluded), so the init item or a repeated new_context cannot
    // unlock the next transition by themselves.
    const markerCount = await this.deps.requestItemCount?.(input.threadId)
    if (markerCount !== undefined) {
      this.progressAtTransition.set(input.threadId, { itemCount: markerCount })
    } else {
      this.progressAtTransition.delete(input.threadId)
    }
    // SSE only after the CAS commit won, so replay reconstructs the boundary
    // exactly once in chronological position.
    await this.deps.events.record({
      kind: 'context_window',
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: committed.item.id,
      item: committed.item
    })
    await this.deps.clearRequestPressure?.(input.threadId)
    if (this.deps.budget && input.model) {
      this.deps.budget.startWindow({
        threadId: input.threadId,
        windowId,
        windowSeq,
        model: input.model
      })
    }
    // Persist the new window identity + fresh budget marks before the
    // initialization item so a crash between the two still restores numbering
    // from either the state file or the committed checkpoint.
    await this.deps.stateRestore?.persist(input.threadId, input.reason)
    await this.appendWindowInitialization(input, windowId, windowSeq)
    return {
      status: 'committed',
      windowId,
      windowSeq,
      itemId: committed.item.id,
      notice: `[context window ${windowSeq} (${windowId}) started; earlier conversation remains retrievable via the history tools]`
    }
  }

  /**
   * Idempotently ensures the durable initialization exists for a committed
   * checkpoint. Called both on the replay path and from restart restore, so a
   * crash between the checkpoint commit and the init write self-heals without
   * requiring an operation replay. Returns without writing when the item
   * already exists (fixed id per operation).
   */
  async ensureInitialization(checkpoint: {
    threadId: string
    turnId: string
    operationId: string
    windowId: string
    windowSeq: number
  }): Promise<void> {
    await this.appendWindowInitialization(
      { threadId: checkpoint.threadId, turnId: checkpoint.turnId, operationId: checkpoint.operationId },
      checkpoint.windowId,
      checkpoint.windowSeq
    )
  }

  /**
   * Durable bounded initialization for the new window: the model-visible
   * context that replaces what the cut removed. Persisted as a host-control
   * item right after the boundary (never in the immutable system prefix) and
   * injected into every subsequent request of this window.
   */
  private async appendWindowInitialization(
    input: { threadId: string; turnId: string; operationId: string },
    windowId: string,
    windowSeq: number
  ): Promise<void> {
    if (!this.deps.sessionStore) return
    const items = await this.deps.sessionStore.loadItems(input.threadId)
    const initId = `${WINDOW_INIT_ITEM_PREFIX}${input.operationId}`
    // Replay/crash backfill: the item is keyed by operation id, so an
    // existing record means the initialization already landed.
    if (items.some((item) => item.id === initId)) return
    const taskMessageId = [...items].reverse().find((item) => item.kind === 'user_message')?.id
      ?? `item_${input.turnId}_user`
    const budgetState = this.deps.budget?.stateFor(input.threadId, windowId)
    const initText = (await buildWindowInitializationText({
      service: this.deps.contextWindows,
      threadId: input.threadId,
      windowId,
      windowSeq,
      taskMessageId,
      remainingTokens: Math.max(
        0,
        (budgetState?.capacityTokens ?? 0) - (budgetState?.noticeTokens ?? 0)
      ),
      capacityTokens: budgetState?.capacityTokens ?? 0
    })).slice(0, INIT_MAX_CHARS)
    await this.deps.sessionStore.appendItem(input.threadId, {
      id: initId,
      turnId: input.turnId,
      threadId: input.threadId,
      kind: 'runtime_context_source',
      role: 'system',
      status: 'completed',
      contextKind: 'host-control',
      createdAt: new Date().toISOString(),
      content: initText
    })
  }

  /** Tool-provider adapter: exposes the transition as a tool execution. */
  asToolTransition(model?: string) {
    return async (context: ToolHostContext, args: Record<string, unknown>) => {
      if (Object.keys(args).length > 0) {
        return { output: { error: 'new_context takes no arguments' }, isError: true }
      }
      const result = await this.transition({
        threadId: context.threadId,
        turnId: context.turnId,
        reason: 'model',
        // Idempotency is scoped to the tool call, not wall time: a retried or
        // crash-replayed call carries the same callId and must replay the
        // committed boundary instead of minting a fresh operation that the
        // no-progress guard would block with a misleading error.
        operationId: `new_context_${context.turnId}_${context.activeToolCallId ?? Date.now()}`,
        ...(model ? { model } : {}),
        signal: context.abortSignal,
        excludeInflightCallId: context.activeToolCallId
      })
      if (result.status === 'committed') return { output: { windowId: result.windowId, windowSeq: result.windowSeq, notice: result.notice } }
      if (result.status === 'replayed') {
        return { output: { windowId: result.windowId, windowSeq: result.windowSeq, replayed: true } }
      }
      if (result.status === 'blocked') return { output: { error: result.reason }, isError: true }
      if (result.status === 'cancelled') return { output: { error: 'window transition cancelled before commit' }, isError: true }
      return { output: { error: 'window transition conflicted with concurrent history changes; retry' }, isError: true }
    }
  }
}
