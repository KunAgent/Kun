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
import type {
  InterruptionNoteTurnItem,
  TurnItem,
  UserMessageSource
} from '../contracts/items.js'
import type { RuntimeErrorSeverity } from '../contracts/errors.js'
import type { RestartRecoverySource } from '../loop/restart-recovery-source.js'
import { runWithTurnMutationFence } from '../manager/turn-mutation-context.js'
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
import { makeGoalContextItem, makeUserItem, makeErrorItem, makeInterruptionNoteItem } from '../domain/item.js'
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
  goalContextKey,
  buildInterruptionNoteText
} from '../loop/continuation-instructions.js'
import { type TurnService, type TurnServiceDeps, TurnConflictError, TurnCapacityError, type TerminalTurnStatus, type TurnSettlement, type GraphLeadSuspensionResult, type GraphLeadResumeResult, HOST_SHUTDOWN_TURN_SUSPENSION_CODE, hostShutdownTurnSuspensionReason, isHostShutdownTurnSuspension, DEFAULT_MAX_CONCURRENT_TURNS, fingerprintStartTurnRequest, canonicalizeFingerprintValue, isActiveTurn, terminalStatus, threadStatusFromTurns, threadStatusAfterTurnTransition, normalizeMaxConcurrentTurns, firstNonBlank, modelForManualCompaction } from './turn-service-core.js'

