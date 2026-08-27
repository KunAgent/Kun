import type { NormalizedThread } from '../../agent/types'
import type { SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import { isEmptySddAssistantThreadCandidate } from '../../sdd/sdd-thread-registry'
import {
  isClawWorkspacePath,
  isConversationWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../../lib/workspace-path'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import {
  projectPathForWorktreeRecord,
  resolveProjectWorkspacePath,
  shouldOmitFromCodeWorkspaceRoots
} from '../../lib/worktree-project-path'
import { threadLooksRunning } from '../../store/chat-store-runtime-helpers'
import { completionAttentionForThread } from '../../store/unread-completions'
import type { CompletionAttentionRegistry, ScheduledThreadActivity } from '../../store/chat-store-types'
import type { ThreadWorktreeRecord } from '../../lib/thread-worktree-registry'

export type SidebarWorkspaceGroup = [workspacePath: string, threads: NormalizedThread[]]
export type SidebarThreadWorktreeRecord = Pick<
  ThreadWorktreeRecord,
  'projectPath' | 'worktreePath'
> & Partial<Pick<ThreadWorktreeRecord, 'branch' | 'createdAt' | 'poolIndex'>>
export type SidebarThreadWorktrees = Record<string, SidebarThreadWorktreeRecord>
export type ThreadPreviewAnchorRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'height'>

const THREAD_PREVIEW_WIDTH = 320
const THREAD_PREVIEW_MAX_HEIGHT = 220
const THREAD_PREVIEW_GAP = 10
const THREAD_PREVIEW_VIEWPORT_MARGIN = 12

export type SidebarThreadActivity = 'awaiting-input' | 'failed' | 'unread' | 'running' | 'scheduled' | 'read'

export type SidebarThreadActivityContext = {
  activeThreadId: string | null
  busy: boolean
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: CompletionAttentionRegistry
  scheduledThreadActivities?: Record<string, ScheduledThreadActivity>
  awaitingUserInputThreadIds?: Record<string, true>
}

/**
 * Classifies a sidebar row from transient renderer state without mutating the
 * durable thread record. A thread waiting on the user's answer outranks
 * everything else (only user action can move it forward); running wins over
 * unread during refresh races, so a live turn never appears as a completed
 * notification.
 */
export function sidebarThreadActivity(
  thread: NormalizedThread,
  context: SidebarThreadActivityContext
): SidebarThreadActivity {
  const id = thread.id.trim()
  if (context.awaitingUserInputThreadIds?.[id] === true) return 'awaiting-input'
  const running =
    threadLooksRunning(thread) ||
    context.watchTurnCompletion[id] === true ||
    (context.activeThreadId === id && context.busy) ||
    context.scheduledThreadActivities?.[id]?.state === 'running'
  if (running) return 'running'
  const attention = context.activeThreadId === id
    ? null
    : completionAttentionForThread(context.unreadThreadIds, id)
  if (attention === 'failed') return 'failed'
  if (attention === 'completed') return 'unread'
  if (context.scheduledThreadActivities?.[id]?.state === 'scheduled') return 'scheduled'
  return 'read'
}

/**
 * Deprecated: activity state (running, awaiting-input, unread, ...) drives row
 * indicators only and must not reorder rows. Poll/SSE refreshes flip activity
 * state every few seconds, so bucketing rows by activity made the sidebar list
 * jump under the user's pointer. This now returns the caller's order unchanged.
 */
export function prioritizeSidebarThreadActivity(
  threads: readonly NormalizedThread[],
  _context: SidebarThreadActivityContext
): NormalizedThread[] {
  return [...threads]
}

export function sidebarThreadsHaveRunningActivity(
  threads: readonly NormalizedThread[],
  context: SidebarThreadActivityContext
): boolean {
  return threads.some((thread) => sidebarThreadActivity(thread, context) === 'running')
}

export function workspaceContextLabel(workspacePath: string, folderName: string): string {
  const normalized = workspacePath.replace(/[/\\]+$/, '')
  const parts = normalized.split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2] ?? ''
  if (!parent || parent.toLowerCase() === folderName.toLowerCase()) return ''
  return parent
}

