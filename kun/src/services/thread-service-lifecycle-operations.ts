import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ThreadStore, ThreadStoreListOptions } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type {
  CreateThreadRequest,
  SetThreadGoalRequest,
  SetThreadTodosRequest,
  ThreadGoal,
  ThreadMode,
  ThreadRecord,
  ThreadRelation,
  ThreadStatus,
  ThreadUpdateStatus,
  ThreadTodoItem,
  ThreadTodoList,
  ThreadTodoSource,
  ThreadTodoStatus,
  ThreadSummary,
  ResumeSessionMetadata
} from '../contracts/threads.js'
import type { ExtensionThreadMetadata } from '../contracts/threads.js'
import type {
  ApprovalPolicy,
  ApprovalReviewer,
  SandboxMode
} from '../contracts/policy.js'
import type { Turn } from '../contracts/turns.js'
import { isPublicTurnItem, type TurnItem } from '../contracts/items.js'
import {
  createThreadRecord,
  resolveThreadAgentSurface,
  toThreadSummary,
  touchThread
} from '../domain/thread.js'
import type { AgentSession } from '../domain/session.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { ThreadLifecycleFence } from './thread-lifecycle-fence.js'
import { withFileMutationQueue } from '../adapters/tool/file-mutation-queue.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'
import { DEFAULT_KUN_MODEL } from '../config/kun-config.js'
import { isGuiPlanRelativePath } from '../shared/gui-plan.js'
import {
  extractPlanTodos,
  mergePlanTodos,
  normalizePlanRelativePath,
  normalizeTodoContent,
  patchPlanTodoStatus,
  todoContentHash
} from '../shared/todos.js'
import { type ThreadService, type ThreadServiceOptions, type ListThreadsOptions, type ForkThreadOptions, type ResumeSessionOptions, type ResumeSessionResult, type SyncPlanTodosOptions, cloneTurnForThread, normalizeTodoItems, preserveToolTodoSources, normalizeTodoStatus, normalizeTodoSource, findExistingTodoForRaw, sameTodoSource, uniqueTodoId, cloneTodoListForThread, resolveWorkspaceRelativePath, cloneTurnForFork, cloneItemForThread, cloneSessionItemsForThread, matchesThreadSearch, threadStatusFromTurns, rebuildTurnsFromItems, attachmentIdsFromItems, toSessionSnapshot } from './thread-service-core.js'
import {
  retargetDesignTaskProfile,
  sameDesignDocumentTarget
} from '../domain/design-task-profile.js'

const DESIGN_CLONE_COMMIT = Symbol('design-clone-commit')
type InternalForkThreadOptions = ForkThreadOptions & {
  [DESIGN_CLONE_COMMIT]?: string
}
type InternalResumeSessionOptions = ResumeSessionOptions & {
  [DESIGN_CLONE_COMMIT]?: string
}

