import type { ThreadRecord, ThreadStatus } from '../contracts/threads.js'
import type {
  CompactRequest,
  CompactResponse,
  RewindThreadResponse,
  StartTurnRequest,
  StartTurnResponse,
  Turn,
  TurnStatus
} from '../contracts/turns.js'
import type { TurnItem } from '../contracts/items.js'
import type { RuntimeErrorSeverity } from '../contracts/errors.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ModelClient } from '../ports/model-client.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { InflightTracker } from '../loop/inflight-tracker.js'
import type { SteeringQueue } from '../loop/steering-queue.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import {
  effectiveHistoryAfterLatestCompaction,
  insertCompactionIntoVisibleHistory,
  placeCompactionsAtTurnEnd
} from '../loop/compaction-history.js'
import { resolveCompactionModel, summarizeCompactionWithModel } from '../loop/compaction-summary.js'
import type { ContextCompactionConfig } from '../loop/model-context-profile.js'
import { makeUserItem, makeErrorItem } from '../domain/item.js'
import { appendTurnItem, createTurnRecord, finishTurn, replaceTurnItem, startTurn as startTurnRecord } from '../domain/turn.js'
import { touchThread } from '../domain/thread.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { UsageService } from './usage-service.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'

export type TurnServiceDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  inflight: InflightTracker
  steering: SteeringQueue
  compactor: ContextCompactor
  model?: ModelClient
  usage?: UsageService
  prefix?: ImmutablePrefix
  defaultModel?: string
  contextCompaction?: ContextCompactionConfig
  ids: IdGenerator
  nowIso: () => string
}

/**
 * Turn service: owns the turn lifecycle (start, finish, abort, steer,
 * compact). The service is the only place that emits turn lifecycle
 * events; the agent loop calls into it instead of mutating state
 * directly.
 */
export class TurnService {
  private readonly deps: TurnServiceDeps
  private readonly inflightTurns = new Map<string, AbortController>()
  private readonly threadMutationQueues = new Map<string, Promise<void>>()

  constructor(deps: TurnServiceDeps) {
    this.deps = deps
  }

  async startTurn(input: {
    threadId: string
    request: StartTurnRequest
  }): Promise<StartTurnResponse> {
    const thread = await this.deps.threadStore.get(input.threadId)
    if (!thread) throw new Error(`thread not found: ${input.threadId}`)
    const turnId = this.deps.ids.next('turn')
    const turn = createTurnRecord({
      id: turnId,
      threadId: input.threadId,
      prompt: input.request.prompt,
      model: input.request.model,
      reasoningEffort: input.request.reasoningEffort,
      attachmentIds: input.request.attachmentIds ?? [],
      guiPlan: input.request.guiPlan,
      mode: input.request.mode,
      disableUserInput: input.request.disableUserInput,
      workspaceCheckpointId: input.request.workspaceCheckpointId
    })
    const userItem = makeUserItem({
      id: `item_${turnId}_user`,
      turnId,
      threadId: input.threadId,
      text: input.request.prompt,
      displayText: input.request.displayText,
      attachmentIds: input.request.attachmentIds ?? [],
      fileReferences: input.request.fileReferences ?? [],
      workspaceCheckpointId: input.request.workspaceCheckpointId
    })
    const controller = new AbortController()
    await this.upsertThread(input.threadId, (current) => ({
      ...touchThread(current, this.deps.nowIso()),
      status: 'running',
      ...(input.request.approvalPolicy !== undefined
        ? { approvalPolicy: input.request.approvalPolicy }
        : {}),
      ...(input.request.sandboxMode !== undefined
        ? { sandboxMode: input.request.sandboxMode }
        : {}),
      turns: [...current.turns, startTurnRecord(appendTurnItem(turn, userItem))]
    }))
    await this.deps.sessionStore.appendItem(input.threadId, userItem)
    await this.deps.events.record({
      kind: 'turn_started',
      threadId: input.threadId,
      turnId
    })
    await this.deps.events.record({
      kind: 'item_created',
      threadId: input.threadId,
      turnId,
      itemId: userItem.id,
      item: userItem
    })
    this.inflightTurns.set(turnId, controller)
    this.deps.inflight.begin({
      id: turnId,
      kind: 'model',
      threadId: input.threadId,
      turnId
    })
    this.deps.steering.setTurn(turnId)
    return { threadId: input.threadId, turnId, userMessageItemId: userItem.id }
  }