export function resolveThreadPreviewPosition(
  anchor: ThreadPreviewAnchorRect,
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const rightX = anchor.right + THREAD_PREVIEW_GAP
  const leftX = anchor.left - THREAD_PREVIEW_WIDTH - THREAD_PREVIEW_GAP
  const maxX = Math.max(
    THREAD_PREVIEW_VIEWPORT_MARGIN,
    viewport.width - THREAD_PREVIEW_WIDTH - THREAD_PREVIEW_VIEWPORT_MARGIN
  )
  const x = rightX + THREAD_PREVIEW_WIDTH <= viewport.width - THREAD_PREVIEW_VIEWPORT_MARGIN
    ? rightX
    : Math.max(THREAD_PREVIEW_VIEWPORT_MARGIN, Math.min(leftX, maxX))
  const idealY = anchor.top + anchor.height / 2 - 28
  const maxY = Math.max(
    THREAD_PREVIEW_VIEWPORT_MARGIN,
    viewport.height - THREAD_PREVIEW_MAX_HEIGHT - THREAD_PREVIEW_VIEWPORT_MARGIN
  )
  const y = Math.max(THREAD_PREVIEW_VIEWPORT_MARGIN, Math.min(idealY, maxY))
  return { x, y }
}

export function isSidebarProjectWorkspacePath(workspacePath: string): boolean {
  const normalized = normalizeWorkspaceRoot(workspacePath)
  if (!normalized) return false
  if (isInternalTemporaryWorkspace(normalized)) return false
  if (isInternalDeepSeekGuiWorkspace(normalized)) return false
  if (isClawWorkspacePath(normalized)) return false
  return true
}

function compareWorkspacePathsByActive(a: string, b: string, selectedWorkspace: string): number {
  const selectedWorkspaceKey = workspaceRootIdentityKey(selectedWorkspace)
  const aKey = workspaceRootIdentityKey(a)
  const bKey = workspaceRootIdentityKey(b)
  if (aKey === selectedWorkspaceKey && bKey !== selectedWorkspaceKey) return -1
  if (bKey === selectedWorkspaceKey && aKey !== selectedWorkspaceKey) return 1
  return a.localeCompare(b)
}

function sortWorkspacePathsByActive(workspacePaths: string[], selectedWorkspace: string): string[] {
  return [...workspacePaths].sort((a, b) => compareWorkspacePathsByActive(a, b, selectedWorkspace))
}

export function sidebarWorkspaceResolutionCandidates(options: {
  workspaceRoot: string
  workspaceRoots: string[]
  threadWorktrees?: SidebarThreadWorktrees
  threads?: NormalizedThread[]
}): string[] {
  const candidates = new Set<string>()
  const selectedWorkspace = normalizeWorkspaceRoot(options.workspaceRoot)
  if (selectedWorkspace) candidates.add(selectedWorkspace)
  for (const workspacePath of options.workspaceRoots) {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    if (normalized) candidates.add(normalized)
  }
  for (const record of Object.values(options.threadWorktrees ?? {})) {
    const projectPath = projectPathForWorktreeRecord(record)
    if (projectPath) candidates.add(projectPath)
  }
  for (const thread of options.threads ?? []) {
    const normalized = normalizeWorkspaceRoot(thread.workspace)
    if (normalized) candidates.add(normalized)
  }
  return [...candidates]
}

function workspacePathForWorktreeRecord(
  record: Pick<ThreadWorktreeRecord, 'projectPath' | 'worktreePath'> | undefined
): string {
  return projectPathForWorktreeRecord(record)
}

