import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ThreadStore, ThreadStoreListOptions, ThreadStoreListPage } from '../ports/thread-store.js'
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
  KnowledgeBaseMount,
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
import type { DesignDocumentTarget } from '../contracts/design-task-profile.js'
import { isPublicTurnItem, type TurnItem } from '../contracts/items.js'
import {
  createThreadRecord,
  resolveThreadAgentSurface,
  toThreadSummary,
  touchThread
} from '../domain/thread.js'
import type { AgentSession } from '../domain/session.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'
import {
  retargetDesignTaskProfile
} from '../domain/design-task-profile.js'
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
import { installServiceOperations } from './service-operation-install.js'
import { threadServiceMetadataOperations } from './thread-service-metadata-operations.js'
import { threadServiceGoalsOperations } from './thread-service-goals-operations.js'
import { threadServiceTodosOperations } from './thread-service-todos-operations.js'
import { threadServiceLifecycleOperations } from './thread-service-lifecycle-operations.js'

export type ThreadServiceOptions = {
  threadStore: ThreadStore
  /** Raw store used only after the lifecycle fence has been closed and drained. */
  deleteThreadStore?: ThreadStore
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  ids: IdGenerator
  nowIso: () => string
  defaultApprovalPolicy?: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  defaultModelRequestCaptureEnabled?: boolean
  lifecycleFence?: ThreadLifecycleFence
  /** Abort in-process work after the fence starts rejecting new writes. */
  onDeleting?: (threadId: string) => Promise<void> | void
  onDeleted?: (threadId: string) => Promise<void> | void
  onStatusChanged?: (
    threadId: string,
    status: ThreadStatus
  ) => Promise<void> | void
  onForked?: (
    sourceThreadId: string,
    targetThreadId: string
  ) => Promise<void> | void
}

export type ListThreadsOptions = ThreadStoreListOptions & {
  /** Return the lean sidebar projection (omits heavy metadata blobs). */
  lean?: boolean
}

export type ForkThreadOptions = {
  relation?: ThreadRelation
  title?: string
  turnId?: string
  beforeTurn?: boolean
  approvalReviewer?: ApprovalReviewer
  designDocumentTarget?: DesignDocumentTarget
  designCloneOperationId?: string
}

export type ResumeSessionOptions = {
  workspace?: string
  model?: string
  mode?: ThreadMode
  approvalReviewer?: ApprovalReviewer
  designDocumentTarget?: DesignDocumentTarget
  designCloneOperationId?: string
}

export type ResumeSessionResult = {
  thread: ThreadRecord
  sessionId: string
  messageCount: number
}

export type SyncPlanTodosOptions = {
  planId: string
  relativePath: string
  markdown: string
  preserveCompleted?: boolean
}

export class ThreadService {
  declare private setTodosInternal: (typeof threadServiceTodosOperations)['setTodosInternal']
  declare private withThreadMutation: (typeof threadServiceTodosOperations)['withThreadMutation']
  declare private patchPlanMarkdownForTodoStatusChanges: (typeof threadServiceTodosOperations)['patchPlanMarkdownForTodoStatusChanges']

  private readonly threadStore: ThreadStore
  private readonly deleteThreadStore: ThreadStore
  private readonly sessionStore: SessionStore
  private readonly events: RuntimeEventRecorder
  private readonly ids: IdGenerator
  private readonly nowIso: () => string
  private defaultApprovalPolicy: ApprovalPolicy | undefined
  private defaultSandboxMode: SandboxMode | undefined
  private defaultApprovalReviewer: ApprovalReviewer | undefined
  private defaultModelRequestCaptureEnabled: boolean
  private readonly lifecycleFence?: ThreadLifecycleFence
  private readonly onDeleting?: (threadId: string) => Promise<void> | void
  private readonly onDeleted?: (threadId: string) => Promise<void> | void
  private readonly onStatusChanged?: ThreadServiceOptions['onStatusChanged']
  private readonly onForked?: ThreadServiceOptions['onForked']

  constructor(options: ThreadServiceOptions) {
    this.threadStore = options.threadStore
    this.deleteThreadStore = options.deleteThreadStore ?? options.threadStore
    this.sessionStore = options.sessionStore
    this.events = options.events
    this.ids = options.ids
    this.nowIso = options.nowIso
    this.defaultApprovalPolicy = options.defaultApprovalPolicy
    this.defaultSandboxMode = options.defaultSandboxMode
    this.defaultApprovalReviewer = options.defaultApprovalReviewer
    this.defaultModelRequestCaptureEnabled = options.defaultModelRequestCaptureEnabled ?? false
    this.lifecycleFence = options.lifecycleFence
    this.onDeleting = options.onDeleting
    this.onDeleted = options.onDeleted
    this.onStatusChanged = options.onStatusChanged
    this.onForked = options.onForked
  }
}