export const turnServiceRuntimeStateOperations = {
withTurnMutationFence<T>(this: TurnService,
    threadId: string,
    turnId: string,
    operation: () => T
  ): T {
    const lease = this['leasedTurns'].get(turnId)
    return lease && lease.threadId === threadId
      ? runWithTurnMutationFence(lease, operation)
      : operation()
  },

isTurnExecutionActive(this: TurnService, turnId: string): boolean {
    return this['inflightTurns'].has(turnId)
  },

getAbortController(this: TurnService, turnId: string): AbortSignal | undefined {
    return this['inflightTurns'].get(turnId)?.signal
  },

/** Abort active turn work without changing its persisted lifecycle state. */
abortTurnExecution(this: TurnService, turnId: string, reason?: unknown): boolean {
    const controller = this['inflightTurns'].get(turnId)
    if (!controller || controller.signal.aborted) return false
    controller.abort(reason)
    return true
  },

/**
   * Abort only the active executions owned by one thread. Persistence is not
   * touched here because delete has already closed the lifecycle fence and
   * will remove the thread once writers drain.
   */
abortThreadExecution(this: TurnService, threadId: string): number {
    let aborted = 0
    for (const [turnId, ownerThreadId] of this['admittedTurnThreads']) {
      if (ownerThreadId !== threadId) continue
      const controller = this['inflightTurns'].get(turnId)
      if (!controller || controller.signal.aborted) continue
      controller.abort()
      aborted += 1
    }
    return aborted
  },

/**
   * Mark turns left 'queued'/'running' by a previous process as failed
   * so clients stop waiting on them after a crash or restart. Turns
   * owned by this process (inflight) are skipped, so the sweep is safe
   * to run in the background after the server starts listening.
   *
   * Returns the ids of threads that had at least one turn reconciled, so the
   * caller can resume goals that were interrupted mid-run (KunAgent/Kun#370).
   */
async reconcileOrphanedTurns(this: TurnService): Promise<RestartRecoverySource[]> {
    // Include `side` threads: a delegated subagent runs on a hidden side thread
    // whose own turn is left `running` when the runtime is interrupted. Without
    // includeSide it is never swept, so its turn (and the parent's delegate_task
    // tool item) stay pending forever, wedging the thread (KunAgent/Kun#621).
    const summaries = await this['deps'].threadStore.list({ includeSide: true })
    const reconciledSources = new Map<string, RestartRecoverySource>()
    for (const summary of summaries) {
      const metadata = await (
        this['deps'].threadStore.getMetadata?.(summary.id) ??
        this['deps'].threadStore.get(summary.id)
      ).catch(() => null)
      if (!metadata?.turns.some((turn) => turn.status === 'running' || turn.status === 'queued')) {
        continue
      }
      if (this['deps'].executionLeases) {
        try {
          // A managed sibling Runtime may own this thread. Only the Manager
          // can expire that lease; startup recovery must never sweep live
          // work merely because it is not inflight in this process.
          if (await this['deps'].executionLeases.owner(summary.id)) continue
        } catch {
          // Losing Manager authority is not proof that the owner is gone.
          continue
        }
      }
      const store = this['deps'].sessionStore
      if (store.scheduleItemHistoryCompaction) {
        store.scheduleItemHistoryCompaction(summary.id)
      } else {
        await store.compactItems?.(summary.id).catch((error) => {
          console.warn(
            `[kun] item history compaction skipped for ${summary.id}: ` +
            `${error instanceof Error ? error.message : String(error)}`
          )
        })
      }
      const thread = await this['deps'].threadStore.get(summary.id).catch(() => null)
      if (!thread) continue
      // Load once per thread: the interrupted turn's checkpoint is derived
      // from its persisted items (intent, progress, completed tool work).
      const sessionItems = await this['deps'].sessionStore.loadItems(summary.id).catch(() => [])
      for (const turn of thread.turns) {
        if (turn.status !== 'running' && turn.status !== 'queued') continue
        if (this['inflightTurns'].has(turn.id)) continue
        if (turn.status === 'queued') {
          if (!turn.admissionPending) {
            // Committed durable queue entries never execute in-process, so
            // they cannot be orphaned. The queued-turn dispatcher drains
            // them after reconciliation.
            continue
          }
          // Crash window: metadata was written but the session user item
          // (the commit boundary) or the commit marker is missing. If the
          // user item exists, finish the admission commit; otherwise roll
          // back so a retry with the same clientRequestId re-enqueues cleanly.
          const hasUserItem = sessionItems.some((item) =>
            item.turnId === turn.id && item.kind === 'user_message'
          )
          if (hasUserItem) {
            await this['markTurnAdmissionCompleted'](thread.id, turn.id, {}).catch(() => undefined)
          } else {
            const rolledBack = await this['rollbackPendingAdmission'](thread.id, turn.id).catch(() => false)
            if (!rolledBack) {
              await this.interruptTurn({ threadId: thread.id, turnId: turn.id }).catch(() => undefined)
            }
          }
          continue
        }
        if (
          turn.admissionPending ||
          (!turn.admissionCompletedAt && thread.designProfile?.lockedAtTurnId === turn.id)
        ) {
          // This turn never crossed the admission boundary. Removing its
          // provisional item/profile is recovery, not a failed user turn, so
          // it must not create an interruption checkpoint or goal resume.
          const rolledBack = await this['rollbackPendingAdmission'](
            thread.id,
            turn.id
          ).catch(() => false)
          if (!rolledBack) {
            await this.interruptTurn({
              threadId: thread.id,
              turnId: turn.id
            }).catch(() => undefined)
          }
          continue
        }
        if (turn.status === 'running' && turn.orchestration === 'graph') {
          const durablePlanning = await this['deps'].resolveGraphPlanningDraft?.({
            threadId: thread.id,
            sourceTurnId: turn.id
          }).catch(() => null)
          if (durablePlanning?.state === 'cancelled') {
            // A cancel endpoint may have durably fenced the draft immediately
            // before the process exited. Complete the idempotent source/run
            // cancellation instead of leaving a spinner with no resume action.
            await this.interruptTurn({
              threadId: thread.id,
              turnId: turn.id
            }).catch(() => undefined)
            continue
          }
          if (turn.graphPlanningLifecycle?.suspendedAt) {
            // A clean host shutdown already parked this planning turn without
            // declaring the draft invalid. Keep it resumable in the same state.
            continue
          }
          let suspension = await this.suspendGraphLeadTurn({
            threadId: thread.id,
            turnId: turn.id
          }).catch(() => 'not_graph' as const)
          if (suspension === 'supervision_pending') {
            // Submitted/reviewing nodes are durable recovery work, not an
            // orphan failure. Park without acknowledging their event cursor;
            // GraphRuntime recovery will redeliver supervision to the Lead.
            suspension = await this.suspendGraphLeadTurn({
              threadId: thread.id,
              turnId: turn.id,
              force: true,
              preserveDeliveryCursor: true,
              allowPendingSupervision: true
            }).catch(() => 'not_graph' as const)
          }
          if (
            suspension === 'suspended' ||
            suspension === 'suspended_pending_supervision' ||
            suspension === 'pending_steering' ||
            suspension === 'graph_terminal'
          ) {
            continue
          }
        }
        try {
          await this.finishTurn({
            threadId: thread.id,
            turnId: turn.id,
            status: 'failed',
            error: 'Turn was interrupted by a runtime restart.',
            code: 'orphaned_after_restart',
            severity: 'warning'
          })
          // Persist a model-visible checkpoint so the auto-resumed turn can
          // pick up where the work stopped without the user repeating it.
          const checkpointed = await recordInterruptionCheckpoint(this, {
            threadId: thread.id,
            turnId: turn.id,
            fallbackPrompt: turn.prompt,
            sessionItems
          })
          if (checkpointed) {
            reconciledSources.set(thread.id, { threadId: thread.id, turnId: turn.id })
          }
        } catch {
          // Best-effort sweep; one unreadable thread must not stop the rest.
        }
      }
    }
    return [...reconciledSources.values()]
  },

/**
 * Recover turns the Manager settled after their Runtime owner disappeared.
 * New turns carry Manager-authored settlement provenance. The exact canonical
 * error item is a compatibility bridge only for records predating that field.
 */
async reconcileManagerSettledInterruptions(this: TurnService, input: {
    settledAfter?: string
  } = {}): Promise<RestartRecoverySource[]> {
    const summaries = await this['deps'].threadStore.list({ includeSide: true })
    const candidateSources = new Map<string, RestartRecoverySource>()
    for (const summary of summaries) {
      if (
        summary.status !== 'idle' ||
        (summary.relation !== 'primary' && summary.relation !== 'fork')
      ) continue
      try {
        const thread = await this['deps'].threadStore.get(summary.id)
        if (
          !thread ||
          thread.status !== 'idle' ||
          (thread.relation !== 'primary' && thread.relation !== 'fork') ||
          thread.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')
        ) continue
        const latest = thread.turns.at(-1)
        if (!latest || latest.status !== 'failed') continue

        let sessionItems: TurnItem[] | undefined
        const managerSettlement = latest.managerLeaseSettlement
        let recoverable = Boolean(
          managerSettlement?.code === 'owner_lease_expired' &&
          timestampAtOrAfter(managerSettlement.settledAt, input.settledAfter)
        )
        if (!managerSettlement && latest.terminalCode === undefined) {
          sessionItems = await this['deps'].sessionStore.loadItems(thread.id)
          const canonicalItemId = `item_${latest.id}_owner_lease_expired`
          recoverable = timestampAtOrAfter(latest.finishedAt, input.settledAfter) &&
            sessionItems.some((item) =>
              item.id === canonicalItemId &&
              item.turnId === latest.id &&
              item.kind === 'error' &&
              item.code === 'owner_lease_expired'
            )
        }
        if (!recoverable) continue
        sessionItems ??= await this['deps'].sessionStore.loadItems(thread.id)
        const checkpointed = await recordInterruptionCheckpoint(this, {
          threadId: thread.id,
          turnId: latest.id,
          fallbackPrompt: latest.prompt,
          sessionItems
        })
        if (checkpointed) {
          candidateSources.set(thread.id, { threadId: thread.id, turnId: latest.id })
        }
      } catch (error) {
        console.warn(
          `[kun] Manager-settled interruption reconciliation skipped ${summary.id}: ` +
          `${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    return [...candidateSources.values()]
  },

async getTurn(this: TurnService, threadId: string, turnId: string): Promise<Turn | null> {
    const thread = await this['deps'].threadStore.get(threadId)
    return thread?.turns.find((turn) => turn.id === turnId) ?? null
  },

/**
   * Append the stable active-goal context exactly once before a model request.
   * This deliberately bypasses applyItem(): it is canonical model history,
   * not renderer content, so it must not create an SSE item event or enter the
   * renderer-facing thread mirror.
   */
async ensureGoalContext(this: TurnService, threadId: string, turnId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return
    await this['withThreadMutation'](threadId, async () => {
      // The caller can wait behind another mutation while its execution lease
      // is cancelled. Check again inside the serialized section so an aborted
      // turn never gains model-only history after that wait.
      if (signal?.aborted) return
      const current = await this['deps'].threadStore.get(threadId)
      const turn = current?.turns.find((candidate) => candidate.id === turnId)
      if (!current || !turn || (turn.status !== 'queued' && turn.status !== 'running')) return
      const text = goalContextInstruction(current.goal)
      const goalKey = goalContextKey(current.goal)
      if (!text || !goalKey) return

      const existing = await this['deps'].sessionStore.loadItems(threadId)
      // The goal record is a thread-level cache prefix, not a per-turn
      // instruction. One active generation must therefore be represented
      // exactly once even when the goal spans many user turns.
      if (existing.some((item) => item.kind === 'goal_context' && item.goalKey === goalKey)) {
        return
      }
      if (signal?.aborted) return
      const itemId = `item_${turnId}_goal_context_${goalKey}`
      await this['deps'].sessionStore.appendItem(threadId, makeGoalContextItem({
        id: itemId,
        threadId,
        turnId,
        goalKey,
        text,
        createdAt: this['deps'].nowIso()
      }))
    })
  },

async updateTurnMetadata(this: TurnService,
    threadId: string,
    turnId: string,
    patch: Omit<Pick<
      Partial<Turn>,
      | 'activeSkillIds'
      | 'injectedMemoryIds'
      | 'injectedMemorySummaries'
      | 'skillInjectionBytes'
      | 'injectedInstructionSources'
      | 'instructionInjectionBytes'
      | 'toolCatalogFingerprint'
      | 'toolCatalogToolCount'
      | 'toolCatalogDrift'
      | 'requiredToolGate'
      | 'extensionModelRequests'
      | 'extensionToolInvocations'
      | 'workspaceCheckpointId'
      | 'actingModelRoute'
      | 'graphPlanningLifecycle'
    >, 'requiredToolGate'>
      & { requiredToolGate?: Turn['requiredToolGate'] | null }
  ): Promise<void> {
    await this['upsertThread'](threadId, (current) => ({
      ...current,
      turns: current.turns.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              ...(patch.activeSkillIds ? { activeSkillIds: [...patch.activeSkillIds] } : {}),
              ...(patch.injectedMemoryIds ? { injectedMemoryIds: [...patch.injectedMemoryIds] } : {}),
              ...(patch.injectedMemorySummaries
                ? { injectedMemorySummaries: [...patch.injectedMemorySummaries] }
                : {}),
              ...(patch.skillInjectionBytes !== undefined ? { skillInjectionBytes: patch.skillInjectionBytes } : {}),
              ...(patch.injectedInstructionSources
                ? { injectedInstructionSources: [...patch.injectedInstructionSources] }
                : {}),
              ...(patch.instructionInjectionBytes !== undefined
                ? { instructionInjectionBytes: patch.instructionInjectionBytes }
                : {}),
              ...(patch.toolCatalogFingerprint ? { toolCatalogFingerprint: patch.toolCatalogFingerprint } : {}),
              ...(patch.toolCatalogToolCount !== undefined ? { toolCatalogToolCount: patch.toolCatalogToolCount } : {}),
              ...(patch.toolCatalogDrift !== undefined ? { toolCatalogDrift: patch.toolCatalogDrift } : {}),
              ...(patch.requiredToolGate === null
                ? { requiredToolGate: undefined }
                : patch.requiredToolGate
                  ? { requiredToolGate: patch.requiredToolGate }
                  : {}),
              ...(patch.extensionModelRequests !== undefined
                ? { extensionModelRequests: patch.extensionModelRequests }
                : {}),
              ...(patch.extensionToolInvocations !== undefined
                ? { extensionToolInvocations: patch.extensionToolInvocations }
                : {}),
              ...(patch.workspaceCheckpointId
                ? { workspaceCheckpointId: patch.workspaceCheckpointId }
                : {}),
              // The first resolved model/provider/account tuple owns the turn.
              // Later steps and settings changes cannot replace it.
              ...(!turn.actingModelRoute && patch.actingModelRoute
                ? { actingModelRoute: { ...patch.actingModelRoute } }
                : {}),
              ...(patch.graphPlanningLifecycle
                ? { graphPlanningLifecycle: { ...patch.graphPlanningLifecycle } }
                : {})
            }
          : turn
      )
    }))
  },
}

/**
 * Best-effort, model-visible checkpoint for one interrupted turn. Writes an
 * `interruption_note` internal record (replacing any older note on the same
 * thread) so an auto-resumed turn can continue the original request without
 * the user repeating it. Never touches the renderer projection: the note is
 * canonical session history only, exactly like `goal_context`.
 */
async function recordInterruptionCheckpoint(
  service: TurnService,
  input: {
    threadId: string
    turnId: string
    fallbackPrompt: string
    sessionItems: TurnItem[]
  }
): Promise<boolean> {
  const noteText = buildInterruptionNoteText(extractInterruptionSummary(input))
  if (!noteText.trim()) return false
  const now = service['deps'].nowIso()
  const note = makeInterruptionNoteItem({
    id: `item_${input.turnId}_interruption_note`,
    turnId: input.turnId,
    threadId: input.threadId,
    sourceTurnId: input.turnId,
    text: noteText,
    createdAt: now
  }) as InterruptionNoteTurnItem
  try {
    const result = await rewriteItemHistoryWithRetry({
      sessionStore: service['deps'].sessionStore,
      threadId: input.threadId,
      maxAttempts: 2,
      build: (snapshot) => {
        const notes = snapshot.items.filter(
          (item): item is InterruptionNoteTurnItem => item.kind === 'interruption_note'
        )
        const alreadyCanonical = notes.length === 1 &&
          notes[0].id === note.id &&
          notes[0].sourceTurnId === note.sourceTurnId &&
          notes[0].text === note.text
        if (alreadyCanonical) {
          return { changed: false, items: snapshot.items, value: undefined }
        }
        const withoutNotes = snapshot.items.filter((item) => item.kind !== 'interruption_note')
        return {
          changed: true,
          items: [...withoutNotes, note],
          value: undefined
        }
      }
    })
    return result.status === 'applied' || result.status === 'unchanged'
  } catch (error) {
    console.warn(
      `[kun] interruption checkpoint write failed for ${input.threadId}: ` +
      `${error instanceof Error ? error.message : String(error)}`
    )
    return false
  }
}

function timestampAtOrAfter(value: string | undefined, threshold: string | undefined): boolean {
  if (!threshold) return true
  if (!value) return false
  const valueMs = Date.parse(value)
  const thresholdMs = Date.parse(threshold)
  return Number.isFinite(valueMs) && Number.isFinite(thresholdMs) && valueMs >= thresholdMs
}

const MAX_INTERRUPTION_TOOL_DETAIL_CHARS = 240
const MAX_INTERRUPTION_TOOL_CALLS = 8

function extractInterruptionSummary(input: {
  turnId: string
  fallbackPrompt: string
  sessionItems: TurnItem[]
}): {
  userRequest: string
  lastAssistantText?: string
  recentToolCalls: Array<{ toolName: string; detail: string }>
} {
  const turnItems = input.sessionItems.filter((item) => item.turnId === input.turnId)
  let userRequest = ''
  for (const item of turnItems) {
    if (item.kind === 'user_message' && item.text.trim()) {
      userRequest = item.text.trim()
      break
    }
  }
  if (!userRequest) userRequest = input.fallbackPrompt.trim()
  let lastAssistantText = ''
  for (let index = turnItems.length - 1; index >= 0; index -= 1) {
    const item = turnItems[index]
    if (item.kind === 'assistant_text' && item.text.trim()) {
      lastAssistantText = item.text.trim()
      break
    }
  }
  const recentToolCalls: Array<{ toolName: string; detail: string }> = []
  const seenCallIds = new Set<string>()
  for (const item of turnItems) {
    if (item.kind !== 'tool_call' || item.status !== 'completed') continue
    if (seenCallIds.has(item.callId)) continue
    seenCallIds.add(item.callId)
    const rawDetail = item.summary?.trim() || JSON.stringify(item.arguments)
    recentToolCalls.push({
      toolName: item.toolName,
      detail: boundText(rawDetail, MAX_INTERRUPTION_TOOL_DETAIL_CHARS)
    })
    if (recentToolCalls.length >= MAX_INTERRUPTION_TOOL_CALLS) break
  }
  return {
    userRequest,
    ...(lastAssistantText ? { lastAssistantText } : {}),
    recentToolCalls
  }
}

function boundText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}…`
}