export function sidebarWorkspacePathForThread(
  thread: NormalizedThread,
  worktrees: SidebarThreadWorktrees = {},
  candidateProjectPaths: readonly string[] = []
): string {
  const worktreeProjectPath = workspacePathForWorktreeRecord(
    worktreeRecordForSidebarThread(thread, worktrees)
  )
  if (worktreeProjectPath) return worktreeProjectPath
  const workspace = thread.workspace ?? ''
  const resolved = resolveProjectWorkspacePath(workspace, {
    threadWorktrees: worktrees,
    candidateProjectPaths
  })
  if (resolved) return resolved
  if (shouldOmitFromCodeWorkspaceRoots(workspace)) return ''
  return normalizeWorkspaceRoot(workspace)
}

function sidebarWorkspacePathForRememberedRoot(
  workspacePath: string,
  worktrees: SidebarThreadWorktrees = {},
  candidateProjectPaths: readonly string[] = []
): string {
  const normalized = normalizeWorkspaceRoot(workspacePath)
  const key = workspaceRootIdentityKey(normalized)
  if (!key) return ''
  for (const record of Object.values(worktrees)) {
    const worktreePath = normalizeWorkspaceRoot(record.worktreePath)
    if (workspaceRootIdentityKey(worktreePath) === key) {
      return workspacePathForWorktreeRecord(record) || normalized
    }
  }
  const resolved = resolveProjectWorkspacePath(normalized, {
    threadWorktrees: worktrees,
    candidateProjectPaths
  })
  if (resolved) return resolved
  if (shouldOmitFromCodeWorkspaceRoots(normalized)) return ''
  return normalized
}

export function worktreeRecordForSidebarThread(
  thread: NormalizedThread,
  worktrees: SidebarThreadWorktrees = {}
): SidebarThreadWorktreeRecord | undefined {
  const direct = worktrees[thread.id]
  if (direct) return direct
  const threadWorkspaceKey = workspaceRootIdentityKey(thread.workspace)
  if (!threadWorkspaceKey) return undefined
  return Object.values(worktrees).find((record) =>
    workspaceRootIdentityKey(record.worktreePath) === threadWorkspaceKey
  )
}

export function buildSidebarWorkspaceGroups(options: {
  threads: NormalizedThread[]
  searchQuery: string
  showArchived: boolean
  workspaceRoot: string
  workspaceRoots: string[]
  conversationRoot: string
  threadWorktrees?: SidebarThreadWorktrees
}): SidebarWorkspaceGroup[] {
  const map = new Map<string, { workspacePath: string; threads: NormalizedThread[] }>()
  const query = options.searchQuery.trim().toLowerCase()
  const candidateProjectPaths = sidebarWorkspaceResolutionCandidates(options)
  const selectedWorkspace = sidebarWorkspacePathForRememberedRoot(
    options.workspaceRoot,
    options.threadWorktrees,
    candidateProjectPaths
  )
  const selectedWorkspaceKey = workspaceRootIdentityKey(selectedWorkspace)

  const upsertWorkspace = (workspacePath: string, threads: NormalizedThread[] = []): void => {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    const key = workspaceRootIdentityKey(normalized)
    if (!key) return
    const existing = map.get(key)
    if (existing) {
      existing.threads.push(...threads)
      if (key === selectedWorkspaceKey && normalized === selectedWorkspace) {
        existing.workspacePath = normalized
      }
      return
    }
    map.set(key, { workspacePath: normalized, threads: [...threads] })
  }

  for (const thread of options.threads) {
    if (isInternalTemporaryWorkspace(thread.workspace)) continue
    if (isInternalDeepSeekGuiWorkspace(thread.workspace)) continue
    if (isClawWorkspacePath(thread.workspace)) continue
    if (isConversationWorkspacePath(thread.workspace, options.conversationRoot)) continue
    if ((thread.archived === true) !== options.showArchived) continue
    const key = sidebarWorkspacePathForThread(
      thread,
      options.threadWorktrees,
      candidateProjectPaths
    )
    if (!key) continue
    if (query) {
      const haystack = [thread.title, thread.preview, key, workspaceLabelFromPath(key), thread.workspace]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      if (!haystack.includes(query)) continue
    }
    upsertWorkspace(key, [thread])
  }

  if (
    selectedWorkspace &&
    !map.has(selectedWorkspaceKey) &&
    isSidebarProjectWorkspacePath(selectedWorkspace) &&
    !isConversationWorkspacePath(selectedWorkspace, options.conversationRoot)
  ) {
    upsertWorkspace(selectedWorkspace)
  }
  if (!query && !options.showArchived) {
    for (const workspacePath of options.workspaceRoots) {
      const key = sidebarWorkspacePathForRememberedRoot(
        workspacePath,
        options.threadWorktrees,
        candidateProjectPaths
      )
      if (!key || map.has(workspaceRootIdentityKey(key))) continue
      if (!isSidebarProjectWorkspacePath(key)) continue
      if (isConversationWorkspacePath(key, options.conversationRoot)) continue
      upsertWorkspace(key)
    }
  }

  return Array.from(map.values())
    .map(({ workspacePath, threads }): SidebarWorkspaceGroup => [workspacePath, threads])
    .sort(([a], [b]) => compareWorkspacePathsByActive(a, b, selectedWorkspace))
}