export interface ThreadService {
  updateRuntimeDefaults(input: {
    approvalPolicy: ApprovalPolicy
    sandboxMode: SandboxMode
    approvalReviewer: ApprovalReviewer
    modelRequestCaptureEnabled: boolean
  }): void;
  list(options?: ListThreadsOptions ): Promise<ThreadSummary[]>;
  /** Paginated listing with keyset cursor. Falls back to `list` when the backing store cannot paginate. */
  listPage(options?: ListThreadsOptions): Promise<ThreadStoreListPage>;
  deleteByWorkspace(workspace: string): Promise<string[]>;
  get(threadId: string): Promise<ThreadRecord | null>;
  getMetadata(threadId: string): Promise<ThreadRecord | null>;
  create(
    request: CreateThreadRequest,
    options?: {
      id?: string
      title?: string
      status?: ThreadStatus
      /** Relationship to a parent thread; `side` threads are hidden from the default list. */
      relation?: ThreadRelation
      /** Parent thread this thread branches from (used by `side`/`fork` relations). */
      parentThreadId?: string
      /** Broker-derived metadata. Never populated from the public thread request body. */
      extensionMetadata?: ExtensionThreadMetadata
    }
  ): Promise<ThreadRecord>;
  update(threadId: string, patch: {
    title?: string
    titleAuto?: boolean
    summary?: string
    workspace?: string
    additionalWorkspaces?: string[]
    knowledgeBases?: KnowledgeBaseMount[]
    mode?: ThreadMode
    /** Archive or unarchive only; execution and deletion states are internal. */
    status?: ThreadUpdateStatus
    approvalPolicy?: ApprovalPolicy
    sandboxMode?: SandboxMode
    approvalReviewer?: ApprovalReviewer
    modelRequestCaptureEnabled?: boolean
    pinned?: boolean
    costBudgetUsd?: number | null
    costBudgetWarningSent?: boolean
    relation?: ThreadRelation
  }): Promise<ThreadRecord>;
  getGoal(threadId: string): Promise<ThreadGoal | null>;
  setGoal(threadId: string, request: SetThreadGoalRequest): Promise<ThreadGoal>;
  recordGoalUsage(threadId: string, tokenDelta: number): Promise<ThreadGoal | null>;
  clearGoal(threadId: string): Promise<boolean>;
  getTodos(threadId: string): Promise<ThreadTodoList | null>;
  setTodos(threadId: string, request: SetThreadTodosRequest): Promise<ThreadTodoList>;
  setTodosFromTool(threadId: string, request: SetThreadTodosRequest): Promise<ThreadTodoList>;
  clearTodos(threadId: string): Promise<boolean>;
  syncTodosFromPlan(threadId: string, options: SyncPlanTodosOptions): Promise<ThreadTodoList>;
  delete(threadId: string): Promise<boolean>;
  fork(threadId: string, options?: ForkThreadOptions ): Promise<ThreadRecord>;
  resumeSession(
    sessionId: string,
    options?: ResumeSessionOptions
  ): Promise<ResumeSessionResult>;
  getResumeSessionMetadata(sessionId: string): Promise<ResumeSessionMetadata>;
  toSummary(thread: ThreadRecord): ThreadSummary;
}

installServiceOperations(
  ThreadService.prototype,
  threadServiceMetadataOperations,
  threadServiceGoalsOperations,
  threadServiceTodosOperations,
  threadServiceLifecycleOperations
)


export function cloneTurnForThread(
  turn: Turn,
  threadId: string,
  now: string,
  designDocumentTarget?: DesignDocumentTarget
): Turn {
  // ThreadRecord is a renderer-facing mirror. Older on-disk records can
  // predate the session-only goal-context boundary, so never carry an
  // internal item into the cloned mirror. `cloneSessionItemsForThread` below
  // separately retains those records in canonical model history.
  const items = repairModelHistoryItems(
    turn.items
      .filter(isPublicTurnItem)
      .map((item) => cloneItemForThread(item, threadId, now, designDocumentTarget))
  )
  const attachmentIds = turn.attachmentIds.length > 0
    ? turn.attachmentIds
    : attachmentIdsFromItems(items)
  return {
    ...turn,
    threadId,
    status: turn.status === 'queued' || turn.status === 'running' ? 'completed' : turn.status,
    finishedAt: turn.finishedAt ?? now,
    attachmentIds,
    items,
    ...(designDocumentTarget && turn.designProfile
      ? {
          designProfile: retargetDesignTaskProfile(turn.designProfile, designDocumentTarget),
          designDocumentTarget
        }
      : {})
  }
}