export const threadServiceLifecycleOperations = {
async delete(this: ThreadService, threadId: string): Promise<boolean> {
    let rawDeleteCommitted = false
    try {
      return await this['withThreadMutation'](threadId, async () => {
        // A concurrent delete that arrives after this service already removed
        // the thread must not reopen its fence on a raw false result.
        if (this['lifecycleFence']?.isDeleted(threadId)) return false

        this['lifecycleFence']?.beginClose(threadId)
        // Stop only this thread's live work. We intentionally do not settle
        // the turn record here: any late lifecycle writes are now fenced off
        // and the canonical record is about to be removed.
        await this['onDeleting']?.(threadId)
        await this['lifecycleFence']?.drain(threadId)
        // Never route deletion through the fenced facade: it is the terminal
        // raw operation after all old-generation writes have drained.
        const ok = await this['deleteThreadStore'].delete(threadId)
        if (!ok) {
          // A failed/no-op deletion must not leave a still-visible thread
          // permanently unwritable. Existing leases remain invalid because
          // this is nevertheless a fresh generation.
          this['lifecycleFence']?.reopen(threadId)
          return false
        }
        rawDeleteCommitted = true
        this['lifecycleFence']?.markDeleted(threadId)
        this['sessionStore'].clearThreadMemory(threadId)
        await this['onDeleted']?.(threadId)
        return true
      })
    } catch (error) {
      // Once raw deletion succeeds, keep the fence closed even when a
      // best-effort cleanup callback fails; reopening here would let a later
      // delayed write recreate the directory that was just removed.
      if (!rawDeleteCommitted) this['lifecycleFence']?.reopen(threadId)
      throw error
    }
  },

async deleteByWorkspace(this: ThreadService, workspace: string): Promise<string[]> {
    const normalized = workspace.trim()
    if (!normalized) return []
    const summaries = await this.list({
      workspace: normalized,
      includeArchived: true,
      includeSide: true
    })
    const deleted: string[] = []
    for (const summary of summaries) {
      if (await this.delete(summary.id)) deleted.push(summary.id)
    }
    return deleted
  },

async fork(this: ThreadService, threadId: string, options: ForkThreadOptions = {}): Promise<ThreadRecord> {
    const internalOptions = options as InternalForkThreadOptions
    if (options.designCloneOperationId && !internalOptions[DESIGN_CLONE_COMMIT]) {
      const source = await this['threadStore'].get(threadId)
      if (!source) throw new Error(`thread not found: ${threadId}`)
      const forkId = designCloneThreadId(options.designCloneOperationId)
      return withThreadStoreMutation(this['threadStore'], forkId, async () => {
        const existing = await this['threadStore'].get(forkId)
        if (existing) return validateExistingDesignClone(existing, {
          kind: 'fork', sourceId: threadId, expectedWorkspace: source.workspace, options
        })
        return this.fork(threadId, {
          ...options,
          [DESIGN_CLONE_COMMIT]: forkId
        } as InternalForkThreadOptions)
      })
    }
    const current = await this['threadStore'].get(threadId)
    if (!current) throw new Error(`thread not found: ${threadId}`)
    if (
      options.approvalReviewer !== undefined &&
      options.approvalReviewer !== current.approvalReviewer
    ) {
      throw new Error('fork approval reviewer must inherit the source thread')
    }
    if (current.designProfile && !options.designDocumentTarget) {
      throw new Error('forking a Design task requires an independently cloned document target')
    }
    if (Boolean(options.designDocumentTarget) !== Boolean(options.designCloneOperationId)) {
      throw new Error('a Design clone target requires a stable clone operation id')
    }
    if (!current.designProfile && options.designDocumentTarget) {
      throw new Error('a Design document target can only fork a locked Design task')
    }
    if (
      current.designProfile &&
      options.designDocumentTarget &&
      sameDesignDocumentTarget(current.designProfile.documentTarget, options.designDocumentTarget)
    ) {
      throw new Error('a Design fork must use a different document target')
    }
    const now = this['nowIso']()
    const forkId = internalOptions[DESIGN_CLONE_COMMIT] ?? this['ids'].next('thr')
    const relation: ThreadRelation = options.relation ?? 'fork'
    const targetTurnId = options.turnId?.trim()
    const targetTurnIndex = targetTurnId
      ? current.turns.findIndex((turn) => turn.id === targetTurnId)
      : -1
    if (targetTurnId && targetTurnIndex < 0) {
      throw new Error(`turn not found: ${targetTurnId}`)
    }
    const sourceTurns = targetTurnId
      ? current.turns.slice(0, targetTurnIndex + (options.beforeTurn ? 0 : 1))
      : current.turns
    // Snapshot semantics: clone each turn as it stands now. The parent
    // loop keeps mutating its own record; we copy, never borrow.
    const clonedTurns = sourceTurns.map((turn) =>
      cloneTurnForFork(turn, forkId, now, {
        relation,
        designDocumentTarget: options.designDocumentTarget
      })
    )
    const clonedPublicItems = clonedTurns.flatMap((turn) => turn.items)
    const persistedItems = await this['sessionStore'].loadItems(threadId)
    const clonedSessionItems = cloneSessionItemsForThread({
      // A pre-boundary FileThreadStore can contain a complete legacy mirror
      // while its canonical stream is absent. Preserve the internal item in
      // that recovery path too; cloneTurnForThread above still strips it from
      // the new ThreadRecord mirror.
      sourceItems: persistedItems.length > 0
        ? persistedItems
        : sourceTurns.flatMap((turn) => turn.items),
      clonedTurns,
      threadId: forkId,
      now
    })
    const defaultTitle = relation === 'side' ? `${current.title} · side` : `${current.title} fork`
    const forkIncludesLatestTurn = !targetTurnId || clonedTurns.length === current.turns.length
    const fork = createThreadRecord({
      id: forkId,
      title: options.title?.trim() || defaultTitle,
      workspace: current.workspace,
      additionalWorkspaces: current.additionalWorkspaces,
      knowledgeBases: current.knowledgeBases,
      model: current.model,
      agentSurface: resolveThreadAgentSurface(current),
      ...(current.designProfile && options.designDocumentTarget
        ? {
            designProfile: retargetDesignTaskProfile(
              current.designProfile,
              options.designDocumentTarget
            )
          }
        : {}),
      ...(options.designCloneOperationId
        ? {
            designCloneOperation: {
              operationId: options.designCloneOperationId,
              kind: 'fork' as const,
              sourceId: threadId
            }
          }
        : {}),
      ...(current.providerId ? { providerId: current.providerId } : {}),
      ...(current.accountId ? { accountId: current.accountId } : {}),
      ...(current.agentId ? { agentId: current.agentId } : {}),
      ...(current.systemPrompt ? { systemPrompt: current.systemPrompt } : {}),
      // A fork is a fresh conversation branch, not a continuation of the
      // parent's plan workflow — the plan artifact and its workspace belong to
      // the source thread. Inheriting `mode: 'plan'` made a forked "new
      // conversation" run as a plan turn bound to a stale plan context, which
      // hard-failed create_plan (workspace mismatch) and produced malformed
      // plan-mode model requests. Default forks to agent; the user can re-enter
      // plan mode in the fork if they want a fresh plan.
      mode: 'agent',
      status: 'idle',
      approvalPolicy: current.approvalPolicy,
      sandboxMode: current.sandboxMode,
      approvalReviewer: current.approvalReviewer,
      modelRequestCaptureEnabled: this['defaultModelRequestCaptureEnabled'],
      relation,
      parentThreadId: current.id,
      forkedFromThreadId: current.id,
      forkedFromTitle: current.title,
      forkedAt: now,
      forkedFromMessageCount: clonedPublicItems.filter((item) => item.kind === 'user_message').length,
      forkedFromTurnCount: clonedTurns.length,
      ...(forkIncludesLatestTurn && current.todos ? { todos: cloneTodoListForThread(current.todos, forkId, now) } : {}),
      createdAt: now
    })
    const record: ThreadRecord = {
      ...fork,
      updatedAt: now,
      turns: clonedTurns
    }
    for (const item of clonedSessionItems) {
      await this['sessionStore'].appendItem(record.id, item)
    }
    // This is the lifecycle commit boundary. Once the target thread exists,
    // the successful return is authoritative; notification/callback failures
    // must not make a client delete an already-cloned Design document.
    await this['threadStore'].upsert(record)
    try {
      await this['events'].record({
        kind: 'thread_created',
        threadId: record.id,
        title: record.title,
        ...(record.agentSurface ? { agentSurface: record.agentSurface } : {}),
        ...(record.designProfile ? { designProfile: record.designProfile } : {}),
        approvalPolicy: record.approvalPolicy,
        sandboxMode: record.sandboxMode,
        approvalReviewer: record.approvalReviewer
      })
    } catch (error) {
      warnPostCommitFailure('fork thread_created event', record.id, error)
    }
    try {
      await this['onForked']?.(threadId, record.id)
    } catch (error) {
      warnPostCommitFailure('fork callback', record.id, error)
    }
    return record
  },

async getResumeSessionMetadata(this: ThreadService,
    sessionId: string
  ): Promise<ResumeSessionMetadata> {
    const sourceThread = await this['threadStore'].get(sessionId)
    const sourceSession = await this['sessionStore'].loadSession(sessionId)
    const persistedItems = await this['sessionStore'].loadItems(sessionId)
    const sourceSessionItems = persistedItems.length > 0
      ? persistedItems
      : sourceSession?.items.length
        ? sourceSession.items
        : sourceThread?.turns.flatMap((turn) => turn.items) ?? []
    if (!sourceThread && !sourceSession && sourceSessionItems.length === 0) {
      throw new Error(`session not found: ${sessionId}`)
    }
    const sourceDesignProfile = sourceThread?.designProfile ?? sourceSessionItems.find(
      (item): item is Extract<TurnItem, { kind: 'user_message' }> =>
        item.kind === 'user_message' && Boolean(item.designProfile)
    )?.designProfile
    const sourceWorkspace = sourceThread?.workspace ?? (sourceDesignProfile
      ? sourceSessionItems.find(
          (item): item is Extract<TurnItem, { kind: 'user_message' }> =>
            item.kind === 'user_message' && Boolean(item.workspace)
        )?.workspace
      : undefined)
    const sourceAgentSurface = sourceThread
      ? resolveThreadAgentSurface(sourceThread)
      : sourceSessionItems.find(
          (item): item is Extract<TurnItem, { kind: 'user_message' }> =>
            item.kind === 'user_message' && Boolean(item.threadAgentSurface)
        )?.threadAgentSurface ?? (sourceDesignProfile ? 'design' : 'code')
    return {
      sessionId,
      sourceAgentSurface,
      ...(sourceWorkspace ? { workspace: sourceWorkspace } : {}),
      ...(sourceDesignProfile
        ? {
            sourceDesignProfile,
            sourceDesignDocumentTarget: sourceDesignProfile.documentTarget
          }
        : {}),
      requiresIndependentDesignTarget: Boolean(sourceDesignProfile)
    }
  },

async resumeSession(this: ThreadService,
    sessionId: string,
    options: ResumeSessionOptions = {}
  ): Promise<ResumeSessionResult> {
    const internalOptions = options as InternalResumeSessionOptions
    if (options.designCloneOperationId && !internalOptions[DESIGN_CLONE_COMMIT]) {
      const threadId = designCloneThreadId(options.designCloneOperationId)
      return withThreadStoreMutation(this['threadStore'], threadId, async () => {
        const existing = await this['threadStore'].get(threadId)
        if (existing) {
          const validated = validateExistingDesignClone(existing, {
            kind: 'resume', sourceId: sessionId,
            expectedWorkspace: options.workspace,
            options
          })
          return {
            thread: validated,
            sessionId,
            messageCount: validated.turns.flatMap((turn) => turn.items)
              .filter((item) => item.kind === 'user_message').length
          }
        }
        return this.resumeSession(sessionId, {
          ...options,
          [DESIGN_CLONE_COMMIT]: threadId
        } as InternalResumeSessionOptions)
      })
    }
    const sourceThread = await this['threadStore'].get(sessionId)
    const sourceSession = await this['sessionStore'].loadSession(sessionId)
    const persistedItems = await this['sessionStore'].loadItems(sessionId)
    const sourceSessionItems = persistedItems.length > 0
      ? persistedItems
      : sourceSession?.items.length
        ? sourceSession.items
        : sourceThread?.turns.flatMap((turn) => turn.items) ?? []
    if (!sourceThread && !sourceSession && sourceSessionItems.length === 0) {
      throw new Error(`session not found: ${sessionId}`)
    }
    const sourceDesignProfile = sourceThread?.designProfile ?? sourceSessionItems.find(
      (item): item is Extract<TurnItem, { kind: 'user_message' }> =>
        item.kind === 'user_message' && Boolean(item.designProfile)
    )?.designProfile
    const sourceWorkspace = sourceThread?.workspace ?? (sourceDesignProfile
      ? sourceSessionItems.find(
          (item): item is Extract<TurnItem, { kind: 'user_message' }> =>
            item.kind === 'user_message' && Boolean(item.workspace)
        )?.workspace
      : undefined)
    const sourceAgentSurface = sourceThread
      ? resolveThreadAgentSurface(sourceThread)
      : sourceSessionItems.find(
          (item): item is Extract<TurnItem, { kind: 'user_message' }> =>
            item.kind === 'user_message' && Boolean(item.threadAgentSurface)
        )?.threadAgentSurface ?? (sourceDesignProfile ? 'design' : 'code')
    if (sourceDesignProfile && !options.designDocumentTarget) {
      throw new Error('resuming a Design task requires an independently cloned document target')
    }
    if (Boolean(options.designDocumentTarget) !== Boolean(options.designCloneOperationId)) {
      throw new Error('a Design clone target requires a stable clone operation id')
    }
    if (!sourceDesignProfile && options.designDocumentTarget) {
      throw new Error('a Design document target can only resume a locked Design task')
    }
    if (
      sourceDesignProfile &&
      options.designDocumentTarget &&
      sameDesignDocumentTarget(sourceDesignProfile.documentTarget, options.designDocumentTarget)
    ) {
      throw new Error('a resumed Design task must use a different document target')
    }
    if (
      sourceDesignProfile &&
      options.workspace &&
      sourceWorkspace &&
      resolve(options.workspace) !== resolve(sourceWorkspace)
    ) {
      throw new Error('a resumed Design task must remain in the source workspace')
    }
    if (sourceDesignProfile && !sourceWorkspace) {
      throw new Error('resuming a Design task requires its persisted source workspace')
    }
    if (
      sourceThread &&
      options.approvalReviewer !== undefined &&
      options.approvalReviewer !== sourceThread.approvalReviewer
    ) {
      throw new Error('resumed approval reviewer must inherit the source thread')
    }

    const now = this['nowIso']()
    const threadId = internalOptions[DESIGN_CLONE_COMMIT] ?? this['ids'].next('thr')
    const sourceTurns = sourceThread
      ? sourceThread.turns
      : rebuildTurnsFromItems({
          // Reconstructed public turns intentionally exclude internal model
          // context; the full ordered stream is cloned separately below.
          items: sourceSessionItems.filter(isPublicTurnItem),
          threadId,
          fallbackTurnId: sourceSession?.turnId || sourceSessionItems[0]?.turnId || this['ids'].next('turn'),
          fallbackPrompt: `Resumed session ${sessionId.slice(0, 8)}`,
          now
        })
    const clonedTurns = sourceTurns.map((turn) => cloneTurnForThread(
      turn,
      threadId,
      now,
      options.designDocumentTarget
    ))
    const clonedPublicItems = clonedTurns.flatMap((turn) => turn.items)
    const clonedSessionItems = cloneSessionItemsForThread({
      sourceItems: sourceSessionItems,
      clonedTurns,
      threadId,
      now
    })
    const sourceTitle = sourceThread?.title ?? `Session ${sessionId.slice(0, 8)}`
    const record = createThreadRecord({
      id: threadId,
      title: `${sourceTitle} resumed`,
      workspace: sourceDesignProfile
        ? sourceWorkspace!
        : options.workspace ?? sourceThread?.workspace ?? '~',
      model: options.model ?? sourceThread?.model ?? DEFAULT_KUN_MODEL,
      agentSurface: sourceAgentSurface,
      ...(sourceDesignProfile && options.designDocumentTarget
        ? {
            designProfile: retargetDesignTaskProfile(
              sourceDesignProfile,
              options.designDocumentTarget
            )
          }
        : {}),
      ...(options.designCloneOperationId
        ? {
            designCloneOperation: {
              operationId: options.designCloneOperationId,
              kind: 'resume' as const,
              sourceId: sessionId
            }
          }
        : {}),
      mode: options.mode ?? sourceThread?.mode ?? 'agent',
      status: 'idle',
      approvalPolicy: sourceThread?.approvalPolicy,
      sandboxMode: sourceThread?.sandboxMode,
      approvalReviewer: sourceThread?.approvalReviewer ?? options.approvalReviewer,
      modelRequestCaptureEnabled: this['defaultModelRequestCaptureEnabled'],
      forkedFromThreadId: sourceThread?.id,
      forkedFromTitle: sourceThread?.title,
      forkedAt: now,
      forkedFromMessageCount: clonedPublicItems.filter((item) => item.kind === 'user_message').length,
      forkedFromTurnCount: clonedTurns.length,
      ...(sourceThread?.todos ? { todos: cloneTodoListForThread(sourceThread.todos, threadId, now) } : {}),
      createdAt: now
    })
    const resumed: ThreadRecord = {
      ...record,
      updatedAt: now,
      turns: clonedTurns
    }
    for (const item of clonedSessionItems) {
      await this['sessionStore'].appendItem(resumed.id, item)
    }
    // As with fork, target ThreadRecord persistence is the response commit.
    await this['threadStore'].upsert(resumed)
    try {
      await this['sessionStore'].upsertSession(toSessionSnapshot(resumed, now, clonedSessionItems))
    } catch (error) {
      warnPostCommitFailure('resume session snapshot', resumed.id, error)
    }
    try {
      await this['events'].record({
        kind: 'thread_created',
        threadId: resumed.id,
        title: resumed.title,
        ...(resumed.agentSurface ? { agentSurface: resumed.agentSurface } : {}),
        ...(resumed.designProfile ? { designProfile: resumed.designProfile } : {}),
        approvalPolicy: resumed.approvalPolicy,
        sandboxMode: resumed.sandboxMode,
        approvalReviewer: resumed.approvalReviewer
      })
    } catch (error) {
      warnPostCommitFailure('resume thread_created event', resumed.id, error)
    }
    return { thread: resumed, sessionId, messageCount: clonedPublicItems.length }
  },

toSummary(this: ThreadService, thread: ThreadRecord): ThreadSummary {
    return toThreadSummary(thread)
  },
}