export function buildSidebarDraftWorkspacePaths(options: {
  threads: NormalizedThread[]
  workspaceRoot: string
  workspaceRoots: string[]
  threadWorktrees?: SidebarThreadWorktrees
}): string[] {
  const map = new Map<string, string>()
  const candidateProjectPaths = sidebarWorkspaceResolutionCandidates(options)
  const selectedWorkspace = sidebarWorkspacePathForRememberedRoot(
    options.workspaceRoot,
    options.threadWorktrees,
    candidateProjectPaths
  )
  const upsertWorkspace = (workspacePath: string): void => {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    if (!isSidebarProjectWorkspacePath(normalized)) return
    const key = workspaceRootIdentityKey(normalized)
    if (!key) return
    const previous = map.get(key)
    if (!previous || normalized === selectedWorkspace) map.set(key, normalized)
  }
  upsertWorkspace(selectedWorkspace)
  for (const workspacePath of options.workspaceRoots) {
    upsertWorkspace(sidebarWorkspacePathForRememberedRoot(
      workspacePath,
      options.threadWorktrees,
      candidateProjectPaths
    ))
  }
  for (const thread of options.threads) {
    upsertWorkspace(sidebarWorkspacePathForThread(thread, options.threadWorktrees, candidateProjectPaths))
  }
  return sortWorkspacePathsByActive([...map.values()], selectedWorkspace)
}

export function isSidebarThreadMoveBlocked({
  thread,
  deleting = false,
  worktreeRecord,
  activeThreadId = null,
  busy = false,
  watchTurnCompletion = {}
}: {
  thread: NormalizedThread
  deleting?: boolean
  worktreeRecord?: SidebarThreadWorktreeRecord
  activeThreadId?: string | null
  busy?: boolean
  watchTurnCompletion?: Record<string, boolean>
}): boolean {
  const threadId = thread.id.trim()
  if (!threadId || deleting || worktreeRecord) return true
  if (threadLooksRunning(thread)) return true
  if (watchTurnCompletion[threadId] === true) return true
  if (activeThreadId === threadId && busy) return true
  return false
}