export function normalizeTodoItems(input: {
  rawItems: SetThreadTodosRequest['todos']
  existingItems: readonly ThreadTodoItem[]
  now: string
  ids: IdGenerator
}): ThreadTodoItem[] {
  const existingById = new Map(input.existingItems.map((item) => [item.id, item]))
  const usedIds = new Set<string>()
  let inProgressSeen = false
  return input.rawItems.map((raw) => {
    const content = normalizeTodoContent(raw.content)
    if (!content) throw new Error('todo content is required')
    const status = normalizeTodoStatus(raw.status)
    if (status === 'in_progress') {
      if (inProgressSeen) throw new Error('at most one todo can be in_progress')
      inProgressSeen = true
    }
    const source = raw.source ? normalizeTodoSource(raw.source) : undefined
    const requestedId = raw.id?.trim()
    const existing =
      (requestedId ? existingById.get(requestedId) : undefined) ??
      findExistingTodoForRaw(input.existingItems, usedIds, { content, source })
    const id = uniqueTodoId(requestedId || existing?.id || input.ids.next('todo'), usedIds, input.ids)
    const changed =
      !existing ||
      existing.content !== content ||
      existing.status !== status ||
      !sameTodoSource(existing.source, source)
    usedIds.add(id)
    return {
      id,
      content,
      status,
      ...(source ? { source } : {}),
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: changed ? input.now : existing.updatedAt
    }
  })
}

export function preserveToolTodoSources(
  rawItems: SetThreadTodosRequest['todos'],
  existingItems: readonly ThreadTodoItem[]
): SetThreadTodosRequest['todos'] {
  const existingById = new Map(existingItems.map((item) => [item.id, item]))
  const usedIds = new Set<string>()
  return rawItems.map((raw) => {
    const content = normalizeTodoContent(raw.content)
    const requestedId = raw.id?.trim()
    let existing = requestedId ? existingById.get(requestedId) : undefined
    if (!existing && !requestedId) {
      const matches = existingItems.filter((item) =>
        !usedIds.has(item.id) && normalizeTodoContent(item.content) === content
      )
      if (matches.length === 1) existing = matches[0]
    }
    if (existing) usedIds.add(existing.id)
    if (
      !existing?.source ||
      normalizeTodoContent(existing.content) !== content
    ) {
      return raw
    }
    return {
      ...raw,
      id: requestedId || existing.id,
      source: existing.source
    }
  })
}

export function normalizeTodoStatus(status: ThreadTodoStatus): ThreadTodoStatus {
  if (status === 'pending' || status === 'in_progress' || status === 'completed') return status
  throw new Error(`unsupported todo status: ${String(status)}`)
}

export function normalizeTodoSource(source: ThreadTodoSource): ThreadTodoSource {
  if (source.kind !== 'plan') throw new Error(`unsupported todo source: ${String(source.kind)}`)
  const relativePath = normalizePlanRelativePath(source.relativePath)
  if (!isGuiPlanRelativePath(relativePath)) {
    throw new Error(`invalid GUI plan relative path: ${source.relativePath}`)
  }
  return {
    kind: 'plan',
    planId: source.planId,
    relativePath,
    ordinal: source.ordinal,
    contentHash: source.contentHash
  }
}

export function findExistingTodoForRaw(
  existingItems: readonly ThreadTodoItem[],
  usedIds: ReadonlySet<string>,
  raw: { content: string; source?: ThreadTodoSource }
): ThreadTodoItem | undefined {
  const candidates = existingItems.filter((item) => !usedIds.has(item.id))
  if (raw.source) {
    return (
      candidates.find((item) => item.source && sameTodoSource(item.source, raw.source)) ??
      candidates.find((item) =>
        item.source?.kind === 'plan' &&
        item.source.planId === raw.source?.planId &&
        item.source.relativePath === raw.source.relativePath &&
        item.source.contentHash === raw.source.contentHash
      ) ??
      candidates.find((item) =>
        item.source?.kind === 'plan' &&
        item.source.planId === raw.source?.planId &&
        item.source.relativePath === raw.source.relativePath &&
        item.source.ordinal === raw.source.ordinal
      )
    )
  }
  const hash = todoContentHash(raw.content)
  return candidates.find((item) => !item.source && todoContentHash(item.content) === hash)
}

