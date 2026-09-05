import { createHash } from 'node:crypto'
import type { ThreadRecord, ThreadStatus } from '../contracts/threads.js'
import { StartTurnRequest as StartTurnRequestSchema } from '../contracts/turns.js'
import type {
  CompactRequest,
  CompactResponse,
  RewindThreadResponse,
  StartTurnRequest,
  StartTurnResponse,
  SteeringEntry,
  Turn,
  GraphPlanningLifecycle,
  TurnStatus
} from '../contracts/turns.js'
import type { TurnItem, UserMessageSource } from '../contracts/items.js'
import type { RuntimeErrorSeverity } from '../contracts/errors.js'
import type { ModelRequestFailureContext } from '../contracts/model-request-failure.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { MigrationMaintenanceLock } from '../ports/migration-maintenance-lock.js'
import {
  ThreadExecutionBusyError,
  type ThreadExecutionLeasePort
} from '../ports/thread-execution-lease.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ModelClient } from '../ports/model-client.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { InflightTracker } from '../loop/inflight-tracker.js'
import type { SteeringQueue } from '../loop/steering-queue.js'
import { ContextCompactor, extractSkillPins } from '../loop/context-compactor.js'
import {
  effectiveHistoryAfterLatestCompaction,
  insertCompactionIntoVisibleHistory
} from '../loop/compaction-history.js'
import {
  resolveCoherentProviderAccount,
  resolveCompactionModel,
  summarizeCompactionWithModel
} from '../loop/compaction-summary.js'
import type { ContextCompactionConfig } from '../loop/model-context-profile.js'
import { reserveExtensionModelRequest } from '../loop/turn-budget-gate.js'
import { makeGoalContextItem, makeUserItem, makeErrorItem } from '../domain/item.js'
import { appendTurnItem, createTurnRecord, finishTurn, replaceTurnItem, startTurn as startTurnRecord } from '../domain/turn.js'
import { finalizeTurnItems } from '../domain/turn-item-finalization.js'
import { touchThread } from '../domain/thread.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { UsageService } from './usage-service.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { rewriteItemHistoryWithRetry } from './history-commit-coordinator.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'
import type { ThreadLifecycleFence } from './thread-lifecycle-fence.js'
import { ThreadItemProjectionService } from './thread-item-projection.js'
import { ComposerContextAttachmentSchema } from '../contracts/composer-context.js'
import {
  goalContextInstruction,
  goalContextKey
} from '../loop/continuation-instructions.js'
import { type TurnService, type TurnServiceDeps, TurnConflictError, TurnCapacityError, type TerminalTurnStatus, type TurnSettlement, type GraphLeadSuspensionResult, type GraphLeadResumeResult, HOST_SHUTDOWN_TURN_SUSPENSION_CODE, hostShutdownTurnSuspensionReason, isHostShutdownTurnSuspension, DEFAULT_MAX_CONCURRENT_TURNS, fingerprintStartTurnRequest, canonicalizeFingerprintValue, isActiveTurn, terminalStatus, threadStatusFromTurns, threadStatusAfterTurnTransition, normalizeMaxConcurrentTurns, firstNonBlank, modelForManualCompaction } from './turn-service-core.js'

import { buildArchivedActiveHistory } from './archive-history-commit.js'