  async rewindThread(input: {
    threadId: string
    turnId: string
  }): Promise<RewindThreadResponse> {
    const thread = await this.deps.threadStore.get(input.threadId)
    if (!thread) throw new Error(`thread not found: ${input.threadId}`)
    if (thread.status === 'running') throw new Error('Cannot rewind while a turn is running.')
    const targetIndex = thread.turns.findIndex((turn) => turn.id === input.turnId)
    if (targetIndex < 0) throw new Error(`turn not found: ${input.turnId}`)

    const keptTurns = thread.turns.slice(0, targetIndex)
    const keptTurnIds = new Set(keptTurns.map((turn) => turn.id))
    const items = await this.deps.sessionStore.loadItems(input.threadId)
    const keptItems = items.filter((item) => keptTurnIds.has(item.turnId))
    await this.deps.sessionStore.rewriteItems(input.threadId, keptItems)
    await this.upsertThread(input.threadId, (current) => ({
      ...touchThread(current, this.deps.nowIso()),
      status: 'idle',
      turns: current.turns.slice(0, targetIndex)
    }))
    return {
      threadId: input.threadId,
      turnId: input.turnId,
      removedTurns: thread.turns.length - targetIndex,
      remainingTurns: keptTurns.length
    }
  }

  async steerTurn(input: { threadId: string; turnId: string; text: string }): Promise<void> {
    this.deps.steering.enqueue(input.turnId, input.text)
    await this.deps.events.record({
      kind: 'turn_steered',
      threadId: input.threadId,
      turnId: input.turnId,
      text: input.text
    })
  }

  async interruptTurn(input: { threadId: string; turnId: string; discard?: boolean }): Promise<{ status: TurnStatus }> {
    const controller = this.inflightTurns.get(input.turnId)
    if (controller) controller.abort()
    this.deps.steering.clear()
    this.inflightTurns.delete(input.turnId)
    this.deps.inflight.end(input.turnId)
    await this.deps.events.record({
      kind: 'turn_aborted',
      threadId: input.threadId,
      turnId: input.turnId
    })
    if (input.discard) {
      await this.discardTurnItems(input.threadId, input.turnId)
    } else {
      await this.finalizePersistedOpenItems(input.threadId, input.turnId, 'aborted')
    }
    await this.upsertThread(input.threadId, (current) => {
      const turn = current.turns.find((t) => t.id === input.turnId)
      if (!turn) return current
      const next = current.turns.map((t) =>
        t.id === input.turnId
          ? this.finalizeOpenItems(
              finishTurn(input.discard ? { ...t, items: this.keepUserItems(t.items) } : t, 'aborted'),
              'aborted'
            )
          : t
      )
      return { ...touchThread(current, this.deps.nowIso()), turns: next, status: 'idle' }
    })
    return { status: 'aborted' }
  }