export function buildSidebarThreadMoveTargets(options: {
  thread: NormalizedThread
  groups: SidebarWorkspaceGroup[]
  threadWorktrees?: SidebarThreadWorktrees
}): string[] {
  const candidateProjectPaths = options.groups.map(([workspacePath]) => workspacePath)
  const currentWorkspaceKey = workspaceRootIdentityKey(
    sidebarWorkspacePathForThread(options.thread, options.threadWorktrees, candidateProjectPaths)
  )
  const targets: string[] = []
  const seen = new Set<string>()
  for (const [workspacePath] of options.groups) {
    if (!isSidebarProjectWorkspacePath(workspacePath)) continue
    const targetKey = workspaceRootIdentityKey(workspacePath)
    if (!targetKey || targetKey === currentWorkspaceKey || seen.has(targetKey)) continue
    seen.add(targetKey)
    targets.push(workspacePath)
  }
  return targets
}

export function filterSddDraftHistoryItems(
  items: SddDraftHistoryItem[],
  searchQuery: string,
  workspacePath = ''
): SddDraftHistoryItem[] {
  const query = searchQuery.trim().toLowerCase()
  if (!query) return items
  const workspaceLabel = workspacePath ? workspaceLabelFromPath(workspacePath) : ''
  return items.filter((item) => [
    item.title,
    item.relativePath,
    item.absolutePath,
    item.searchText,
    workspacePath,
    workspaceLabel
  ].filter(Boolean).join('\n').toLowerCase().includes(query))
}

export function mergeSidebarWorkspaceGroupsWithDraftHistory(options: {
  groups: SidebarWorkspaceGroup[]
  draftHistoryByWorkspace: Record<string, SddDraftHistoryItem[]>
  workspaceRoot: string
}): SidebarWorkspaceGroup[] {
  const selectedWorkspace = normalizeWorkspaceRoot(options.workspaceRoot)
  const map = new Map<string, SidebarWorkspaceGroup>()
  const upsertGroup = (workspacePath: string, threads: NormalizedThread[] = []): void => {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    if (!isSidebarProjectWorkspacePath(normalized)) return
    const key = workspaceRootIdentityKey(normalized)
    if (!key) return
    const previous = map.get(key)
    if (previous) {
      previous[1].push(...threads)
      if (normalized === selectedWorkspace) previous[0] = normalized
      return
    }
    map.set(key, [normalized, [...threads]])
  }
  for (const [workspacePath, threads] of options.groups) upsertGroup(workspacePath, threads)
  for (const [workspacePath, items] of Object.entries(options.draftHistoryByWorkspace)) {
    if (items.length > 0) upsertGroup(workspacePath)
  }
  return Array.from(map.values())
    .sort(([a], [b]) => compareWorkspacePathsByActive(a, b, selectedWorkspace))
}

export function filterEmptySddAssistantThreadsFromSidebar(
  threads: NormalizedThread[],
  draftHistory: SddDraftHistoryItem[]
): NormalizedThread[] {
  const draftThreadIds = new Set<string>()
  for (const draft of draftHistory) {
    for (const threadId of draft.chatThreadIds ?? []) {
      if (threadId.trim()) draftThreadIds.add(threadId.trim())
    }
  }
  if (draftThreadIds.size === 0) return [...threads]
  return threads.filter((thread) =>
    !draftThreadIds.has(thread.id) || !isEmptySddAssistantThreadCandidate(thread)
  )
}

export function sortSidebarThreads(threads: NormalizedThread[]): NormalizedThread[] {
  return [...threads].sort((a, b) => {
    if (a.pinned === true && b.pinned !== true) return -1
    if (b.pinned === true && a.pinned !== true) return 1
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
}

export function sddDraftHistoryForWorkspace(
  draftHistoryByWorkspace: Record<string, SddDraftHistoryItem[]>,
  workspacePath: string
): SddDraftHistoryItem[] {
  const exact = draftHistoryByWorkspace[workspacePath]
  if (exact) return exact
  const targetKey = workspaceRootIdentityKey(workspacePath)
  if (!targetKey) return []
  for (const [path, history] of Object.entries(draftHistoryByWorkspace)) {
    if (workspaceRootIdentityKey(path) === targetKey) return history
  }
  return []
}