export function sameTodoSource(
  first: ThreadTodoSource | undefined,
  second: ThreadTodoSource | undefined
): boolean {
  if (!first || !second) return !first && !second
  return (
    first.kind === second.kind &&
    first.planId === second.planId &&
    first.relativePath === second.relativePath &&
    first.ordinal === second.ordinal &&
    first.contentHash === second.contentHash
  )
}

export function uniqueTodoId(requested: string, usedIds: Set<string>, ids: IdGenerator): string {
  let candidate = requested.trim()
  while (!candidate || usedIds.has(candidate)) {
    candidate = ids.next('todo')
  }
  return candidate
}

export function cloneTodoListForThread(todos: ThreadTodoList, threadId: string, now: string): ThreadTodoList {
  return {
    threadId,
    items: todos.items.map((item) => ({ ...item })),
    updatedAt: now
  }
}

export async function resolveWorkspaceRelativePath(workspace: string, relativePath: string): Promise<string> {
  const lexicalRoot = resolve(workspace)
  const lexicalTarget = resolve(lexicalRoot, relativePath)
  const lexicalRelative = relative(lexicalRoot, lexicalTarget)
  if (!lexicalRelative || lexicalRelative.startsWith('..') || isAbsolute(lexicalRelative)) {
    throw new Error(`plan path escapes workspace: ${relativePath}`)
  }

  // The plan path is always an existing Markdown file by the time TODO state
  // is written back. Resolve both ends before opening it so a symlinked
  // `.kunsdd/plan` cannot redirect a status update outside the workspace.
  const [root, target] = await Promise.all([realpath(lexicalRoot), realpath(lexicalTarget)])
  const fromRoot = relative(root, target)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`plan path escapes workspace: ${relativePath}`)
  }
  return target
}

/**
 * Clone a turn into a new thread for fork/side spawn.
 *
 * For `relation: 'side'`, an in-flight parent turn (queued/running) is
 * copied as `aborted` with only its user prompt kept: unfinished
 * assistant/tool items are dropped so the side thread does not inherit
 * half-streamed tool calls or reasoning. Completed parent turns are
 * copied as-is (still re-routed through item clone for new threadId).
 *
 * For `relation: 'fork'`, behavior is unchanged from
 * `cloneTurnForThread` (in-flight is finalized as `completed`).
 */
export function cloneTurnForFork(
  turn: Turn,
  threadId: string,
  now: string,
  options: { relation: ThreadRelation; designDocumentTarget?: DesignDocumentTarget }
): Turn {
  const isInFlight = turn.status === 'queued' || turn.status === 'running'
  if (options.relation === 'side' && isInFlight) {
    const userPromptItem = turn.items.find((item) => item.kind === 'user_message')
    const userPromptItemCloned = userPromptItem
      ? cloneItemForThread(userPromptItem, threadId, now, options.designDocumentTarget)
      : undefined
    return {
      ...turn,
      threadId,
      status: 'aborted',
      finishedAt: turn.finishedAt ?? now,
      attachmentIds: turn.attachmentIds.length > 0
        ? turn.attachmentIds
        : attachmentIdsFromItems(userPromptItemCloned ? [userPromptItemCloned] : []),
      // Keep the user prompt; drop everything else to avoid carrying
      // half-streamed assistant/tool state into the side thread.
      items: userPromptItemCloned ? [userPromptItemCloned] : [],
      ...(options.designDocumentTarget && turn.designProfile
        ? {
            designProfile: retargetDesignTaskProfile(turn.designProfile, options.designDocumentTarget),
            designDocumentTarget: options.designDocumentTarget
          }
        : {})
    }
  }
  return cloneTurnForThread(turn, threadId, now, options.designDocumentTarget)
}

export function cloneItemForThread(
  item: TurnItem,
  threadId: string,
  now: string,
  designDocumentTarget?: DesignDocumentTarget
): TurnItem {
  let cloned = {
    ...item,
    threadId
  } as TurnItem
  if (designDocumentTarget && cloned.kind === 'user_message' && cloned.designProfile) {
    cloned = {
      ...cloned,
      designProfile: retargetDesignTaskProfile(cloned.designProfile, designDocumentTarget),
      designDocumentTarget
    }
  }
  if (cloned.status === 'pending' || cloned.status === 'running') {
    if (cloned.kind === 'approval') {
      return { ...cloned, status: 'expired', finishedAt: cloned.finishedAt ?? now }
    }
    if (cloned.kind === 'user_input') {
      return { ...cloned, status: 'cancelled', finishedAt: cloned.finishedAt ?? now }
    }
    return { ...cloned, status: 'completed', finishedAt: cloned.finishedAt ?? now } as TurnItem
  }
  return cloned
}