  async compact(input: {
    threadId: string
    turnId?: string
    request: CompactRequest
    signal?: AbortSignal
  }): Promise<CompactResponse> {
    const thread = await this.deps.threadStore.get(input.threadId)
    if (!thread) throw new Error(`thread not found: ${input.threadId}`)
    const turnId = input.turnId ?? thread.turns[thread.turns.length - 1]?.id ?? this.deps.ids.next('turn')
    const items = await this.deps.sessionStore.loadItems(input.threadId)
    const history = effectiveHistoryAfterLatestCompaction(items)
      .filter((item) => item.kind !== 'error')
    const prefix = this.deps.prefix ?? createImmutablePrefix({
      pinnedConstraints: ['user: preserve recent turns']
    })
    let result = this.deps.compactor.compact({
      threadId: input.threadId,
      turnId,
      history,
      prefix,
      budgetTokens: input.request.budgetTokens,
      reason: input.request.reason,
      // Mark this as a user-requested compaction so the GUI renders it as a
      // manual "已压缩" event rather than an automatic one.
      auto: false
    })
    // Only surface lifecycle events (and persist the summary) when something
    // was actually folded. A no-op compaction stays invisible in the timeline;
    // the caller signals "nothing to compact" from the returned replacedTokens.
    if (result.replacedTokens > 0) {
      // Emit `started` before the persist so the live SSE stream shows a brief
      // "正在压缩上下文" row. In model-summary mode this also covers the
      // extra summarizer request.
      await this.deps.events.record({
        kind: 'compaction_started',
        threadId: input.threadId,
        turnId,
        itemId: result.summaryItem.id,
        auto: false
      })
      if (this.deps.contextCompaction?.summaryMode === 'model' && this.deps.model) {
        const fallbackModel = modelForManualCompaction({
          threadModel: thread.model,
          defaultModel: this.deps.defaultModel,
          clientModel: this.deps.model.model
        })
        const compactionModel = resolveCompactionModel({
          contextCompaction: this.deps.contextCompaction,
          fallbackModel
        })
        const model = compactionModel.model
        const modelSummary = await summarizeCompactionWithModel({
          threadId: input.threadId,
          turnId,
          model,
          ...(compactionModel.providerId ? { providerId: compactionModel.providerId } : {}),
          modelClient: this.deps.model,
          prefix,
          contextCompaction: this.deps.contextCompaction,
          items: history,
          heuristicSummary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
          signal: input.signal ?? new AbortController().signal,
          recordUsage: async (usageSnapshot) => {
            const usage = this.deps.usage?.record(input.threadId, usageSnapshot) ?? usageSnapshot
            await this.deps.events.record({
              kind: 'usage',
              threadId: input.threadId,
              turnId,
              model,
              usage
            })
          },
          recordFallback: async (message) => {
            await this.deps.events.record({
              kind: 'error',
              threadId: input.threadId,
              turnId,
              message,
              code: 'compaction_summary_fallback',
              severity: 'warning'
            })
          }
        })
        if (modelSummary) {
          result = this.deps.compactor.compact({
            threadId: input.threadId,
            turnId,
            history,
            prefix,
            budgetTokens: input.request.budgetTokens,
            reason: input.request.reason,
            auto: false,
            summaryOverride: modelSummary,
            summaryItemId: result.summaryItem.id
          })
        }
      }
      const visibleItems = insertCompactionIntoVisibleHistory({
        visibleItems: items,
        compactedItems: result.next,
        summaryItem: result.summaryItem
      })
      await this.deps.sessionStore.rewriteItems(input.threadId, visibleItems)
      await this.rewriteThreadItemsFromSession(input.threadId, visibleItems)
      await this.deps.events.record({
        kind: 'compaction_completed',
        threadId: input.threadId,
        turnId,
        itemId: result.summaryItem.id,
        summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
        replacedTokens: result.replacedTokens,
        auto: false,
        pinnedConstraints: prefix.pinnedConstraints,
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
      threadId: input.threadId,
      replacedTokens: result.replacedTokens,
      summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
      pinnedConstraints: prefix.pinnedConstraints,
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceDigest
        ? { sourceDigest: result.summaryItem.sourceDigest }
        : {}),
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.digestMarker
        ? { digestMarker: result.summaryItem.digestMarker }
        : {}),
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
        ? { sourceItemIds: result.summaryItem.sourceItemIds }
        : {})
    }
  }

  /**
   * Persist a final turn state (running -> completed/failed/aborted).
   * Called by the agent loop when a model stream finishes.
   */
  async finishTurn(input: {
    threadId: string
    turnId: string
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>
    error?: string
    code?: string
    details?: unknown
    severity?: RuntimeErrorSeverity
  }): Promise<void> {
    this.inflightTurns.delete(input.turnId)
    this.deps.inflight.end(input.turnId)
    this.deps.steering.clear()
    await this.finalizePersistedOpenItems(input.threadId, input.turnId, input.status)
    await this.upsertThread(input.threadId, (current) => {
      const next = current.turns.map((t) => {
        if (t.id !== input.turnId) return t
        const finished = this.finalizeOpenItems(finishTurn(t, input.status), input.status)
        return input.error ? { ...finished, error: input.error } : finished
      })
      return { ...touchThread(current, this.deps.nowIso()), turns: next, status: 'idle' }
    })
    const errorItem = input.error
      ? makeErrorItem({
          id: `item_${input.turnId}_error`,
          turnId: input.turnId,
          threadId: input.threadId,
          message: input.error,
          ...(input.code ? { code: input.code } : {}),
          ...(input.details !== undefined ? { details: input.details } : {}),
          ...(input.severity ? { severity: input.severity } : {})
        })
      : null
    await this.deps.events.record({
      kind: input.status === 'completed' ? 'turn_completed' : input.status === 'aborted' ? 'turn_aborted' : 'turn_failed',
      threadId: input.threadId,
      turnId: input.turnId,
      ...(errorItem ? { itemId: errorItem.id } : {}),
      ...(input.error ? { message: input.error } : {}),
      ...(input.code ? { code: input.code } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
      ...(input.severity ? { severity: input.severity } : {})
    })
    if (errorItem) {
      await this.appendItem(input.threadId, errorItem)
    }
  }

  getAbortController(turnId: string): AbortSignal | undefined {
    return this.inflightTurns.get(turnId)?.signal
  }

  /**
   * Mark turns left 'queued'/'running' by a previous process as failed
   * so clients stop waiting on them after a crash or restart. Turns
   * owned by this process (inflight) are skipped, so the sweep is safe
   * to run in the background after the server starts listening.
   *
   * Returns the ids of threads that had at least one turn reconciled, so the
   * caller can resume goals that were interrupted mid-run (KunAgent/Kun#370).
   */
  async reconcileOrphanedTurns(): Promise<string[]> {
    // Include `side` threads: a delegated subagent runs on a hidden side thread
    // whose own turn is left `running` when the runtime is interrupted. Without
    // includeSide it is never swept, so its turn (and the parent's delegate_task
    // tool item) stay pending forever, wedging the thread (KunAgent/Kun#621).
    const summaries = await this.deps.threadStore.list({ includeSide: true })
    const reconciledThreadIds = new Set<string>()
    for (const summary of summaries) {
      const thread = await this.deps.threadStore.get(summary.id).catch(() => null)
      if (!thread) continue
      for (const turn of thread.turns) {
        if (turn.status !== 'running' && turn.status !== 'queued') continue
        if (this.inflightTurns.has(turn.id)) continue
        try {
          await this.finishTurn({
            threadId: thread.id,
            turnId: turn.id,
            status: 'failed',
            error: 'Turn was interrupted by a runtime restart.',
            code: 'orphaned_after_restart',
            severity: 'warning'
          })
          reconciledThreadIds.add(thread.id)
        } catch {
          // Best-effort sweep; one unreadable thread must not stop the rest.
        }
      }
    }
    return [...reconciledThreadIds]
  }

  async getTurn(threadId: string, turnId: string): Promise<Turn | null> {
    const thread = await this.deps.threadStore.get(threadId)
    return thread?.turns.find((turn) => turn.id === turnId) ?? null
  }

  async updateTurnMetadata(
    threadId: string,
    turnId: string,
    patch: Pick<
      Partial<Turn>,
      | 'activeSkillIds'
      | 'injectedMemoryIds'
      | 'skillInjectionBytes'
      | 'toolCatalogFingerprint'
      | 'toolCatalogToolCount'
      | 'toolCatalogDrift'
    >
  ): Promise<void> {
    await this.upsertThread(threadId, (current) => ({
      ...current,
      turns: current.turns.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              ...(patch.activeSkillIds ? { activeSkillIds: [...patch.activeSkillIds] } : {}),
              ...(patch.injectedMemoryIds ? { injectedMemoryIds: [...patch.injectedMemoryIds] } : {}),
              ...(patch.skillInjectionBytes !== undefined ? { skillInjectionBytes: patch.skillInjectionBytes } : {}),
              ...(patch.toolCatalogFingerprint ? { toolCatalogFingerprint: patch.toolCatalogFingerprint } : {}),
              ...(patch.toolCatalogToolCount !== undefined ? { toolCatalogToolCount: patch.toolCatalogToolCount } : {}),
              ...(patch.toolCatalogDrift !== undefined ? { toolCatalogDrift: patch.toolCatalogDrift } : {})
            }
          : turn
      )
    }))
  }

  /**
   * Apply a tool or assistant item to the current turn. The agent loop
   * calls this after each chunk so SSE consumers see live updates.
   */
  async applyItem(threadId: string, item: TurnItem): Promise<void> {
    await this.appendItem(threadId, item)
    await this.deps.events.record({
      kind: 'item_created',
      threadId,
      turnId: item.turnId,
      itemId: item.id,
      item
    })
  }

  async updateItem(
    threadId: string,
    itemId: string,
    patch: Partial<TurnItem>
  ): Promise<TurnItem | null> {
    const updatedInSession = await this.deps.sessionStore.updateItem(threadId, itemId, patch)
    const updatedItems: TurnItem[] = []
    await this.upsertThread(threadId, (current) => {
      const turns = current.turns.map((turn) => {
        const existing = turn.items.find((item) => item.id === itemId)
        if (!existing) return turn
        updatedItems[0] = { ...existing, ...patch } as TurnItem
        return replaceTurnItem(turn, itemId, patch)
      })
      return { ...current, turns }
    })
    const updated = updatedItems[0] ?? updatedInSession
    if (!updated) return null
    await this.deps.events.record({
      kind: 'item_updated',
      threadId,
      turnId: updated.turnId,
      itemId: updated.id,
      item: updated
    })
    return updated
  }

  private async appendItem(threadId: string, item: TurnItem): Promise<void> {
    await this.deps.sessionStore.appendItem(threadId, item)
    await this.upsertThread(threadId, (current) => {
      const turn = current.turns.find((t) => t.id === item.turnId)
      if (!turn) return current
      const nextTurn = appendTurnItem(turn, item)
      const turns = current.turns.map((t) => (t.id === item.turnId ? nextTurn : t))
      return { ...current, turns }
    })
  }

  private async upsertThread(
    threadId: string,
    mutator: (current: ThreadRecord) => ThreadRecord
  ): Promise<void> {
    const previous = this.threadMutationQueues.get(threadId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      const current = await this.deps.threadStore.get(threadId)
      if (!current) return
      const next = mutator(current)
      await this.deps.threadStore.upsert({ ...next, updatedAt: this.deps.nowIso() })
    })
    const guard = run.then(() => undefined, () => undefined)
    this.threadMutationQueues.set(threadId, guard)
    try {
      await run
    } finally {
      if (this.threadMutationQueues.get(threadId) === guard) {
        this.threadMutationQueues.delete(threadId)
      }
    }
  }

  private finalizeOpenItems(
    turn: Turn,
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>
  ): Turn {
    const finishedAt = this.deps.nowIso()
    let changed = false
    const items = turn.items.map((item) => {
      const next = this.finalizeOpenItem(item, status, finishedAt)
      if (next !== item) changed = true
      return next
    })
    return changed ? { ...turn, items } : turn
  }

  private async discardTurnItems(threadId: string, turnId: string): Promise<void> {
    const items = await this.deps.sessionStore.loadItems(threadId)
    await this.deps.sessionStore.rewriteItems(
      threadId,
      items.filter((item) => item.turnId !== turnId || item.kind === 'user_message')
    )
  }

  private async finalizePersistedOpenItems(
    threadId: string,
    turnId: string,
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>
  ): Promise<void> {
    const items = await this.deps.sessionStore.loadItems(threadId)
    const finishedAt = this.deps.nowIso()
    for (const item of items) {
      if (item.turnId !== turnId) continue
      const finalized = this.finalizeOpenItem(item, status, finishedAt)
      if (finalized === item) continue
      await this.updateItem(threadId, item.id, finalized)
    }
  }

  private keepUserItems(items: TurnItem[]): TurnItem[] {
    return items.filter((item) => item.kind === 'user_message')
  }

  private async rewriteThreadItemsFromSession(threadId: string, items: TurnItem[]): Promise<void> {
    if (items.length === 0) return
    const itemsByTurn = new Map<string, TurnItem[]>()
    for (const item of items) {
      const turnItems = itemsByTurn.get(item.turnId) ?? []
      turnItems.push(item)
      itemsByTurn.set(item.turnId, turnItems)
    }
    await this.upsertThread(threadId, (current) => {
      let changed = false
      const turns = current.turns.map((turn) => {
        const sessionItems = itemsByTurn.get(turn.id)
        if (!sessionItems) return turn
        changed = true
        return { ...turn, items: placeCompactionsAtTurnEnd(sessionItems) }
      })
      return changed ? { ...current, turns } : current
    })
  }

  private finalizeOpenItem(
    item: TurnItem,
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>,
    finishedAt: string
  ): TurnItem {
    if (item.status !== 'pending' && item.status !== 'running') return item
    if (item.kind === 'approval') {
      return { ...item, status: 'expired', finishedAt }
    }
    if (item.kind === 'user_input') {
      return { ...item, status: 'cancelled', finishedAt }
    }
    const itemStatus = status === 'completed' ? 'completed' : status
    return { ...item, status: itemStatus, finishedAt } as TurnItem
  }

}

function modelForManualCompaction(input: {
  threadModel?: string
  defaultModel?: string
  clientModel?: string
}): string {
  for (const candidate of [input.threadModel, input.defaultModel, input.clientModel]) {
    const normalized = candidate?.trim()
    if (!normalized || normalized.toLowerCase() === 'auto') continue
    return normalized
  }
  return input.threadModel?.trim() || input.defaultModel?.trim() || input.clientModel?.trim() || ''
}
