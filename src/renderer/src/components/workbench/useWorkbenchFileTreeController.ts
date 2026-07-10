import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { NormalizedThread } from '../../agent/types'
import {
  composerFileReferenceFromPath,
  mergeComposerFileReferences,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import type { ChatFileTreeReference } from '../chat/ChatFileTreePanel'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { CODE_PANEL_PREFERRED } from '../workbench-layout'

export type WorkbenchFileTreeSidePanelView = 'workspace' | 'design'

export type WorkbenchFileTreeControllerOptions = {
  route: string
  threads: NormalizedThread[]
  activeThreadId: string | null
  workspaceRoot: string
  activeSkillWorkspace: string
  rightPanelMode: RightPanelMode | null
  filePreviewTarget: WorkspaceFileTarget | null
  setFilePreviewTarget: (target: WorkspaceFileTarget | null) => void
  setRightPanelMode: (mode: RightPanelMode | null) => void
  setRightSidebarWidth: (updater: (width: number) => number) => void
}

const PINNED_FILE_PREVIEW_TARGETS_KEY = 'kun.filePreview.pinnedTargets'
const PRESERVE_FILE_PREVIEW_TARGETS_KEY = 'kun.filePreview.preserveAcrossThreads'

export function workspaceFileTargetKey(target: WorkspaceFileTarget | null | undefined): string {
  if (!target?.path) return ''
  return `${target.workspaceRoot ?? ''}\n${target.path}`.replaceAll('\\', '/').toLowerCase()
}

export function retainFilePreviewTargets(
  targets: WorkspaceFileTarget[],
  pinnedTargetKeys: ReadonlySet<string>,
  preserveAcrossThreads: boolean
): WorkspaceFileTarget[] {
  if (preserveAcrossThreads) return targets
  return targets.filter((target) => pinnedTargetKeys.has(workspaceFileTargetKey(target)))
}

function readStoredPinnedTargetKeys(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(window.localStorage.getItem(PINNED_FILE_PREVIEW_TARGETS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function readStoredPreserveAcrossThreads(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(PRESERVE_FILE_PREVIEW_TARGETS_KEY) === 'true'
}

function storeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable in private or locked-down renderer sessions.
  }
}

export function useWorkbenchFileTreeController({
  route,
  threads,
  activeThreadId,
  workspaceRoot,
  activeSkillWorkspace,
  rightPanelMode,
  filePreviewTarget,
  setFilePreviewTarget,
  setRightPanelMode,
  setRightSidebarWidth
}: WorkbenchFileTreeControllerOptions) {
  const [composerFileReferences, setComposerFileReferences] = useState<ComposerFileReference[]>([])
  const [fileTreeSidePanelOpen, setFileTreeSidePanelOpen] = useState(false)
  const [fileTreeSidePanelView, setFileTreeSidePanelView] =
    useState<WorkbenchFileTreeSidePanelView>('workspace')
  const [openFilePreviewTargets, setOpenFilePreviewTargets] = useState<WorkspaceFileTarget[]>([])
  const [pinnedFilePreviewTargetKeys, setPinnedFilePreviewTargetKeys] = useState<string[]>(
    readStoredPinnedTargetKeys
  )
  const [preserveFilePreviewTargets, setPreserveFilePreviewTargets] = useState(
    readStoredPreserveAcrossThreads
  )
  const previousActiveThreadIdRef = useRef(activeThreadId)
  const fileTreeWorkspaceRoot = useMemo(
    () => normalizeWorkspaceRoot(threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot),
    [activeThreadId, threads, workspaceRoot]
  )

  function clearComposerFileReferences(): void {
    setComposerFileReferences([])
  }

  function addComposerFileReference(reference: ComposerFileReference): void {
    setComposerFileReferences((current) => mergeComposerFileReferences(current, reference))
  }

  async function pickComposerFileReferences(): Promise<void> {
    const result = await window.kunGui.pickLocalFiles(activeSkillWorkspace || undefined)
    if (result.canceled) return
    for (const path of result.paths) {
      addComposerFileReference(composerFileReferenceFromPath(path, activeSkillWorkspace))
    }
  }

  function removeComposerFileReference(relativePath: string): void {
    const key = relativePath.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase()
    setComposerFileReferences((current) =>
      current.filter((reference) =>
        reference.relativePath.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase() !== key
      )
    )
  }

  function openWorkspaceFilePreviewTarget(target: WorkspaceFileTarget): void {
    const nextTarget = {
      ...target,
      workspaceRoot: target.workspaceRoot ?? fileTreeWorkspaceRoot
    }
    if (!nextTarget.workspaceRoot) return
    setOpenFilePreviewTargets((current) => {
      const key = workspaceFileTargetKey(nextTarget)
      if (current.some((item) => workspaceFileTargetKey(item) === key)) return current
      return [...current, nextTarget]
    })
    setFilePreviewTarget(nextTarget)
    setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    setRightPanelMode('file')
  }

  function previewWorkspaceFileFromSidebar(path: string): void {
    const workspace = fileTreeWorkspaceRoot
    if (!workspace) return
    openWorkspaceFilePreviewTarget({ path, workspaceRoot: workspace })
  }

  function closeWorkspaceFilePreviewTarget(target: WorkspaceFileTarget): void {
    const closingKey = workspaceFileTargetKey(target)
    setPinnedFilePreviewTargetKeys((current) => {
      const next = current.filter((key) => key !== closingKey)
      storeJson(PINNED_FILE_PREVIEW_TARGETS_KEY, next)
      return next
    })
    setOpenFilePreviewTargets((current) => {
      const index = current.findIndex((item) => workspaceFileTargetKey(item) === closingKey)
      if (index < 0) return current
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      if (workspaceFileTargetKey(filePreviewTarget) === closingKey) {
        const fallback = next[Math.max(0, index - 1)] ?? next[0] ?? null
        setFilePreviewTarget(fallback)
        if (!fallback) setRightPanelMode(null)
      }
      return next
    })
  }

  function togglePinnedFilePreviewTarget(target: WorkspaceFileTarget): void {
    const key = workspaceFileTargetKey(target)
    if (!key) return
    setPinnedFilePreviewTargetKeys((current) => {
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
      storeJson(PINNED_FILE_PREVIEW_TARGETS_KEY, next)
      return next
    })
  }

  function closeOtherFilePreviewTargets(target: WorkspaceFileTarget): void {
    const keepKey = workspaceFileTargetKey(target)
    const pinned = new Set(pinnedFilePreviewTargetKeys)
    setOpenFilePreviewTargets((current) => current.filter((item) => {
      const key = workspaceFileTargetKey(item)
      return key === keepKey || pinned.has(key)
    }))
    setFilePreviewTarget(target)
  }

  function togglePreserveFilePreviewTargets(): void {
    setPreserveFilePreviewTargets((current) => {
      const next = !current
      try {
        window.localStorage.setItem(PRESERVE_FILE_PREVIEW_TARGETS_KEY, String(next))
      } catch {
        // Keep the in-memory preference when storage is unavailable.
      }
      return next
    })
  }

  function addWorkspaceReferenceFromSidebar(reference: ChatFileTreeReference): void {
    addComposerFileReference(reference)
  }

  function toggleFileTreeSidePanel(): void {
    setFileTreeSidePanelOpen((open) => !open)
  }

  function openFileTreeSidePanel(): void {
    setFileTreeSidePanelView('workspace')
    setFileTreeSidePanelOpen(true)
  }

  function openDesignFileTreeSidePanel(): void {
    setFileTreeSidePanelView('design')
    setFileTreeSidePanelOpen(true)
  }

  function clearFilePreviewTargets(): void {
    setOpenFilePreviewTargets([])
    setPinnedFilePreviewTargetKeys([])
    storeJson(PINNED_FILE_PREVIEW_TARGETS_KEY, [])
    setFilePreviewTarget(null)
  }

  useEffect(() => {
    if (rightPanelMode !== 'file' || !filePreviewTarget) return
    setOpenFilePreviewTargets((current) => {
      const key = workspaceFileTargetKey(filePreviewTarget)
      if (current.some((item) => workspaceFileTargetKey(item) === key)) return current
      return [...current, filePreviewTarget]
    })
  }, [filePreviewTarget, rightPanelMode])

  useEffect(() => {
    const previousThreadId = previousActiveThreadIdRef.current
    previousActiveThreadIdRef.current = activeThreadId
    if (previousThreadId === null || previousThreadId === activeThreadId || rightPanelMode !== 'file') return

    const pinned = new Set(pinnedFilePreviewTargetKeys)
    const retained = retainFilePreviewTargets(
      openFilePreviewTargets,
      pinned,
      preserveFilePreviewTargets
    )
    const activeKey = workspaceFileTargetKey(filePreviewTarget)
    const nextTarget = retained.find((item) => workspaceFileTargetKey(item) === activeKey)
      ?? retained[0]
      ?? null
    setOpenFilePreviewTargets(retained)
    setFilePreviewTarget(nextTarget)
    if (!nextTarget) setRightPanelMode(null)
  }, [
    activeThreadId,
    filePreviewTarget,
    openFilePreviewTargets,
    pinnedFilePreviewTargetKeys,
    preserveFilePreviewTargets,
    rightPanelMode,
    setFilePreviewTarget,
    setRightPanelMode
  ])

  useEffect(() => {
    if (route !== 'chat') setComposerFileReferences([])
  }, [route])

  return {
    composerFileReferences,
    fileTreeSidePanelOpen,
    fileTreeSidePanelView,
    openFilePreviewTargets,
    pinnedFilePreviewTargetKeys,
    preserveFilePreviewTargets,
    fileTreeWorkspaceRoot,
    clearComposerFileReferences,
    addComposerFileReference,
    pickComposerFileReferences,
    removeComposerFileReference,
    openWorkspaceFilePreviewTarget,
    previewWorkspaceFileFromSidebar,
    closeWorkspaceFilePreviewTarget,
    togglePinnedFilePreviewTarget,
    closeOtherFilePreviewTargets,
    togglePreserveFilePreviewTargets,
    addWorkspaceReferenceFromSidebar,
    toggleFileTreeSidePanel,
    openFileTreeSidePanel,
    openDesignFileTreeSidePanel,
    setFileTreeSidePanelView,
    clearFilePreviewTargets
  }
}