export const turnServiceCompactionOperations = {
async compact(this: TurnService, input: {
    threadId: string
    turnId?: string
    request: CompactRequest
    signal?: AbortSignal
    /** Marks this compaction as automatic (memory-pressure sweep), not user-requested. */
    auto?: boolean
  }): Promise<CompactResponse> {
    const thread = await this['deps'].threadStore.get(input.threadId)
    if (!thread) throw new Error(`thread not found: ${input.threadId}`)
    if (input.request.cutoffTurnId) {
      return this['withThreadMutation'](input.threadId, async () => {
        const current = await this['deps'].threadStore.get(input.threadId)
        if (!current) throw new Error(`thread not found: ${input.threadId}`)
        if (current.turns.some(isActiveTurn)) {
          throw new TurnConflictError('thread has an active turn')
        }
        const cutoffTurn = current.turns.find((candidate) => candidate.id === input.request.cutoffTurnId)
        if (!cutoffTurn || cutoffTurn.status !== 'completed') {
          throw new TurnConflictError('cutoffTurnId must identify a completed turn')
        }
        const archiveItems = this['deps'].sessionStore.archiveItems
        if (input.request.archiveBeforePrune !== false && !archiveItems) {
          throw new Error('session archive is unavailable for this store')
        }
        const snapshot = await this['deps'].sessionStore.loadItemSnapshot(input.threadId)
        const cutoffIndex = snapshot.items.reduce(
          (last, item, index) => item.turnId === cutoffTurn.id ? index : last,
          -1
        )
        if (cutoffIndex < 0) throw new TurnConflictError('cutoff turn has no persisted history')
        if (snapshot.items.slice(cutoffIndex + 1).some((item) => item.turnId === cutoffTurn.id)) {
          throw new TurnConflictError('cutoff turn is not a contiguous history boundary')
        }
        const archivedHead = snapshot.items.slice(0, cutoffIndex + 1)
        const retainedTail = snapshot.items.slice(cutoffIndex + 1)
        if (archivedHead.some((item) => item.kind === 'tool_call' &&
          !archivedHead.some((candidate) => candidate.kind === 'tool_result' && candidate.callId === item.callId))) {
          throw new TurnConflictError('cutoff would split a tool interaction')
        }
        const prefix = this['deps'].prefix ?? createImmutablePrefix({
          pinnedConstraints: ['user: preserve recent turns']
        })
        const history = effectiveHistoryAfterLatestCompaction(snapshot.items)
          .filter((item) => item.kind !== 'error')
        const retainedIds = new Set(retainedTail.map((item) => item.id))
        const keepRecent = history.filter((item) => retainedIds.has(item.id)).length
        const summaryItemId = this['deps'].ids.next('compaction')
        const result = this['deps'].compactor.compact({
          threadId: input.threadId,
          turnId: cutoffTurn.id,
          history,
          prefix,
          keepRecent,
          budgetTokens: input.request.budgetTokens,
          reason: input.request.reason ?? `archive through ${cutoffTurn.id}`,
          summaryItemId,
          auto: false
        })
        if (result.replacedTokens === 0) {
          throw new TurnConflictError('cutoff does not contain compactable history')
        }
        const nextItems = buildArchivedActiveHistory(result.next, result.summaryItem, retainedTail)
        const staged = input.request.archiveBeforePrune === false
          ? undefined
          : await archiveItems!.call(this['deps'].sessionStore, {
              threadId: input.threadId,
              cutoffTurnId: cutoffTurn.id,
              createdAt: this['deps'].nowIso(),
              items: archivedHead,
              retainedItems: retainedTail.length,
              replacedTokens: result.replacedTokens
            })
        const commit = await this['deps'].sessionStore.rewriteItemsIfRevision(
          input.threadId,
          snapshot.revision,
          nextItems
        )
        if (!commit.applied) {
          await staged?.cleanup()
          throw new TurnConflictError('history changed while archive was being committed')
        }
        await this['threadItems'].syncFromSession(input.threadId)
        await this['deps'].events.record({
          kind: 'compaction_completed',
          threadId: input.threadId,
          turnId: cutoffTurn.id,
          itemId: result.summaryItem.id,
          summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
          replacedTokens: result.replacedTokens,
          auto: false,
          pinnedConstraints: prefix.pinnedConstraints,
          ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
            ? { sourceItemIds: result.summaryItem.sourceItemIds }
            : {})
        })
        await this['deps'].onCompacted?.(input.threadId)
        return {
          threadId: input.threadId,
          replacedTokens: result.replacedTokens,
          summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
          pinnedConstraints: prefix.pinnedConstraints,
          ...(staged ? { archivePath: staged.path } : {}),
          archivedItems: archivedHead.length,
          retainedItems: retainedTail.length,
          contextEstimate: this['deps'].compactor.estimate(nextItems),
          ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
            ? { sourceItemIds: result.summaryItem.sourceItemIds }
            : {})
        }
      })
    }
    const turnId = input.turnId ?? thread.turns[thread.turns.length - 1]?.id ?? this['deps'].ids.next('turn')
    const bindingTurn = thread.turns.find((candidate) => candidate.id === turnId)
    const {
      providerId: fallbackProviderId,
      accountId: fallbackAccountId
    } = resolveCoherentProviderAccount({
      turnProviderId: bindingTurn?.providerId,
      turnAccountId: bindingTurn?.accountId,
      threadProviderId: thread.providerId,
      threadAccountId: thread.accountId
    })
    const prefix = this['deps'].prefix ?? createImmutablePrefix({
      pinnedConstraints: ['user: preserve recent turns']
    })
    const summaryItemId = this['deps'].ids.next('compaction')
    let started = false
    const committed = await rewriteItemHistoryWithRetry({
      sessionStore: this['deps'].sessionStore,
      threadId: input.threadId,
      maxAttempts: 2,
      build: async (snapshot, attempt) => {
        const history = effectiveHistoryAfterLatestCompaction(snapshot.items)
          .filter((item) => item.kind !== 'error')
        let result = this['deps'].compactor.compact({
          threadId: input.threadId,
          turnId,
          history,
          prefix,
          budgetTokens: input.request.budgetTokens,
          reason: input.request.reason,
          summaryItemId,
          // `auto` marks a memory-pressure sweep; `false` marks a user-run
          // (`/compact`) compaction so the GUI renders the right kind.
          auto: input.auto === true
        })
        if (result.replacedTokens === 0) {
          return { changed: false, items: snapshot.items, value: result }
        }
        if (!started) {
          started = true
          // Keep the existing live lifecycle signal, but only persist the
          // corresponding completion after a conditional history commit wins.
          await this['deps'].events.record({
            kind: 'compaction_started',
            threadId: input.threadId,
            turnId,
            itemId: result.summaryItem.id,
            auto: input.auto === true
          })
        }
        // A conflicting model-backed summary describes the old snapshot, so
        // retry with the deterministic heuristic instead of reusing it (or
        // issuing a second expensive summary request).
        if (attempt === 1 && this['deps'].contextCompaction?.summaryMode === 'model' && this['deps'].model) {
          const fallbackModel = modelForManualCompaction({
            turnModel: bindingTurn?.model,
            threadModel: thread.model,
            defaultModel: this['deps'].defaultModel,
            clientModel: this['deps'].model.model
          })
          const compactionModel = resolveCompactionModel({
            contextCompaction: this['deps'].contextCompaction,
            fallbackModel,
            fallbackProviderId,
            fallbackAccountId
          })
          const model = compactionModel.model
          const recordFallback = async (message: string): Promise<void> => {
            await this['deps'].events.record({
              kind: 'error',
              threadId: input.threadId,
              turnId,
              message,
              code: 'compaction_summary_fallback',
              severity: 'warning'
            })
          }
          let modelSummary: string | undefined
          if (compactionModel.bindingError) {
            await recordFallback(compactionModel.bindingError)
          } else {
            const reservation = this['deps'].usage
              ? await reserveExtensionModelRequest({
                  threadStore: this['deps'].threadStore,
                  usage: this['deps'].usage,
                  nowIso: this['deps'].nowIso,
                  threadId: input.threadId,
                  turnId
                })
              : thread.extensionBudget
                ? {
                    allowed: false as const,
                    reason: 'Extension model-request accounting is unavailable.'
                  }
                : { allowed: true as const, counted: false as const }
            if (!reservation.allowed) {
              await recordFallback(
                `${reservation.reason} Model compaction summary was not sent; using heuristic summary.`
              )
            } else {
              const foldedItemIds = new Set(
                result.summaryItem.kind === 'compaction'
                  ? result.summaryItem.sourceItemIds ?? []
                  : []
              )
              // Keep the manual compaction summarizer aligned with the
              // automatic path: recent tail items are sent verbatim after the
              // summary and must not be summarized a second time.
              const summaryItems = history.filter((item) => foldedItemIds.has(item.id))
              if (summaryItems.length === 0) {
                await recordFallback(
                  'Model compaction summary skipped because no folded source items were available; using heuristic summary.'
                )
              } else {
                modelSummary = await summarizeCompactionWithModel({
                  threadId: input.threadId,
                  turnId,
                  model,
                  ...(compactionModel.providerId ? { providerId: compactionModel.providerId } : {}),
                  ...(compactionModel.accountId ? { accountId: compactionModel.accountId } : {}),
                  modelClient: this['deps'].model,
                  prefix,
                  contextCompaction: this['deps'].contextCompaction,
                  items: summaryItems,
                  pinnedSkillPins: extractSkillPins(summaryItems),
                  heuristicSummary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
                  signal: input.signal ?? new AbortController().signal,
                  recordUsage: async (usageSnapshot) => {
                    const usage = this['deps'].usage?.record(input.threadId, usageSnapshot) ?? usageSnapshot
                    await this['deps'].events.record({
                      kind: 'usage',
                      threadId: input.threadId,
                      turnId,
                      model,
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
          if (modelSummary) {
            result = this['deps'].compactor.compact({
              threadId: input.threadId,
              turnId,
              history,
              prefix,
              budgetTokens: input.request.budgetTokens,
              reason: input.request.reason,
              auto: input.auto === true,
              summaryOverride: modelSummary,
              summaryItemId
            })
          }
        }
        return {
          changed: true,
          items: insertCompactionIntoVisibleHistory({
            visibleItems: snapshot.items,
            compactedItems: result.next,
            summaryItem: result.summaryItem,
            threadId: input.threadId,
            activeTurnId: turnId,
            nowIso: this['deps'].nowIso
          }),
          value: result
        }
      }
    })
    if (committed.status !== 'applied' && committed.status !== 'unchanged') {
      // Preserve every newer append rather than making a stale compaction
      // appear successful. The next request can compact a fresh snapshot.
      return {
        threadId: input.threadId,
        replacedTokens: 0,
        summary: '',
        pinnedConstraints: prefix.pinnedConstraints
      }
    }
    const result = committed.value
    if (committed.status === 'applied') {
      await this['threadItems'].syncFromSession(input.threadId)
      await this['deps'].events.record({
        kind: 'compaction_completed',
        threadId: input.threadId,
        turnId,
        itemId: result.summaryItem.id,
        summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
        replacedTokens: result.replacedTokens,
        auto: input.auto === true,
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
      await this['deps'].onCompacted?.(input.threadId)
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
  },

/**
   * Persist a final turn state (running -> completed/failed/aborted).
   * Called by the agent loop when a model stream finishes.
   */
async finishTurn(this: TurnService, input: {
    threadId: string
    turnId: string
    status: TerminalTurnStatus
    error?: string
    code?: string
    details?: unknown
    modelRequestFailure?: ModelRequestFailureContext
    severity?: RuntimeErrorSeverity
  }): Promise<TurnSettlement> {
    let settlement: TurnSettlement
    try {
      settlement = await this['withThreadMutation'](input.threadId, async () => {
        const current = await this['deps'].threadStore.get(input.threadId)
        if (!current) return { kind: 'missing' }
        const turn = current.turns.find((candidate) => candidate.id === input.turnId)
        if (!turn) return { kind: 'missing' }
        if (!isActiveTurn(turn)) {
          return {
            kind: 'already_terminal',
            status: terminalStatus(turn.status),
            ...(turn.error ? { error: turn.error } : {})
          }
        }
        const turns = current.turns.map((candidate) => {
          if (candidate.id !== input.turnId) return candidate
          const finished = this['finalizeOpenItems'](finishTurn(candidate, input.status), input.status)
          const terminalCode = input.code?.trim().slice(0, 128)
          return {
            ...finished,
            ...(input.error ? { error: input.error } : {}),
            ...(terminalCode ? { terminalCode } : {})
          }
        })
        await this['deps'].threadStore.upsert({
          ...touchThread(current, this['deps'].nowIso()),
          turns,
          status: threadStatusAfterTurnTransition(current.status, turns),
          updatedAt: this['deps'].nowIso()
        })
        return {
          kind: 'applied',
          status: input.status,
          ...(input.error ? { error: input.error } : {})
        }
      })
    } catch (error) {
      // The model loop has already settled. Do not keep its in-process slot
      // forever just because its terminal status could not be persisted.
      this['clearRuntimeTurnState'](input.threadId, input.turnId)
      throw error
    }
    if (settlement.kind !== 'applied') {
      // A thread can disappear while a loop is unwinding. It no longer has a
      // durable turn to update, but its in-process admission must not leak.
      this['clearRuntimeTurnState'](input.threadId, input.turnId)
      return settlement
    }

    try {
      await this['finalizePersistedOpenItems'](input.threadId, input.turnId, input.status)
    // The turn's usage metrics are now stable; release per-turn aggregation
    // so long-lived threads do not accumulate one entry per historical turn.
      this['deps'].usage?.endTurn(input.threadId, input.turnId)
      const errorItem = input.error
      ? makeErrorItem({
          id: input.code === 'owner_lease_expired'
            ? `item_${input.turnId}_owner_lease_expired`
            : `item_${input.turnId}_error`,
          turnId: input.turnId,
          threadId: input.threadId,
          message: input.error,
          ...(input.code ? { code: input.code } : {}),
          ...(input.details !== undefined ? { details: input.details } : {}),
          ...(input.modelRequestFailure ? { modelRequestFailure: input.modelRequestFailure } : {}),
          ...(input.severity ? { severity: input.severity } : {})
        })
      : null
      await this['deps'].events.record({
      kind: input.status === 'completed' ? 'turn_completed' : input.status === 'aborted' ? 'turn_aborted' : 'turn_failed',
      threadId: input.threadId,
      turnId: input.turnId,
      ...(errorItem ? { itemId: errorItem.id } : {}),
      ...(input.error ? { message: input.error } : {}),
      ...(input.code ? { code: input.code } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
      ...(input.modelRequestFailure ? { modelRequestFailure: input.modelRequestFailure } : {}),
      ...(input.severity ? { severity: input.severity } : {})
    })
      if (errorItem) {
        await this['appendItem'](input.threadId, errorItem)
      }
      return settlement
    } finally {
      this['clearRuntimeTurnState'](input.threadId, input.turnId)
      // Every terminal status frees a global admission slot, so the
      // scheduler is always notified. Aborted turns still pause their own
      // thread's queue (the dispatcher evicts it from the ready queue); the
      // wake lets other threads claim the released capacity.
      this.notifyTurnSettled(input.threadId, input.status)
    }
  },
}