/**
 * Clone the durable session stream while keeping the ThreadRecord's turn
 * mirror public-only. Public item clones come from `clonedTurns` so side
 * forks retain their existing in-flight cleanup semantics. Session-only
 * records, including goal context, retain their position in canonical history.
 */
export function cloneSessionItemsForThread(input: {
  sourceItems: readonly TurnItem[]
  clonedTurns: readonly Turn[]
  threadId: string
  now: string
}): TurnItem[] {
  const allowedTurnIds = new Set(input.clonedTurns.map((turn) => turn.id))
  const clonedPublicItems = input.clonedTurns.flatMap((turn) => turn.items)
  const clonedPublicById = new Map(clonedPublicItems.map((item) => [item.id, item]))
  const includedIds = new Set<string>()
  const result: TurnItem[] = []

  for (const sourceItem of input.sourceItems) {
    if (!allowedTurnIds.has(sourceItem.turnId)) continue
    if (isPublicTurnItem(sourceItem)) {
      const cloned = clonedPublicById.get(sourceItem.id)
      if (!cloned || includedIds.has(cloned.id)) continue
      result.push(cloned)
      includedIds.add(cloned.id)
      continue
    }

    const cloned = cloneItemForThread(sourceItem, input.threadId, input.now)
    if (includedIds.has(cloned.id)) continue
    result.push(cloned)
    includedIds.add(cloned.id)
  }

  // Older snapshots can have public turn items without a corresponding
  // canonical session entry. Retain those at the tail rather than dropping
  // visible history during fork/resume; new GoalContext records never take
  // this fallback path because they are session-only by construction.
  for (const item of clonedPublicItems) {
    if (includedIds.has(item.id)) continue
    result.push(item)
    includedIds.add(item.id)
  }
  return result
}

export function matchesThreadSearch(thread: ThreadSummary, query: string): boolean {
  return [
    thread.id,
    thread.title,
    thread.workspace,
    thread.model,
    thread.mode,
    thread.forkedFromTitle,
    thread.forkedFromThreadId
  ].some((value) => value?.toLowerCase().includes(query))
}

export function threadStatusFromTurns(turns: Turn[]): 'idle' | 'running' {
  return turns.some((turn) => turn.status === 'queued' || turn.status === 'running')
    ? 'running'
    : 'idle'
}

export function rebuildTurnsFromItems(input: {
  items: TurnItem[]
  threadId: string
  fallbackTurnId: string
  fallbackPrompt: string
  now: string
}): Turn[] {
  const byTurn = new Map<string, TurnItem[]>()
  for (const item of input.items) {
    const turnId = item.turnId || input.fallbackTurnId
    byTurn.set(turnId, [...(byTurn.get(turnId) ?? []), { ...item, threadId: input.threadId } as TurnItem])
  }
  if (byTurn.size === 0) {
    return [{
      id: input.fallbackTurnId,
      threadId: input.threadId,
      status: 'completed',
      prompt: input.fallbackPrompt,
      orchestration: 'direct',
      steering: [],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: [],
      createdAt: input.now,
      finishedAt: input.now,
      items: []
    }]
  }
  return [...byTurn.entries()].map(([turnId, items]) => {
    const userItem = items.find(
      (item): item is Extract<TurnItem, { kind: 'user_message' }> => item.kind === 'user_message'
    )
    const prompt = userItem?.text ?? input.fallbackPrompt
    return {
      id: turnId,
      threadId: input.threadId,
      status: 'completed',
      prompt,
      orchestration: 'direct',
      steering: [],
      attachmentIds: attachmentIdsFromItems(items),
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: [],
      createdAt: items[0]?.createdAt ?? input.now,
      finishedAt: input.now,
      items,
      ...(userItem?.designProfile
        ? {
            agentSurface: 'design' as const,
            designProfile: userItem.designProfile,
            designDocumentTarget: userItem.designDocumentTarget ?? userItem.designProfile.documentTarget
          }
        : {})
    }
  })
}

export function attachmentIdsFromItems(items: TurnItem[]): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'user_message') continue
    for (const id of item.attachmentIds ?? []) {
      const trimmed = id.trim()
      if (trimmed) ids.add(trimmed)
    }
  }
  return [...ids]
}

export function toSessionSnapshot(
  thread: ThreadRecord,
  now: string,
  items: readonly TurnItem[] = thread.turns.flatMap((turn) => turn.items)
): AgentSession {
  const firstTurn = thread.turns[0]
  return {
    threadId: thread.id,
    turnId: firstTurn?.id ?? '',
    startedAt: firstTurn?.createdAt ?? thread.createdAt,
    updatedAt: now,
    items: [...items],
    events: [],
    closed: true
  }
}
