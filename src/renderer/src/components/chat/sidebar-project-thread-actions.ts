import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { kunThreadSummarizePath } from '@shared/kun-endpoints'
import { parseRuntimeErrorBody } from '@shared/runtime-error'
import type { NormalizedThread } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { useChatStore } from '../../store/chat-store'
import { rememberCodeWorkspaceRoots } from '../../store/chat-store-helpers'
import { normalizeWorkspaceRoot, workspaceRootIdentityKey } from '../../lib/workspace-path'
import { threadLooksRunning } from '../../store/chat-store-runtime-helpers'
import {
  buildSidebarThreadMoveTargets,
  sidebarWorkspacePathForThread,
  type SidebarThreadWorktreeRecord,
  type SidebarThreadWorktrees,
  type SidebarWorkspaceGroup
} from './sidebar-project-selectors'
import { removeSidebarThreadAssignments, type SidebarFolderRegistry } from './sidebar-folders'
import type {
  MoveThreadDialogState,
  RenameThreadDialogState,
  SidebarActionDialogState,
  ThreadContextMenuState
} from './SidebarProjectOverlays'

/** Reads `{ id, summary }` from a successful summarize response. */
export function readSummaryFromResponse(body: string): string {
  try {
    const parsed = JSON.parse(body) as { summary?: unknown }
    return typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  } catch {
    return ''
  }
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

type Params = {
  t: (key: string, options?: Record<string, unknown>) => string
  activeThreadId: string | null
  busy: boolean
  watchTurnCompletion: Record<string, boolean>
  projectWorkspaceGroups: SidebarWorkspaceGroup[]
  threadWorktrees: SidebarThreadWorktrees
  deletingThreadIds: Record<string, boolean>
  actionDialog: SidebarActionDialogState | null
  renameThreadDialog: RenameThreadDialogState | null
  moveThreadDialog: MoveThreadDialogState | null
  setDeletingThreadIds: Dispatch<SetStateAction<Record<string, boolean>>>
  setActionDialog: Dispatch<SetStateAction<SidebarActionDialogState | null>>
  setRenameThreadDialog: Dispatch<SetStateAction<RenameThreadDialogState | null>>
  setMoveThreadDialog: Dispatch<SetStateAction<MoveThreadDialogState | null>>
  setThreadContextMenu: Dispatch<SetStateAction<ThreadContextMenuState | null>>
  setDragOverWorkspace: Dispatch<SetStateAction<string | null>>
  persistSidebarFolders: (update: (current: SidebarFolderRegistry) => SidebarFolderRegistry) => void
  onRenameThread: (threadId: string, title: string) => Promise<void>
  onPinThread: (threadId: string, pinned: boolean) => Promise<void>
  onArchiveThread: (threadId: string) => Promise<void>
  onDeleteThread: (threadId: string) => Promise<void>
  onRestoreThread: (threadId: string) => Promise<void>
}

export function createSidebarProjectThreadActions({
  t,
  activeThreadId,
  busy,
  watchTurnCompletion,
  projectWorkspaceGroups,
  threadWorktrees,
  deletingThreadIds,
  actionDialog,
  renameThreadDialog,
  moveThreadDialog,
  setDeletingThreadIds,
  setActionDialog,
  setRenameThreadDialog,
  setMoveThreadDialog,
  setThreadContextMenu,
  setDragOverWorkspace,
  persistSidebarFolders,
  onRenameThread,
  onPinThread,
  onArchiveThread,
  onDeleteThread,
  onRestoreThread
}: Params) {
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

  const withThreadBusy = async (threadId: string, action: () => Promise<void>): Promise<void> => {
    setDeletingThreadIds((prev) => ({ ...prev, [threadId]: true }))
    try {
      await action()
    } finally {
      setDeletingThreadIds((prev) => {
        const next = { ...prev }
        delete next[threadId]
        return next
      })
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
      onConfirm: () => withThreadBusy(threadId, async () => {
        await onDeleteThread(threadId)
        persistSidebarFolders((current) => removeSidebarThreadAssignments(current, [threadId]))
      })
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
      onConfirm: () => withThreadBusy(threadId, () => onArchiveThread(threadId))
    })
  }

  const handleSummarizeThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    let summary = ''
    await withThreadBusy(threadId, async () => {
      try {
        const res = await rendererRuntimeClient.runtimeRequest(
          kunThreadSummarizePath(threadId),
          'POST',
          '{}'
        )
        if (!res.ok) {
          const runtimeError = parseRuntimeErrorBody(res.body, t('summarizeFailed'))
          // A sidebar row cached from an earlier profile can outlive the thread
          // in the runtime store. Refreshing drops the ghost row so the user
          // stops retrying an id the runtime cannot resolve (#1200).
          if (res.status === 404 || runtimeError.code === 'not_found') {
            useChatStore.getState().setError(t('summarizeThreadMissing'))
            await useChatStore.getState().refreshThreads()
            return
          }
          useChatStore.getState().setError(`${t('summarizeFailed')}: ${runtimeError.message}`)
          return
        }
        summary = readSummaryFromResponse(res.body)
        await useChatStore.getState().refreshThreads()
      } catch (error) {
        const detail = error instanceof Error ? error.message.trim() : String(error ?? '').trim()
        useChatStore.getState().setError(
          detail ? `${t('summarizeFailed')}: ${detail}` : t('summarizeFailed')
        )
      }
    })
    if (!summary) return
    openActionDialog({
      title: t('summarizeSummaryTitle'),
      description: thread.title,
      detail: summary,
      confirmLabel: t('sidebarThreadCopySummary'),
      onConfirm: () => copyToClipboard(summary)
    })
  }

  const handleCopyThreadId = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId) return
    try {
      await copyToClipboard(threadId)
    } catch {
      useChatStore.getState().setError(t('copyFailed'))
    }
  }

  const handleRestoreThread = async (thread: NormalizedThread): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    await withThreadBusy(threadId, () => onRestoreThread(threadId))
  }

  const handlePinThread = async (thread: NormalizedThread, pinned: boolean): Promise<void> => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    await withThreadBusy(threadId, () => onPinThread(threadId, pinned))
  }

  const openRenameThreadDialog = (thread: NormalizedThread): void => {
    const threadId = thread.id.trim()
    if (!threadId || deletingThreadIds[threadId]) return
    setRenameThreadDialog({ thread, value: thread.title, submitting: false })
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
    if (!threadId || deletingThreadIds[threadId] || !nextTitle) return
    if (nextTitle === dialog.thread.title) {
      setRenameThreadDialog(null)
      return
    }
    setRenameThreadDialog((current) =>
      current?.thread.id === threadId ? { ...current, value: nextTitle, submitting: true } : current
    )
    try {
      await withThreadBusy(threadId, () => onRenameThread(threadId, nextTitle))
      setRenameThreadDialog(null)
    } catch {
      setRenameThreadDialog((current) =>
        current?.thread.id === threadId ? { ...current, submitting: false } : current
      )
    }
  }

  const moveTargetsForThread = (thread: NormalizedThread): string[] => buildSidebarThreadMoveTargets({
    thread,
    groups: projectWorkspaceGroups,
    threadWorktrees
  })

  const threadMoveDisabledReason = (
    thread: NormalizedThread,
    worktreeRecord?: SidebarThreadWorktreeRecord
  ): string => {
    if (!thread.id.trim()) return t('sidebarThreadMoveUnsupported')
    if (deletingThreadIds[thread.id] === true) return t('loading')
    if (worktreeRecord) return t('sidebarThreadMoveWorktreeBlocked')
    if (threadLooksRunning(thread)) return t('sidebarThreadMoveRunningBlocked')
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
    await withThreadBusy(threadId, async () => {
      await provider.updateThreadWorkspace!(threadId, normalizedTarget)
      persistSidebarFolders((current) => removeSidebarThreadAssignments(current, [threadId]))
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
    })
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
      sidebarWorkspacePathForThread(
        thread,
        threadWorktrees,
        projectWorkspaceGroups.map(([workspacePath]) => workspacePath)
      )
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
      setMoveThreadDialog((current) => current ? {
        ...current,
        submitting: false,
        error: error instanceof Error && error.message.trim()
          ? error.message
          : t('sidebarThreadMoveFailed')
      } : current)
    }
  }

  return {
    closeActionDialog,
    closeMoveThreadDialog,
    closeRenameThreadDialog,
    confirmThreadWorkspaceMove,
    handleArchiveThread,
    handleCopyThreadId,
    handleDeleteThread,
    handlePinThread,
    handleRestoreThread,
    handleSummarizeThread,
    moveTargetsForThread,
    moveThreadToWorkspace,
    openActionDialog,
    openMoveThreadDialog,
    openRenameThreadDialog,
    submitActionDialog,
    submitMoveThreadDialog,
    submitRenameThreadDialog,
    threadMoveDisabledReason
  }
}
