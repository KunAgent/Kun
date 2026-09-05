import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from 'react'
import type { NormalizedThread } from '../../agent/types'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import {
  sidebarWorkspacePathForThread,
  sidebarWorkspaceResolutionCandidates,
  worktreeRecordForSidebarThread,
  type SidebarThreadWorktrees
} from './sidebar-project-selectors'
import { resolveProjectWorkspacePath } from '../../lib/worktree-project-path'
import type { SidebarVirtualFolder } from './sidebar-folders'
import type {
  FolderContextMenuState,
  SidebarActionDialogState,
  ThreadContextMenuState,
  WorkspaceContextMenuState
} from './SidebarProjectOverlays'

type Params = {
  t: (key: string, options?: Record<string, unknown>) => string
  threads: NormalizedThread[]
  workspaceRoot: string
  workspaceRoots: string[]
  threadWorktrees: SidebarThreadWorktrees
  setThreadContextMenu: Dispatch<SetStateAction<ThreadContextMenuState | null>>
  setWorkspaceContextMenu: Dispatch<SetStateAction<WorkspaceContextMenuState | null>>
  setFolderContextMenu: Dispatch<SetStateAction<FolderContextMenuState | null>>
  setDeletingThreadIds: Dispatch<SetStateAction<Record<string, boolean>>>
  openActionDialog: (dialog: Omit<SidebarActionDialogState, 'submitting'>) => void
  onRemoveWorkspace: (workspacePath: string, relatedPaths?: string[]) => Promise<void>
  onArchiveThread: (threadId: string) => Promise<void>
}

export function createSidebarProjectWorkspaceActions({
  t,
  threads,
  workspaceRoot,
  workspaceRoots,
  threadWorktrees,
  setThreadContextMenu,
  setWorkspaceContextMenu,
  setFolderContextMenu,
  setDeletingThreadIds,
  openActionDialog,
  onRemoveWorkspace,
  onArchiveThread
}: Params) {
  const openThreadContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    thread: NormalizedThread
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const worktreeRecord = worktreeRecordForSidebarThread(thread, threadWorktrees)
    setWorkspaceContextMenu(null)
    setFolderContextMenu(null)
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
    setFolderContextMenu(null)
    setWorkspaceContextMenu({
      workspacePath,
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 210)
    })
  }

  const openFolderContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    workspacePath: string,
    folder: SidebarVirtualFolder
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    setThreadContextMenu(null)
    setWorkspaceContextMenu(null)
    setFolderContextMenu({
      workspacePath,
      folder,
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 130)
    })
  }

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

  /**
   * Every path that displays as this project: the display path, worktree paths
   * from the sidebar registries, thread workspaces and remembered roots that
   * resolve back to the same project identity.
   */
  const relatedProjectPaths = (workspacePath: string): string[] => {
    const targetKey = workspaceRootIdentityKey(workspacePath)
    if (!targetKey) return []
    const candidateProjectPaths = sidebarWorkspaceResolutionCandidates({
      workspaceRoot,
      workspaceRoots,
      threadWorktrees,
      threads
    })
    const aliases = new Set<string>([normalizeWorkspaceRoot(workspacePath)])
    for (const record of Object.values(threadWorktrees)) {
      if (workspaceRootIdentityKey(record.projectPath) === targetKey) {
        aliases.add(normalizeWorkspaceRoot(record.worktreePath))
      }
    }
    for (const thread of threads) {
      const workspace = normalizeWorkspaceRoot(thread.workspace)
      if (!workspace) continue
      const resolved = resolveProjectWorkspacePath(workspace, {
        threadWorktrees,
        candidateProjectPaths
      }) || workspace
      if (workspaceRootIdentityKey(resolved) === targetKey) aliases.add(workspace)
    }
    for (const root of [...workspaceRoots, workspaceRoot]) {
      const normalized = normalizeWorkspaceRoot(root)
      if (!normalized) continue
      const resolved = resolveProjectWorkspacePath(normalized, {
        threadWorktrees,
        candidateProjectPaths
      }) || normalized
      if (workspaceRootIdentityKey(resolved) === targetKey) aliases.add(normalized)
    }
    aliases.delete('')
    return [...aliases]
  }

  const handleRemoveWorkspace = async (workspacePath: string): Promise<void> => {
    openActionDialog({
      title: t('sidebarWorkspaceRemoveDialogTitle', { name: workspaceLabelFromPath(workspacePath) }),
      description: t('sidebarWorkspaceRemoveDialogDescription'),
      detail: t('sidebarWorkspaceRemoveDialogDetail'),
      confirmLabel: t('sidebarWorkspaceRemoveConfirmButton'),
      danger: true,
      onConfirm: () => onRemoveWorkspace(workspacePath, relatedProjectPaths(workspacePath))
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
        const targetIds = archivableWorkspaceThreads(workspacePath)
          .map((thread) => thread.id.trim())
          .filter(Boolean)
        if (targetIds.length === 0) return
        setDeletingThreadIds((prev) => ({
          ...prev,
          ...Object.fromEntries(targetIds.map((threadId) => [threadId, true]))
        }))
        try {
          for (const threadId of targetIds) await onArchiveThread(threadId)
        } finally {
          setDeletingThreadIds((prev) => {
            const next = { ...prev }
            for (const threadId of targetIds) delete next[threadId]
            return next
          })
        }
      }
    })
  }

  return {
    archivableWorkspaceThreads,
    closeThreadPreview,
    handleArchiveWorkspaceThreads,
    handleRemoveWorkspace,
    openFolderContextMenu,
    openThreadContextMenu,
    openThreadPreview,
    openWorkspaceContextMenu,
    openWorkspaceInSystem
  }
}
