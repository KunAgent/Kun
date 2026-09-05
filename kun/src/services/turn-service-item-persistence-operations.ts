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

export const turnServiceItemPersistenceOperations = {
/**
   * Apply a tool or assistant item to the current turn. The agent loop
   * calls this after each chunk so SSE consumers see live updates.
   */
async applyItem(this: TurnService, threadId: string, item: TurnItem): Promise<void> {
    await this['appendItem'](threadId, item)
    await this['deps'].events.record({
      kind: 'item_created',
      threadId,
      turnId: item.turnId,
      itemId: item.id,
      item
    })
  },

/**
   * Persist the cumulative assistant item before exposing its next replay
   * fragment. The ordering closes the hydrate event-before-state window; the
   * offset makes the opposite state-before-event window safe to replay.
   */
async applyAssistantDelta(this: TurnService,
    threadId: string,
    item: TurnItem,
    deltaText: string,
    deltaOffset: number
  ): Promise<void> {
    if (item.kind !== 'assistant_text' && item.kind !== 'assistant_reasoning') {
      throw new TypeError(`assistant delta requires assistant item: ${item.kind}`)
    }
    if (!Number.isSafeInteger(deltaOffset) || deltaOffset < 0) {
      throw new RangeError(`assistant delta offset must be a non-negative safe integer: ${deltaOffset}`)
    }
    // Checkpoint state before exposing the event. Its represented sequence is
    // deliberately the previous durable high-water, so replaying the next
    // offset-bearing delta is idempotent across either hydration race window.
    const sessionStore = this['deps'].sessionStore
    if (sessionStore.checkpointLiveItem) {
      const representedSeq = await sessionStore.highestSeq(threadId)
      await sessionStore.checkpointLiveItem(threadId, item, representedSeq)
    } else {
      // Compatibility adapters retain the old state-first behavior.
      await sessionStore.appendItem(threadId, item)
    }
    await this['deps'].events.record({
      kind: item.kind === 'assistant_text'
        ? 'assistant_text_delta'
        : 'assistant_reasoning_delta',
      threadId,
      turnId: item.turnId,
      itemId: item.id,
      deltaOffset,
      item: { ...item, text: deltaText }
    })
  },

async publishTransientItem(this: TurnService, threadId: string, item: TurnItem): Promise<void> {
    await this['deps'].events.publishTransient({
      kind: 'item_updated',
      threadId,
      turnId: item.turnId,
      itemId: item.id,
      item
    })
  },

async compactItemHistory(this: TurnService, threadId: string): Promise<void> {
    const store = this['deps'].sessionStore
    if (store.scheduleItemHistoryCompaction) {
      store.scheduleItemHistoryCompaction(threadId)
      return
    }
    if (!store.compactItems) return
    await store.compactItems(threadId).catch((error) => {
      console.warn(
        `[kun] item history compaction skipped for ${threadId}: ` +
        `${error instanceof Error ? error.message : String(error)}`
      )
    })
  },

async updateItem(this: TurnService,
    threadId: string,
    itemId: string,
    patch: Partial<TurnItem>
  ): Promise<TurnItem | null> {
    const updatedInSession = await this['deps'].sessionStore.updateItem(threadId, itemId, patch)
    const updatedItems: TurnItem[] = []
    if (this['deps'].threadStore.touch) {
      await this['deps'].threadStore.touch(threadId, this['deps'].nowIso())
    } else {
      await this['upsertThread'](threadId, (current) => {
        const turns = current.turns.map((turn) => {
          const existing = turn.items.find((item) => item.id === itemId)
          if (!existing) return turn
          updatedItems[0] = { ...existing, ...patch } as TurnItem
          return replaceTurnItem(turn, itemId, patch)
        })
        return { ...current, turns }
      })
    }
    const updated = updatedItems[0] ?? updatedInSession
    if (!updated) return null
    await this['deps'].events.record({
      kind: 'item_updated',
      threadId,
      turnId: updated.turnId,
      itemId: updated.id,
      item: updated
    })
    return updated
  },

async appendItem(this: TurnService, threadId: string, item: TurnItem): Promise<void> {
    const sessionStore = this['deps'].sessionStore
    if (
      sessionStore.finalizeLiveItem &&
      (item.kind === 'assistant_text' || item.kind === 'assistant_reasoning')
    ) {
      await sessionStore.finalizeLiveItem(threadId, item)
    } else {
      await sessionStore.appendItem(threadId, item)
    }
    await this['upsertThread'](threadId, (current) => {
      const turn = current.turns.find((t) => t.id === item.turnId)
      if (!turn) return current
      const nextTurn = appendTurnItem(turn, item)
      const turns = current.turns.map((t) => (t.id === item.turnId ? nextTurn : t))
      return { ...current, turns }
    })
  },

async upsertThread(this: TurnService,
    threadId: string,
    mutator: (current: ThreadRecord) => ThreadRecord
  ): Promise<void> {
    await this['withThreadMutation'](threadId, async () => {
      const current = await this['deps'].threadStore.get(threadId)
      if (!current) return
      const next = mutator(current)
      await this['deps'].threadStore.upsert({ ...next, updatedAt: this['deps'].nowIso() })
    })
  },

async withThreadMutation<T>(this: TurnService, threadId: string, operation: () => Promise<T>): Promise<T> {
    return withThreadStoreMutation(this['deps'].threadStore, threadId, operation)
  },

async markTurnAdmissionCompleted(this: TurnService,
    threadId: string,
    turnId: string,
    locks: Partial<Pick<
      ThreadRecord,
      'agentSurface' | 'designProfile' | 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'
    >>
  ): Promise<ThreadRecord> {
    return this['withThreadMutation'](threadId, async () => {
      const current = await this['deps'].threadStore.get(threadId)
      if (!current) throw new Error(`thread not found: ${threadId}`)
      const existing = current.turns.find((turn) => turn.id === turnId)
      if (!existing) throw new Error(`turn not found: ${turnId}`)
      if (existing.admissionCompletedAt && !existing.admissionPending) return current
      if (!existing.admissionPending) {
        throw new Error(`turn is not a pending admission: ${turnId}`)
      }
      if (existing.status !== 'queued' && existing.status !== 'running') {
        throw new Error(`pending admission is already terminal: ${turnId}`)
      }
      const completedAt = this['deps'].nowIso()
      const turns = current.turns.map((turn) => {
        if (turn.id !== turnId) return turn
        const { admissionPending: _pending, ...committed } = turn
        return { ...committed, admissionCompletedAt: completedAt }
      })
      const next: ThreadRecord = {
        ...current,
        ...(locks.agentSurface ? { agentSurface: locks.agentSurface } : {}),
        ...(locks.designProfile ? { designProfile: locks.designProfile } : {}),
        ...(locks.approvalPolicy ? { approvalPolicy: locks.approvalPolicy } : {}),
        ...(locks.sandboxMode ? { sandboxMode: locks.sandboxMode } : {}),
        ...(locks.approvalReviewer ? { approvalReviewer: locks.approvalReviewer } : {}),
        turns,
        updatedAt: completedAt
      }
      try {
        return await this['deps'].threadStore.upsert(next)
      } catch (error) {
        // Some durable stores can report a transport/fsync error after their
        // atomic rename already committed. Observe the boundary before
        // declaring failure so the caller never rolls back an accepted turn.
        const observed = await this['deps'].threadStore.get(threadId).catch(() => null)
        const observedTurn = observed?.turns.find((turn) => turn.id === turnId)
        if (observed && observedTurn?.admissionCompletedAt && !observedTurn.admissionPending) {
          return observed
        }
        throw error
      }
    })
  },

async rollbackPendingAdmission(this: TurnService,
    threadId: string,
    turnId: string
  ): Promise<boolean> {
    return this['withThreadMutation'](threadId, async () => {
      const current = await this['deps'].threadStore.get(threadId)
      if (!current) return false
      const pending = current.turns.find((turn) => turn.id === turnId)
      const legacyProvisional = Boolean(
        pending &&
        !pending.admissionCompletedAt &&
        current.designProfile?.lockedAtTurnId === turnId
      )
      if (!pending || (!pending.admissionPending && !legacyProvisional)) return false
      const history = await rewriteItemHistoryWithRetry({
        sessionStore: this['deps'].sessionStore,
        threadId,
        maxAttempts: 3,
        build: (snapshot) => {
          const items = snapshot.items.filter((item) => item.turnId !== turnId)
          return {
            changed: items.length !== snapshot.items.length,
            items,
            value: undefined
          }
        }
      })
      if (history.status === 'closed' || history.status === 'conflict') return false
      const turns = current.turns.filter((turn) => turn.id !== turnId)
      const next: ThreadRecord = {
        ...current,
        status: threadStatusAfterTurnTransition(current.status, turns),
        turns,
        updatedAt: this['deps'].nowIso()
      }
      // Heal records written by the earlier provisional-lock implementation.
      if (next.designProfile?.lockedAtTurnId === turnId) delete next.designProfile
      if (
        current.turns.length === 1 &&
        !current.designProfile &&
        pending.agentSurface &&
        current.agentSurface === pending.agentSurface
      ) {
        delete next.agentSurface
      }
      await this['deps'].threadStore.upsert(next)
      return true
    })
  },

tryAdmitTurn(this: TurnService, turnId: string, threadId: string): boolean {
    if (this['admittedTurnThreads'].size >= this['maxConcurrentTurns']) {
      return false
    }
    // There is no await between capacity check and this map insertion, so
    // starts serialized on different thread locks cannot over-admit.
    this['admittedTurnThreads'].set(turnId, threadId)
    return true
  },

clearRuntimeTurnState(this: TurnService,
    threadId: string,
    turnId: string,
    options: { abort?: boolean; releaseLease?: boolean } = {}
  ): void {
    this['releaseRuntimeTurnExecution'](threadId, turnId, options)
    this['deps'].steering.clear(turnId)
  },

releaseRuntimeTurnExecution(this: TurnService,
    threadId: string,
    turnId: string,
    options: { abort?: boolean; releaseLease?: boolean } = {}
  ): void {
    const admittedThreadId = this['admittedTurnThreads'].get(turnId)
    if (admittedThreadId === threadId) {
      if (options.abort) this['inflightTurns'].get(turnId)?.abort()
      this['inflightTurns'].delete(turnId)
      this['deps'].inflight.end(turnId)
      this['admittedTurnThreads'].delete(turnId)
    } else if (!this['leasedTurns'].has(turnId)) {
      // An external interrupt may already have released admission before the
      // model loop observes the abort and seals its terminal boundary. The
      // loop's later idempotent finish must still clear that transient seal.
      return
    }
    if (options.releaseLease !== false && this['leasedTurns'].delete(turnId)) {
      void this['deps'].executionLeases?.release(threadId, turnId).catch(() => undefined)
    }
  },

finalizeOpenItems(this: TurnService,
    turn: Turn,
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>
  ): Turn {
    const finishedAt = this['deps'].nowIso()
    const items = finalizeTurnItems(turn.items, { turnId: turn.id, status, finishedAt })
    return items === turn.items ? turn : { ...turn, items }
  },

async discardTurnItems(this: TurnService, threadId: string, turnId: string): Promise<void> {
    const history = await rewriteItemHistoryWithRetry({
      sessionStore: this['deps'].sessionStore,
      threadId,
      maxAttempts: 3,
      build: (snapshot) => {
        const items = snapshot.items.filter((item) => item.turnId !== turnId || item.kind === 'user_message')
        return {
          changed: items.length !== snapshot.items.length,
          items,
          value: undefined
        }
      }
    })
    if (history.status === 'applied' || history.status === 'unchanged') {
      await this['threadItems'].syncFromSession(threadId)
    }
  },

async finalizePersistedOpenItems(this: TurnService,
    threadId: string,
    turnId: string,
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>
  ): Promise<void> {
    const items = await this['deps'].sessionStore.loadItems(threadId)
    const finishedAt = this['deps'].nowIso()
    const finalizedItems = finalizeTurnItems(items, { turnId, status, finishedAt })
    if (finalizedItems === items) return
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const finalized = finalizedItems[index]
      if (!item || !finalized || finalized === item) continue
      await this.updateItem(threadId, item.id, finalized)
    }
  },

keepUserItems(this: TurnService, items: TurnItem[]): TurnItem[] {
    return items.filter((item) => item.kind === 'user_message')
  },
}