function warnPostCommitFailure(operation: string, threadId: string, error: unknown): void {
  console.warn(
    `[kun] ${operation} failed after thread commit for ${threadId}: ` +
    `${error instanceof Error ? error.message : String(error)}`
  )
}

function designCloneThreadId(operationId: string): string {
  const digest = createHash('sha256').update(operationId).digest('hex').slice(0, 32)
  return `thr_design_${digest}`
}

function validateExistingDesignClone(
  existing: ThreadRecord,
  input: {
    kind: 'fork' | 'resume'
    sourceId: string
    expectedWorkspace?: string
    options: ForkThreadOptions | ResumeSessionOptions
  }
): ThreadRecord {
  const operationId = input.options.designCloneOperationId
  const target = input.options.designDocumentTarget
  const existingTarget = existing.designProfile?.documentTarget
  const existingOperation = existing.designCloneOperation
  const expectedRelation = input.kind === 'fork'
    ? (input.options as ForkThreadOptions).relation ?? 'fork'
    : 'primary'
  const matches = Boolean(operationId && target)
    && existingOperation?.operationId === operationId
    && existingOperation?.kind === input.kind
    && existingOperation?.sourceId === input.sourceId
    && existing.relation === expectedRelation
    && (!input.expectedWorkspace || resolve(existing.workspace) === resolve(input.expectedWorkspace))
    && existingTarget?.documentId === target?.documentId
    && existingTarget?.boardArtifactId === target?.boardArtifactId
    && (input.kind !== 'fork' || (
      existing.parentThreadId === input.sourceId &&
      existing.forkedFromThreadId === input.sourceId
    ))
  if (!matches) {
    throw new Error(`Design clone operation is already committed to a different target: ${operationId}`)
  }
  return existing
}
