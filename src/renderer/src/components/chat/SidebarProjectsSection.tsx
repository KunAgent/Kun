import type {
  DragEvent as ReactDragEvent,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement
} from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Folder,
  FolderPlus,
  FolderOpen,
  GitBranch,
  Loader2,
  MoveRight,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import { rememberCodeWorkspaceRoots } from '../../store/chat-store-helpers'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { deleteSddDraft } from '../../sdd/sdd-draft-actions'
import { listSddDraftHistory, type SddDraftHistoryItem } from '../../sdd/sdd-draft-history'
import { isEmptySddAssistantThreadCandidate } from '../../sdd/sdd-thread-registry'
import { useSddDraftStore, type SddDraft } from '../../sdd/sdd-draft-store'
import {
  isClawWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  isConversationWorkspacePath,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../../lib/workspace-path'
import {
  SidebarIconButton,
  SidebarSearchField,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import {
  projectPathForWorktreeRecord,
  resolveProjectWorkspacePath,
  shouldOmitFromCodeWorkspaceRoots
} from '../../lib/worktree-project-path'
import { readThreadWorktreeRegistry, type ThreadWorktreeRecord } from '../../lib/thread-worktree-registry'

type SidebarProjectsSectionProps = {
  threads: NormalizedThread[]
  activeView: 'chat' | 'write' | 'claw'
  activeThreadId: string | null
  runtimeReady: boolean
  searchQuery: string
  showArchived: boolean
  workspaceRoot: string
  workspaceRoots: string[]
  /** 对话工作目录根,用于在项目区块中过滤掉对话会话。 */
  conversationRoot: string
  busy: boolean
  watchTurnCompletion: Record<string, boolean>
  unreadThreadIds: Record<string, boolean>
  locale: string
  onPickWorkspace: () => void
  onRemoveWorkspace: (workspacePath: string) => Promise<void>
  onCreateThreadInWorkspace: (workspacePath: string) => void
  onOpenRequirementDraft: (draft: SddDraft) => void
  onSelectThread: (threadId: string) => void
  onRenameThread: (threadId: string, title: string) => Promise<void>
  onPinThread: (threadId: string, pinned: boolean) => Promise<void>
  onArchiveThread: (threadId: string) => Promise<void>
  onDeleteThread: (threadId: string) => Promise<void>
  onRestoreThread: (threadId: string) => Promise<void>
  onSearchQueryChange: (query: string) => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

export type SidebarWorkspaceGroup = [workspacePath: string, threads: NormalizedThread[]]
type SidebarThreadWorktreeRecord = Pick<ThreadWorktreeRecord, 'projectPath' | 'worktreePath'> & Partial<Pick<ThreadWorktreeRecord, 'branch' | 'createdAt' | 'poolIndex'>>
type SidebarThreadWorktrees = Record<string, SidebarThreadWorktreeRecord>

type ThreadContextMenuState = {
  thread: NormalizedThread
  worktreeRecord?: SidebarThreadWorktreeRecord
  x: number
  y: number
}

type WorkspaceContextMenuState = {
  workspacePath: string
  x: number
  y: number
}

type MoveThreadDialogState = {
  thread: NormalizedThread
  targets: string[]
  targetWorkspace: string | null
  submitting: boolean
  error?: string
}

type ThreadPreviewAnchorRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'height'>

const THREAD_PREVIEW_WIDTH = 320
const THREAD_PREVIEW_MAX_HEIGHT = 220
const THREAD_PREVIEW_GAP = 10
const THREAD_PREVIEW_VIEWPORT_MARGIN = 12
const SIDEBAR_THREAD_DRAG_DATA_KEY = 'application/x-kun-thread-id'

type SidebarActionDialogState = {
  title: string
  description: string
  detail: string
  confirmLabel: string
  danger?: boolean
  submitting: boolean
  onConfirm: () => Promise<void>
}

export type RenameThreadDialogState = {
  thread: NormalizedThread
  value: string
  submitting: boolean
}

const SDD_DRAFT_HISTORY_PAGE_SIZE = 3
const SDD_DRAFT_HISTORY_LOAD_LIMIT = 40

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
  const x =
    rightX + THREAD_PREVIEW_WIDTH <= viewport.width - THREAD_PREVIEW_VIEWPORT_MARGIN
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

function isSidebarProjectWorkspacePath(workspacePath: string): boolean {
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

function sidebarWorkspaceResolutionCandidates(options: {
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

function workspacePathForWorktreeRecord(record: Pick<ThreadWorktreeRecord, 'projectPath' | 'worktreePath'> | undefined): string {
  return projectPathForWorktreeRecord(record)
}

function sidebarWorkspacePathForThread(
  thread: NormalizedThread,
  worktrees: SidebarThreadWorktrees = {},
  candidateProjectPaths: readonly string[] = []
): string {
  const worktreeProjectPath = workspacePathForWorktreeRecord(worktrees[thread.id])
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

function worktreeRecordForSidebarThread(
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
  const map = new Map<string, { workspacePath: string, threads: NormalizedThread[] }>()
  const selectedWorkspace = normalizeWorkspaceRoot(options.workspaceRoot)
  const selectedWorkspaceKey = workspaceRootIdentityKey(selectedWorkspace)
  const query = options.searchQuery.trim().toLowerCase()
  const candidateProjectPaths = sidebarWorkspaceResolutionCandidates(options)
  const conversationRoot = options.conversationRoot

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

  for (const th of options.threads) {
    if (isInternalTemporaryWorkspace(th.workspace)) continue
    if (isInternalDeepSeekGuiWorkspace(th.workspace)) continue
    if (isClawWorkspacePath(th.workspace)) continue
    if (isConversationWorkspacePath(th.workspace, conversationRoot)) continue
    if ((th.archived === true) !== options.showArchived) continue
    const key = sidebarWorkspacePathForThread(th, options.threadWorktrees, candidateProjectPaths)
    if (!key) continue
    if (query) {
      const haystack = [th.title, th.preview, key, workspaceLabelFromPath(key), th.workspace]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      if (!haystack.includes(query)) continue
    }
    upsertWorkspace(key, [th])
  }

  if (
    selectedWorkspace &&
    !map.has(selectedWorkspaceKey) &&
    isSidebarProjectWorkspacePath(selectedWorkspace) &&
    !isConversationWorkspacePath(selectedWorkspace, conversationRoot)
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
      if (isInternalTemporaryWorkspace(key)) continue
      if (isInternalDeepSeekGuiWorkspace(key)) continue
      if (isClawWorkspacePath(key)) continue
      if (isConversationWorkspacePath(key, conversationRoot)) continue
      upsertWorkspace(key)
    }
  }

  return Array.from(map.values()).map(({ workspacePath, threads }): SidebarWorkspaceGroup => [workspacePath, threads]).sort(([a], [b]) => {
    const aKey = workspaceRootIdentityKey(a)
    const bKey = workspaceRootIdentityKey(b)
    if (aKey === selectedWorkspaceKey && bKey !== selectedWorkspaceKey) return -1
    if (bKey === selectedWorkspaceKey && aKey !== selectedWorkspaceKey) return 1
    return a.localeCompare(b)
  })
}

export function buildSidebarDraftWorkspacePaths(options: {
  threads: NormalizedThread[]
  workspaceRoot: string
  workspaceRoots: string[]
  threadWorktrees?: SidebarThreadWorktrees
}): string[] {
  const map = new Map<string, string>()
  const selectedWorkspace = normalizeWorkspaceRoot(options.workspaceRoot)
  const candidateProjectPaths = sidebarWorkspaceResolutionCandidates(options)

  const upsertWorkspace = (workspacePath: string): void => {
    const normalized = normalizeWorkspaceRoot(workspacePath)
    if (!isSidebarProjectWorkspacePath(normalized)) return
    const key = workspaceRootIdentityKey(normalized)
    if (!key) return
    const previous = map.get(key)
    if (!previous || normalized === selectedWorkspace) {
      map.set(key, normalized)
    }
  }

  upsertWorkspace(selectedWorkspace)
  for (const workspacePath of options.workspaceRoots) {
    upsertWorkspace(
      sidebarWorkspacePathForRememberedRoot(
        workspacePath,
        options.threadWorktrees,
        candidateProjectPaths
      )
    )
  }
  for (const thread of options.threads) {
    upsertWorkspace(sidebarWorkspacePathForThread(thread, options.threadWorktrees, candidateProjectPaths))
  }

  return sortWorkspacePathsByActive([...map.values()], selectedWorkspace)
}

type SidebarThreadMoveBlockedOptions = {
  thread: NormalizedThread
  deleting?: boolean
  worktreeRecord?: SidebarThreadWorktreeRecord
  activeThreadId?: string | null
  busy?: boolean
  watchTurnCompletion?: Record<string, boolean>
}

export function isSidebarThreadMoveBlocked({
  thread,
  deleting = false,
  worktreeRecord,
  activeThreadId = null,
  busy = false,
  watchTurnCompletion = {}
}: SidebarThreadMoveBlockedOptions): boolean {
  const threadId = thread.id.trim()
  if (!threadId) return true
  if (deleting) return true
  if (worktreeRecord) return true
  if (thread.status?.trim().toLowerCase() === 'running') return true
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
  return items.filter((item) => {
    const haystack = [
      item.title,
      item.relativePath,
      item.absolutePath,
      item.searchText,
      workspacePath,
      workspaceLabel
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase()
    return haystack.includes(query)
  })
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

  for (const [workspacePath, threads] of options.groups) {
    upsertGroup(workspacePath, threads)
  }
  for (const [workspacePath, items] of Object.entries(options.draftHistoryByWorkspace)) {
    if (items.length > 0) upsertGroup(workspacePath)
  }

  return Array.from(map.values()).sort(([a], [b]) => compareWorkspacePathsByActive(a, b, selectedWorkspace))
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

function sddDraftHistoryForWorkspace(
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

export function SidebarProjectsSection({
  threads,
  activeView,
  activeThreadId,
  runtimeReady,
  searchQuery,
  showArchived,
  workspaceRoot,
  workspaceRoots,
  conversationRoot,
  busy,
  watchTurnCompletion,
  unreadThreadIds,
  locale,
  onPickWorkspace,
  onRemoveWorkspace,
  onCreateThreadInWorkspace,
  onOpenRequirementDraft,
  onSelectThread,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread,
  onSearchQueryChange,
  t
}: SidebarProjectsSectionProps): ReactElement {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({})
  const [deletingThreadIds, setDeletingThreadIds] = useState<Record<string, boolean>>({})
  const [deletingDraftIds, setDeletingDraftIds] = useState<Record<string, boolean>>({})
  const [draftHistoryErrors, setDraftHistoryErrors] = useState<Record<string, string>>({})
  const [draftHistoryRefreshVersion, setDraftHistoryRefreshVersion] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [threadContextMenu, setThreadContextMenu] = useState<ThreadContextMenuState | null>(null)
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenuState | null>(null)
  const [actionDialog, setActionDialog] = useState<SidebarActionDialogState | null>(null)
  const [renameThreadDialog, setRenameThreadDialog] = useState<RenameThreadDialogState | null>(null)
  const [moveThreadDialog, setMoveThreadDialog] = useState<MoveThreadDialogState | null>(null)
  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(null)
  const [dragOverWorkspace, setDragOverWorkspace] = useState<string | null>(null)
  const [draftHistoryByWorkspace, setDraftHistoryByWorkspace] = useState<Record<string, SddDraftHistoryItem[]>>({})
  const [threadWorktrees, setThreadWorktrees] = useState<SidebarThreadWorktrees>(() => readThreadWorktreeRegistry().worktrees)
  const activeSddDraftId = useSddDraftStore((s) => s.activeDraft?.id ?? '')

  useEffect(() => {
    setThreadWorktrees(readThreadWorktreeRegistry().worktrees)
  }, [activeThreadId, threads, workspaceRoots])

  const groups = useMemo(() => {
    return buildSidebarWorkspaceGroups({
      threads,
      searchQuery,
      showArchived,
      workspaceRoot,
      workspaceRoots,
      conversationRoot,
      threadWorktrees
    })
  }, [searchQuery, showArchived, threadWorktrees, threads, workspaceRoot, workspaceRoots, conversationRoot])

  const draftHistoryWorkspacePaths = useMemo(() => {
    return buildSidebarDraftWorkspacePaths({
      threads,
      workspaceRoot,
      workspaceRoots,
      threadWorktrees
    })
  }, [threadWorktrees, threads, workspaceRoot, workspaceRoots])

  const filteredDraftHistoryByWorkspace = useMemo(() => {
    return Object.fromEntries(
      Object.entries(draftHistoryByWorkspace)
        .map(([path, history]) => [
          path,
          filterSddDraftHistoryItems(history, searchQuery, path)
        ] as const)
        .filter(([, history]) => history.length > 0)
    )
  }, [draftHistoryByWorkspace, searchQuery])

  const displayGroups = useMemo(() => {
    return mergeSidebarWorkspaceGroupsWithDraftHistory({
      groups,
      draftHistoryByWorkspace: filteredDraftHistoryByWorkspace,
      workspaceRoot
    })
  }, [filteredDraftHistoryByWorkspace, groups, workspaceRoot])

  const searchVisible = searchOpen || searchQuery.trim().length > 0
  const allGroupsCollapsed = displayGroups.length > 0 && displayGroups.every(([workspacePath]) => collapsed[workspacePath] === true)
  const workspaceHistoryKey = draftHistoryWorkspacePaths.join('\n')
  const projectWorkspaceGroups = displayGroups.filter(([workspacePath]) => isSidebarProjectWorkspacePath(workspacePath))

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.kunGui?.listWorkspaceDirectory !== 'function' ||
      typeof window.kunGui?.readWorkspaceFile !== 'function'
    ) {
      setDraftHistoryByWorkspace({})
      return
    }
    const workspacePaths = workspaceHistoryKey.split('\n').filter(Boolean)
    if (workspacePaths.length === 0) {
      setDraftHistoryByWorkspace({})
      return
    }
    let cancelled = false
    void Promise.all(
      workspacePaths.map(async (path) => {
        const history = await listSddDraftHistory({
          workspaceRoot: path,
          listWorkspaceDirectory: window.kunGui.listWorkspaceDirectory,
          readWorkspaceFile: window.kunGui.readWorkspaceFile,
          limit: SDD_DRAFT_HISTORY_LOAD_LIMIT
        }).catch(() => [])
        return [path, history] as const
      })
    ).then((entries) => {
      if (cancelled) return
      setDraftHistoryByWorkspace(Object.fromEntries(entries.filter(([, history]) => history.length > 0)))
    })
    return () => {
      cancelled = true
    }
  }, [draftHistoryRefreshVersion, workspaceHistoryKey])

  useEffect(() => {
    if (!threadContextMenu && !workspaceContextMenu) return
    const close = (): void => {
      setThreadContextMenu(null)
      setWorkspaceContextMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [threadContextMenu, workspaceContextMenu])

  const toggleAllGroups = (): void => {
    if (displayGroups.length === 0) return
    if (allGroupsCollapsed) {
      setCollapsed({})
      return
    }
    setCollapsed(Object.fromEntries(displayGroups.map(([workspacePath]) => [workspacePath, true])))
  }

  const openActionDialog = (dialog: Omit<SidebarActionDialogState, 'submitting'>): void => {
    setActionDialog({ ...dialog, submitting: false })
  }

  const closeActionDialog = (): void => {
    setActionDialog((current) => current?.submitting ? current : null)
  }

  const submitActionDialog = async (): Promise<void> => {
    const dialog = actionDialog
    if (!dialog || dialog.submitting) return
    setActionDialog((current) => current ? { ...current, submitting: true } : current)
    try {
      await dialog.onConfirm()
      setActionDialog(null)
    } catch {
      setActionDialog((current) => current ? { ...current, submitting: false } : current)
    }
  }

  const handleDeleteThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    openActionDialog({
      title: t('sidebarThreadDeleteDialogTitle', { title: thread.title }),
      description: t('sidebarThreadDeleteDialogDescription'),
      detail: t('sidebarThreadDeleteDialogDetail'),
      confirmLabel: t('sidebarThreadDeleteConfirmButton'),
      danger: true,
      onConfirm: async () => {
        setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
        try {
          await onDeleteThread(threadId)
        } finally {
          setDeletingThreadIds((prev) => {
            const next = { ...prev }
            delete next[threadId]
            return next
          })
        }
      }
    })
  }

  const handleArchiveThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    openActionDialog({
      title: t('sidebarThreadArchiveDialogTitle', { title: thread.title }),
      description: t('sidebarThreadArchiveDialogDescription'),
      detail: t('sidebarThreadArchiveDialogDetail'),
      confirmLabel: t('sidebarThreadArchiveConfirmButton'),
      onConfirm: async () => {
        setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
        try {
          await onArchiveThread(threadId)
        } finally {
          setDeletingThreadIds((prev) => {
            const next = { ...prev }
            delete next[threadId]
            return next
          })
        }
      }
    })
  }

  const handleSummarizeThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      const res = await rendererRuntimeClient.runtimeRequest(
        `/v1/threads/${encodeURIComponent(threadId)}/summarize`,
        'POST',
        '{}'
      )
      if (!res.ok) {
        useChatStore.getState().setError(t('summarizeFailed'))
        return
      }
      // The summary now lives on the thread; refresh the list so the new
      // subtitle/hover text is picked up from the thread-list projection.
      await useChatStore.getState().refreshThreads()
    } catch {
      useChatStore.getState().setError(t('summarizeFailed'))
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const handleRestoreThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await onRestoreThread(threadId)
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const handlePinThread = async (thread: NormalizedThread, pinned: boolean): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await onPinThread(threadId, pinned)
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const openRenameThreadDialog = (thread: NormalizedThread): void => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    setRenameThreadDialog({
      thread,
      value: thread.title,
      submitting: false
    })
  }

  const closeRenameThreadDialog = (): void => {
    setRenameThreadDialog((current) => current?.submitting ? current : null)
  }

  const submitRenameThreadDialog = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const dialog = renameThreadDialog
    if (!dialog || dialog.submitting) return
    const threadId = dialog.thread.id.trim()
    const nextTitle = dialog.value.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    if (!nextTitle) return
    if (nextTitle === dialog.thread.title) {
      setRenameThreadDialog(null)
      return
    }
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    setRenameThreadDialog((current) =>
      current?.thread.id === threadId ? { ...current, value: nextTitle, submitting: true } : current
    )
    try {
      await onRenameThread(threadId, nextTitle)
      setRenameThreadDialog(null)
    } catch {
      setRenameThreadDialog((current) =>
        current?.thread.id === threadId ? { ...current, submitting: false } : current
      )
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const moveTargetsForThread = (thread: NormalizedThread): string[] => {
    return buildSidebarThreadMoveTargets({
      thread,
      groups: projectWorkspaceGroups,
      threadWorktrees
    })
  }

  const threadMoveDisabledReason = (
    thread: NormalizedThread,
    worktreeRecord?: SidebarThreadWorktreeRecord
  ): string => {
    if (!thread.id.trim()) return t('sidebarThreadMoveUnsupported')
    if (deletingThreadIds[thread.id] === true) return t('loading')
    if (worktreeRecord) return t('sidebarThreadMoveWorktreeBlocked')
    if (thread.status?.trim().toLowerCase() === 'running') return t('sidebarThreadMoveRunningBlocked')
    if (watchTurnCompletion[thread.id] === true) return t('sidebarThreadMoveRunningBlocked')
    if (activeThreadId === thread.id && busy) return t('sidebarThreadMoveRunningBlocked')
    if (typeof getProvider().updateThreadWorkspace !== 'function') return t('sidebarThreadMoveUnsupported')
    return ''
  }

  const moveThreadToWorkspace = async (
    thread: NormalizedThread,
    targetWorkspace: string
  ): Promise<void> => {
    const threadId = thread.id.trim()
    const normalizedTarget = normalizeWorkspaceRoot(targetWorkspace)
    if (!threadId || !normalizedTarget) return
    const provider = getProvider()
    if (typeof provider.updateThreadWorkspace !== 'function') {
      throw new Error(t('sidebarThreadMoveUnsupported'))
    }
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await provider.updateThreadWorkspace(threadId, normalizedTarget)
      useChatStore.setState((state) => ({
        codeWorkspaceRoots: rememberCodeWorkspaceRoots(state.codeWorkspaceRoots, [normalizedTarget]),
        threads: state.threads.map((item) =>
          item.id === threadId ? { ...item, workspace: normalizedTarget } : item
        )
      }))
      await useChatStore.getState().refreshThreads()
      setMoveThreadDialog(null)
      setThreadContextMenu(null)
      setDragOverWorkspace(null)
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
    }
  }

  const confirmThreadWorkspaceMove = (
    thread: NormalizedThread,
    targetWorkspace: string,
    worktreeRecord?: SidebarThreadWorktreeRecord
  ): void => {
    if (threadMoveDisabledReason(thread, worktreeRecord)) return
    const normalizedTarget = normalizeWorkspaceRoot(targetWorkspace)
    if (!normalizedTarget) return
    const currentWorkspaceKey = workspaceRootIdentityKey(
      sidebarWorkspacePathForThread(thread, threadWorktrees, projectWorkspaceGroups.map(([workspacePath]) => workspacePath))
    )
    if (!currentWorkspaceKey || workspaceRootIdentityKey(normalizedTarget) === currentWorkspaceKey) return
    setMoveThreadDialog({
      thread,
      targets: moveTargetsForThread(thread),
      targetWorkspace: normalizedTarget,
      submitting: false,
      error: ''
    })
  }

  const openMoveThreadDialog = (
    thread: NormalizedThread,
    worktreeRecord?: SidebarThreadWorktreeRecord
  ): void => {
    if (busy || threadMoveDisabledReason(thread, worktreeRecord)) return
    setMoveThreadDialog({
      thread,
      targets: moveTargetsForThread(thread),
      targetWorkspace: null,
      submitting: false,
      error: ''
    })
    setThreadContextMenu(null)
  }

  const closeMoveThreadDialog = (): void => {
    setMoveThreadDialog((current) => current?.submitting ? current : null)
  }

  const submitMoveThreadDialog = async (): Promise<void> => {
    const dialog = moveThreadDialog
    if (!dialog || !dialog.targetWorkspace || dialog.submitting) return
    setMoveThreadDialog((current) => current ? { ...current, submitting: true } : current)
    try {
      await moveThreadToWorkspace(dialog.thread, dialog.targetWorkspace)
    } catch (error) {
      setMoveThreadDialog((current) =>
        current
          ? {
              ...current,
              submitting: false,
              error: error instanceof Error && error.message.trim()
                ? error.message
                : t('sidebarThreadMoveFailed')
            }
          : current
      )
    }
  }

  const handleThreadDragStart = (
    event: ReactDragEvent<HTMLDivElement>,
    thread: NormalizedThread
  ): void => {
    const worktreeRecord = worktreeRecordForSidebarThread(thread, threadWorktrees)
    if (busy || threadMoveDisabledReason(thread, worktreeRecord) || moveTargetsForThread(thread).length === 0) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(SIDEBAR_THREAD_DRAG_DATA_KEY, thread.id)
    setDraggingThreadId(thread.id)
    setDragOverWorkspace(null)
  }

  const handleThreadDragEnd = (): void => {
    setDraggingThreadId(null)
    setDragOverWorkspace(null)
  }

  const handleWorkspaceDragOver = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string
  ): void => {
    const threadId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    if (!threadId) return
    const thread = threads.find((item) => item.id === threadId)
    if (!thread) return
    const worktreeRecord = worktreeRecordForSidebarThread(thread, threadWorktrees)
    if (threadMoveDisabledReason(thread, worktreeRecord)) return
    const targets = moveTargetsForThread(thread)
    if (!targets.some((target) => workspaceRootIdentityKey(target) === workspaceRootIdentityKey(workspacePath))) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverWorkspace(workspacePath)
  }

  const handleWorkspaceDrop = (
    event: ReactDragEvent<HTMLDivElement>,
    workspacePath: string
  ): void => {
    event.preventDefault()
    const threadId = draggingThreadId || event.dataTransfer.getData(SIDEBAR_THREAD_DRAG_DATA_KEY)
    setDraggingThreadId(null)
    setDragOverWorkspace(null)
    if (!threadId) return
    const thread = threads.find((item) => item.id === threadId)
    if (!thread) return
    confirmThreadWorkspaceMove(
      thread,
      workspacePath,
      worktreeRecordForSidebarThread(thread, threadWorktrees)
    )
  }

  const openThreadContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    thread: NormalizedThread
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const worktreeRecord = worktreeRecordForSidebarThread(thread, threadWorktrees)
    setWorkspaceContextMenu(null)
    setThreadContextMenu({
      thread,
      ...(worktreeRecord ? { worktreeRecord } : {}),
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 220)
    })
  }

  const openWorkspaceContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    workspacePath: string
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    setThreadContextMenu(null)
    setWorkspaceContextMenu({
      workspacePath,
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 210)
    })
  }

  // Thread hover preview card removed: it showed no useful content. Keep no-op
  // handlers so row hover wiring stays intact without rendering a popup.
  const openThreadPreview = (): void => {}

  const closeThreadPreview = (): void => {}

  const openWorkspaceInSystem = async (workspacePath: string): Promise<void> => {
    if (typeof window === 'undefined' || typeof window.kunGui?.openEditorPath !== 'function') return
    await window.kunGui.openEditorPath({
      path: workspacePath,
      workspaceRoot: workspacePath,
      editorId: 'system'
    }).catch(() => undefined)
  }

  const handleRemoveWorkspace = async (workspacePath: string): Promise<void> => {
    openActionDialog({
      title: t('sidebarWorkspaceRemoveDialogTitle', { name: workspaceLabelFromPath(workspacePath) }),
      description: t('sidebarWorkspaceRemoveDialogDescription'),
      detail: t('sidebarWorkspaceRemoveDialogDetail'),
      confirmLabel: t('sidebarWorkspaceRemoveConfirmButton'),
      danger: true,
      onConfirm: () => onRemoveWorkspace(workspacePath)
    })
  }

  const archivableWorkspaceThreads = (workspacePath: string): NormalizedThread[] => {
    const targetKey = workspaceRootIdentityKey(workspacePath)
    if (!targetKey) return []
    const candidateProjectPaths = sidebarWorkspaceResolutionCandidates({
      workspaceRoot,
      workspaceRoots,
      threadWorktrees,
      threads
    })
    return threads.filter((thread) =>
      thread.archived !== true &&
      workspaceRootIdentityKey(
        sidebarWorkspacePathForThread(thread, threadWorktrees, candidateProjectPaths)
      ) === targetKey
    )
  }

  const handleArchiveWorkspaceThreads = async (workspacePath: string): Promise<void> => {
    const targets = archivableWorkspaceThreads(workspacePath)
    if (targets.length === 0) return
    openActionDialog({
      title: t('sidebarWorkspaceArchiveDialogTitle', { name: workspaceLabelFromPath(workspacePath) }),
      description: t('sidebarWorkspaceArchiveDialogDescription', { count: targets.length }),
      detail: t('sidebarWorkspaceArchiveDialogDetail'),
      confirmLabel: t('sidebarWorkspaceArchiveConfirmButton'),
      onConfirm: async () => {
        const latestTargets = archivableWorkspaceThreads(workspacePath)
        const targetIds = latestTargets.map((thread) => thread.id.trim()).filter(Boolean)
        if (targetIds.length === 0) return
        setDeletingThreadIds((prev) => ({
          ...prev,
          ...Object.fromEntries(targetIds.map((threadId) => [threadId, true]))
        }))
        try {
          for (const threadId of targetIds) {
            await onArchiveThread(threadId)
          }
        } finally {
          setDeletingThreadIds((prev) => {
            const next = { ...prev }
            for (const threadId of targetIds) {
              delete next[threadId]
            }
            return next
          })
        }
      }
    })
  }

  const handleDeleteRequirementDraft = async (draft: SddDraftHistoryItem): Promise<void> => {
    const draftId = draft.id.trim()
    if (!draftId || deletingDraftIds[draftId]) return
    const workspaceKey = draft.workspaceRoot
    openActionDialog({
      title: t('sddDraftHistoryDeleteDialogTitle', { title: draft.title }),
      description: t('sddDraftHistoryDeleteDialogDescription'),
      detail: t('sddDraftHistoryDeleteDialogDetail'),
      confirmLabel: t('sddDraftHistoryDelete'),
      danger: true,
      onConfirm: async () => {
        setDeletingDraftIds((prev) => ({ ...prev, [draftId]: true }))
        setDraftHistoryErrors((prev) => {
          const next = { ...prev }
          delete next[workspaceKey]
          return next
        })
        try {
          const result = await deleteSddDraft(draft)
          if (!result.ok) {
            setDraftHistoryErrors((prev) => ({
              ...prev,
              [workspaceKey]: t('sddDraftHistoryDeleteFailed', { message: result.message })
            }))
            return
          }
          setDraftHistoryByWorkspace((current) => {
            const next = Object.fromEntries(
              Object.entries(current)
                .map(([workspacePath, items]) => [
                  workspacePath,
                  items.filter((item) => item.id !== draftId)
                ] as const)
                .filter(([, items]) => items.length > 0)
            )
            return next
          })
          setDraftHistoryRefreshVersion((version) => version + 1)
        } finally {
          setDeletingDraftIds((prev) => {
            const next = { ...prev }
            delete next[draftId]
            return next
          })
        }
      }
    })
  }

  return (
    <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[38px] items-center justify-between px-2 pb-1.5 pt-3">
        <button
          type="button"
          onClick={toggleAllGroups}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-muted"
          title={t('sidebarProjects')}
          aria-label={t('sidebarProjects')}
        >
          <span className="truncate">{t('sidebarProjects')}</span>
          {allGroupsCollapsed ? (
            <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} />
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <SidebarIconButton
            onClick={() => setSearchOpen((open) => !open)}
            active={searchVisible}
            className="h-7 w-7"
            title={t('sidebarSearchThreads')}
            ariaLabel={t('sidebarSearchThreads')}
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.85} />
          </SidebarIconButton>
          <SidebarIconButton
            onClick={onPickWorkspace}
            className="h-7 w-7"
            title={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
            ariaLabel={workspaceRoot ? t('changeWorkspace') : t('selectWorkspace')}
          >
            <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </SidebarIconButton>
        </div>
      </div>

      {searchVisible ? (
        <div className="mb-2 flex items-center gap-1 px-2">
          <SidebarSearchField
            value={searchQuery}
            onChange={onSearchQueryChange}
            placeholder={t('sidebarSearchThreads')}
            clearLabel={t('clear')}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 pt-0.5">
        {displayGroups.length === 0 ? (
          <SidebarEmpty
            runtimeReady={runtimeReady}
            hasWorkspace={!!workspaceRoot}
            onPickWorkspace={onPickWorkspace}
            t={t}
          />
        ) : null}

        {displayGroups.map(([workspacePath, list]) => {
          const folderName = workspaceLabelFromPath(workspacePath)
          const workspaceContext = workspaceContextLabel(workspacePath, folderName)
          const isCollapsed = collapsed[workspacePath] === true
          const isDragOver =
            dragOverWorkspace !== null
            && workspaceRootIdentityKey(dragOverWorkspace) === workspaceRootIdentityKey(workspacePath)
          const draftHistory = sddDraftHistoryForWorkspace(filteredDraftHistoryByWorkspace, workspacePath)
          const sortedThreads = sortSidebarThreads(
            filterEmptySddAssistantThreadsFromSidebar(list, draftHistory)
          )
          const workspaceExpanded = expandedWorkspaces[workspacePath] === true
          const hasOverflow = sortedThreads.length > 5
          const visibleThreads = workspaceExpanded
            ? sortedThreads
            : sortedThreads.slice(0, 5)
          return (
            <div key={workspacePath} className="mb-2">
              <SidebarTreeRow
                title={workspacePath}
                onClick={() =>
                  setCollapsed((current) => ({ ...current, [workspacePath]: !current[workspacePath] }))
                }
                onContextMenu={(event) => openWorkspaceContextMenu(event, workspacePath)}
                onDragOver={(event) => handleWorkspaceDragOver(event, workspacePath)}
                onDragLeave={() =>
                  setDragOverWorkspace((current) =>
                    workspaceRootIdentityKey(current ?? undefined) === workspaceRootIdentityKey(workspacePath)
                      ? null
                      : current
                  )
                }
                onDrop={(event) => handleWorkspaceDrop(event, workspacePath)}
                className={`min-h-[36px] text-[13.5px] ${
                  isDragOver
                    ? 'bg-accent/10 shadow-[inset_0_0_0_1px_rgba(79,124,255,0.32)]'
                    : ''
                }`}
                buttonClassName="items-center gap-2 px-2.5 py-2"
                actionsVisibility="hidden"
                actionsLayout="overlay"
                actions={
                  <>
                    <SidebarIconButton
                      onClick={() => onCreateThreadInWorkspace(workspacePath)}
                      title={t('sidebarWorkspaceNewThread')}
                      ariaLabel={t('sidebarWorkspaceNewThread')}
                      className="h-6 w-6"
                      stopPropagation
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </SidebarIconButton>
                  </>
                }
              >
                {isCollapsed ? (
                  <Folder className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                ) : (
                  <FolderOpen className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.75} />
                )}
                <span className="min-w-0 flex-1 truncate">{folderName}</span>
                {workspaceContext ? (
                  <span className="min-w-0 max-w-[42%] shrink truncate text-[12.5px] text-ds-faint transition group-hover:opacity-0 group-focus-within:opacity-0">
                    {workspaceContext}
                  </span>
                ) : null}
              </SidebarTreeRow>

              {!isCollapsed ? (
                <div className="mt-1 space-y-[3px] pl-4">
                  <SddDraftHistoryRows
                    items={draftHistory}
                    activeDraftId={activeSddDraftId}
                    deletingDraftIds={deletingDraftIds}
                    error={draftHistoryErrors[workspacePath] ?? ''}
                    onOpen={onOpenRequirementDraft}
                    onDelete={(draft) => void handleDeleteRequirementDraft(draft)}
                    t={t}
                  />
                  {sortedThreads.length === 0 && draftHistory.length === 0 ? (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                      <div className="text-[12.5px] leading-5 text-ds-faint">
                        {searchQuery.trim()
                          ? t('sidebarSearchEmpty')
                          : showArchived
                            ? t('sidebarArchiveEmpty')
                            : t('sidebarWorkspaceEmpty')}
                      </div>
                      {!showArchived && !searchQuery.trim() ? (
                        <button
                          type="button"
                          data-cursor-spotlight-target
                          onClick={() => onCreateThreadInWorkspace(workspacePath)}
                          className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
                        >
                          {t('sidebarWorkspaceNewThread')}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    visibleThreads.map((thread) => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        worktreeRecord={worktreeRecordForSidebarThread(thread, threadWorktrees)}
                        active={(activeView === 'chat' || activeView === 'write') && activeThreadId === thread.id}
                        deleting={deletingThreadIds[thread.id] === true}
                        locale={locale}
                        showRunning={
                          thread.status?.trim().toLowerCase() === 'running' ||
                          (activeThreadId === thread.id && busy) ||
                          watchTurnCompletion[thread.id] === true
                        }
                        showUnread={
                          unreadThreadIds[thread.id] === true && activeThreadId !== thread.id
                        }
                        onSelect={() => onSelectThread(thread.id)}
                        onContextMenu={(event) => openThreadContextMenu(event, thread)}
                        onPreviewOpen={openThreadPreview}
                        onPreviewClose={closeThreadPreview}
                        draggable={
                          !busy
                          && !threadMoveDisabledReason(thread, worktreeRecordForSidebarThread(thread, threadWorktrees))
                          && moveTargetsForThread(thread).length > 0
                        }
                        onDragStart={(event) => handleThreadDragStart(event, thread)}
                        onDragEnd={handleThreadDragEnd}
                        onPin={() => void handlePinThread(thread, thread.pinned !== true)}
                        onRename={() => openRenameThreadDialog(thread)}
                        onArchive={() => void handleArchiveThread(thread)}
                        onDelete={() => void handleDeleteThread(thread)}
                        onRestore={() => void handleRestoreThread(thread)}
                      />
                    ))
                  )}
                  {hasOverflow ? (
                    <button
                      type="button"
                      data-cursor-spotlight-target
                      onClick={() =>
                        setExpandedWorkspaces((current) => ({
                          ...current,
                          [workspacePath]: !workspaceExpanded
                        }))
                      }
                      className="ml-1 mt-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
                    >
                      {workspaceExpanded
                        ? t('sidebarWorkspaceShowLess')
                        : t('sidebarWorkspaceShowMore', {
                            count: sortedThreads.length - 5
                          })}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {threadContextMenu ? (
        <ThreadContextMenu
          state={threadContextMenu}
          busy={deletingThreadIds[threadContextMenu.thread.id] === true}
          moveDisabled={busy || Boolean(threadMoveDisabledReason(threadContextMenu.thread, threadContextMenu.worktreeRecord))}
          moveDisabledTitle={threadMoveDisabledReason(threadContextMenu.thread, threadContextMenu.worktreeRecord) || undefined}
          onClose={() => setThreadContextMenu(null)}
          onMove={() => openMoveThreadDialog(threadContextMenu.thread, threadContextMenu.worktreeRecord)}
          onPin={() => void handlePinThread(threadContextMenu.thread, threadContextMenu.thread.pinned !== true)}
          onRename={() => openRenameThreadDialog(threadContextMenu.thread)}
          onSummarize={() => void handleSummarizeThread(threadContextMenu.thread)}
          onArchive={() => void handleArchiveThread(threadContextMenu.thread)}
          onDelete={() => void handleDeleteThread(threadContextMenu.thread)}
          onRestore={() => void handleRestoreThread(threadContextMenu.thread)}
          t={t}
        />
      ) : null}

      {workspaceContextMenu ? (
        <WorkspaceContextMenu
          state={workspaceContextMenu}
          onClose={() => setWorkspaceContextMenu(null)}
          onNewThread={() => onCreateThreadInWorkspace(workspaceContextMenu.workspacePath)}
          onOpenInSystem={() => void openWorkspaceInSystem(workspaceContextMenu.workspacePath)}
          onArchiveThreads={() => void handleArchiveWorkspaceThreads(workspaceContextMenu.workspacePath)}
          onRemove={() => void handleRemoveWorkspace(workspaceContextMenu.workspacePath)}
          archiveDisabled={archivableWorkspaceThreads(workspaceContextMenu.workspacePath).length === 0}
          t={t}
        />
      ) : null}

      {renameThreadDialog ? (
        <ThreadRenameDialog
          state={renameThreadDialog}
          onClose={closeRenameThreadDialog}
          onValueChange={(value) =>
            setRenameThreadDialog((current) => current ? { ...current, value } : current)
          }
          onSubmit={(event) => void submitRenameThreadDialog(event)}
          t={t}
        />
      ) : null}

      {moveThreadDialog ? (
        <MoveThreadDialog
          state={moveThreadDialog}
          onClose={closeMoveThreadDialog}
          onPickTarget={(targetWorkspace) =>
            confirmThreadWorkspaceMove(
              moveThreadDialog.thread,
              targetWorkspace,
              worktreeRecordForSidebarThread(moveThreadDialog.thread, threadWorktrees)
            )
          }
          onConfirm={submitMoveThreadDialog}
          t={t}
        />
      ) : null}

      {actionDialog ? (
        <SidebarActionDialog
          state={actionDialog}
          onClose={closeActionDialog}
          onConfirm={() => void submitActionDialog()}
          t={t}
        />
      ) : null}
    </div>
  )
}

type ThreadRowProps = {
  thread: NormalizedThread
  worktreeRecord?: SidebarThreadWorktreeRecord
  active: boolean
  deleting: boolean
  locale: string
  showRunning: boolean
  showUnread: boolean
  onSelect: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
  onPreviewOpen: (event: ReactMouseEvent<HTMLDivElement>, worktreeRecord?: SidebarThreadWorktreeRecord) => void
  onPreviewClose: () => void
  draggable?: boolean
  onDragStart?: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd?: (event: ReactDragEvent<HTMLDivElement>) => void
  onPin: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
}

export function SddDraftHistoryRows({
  items,
  activeDraftId,
  onOpen,
  onDelete,
  deletingDraftIds = {},
  error = '',
  t
}: {
  items: SddDraftHistoryItem[]
  activeDraftId: string
  onOpen: (draft: SddDraft) => void
  onDelete?: (draft: SddDraftHistoryItem) => void
  deletingDraftIds?: Record<string, boolean>
  error?: string
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement | null {
  const itemKey = items.map((item) => item.id).join('\n')
  const [collapsed, setCollapsed] = useState(true)
  const [visibleCount, setVisibleCount] = useState(SDD_DRAFT_HISTORY_PAGE_SIZE)

  useEffect(() => {
    setCollapsed(true)
    setVisibleCount(SDD_DRAFT_HISTORY_PAGE_SIZE)
  }, [itemKey])

  if (items.length === 0) return null

  const visibleItems = items.slice(0, visibleCount)
  const remainingCount = Math.max(0, items.length - visibleItems.length)
  const nextCount = Math.min(SDD_DRAFT_HISTORY_PAGE_SIZE, remainingCount)

  return (
    <div className="mb-1.5 rounded-lg border border-transparent bg-[var(--ds-sidebar-row-hover)]/35 px-1 py-1">
      <SidebarTreeRow
        title={t('sddDraftHistoryTitle')}
        ariaLabel={collapsed ? t('sddDraftHistoryExpand') : t('sddDraftHistoryCollapse')}
        onClick={() => setCollapsed((current) => !current)}
        className="min-h-[28px]"
        buttonClassName="items-center gap-1.5 px-2 py-1.5"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ds-faint">
          {t('sddDraftHistoryTitle')}
        </span>
        <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint tabular-nums">
          {items.length}
        </span>
      </SidebarTreeRow>
      {error ? (
        <div className="px-2 py-1 text-[11.5px] leading-4 text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {!collapsed ? (
        <div className="space-y-[2px] pt-1">
          {visibleItems.map((item) => (
            <SidebarTreeRow
              key={item.id}
              active={activeDraftId === item.id}
              activeVariant="outline"
              actionsVisibility={deletingDraftIds[item.id] ? 'visible' : 'hidden'}
              actionsLayout="overlay"
              actions={
                onDelete ? (
                  <SidebarIconButton
                    onClick={() => onDelete(item)}
                    disabled={deletingDraftIds[item.id] === true}
                    tone="danger"
                    title={t('sddDraftHistoryDelete')}
                    ariaLabel={t('sddDraftHistoryDelete')}
                    stopPropagation
                  >
                    {deletingDraftIds[item.id] ? (
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                    ) : (
                      <Trash2 className="h-3 w-3" strokeWidth={1.9} />
                    )}
                  </SidebarIconButton>
                ) : null
              }
              className="min-h-[32px]"
              buttonClassName="items-center gap-2 px-2 py-1.5"
              title={item.relativePath}
              ariaLabel={t('sddDraftHistoryOpen', { title: item.title })}
              onClick={() => onOpen(item)}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition ${
                  activeDraftId === item.id
                    ? 'border-accent/25 bg-accent/10 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]'
                    : 'border-ds-border-muted bg-ds-card/70 text-ds-faint group-hover:border-accent/20 group-hover:bg-accent/10 group-hover:text-accent'
                }`}
                aria-hidden="true"
              >
                <ClipboardList className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-4 text-ds-ink">{item.title}</span>
                <span className="block truncate text-[11.5px] leading-4 text-ds-faint">{item.relativePath}</span>
              </span>
              <span className="shrink-0 rounded-md bg-ds-card/70 px-1.5 py-0.5 text-[10.5px] text-ds-faint transition group-hover:opacity-0 group-focus-within:opacity-0">
                {item.source === 'remembered' ? t('sddDraftHistoryRemembered') : t('sddDraftHistoryDisk')}
              </span>
            </SidebarTreeRow>
          ))}
        </div>
      ) : null}
      {!collapsed && remainingCount > 0 ? (
        <button
          type="button"
          data-cursor-spotlight-target
          onClick={() =>
            setVisibleCount((count) => Math.min(items.length, count + SDD_DRAFT_HISTORY_PAGE_SIZE))
          }
          className="ml-1 mt-1 rounded-md px-2.5 py-1.5 text-[12.5px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
        >
          {t('sddDraftHistoryShowMore', { count: nextCount })}
        </button>
      ) : null}
    </div>
  )
}

export function ThreadRow({
  thread,
  worktreeRecord,
  active,
  deleting,
  locale,
  showRunning,
  showUnread,
  onSelect,
  onContextMenu,
  onPreviewOpen,
  onPreviewClose,
  draggable = false,
  onDragStart,
  onDragEnd,
  onPin,
  onRename,
  onArchive,
  onDelete,
  onRestore
}: ThreadRowProps): ReactElement {
  const { t } = useTranslation('common')
  const showUnreadDot = showUnread && !showRunning
  const archived = thread.archived === true
  const pinned = thread.pinned === true
  const worktreeLabel = worktreeRecord
    ? t('sidebarThreadWorktree', { branch: worktreeRecord.branch || 'worktree' })
    : ''
  const updatedLabel = formatRelativeTime(thread.updatedAt, locale)
  const ariaLabel = [
    thread.title,
    updatedLabel,
    pinned ? t('sidebarThreadPinned') : '',
    showRunning ? t('sidebarThreadRunning') : '',
    showUnreadDot ? t('sidebarThreadUnread') : '',
    worktreeLabel
  ].filter(Boolean).join(' - ')

  return (
    <SidebarTreeRow
      active={active}
      actionsVisibility={deleting ? 'visible' : 'hidden'}
      actionsLayout="overlay"
      actions={
        <>
          {!archived ? (
            <SidebarIconButton
              onClick={onPin}
              disabled={deleting}
              tone="accent"
              title={pinned ? t('sidebarThreadUnpin') : t('sidebarThreadPin')}
              ariaLabel={pinned ? t('sidebarThreadUnpin') : t('sidebarThreadPin')}
              active={pinned}
              stopPropagation
            >
              {pinned ? (
                <PinOff className="h-3 w-3" strokeWidth={1.9} />
              ) : (
                <Pin className="h-3 w-3" strokeWidth={1.9} />
              )}
            </SidebarIconButton>
          ) : null}
          <SidebarIconButton
            onClick={archived ? onRestore : onArchive}
            disabled={deleting}
            tone="accent"
            title={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
            ariaLabel={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
            stopPropagation
          >
            {deleting ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : archived ? (
              <RotateCcw className="h-3 w-3" strokeWidth={1.9} />
            ) : (
              <Archive className="h-3 w-3" strokeWidth={1.9} />
            )}
          </SidebarIconButton>
          <SidebarIconButton
            onClick={onDelete}
            disabled={deleting}
            tone="danger"
            title={t('sidebarThreadDelete')}
            ariaLabel={t('sidebarThreadDelete')}
            stopPropagation
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.9} />
          </SidebarIconButton>
        </>
      }
      className="min-h-[34px]"
      buttonClassName="items-center gap-2 px-2.5 py-1.5"
      disabled={deleting}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      ariaLabel={ariaLabel}
      title={[thread.title, thread.summary?.trim(), worktreeLabel].filter(Boolean).join('\n')}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseEnter={(event) => onPreviewOpen(event, worktreeRecord)}
      onMouseLeave={onPreviewClose}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {pinned ? (
          <Pin className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
        ) : null}
        {worktreeRecord ? (
          <span
            className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ds-border-muted bg-ds-card/80 text-ds-muted"
            title={worktreeLabel}
            aria-label={worktreeLabel}
          >
            <GitBranch className="h-3 w-3" strokeWidth={1.8} />
          </span>
        ) : null}
        <span
          className={`min-w-0 flex-1 truncate text-[13.5px] leading-5 ${
            showUnreadDot && !active ? 'font-semibold text-ds-ink' : 'text-ds-ink'
          }`}
        >
          {thread.title}
        </span>
        <span className={`ml-auto flex min-w-[3.75rem] shrink-0 items-center justify-end gap-1.5 transition ${
          deleting ? 'opacity-0' : 'group-hover:opacity-0 group-focus-within:opacity-0'
        }`}>
          <span className="shrink-0 text-right text-[12px] leading-4 text-ds-faint tabular-nums">
            {updatedLabel}
          </span>
          <ThreadActivityDot
            running={showRunning}
            unread={showUnreadDot}
            unreadLabel={t('sidebarThreadUnread')}
          />
        </span>
      </span>
    </SidebarTreeRow>
  )
}

export function ThreadRenameDialog({
  state,
  onClose,
  onValueChange,
  onSubmit,
  t
}: {
  state: RenameThreadDialogState
  onClose: () => void
  onValueChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  const nextTitle = state.value.trim()
  const unchanged = nextTitle === state.thread.title
  const canSubmit = Boolean(nextTitle) && !unchanged && !state.submitting

  useEffect(() => {
    if (state.submitting) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, state.submitting])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="thread-rename-dialog-title"
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <form
        onSubmit={onSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        <h2
          id="thread-rename-dialog-title"
          className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink"
        >
          {t('sidebarThreadRename')}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {t('sidebarThreadRenamePrompt')}
        </p>
        <input
          autoFocus
          aria-label={t('sidebarThreadRenamePrompt')}
          disabled={state.submitting}
          value={state.value}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-4 w-full rounded-xl border border-ds-border bg-ds-main/65 px-3 py-2 text-[14px] text-ds-ink outline-none transition focus:border-accent/40 focus:ring-1 focus:ring-accent/25 disabled:cursor-wait disabled:opacity-70"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={state.submitting}
            onClick={onClose}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {state.submitting ? t('loading') : t('confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}

export function MoveThreadDialog({
  state,
  onClose,
  onPickTarget,
  onConfirm,
  t
}: {
  state: MoveThreadDialogState
  onClose: () => void
  onPickTarget: (workspacePath: string) => void
  onConfirm: () => Promise<void>
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  const threadTitle = state.thread.title.trim() || state.thread.id
  const fromWorkspace = normalizeWorkspaceRoot(state.thread.workspace)
  const selectedTarget = state.targetWorkspace ? normalizeWorkspaceRoot(state.targetWorkspace) : ''
  const canConfirm = Boolean(selectedTarget) && !state.submitting

  useEffect(() => {
    if (state.submitting) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, state.submitting])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-thread-dialog-title"
      className="ds-no-drag fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        <h2
          id="move-thread-dialog-title"
          className="text-[18px] font-semibold tracking-[-0.035em] text-ds-ink"
        >
          {state.targetWorkspace
            ? t('sidebarThreadMoveDialogTitle', { title: threadTitle })
            : t('sidebarThreadMovePickerTitle')}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-ds-muted">
          {state.targetWorkspace
            ? t('sidebarThreadMoveDialogDescription', {
                from: workspaceLabelFromPath(fromWorkspace),
                to: workspaceLabelFromPath(selectedTarget)
              })
            : t('sidebarThreadMovePickerDescription')}
        </p>
        {state.targetWorkspace ? (
          <div className="mt-4 space-y-2">
            <p className="rounded-2xl border border-ds-border-muted bg-ds-main px-3.5 py-3 text-[13px] leading-6 text-ds-muted">
              {t('sidebarThreadMoveDialogDetail')}
            </p>
            <p className="rounded-2xl border border-amber-300/45 bg-amber-50/75 px-3.5 py-3 text-[12.5px] leading-5 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
              {t('sidebarThreadMoveMetadataOnlyDetail')}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {state.targets.length === 0 ? (
              <div className="rounded-2xl border border-ds-border-muted bg-ds-main px-3.5 py-3 text-[13px] leading-6 text-ds-muted">
                {t('sidebarThreadMoveNoTargets')}
              </div>
            ) : (
              state.targets.map((workspacePath) => (
                <button
                  key={workspacePath}
                  type="button"
                  onClick={() => onPickTarget(workspacePath)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-ds-border bg-ds-main/55 px-3.5 py-3 text-left transition hover:border-accent/35 hover:bg-accent/6"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ds-ink">
                      {workspaceLabelFromPath(workspacePath)}
                    </span>
                    <span className="mt-1 block truncate text-[12px] text-ds-faint">
                      {workspacePath}
                    </span>
                  </span>
                  <MoveRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
                </button>
              ))
            )}
          </div>
        )}
        {state.error ? (
          <p className="mt-4 text-[12.5px] leading-5 text-red-600 dark:text-red-300">
            {state.error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={state.submitting}
            onClick={onClose}
            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          {state.targetWorkspace ? (
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => void onConfirm()}
              className="rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {state.submitting ? t('loading') : t('sidebarThreadMoveConfirmButton')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ThreadContextMenu({
  state,
  busy,
  moveDisabled,
  moveDisabledTitle,
  onClose,
  onMove,
  onPin,
  onRename,
  onSummarize,
  onArchive,
  onDelete,
  onRestore,
  t
}: {
  state: ThreadContextMenuState
  busy: boolean
  moveDisabled: boolean
  moveDisabledTitle?: string
  onClose: () => void
  onMove: () => void
  onPin: () => void
  onRename: () => void
  onSummarize: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  const archived = state.thread.archived === true
  const pinned = state.thread.pinned === true
  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return (
    <div
      role="menu"
      aria-label={state.thread.title}
      className="ds-thread-context-menu ds-no-drag fixed z-50 min-w-[210px] rounded-[16px] border border-ds-border bg-ds-card/95 p-1.5 text-[13px] text-ds-ink shadow-[0_18px_52px_rgba(20,47,95,0.18)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ThreadContextMenuItem
        icon={pinned ? <PinOff className="h-3.5 w-3.5" strokeWidth={1.9} /> : <Pin className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={pinned ? t('sidebarThreadUnpin') : t('sidebarThreadPin')}
        disabled={busy || archived}
        onClick={() => run(onPin)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <ThreadContextMenuItem
        icon={<MoveRight className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarThreadMove')}
        disabled={moveDisabled}
        title={moveDisabledTitle}
        onClick={() => run(onMove)}
      />
      <ThreadContextMenuItem
        icon={<PencilLine className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarThreadRename')}
        disabled={busy}
        onClick={() => run(onRename)}
      />
      <ThreadContextMenuItem
        icon={<ScrollText className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('summarizeSession')}
        disabled={busy}
        onClick={() => run(onSummarize)}
      />
      <ThreadContextMenuItem
        icon={
          archived
            ? <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.9} />
            : <Archive className="h-3.5 w-3.5" strokeWidth={1.9} />
        }
        label={archived ? t('sidebarThreadRestore') : t('sidebarThreadArchive')}
        disabled={busy}
        onClick={() => run(archived ? onRestore : onArchive)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <ThreadContextMenuItem
        icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarThreadDelete')}
        disabled={busy}
        danger
        onClick={() => run(onDelete)}
      />
    </div>
  )
}

function WorkspaceContextMenu({
  state,
  onClose,
  onNewThread,
  onOpenInSystem,
  onArchiveThreads,
  onRemove,
  archiveDisabled,
  t
}: {
  state: WorkspaceContextMenuState
  onClose: () => void
  onNewThread: () => void
  onOpenInSystem: () => void
  onArchiveThreads: () => void
  onRemove: () => void
  archiveDisabled: boolean
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return (
    <div
      role="menu"
      aria-label={state.workspacePath}
      className="ds-workspace-context-menu ds-no-drag fixed z-50 min-w-[230px] rounded-[16px] border border-ds-border bg-ds-card/95 p-1.5 text-[13px] text-ds-ink shadow-[0_18px_52px_rgba(20,47,95,0.18)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ThreadContextMenuItem
        icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarWorkspaceNewThread')}
        disabled={false}
        onClick={() => run(onNewThread)}
      />
      <ThreadContextMenuItem
        icon={<ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarWorkspaceOpenInSystem')}
        disabled={false}
        onClick={() => run(onOpenInSystem)}
      />
      <ThreadContextMenuItem
        icon={<Archive className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarWorkspaceArchiveThreads')}
        disabled={archiveDisabled}
        onClick={() => run(onArchiveThreads)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      <ThreadContextMenuItem
        icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />}
        label={t('sidebarWorkspaceRemove')}
        disabled={false}
        danger
        onClick={() => run(onRemove)}
      />
    </div>
  )
}

export function SidebarActionDialog({
  state,
  onClose,
  onConfirm,
  t
}: {
  state: SidebarActionDialogState
  onClose: () => void
  onConfirm: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}): ReactElement {
  useEffect(() => {
    if (state.submitting) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, state.submitting])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sidebar-action-dialog-title"
      className="ds-no-drag fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/28 px-4 pb-10 backdrop-blur-[2px] dark:bg-black/45 sm:items-center sm:pb-0"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-[520px] rounded-[26px] border border-ds-border bg-[var(--surface-3)] p-6 shadow-[0_26px_82px_rgba(20,47,95,0.24)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              id="sidebar-action-dialog-title"
              className="text-[22px] font-semibold tracking-[-0.04em] text-ds-ink"
            >
              {state.title}
            </h2>
            <p className="mt-2 text-[14px] leading-6 text-ds-muted">{state.description}</p>
          </div>
          <button
            type="button"
            disabled={state.submitting}
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink disabled:cursor-wait disabled:opacity-50"
            aria-label={t('cancel')}
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <p className="mt-4 rounded-2xl border border-ds-border-muted bg-ds-main px-3.5 py-3 text-[13px] leading-6 text-ds-muted">
          {state.detail}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={state.submitting}
            onClick={onClose}
            className="rounded-2xl px-4 py-2 text-[14px] font-medium text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={state.submitting}
            onClick={onConfirm}
            className={`rounded-2xl px-5 py-2 text-[14px] font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
              state.danger
                ? 'bg-red-500/12 text-red-600 hover:bg-red-500/18 dark:text-red-300'
                : 'bg-accent text-white hover:brightness-110'
            }`}
          >
            {state.submitting ? t('loading') : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ThreadContextMenuItem({
  icon,
  label,
  disabled,
  title,
  danger = false,
  onClick
}: {
  icon: ReactElement
  label: string
  disabled: boolean
  title?: string
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-300'
          : 'text-ds-ink hover:bg-[var(--ds-sidebar-row-hover)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current opacity-80">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function workspaceContextLabel(workspacePath: string, folderName: string): string {
  const normalized = workspacePath.replace(/[/\\]+$/, '')
  const parts = normalized.split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2] ?? ''
  if (!parent || parent.toLowerCase() === folderName.toLowerCase()) return ''
  return parent
}

function ThreadActivityDot({
  running,
  unread,
  unreadLabel
}: {
  running: boolean
  unread: boolean
  unreadLabel: string
}): ReactElement | null {
  if (running) {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" strokeWidth={2} />
  }

  if (unread) {
    return (
      <span
        className="block h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_1px_rgba(79,124,255,0.2)]"
        title={unreadLabel}
      />
    )
  }

  return null
}

type SidebarEmptyProps = {
  runtimeReady: boolean
  hasWorkspace: boolean
  onPickWorkspace: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}

function SidebarEmpty({
  runtimeReady,
  hasWorkspace,
  onPickWorkspace,
  t
}: SidebarEmptyProps): ReactElement {
  if (!hasWorkspace && runtimeReady) {
    return (
      <button
        type="button"
        onClick={onPickWorkspace}
        className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink"
      >
        <FolderPlus className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {t('selectWorkspace')}
        </span>
      </button>
    )
  }

  return (
    <div className="mx-2 mt-2 rounded-lg px-2 py-2">
      <p className="text-[15px] font-medium text-ds-muted">{t('sidebarEmptyTitle')}</p>
      <p className="mt-1 text-[13px] leading-5 text-ds-faint">
        {runtimeReady ? t('sidebarEmptySub') : t('sidebarEmptySubOffline')}
      </p>
    </div>
  )
}
