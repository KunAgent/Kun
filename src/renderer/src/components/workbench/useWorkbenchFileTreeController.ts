import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import type { NormalizedThread } from '../../agent/types'
import {
  composerFileReferenceFromPath,
  composerFileReferenceKey,
  mergeComposerFileReferences,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { workspaceFileTargetKey } from '../../lib/workspace-file-target-key'
import {
  readBrowserStorageItem,
  removeBrowserStorageItem,
  writeBrowserStorageItem
} from '../../lib/browser-storage'
import {
  LIVE_OFFICE_PREVIEW_EVENT,
  normalizeLiveOfficePreviewPath,
  type LiveOfficePreviewDetail
} from '../../lib/live-office-preview'
import type { ChatFileTreeReference } from '../chat/ChatFileTreePanel'
import type {
  GeneratedDocumentArtifact,
  GeneratedDocumentCollection
} from '../chat/generated-document-artifacts'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'

export type WorkbenchFileTreeSidePanelView = 'workspace' | 'design' | 'generated'

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
  closeRightPanelTab?: (mode: Exclude<RightPanelMode, null>) => void
}

export const PINNED_FILE_PREVIEW_TARGETS_KEY = 'kun.filePreview.pinnedTargets'
export const PRESERVE_FILE_PREVIEW_TARGETS_KEY = 'kun.filePreview.preserveAcrossThreads'
export const LEGACY_PINNED_FILE_PREVIEW_TARGETS_KEY = 'kun.issue781.pinnedPreviewTabs'
const MAX_PINNED_FILE_PREVIEW_TARGETS = 200

type OfficePreviewTurnState = {
  focused: boolean
  suppressed: boolean
}

export { workspaceFileTargetKey } from '../../lib/workspace-file-target-key'

export function retainFilePreviewTargets(
  targets: WorkspaceFileTarget[],
  pinnedTargetKeys: ReadonlySet<string>,
  preserveAcrossThreads: boolean
): WorkspaceFileTarget[] {
  if (preserveAcrossThreads) return targets
  return targets.filter((target) => pinnedTargetKeys.has(workspaceFileTargetKey(target)))
}

export function closeOtherFilePreviewTargets(
  targets: WorkspaceFileTarget[],
  targetToKeep: WorkspaceFileTarget,
  pinnedTargetKeys: ReadonlySet<string>
): WorkspaceFileTarget[] {
  const keepKey = workspaceFileTargetKey(targetToKeep)
  return targets.filter((target) => {
    const key = workspaceFileTargetKey(target)
    return key === keepKey || pinnedTargetKeys.has(key)
  })
}

export function closeFilePreviewTarget(
  targets: WorkspaceFileTarget[],
  pinnedTargetKeys: string[],
  targetToClose: WorkspaceFileTarget,
  activeTarget: WorkspaceFileTarget | null
): {
  targets: WorkspaceFileTarget[]
  pinnedTargetKeys: string[]
  activeTarget: WorkspaceFileTarget | null
} {
  const closingKey = workspaceFileTargetKey(targetToClose)
  const index = targets.findIndex((item) => workspaceFileTargetKey(item) === closingKey)
  const nextPinnedTargetKeys = pinnedTargetKeys.filter((key) => key !== closingKey)
  if (index < 0) {
    return { targets, pinnedTargetKeys: nextPinnedTargetKeys, activeTarget }
  }
  const nextTargets = targets.filter((_, itemIndex) => itemIndex !== index)
  if (workspaceFileTargetKey(activeTarget) !== closingKey) {
    return { targets: nextTargets, pinnedTargetKeys: nextPinnedTargetKeys, activeTarget }
  }
  return {
    targets: nextTargets,
    pinnedTargetKeys: nextPinnedTargetKeys,
    activeTarget: nextTargets[Math.max(0, index - 1)] ?? nextTargets[0] ?? null
  }
}

export function parsePinnedFilePreviewTargetKeys(raw: string | null, platform = ''): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const keys = value.flatMap((item): string[] => {
      if (typeof item !== 'string') return []
      const parts = item.replaceAll('\\', '/').split('\n')
      if (parts.length !== 2 || !parts[1]) return []
      return [workspaceFileTargetKey({ workspaceRoot: parts[0], path: parts[1] }, platform)]
    })
    return Array.from(new Set(keys)).slice(-MAX_PINNED_FILE_PREVIEW_TARGETS)
  } catch {
    return []
  }
}

export function migrateLegacyPinnedFilePreviewTargetKeys(raw: string | null, platform = ''): string[] {
  if (platform !== 'win32' || !raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    const keys = value.flatMap((item): string[] => {
      if (typeof item !== 'string') return []
      const parts = item.replaceAll('\\', '/').split('\n')
      if (parts.length !== 3 || !parts[2]) return []
      return [workspaceFileTargetKey({ workspaceRoot: parts[1], path: parts[2] }, platform)]
    })
    return Array.from(new Set(keys)).slice(-MAX_PINNED_FILE_PREVIEW_TARGETS)
  } catch {
    return []
  }
}

function readStoredPinnedTargetKeys(): string[] {
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''
  const stored = readBrowserStorageItem(PINNED_FILE_PREVIEW_TARGETS_KEY)
  if (stored !== null) return parsePinnedFilePreviewTargetKeys(stored, platform)

  const legacy = readBrowserStorageItem(LEGACY_PINNED_FILE_PREVIEW_TARGETS_KEY)
  const migrated = migrateLegacyPinnedFilePreviewTargetKeys(legacy, platform)
  if (platform === 'win32') removeBrowserStorageItem(LEGACY_PINNED_FILE_PREVIEW_TARGETS_KEY)
  if (migrated.length > 0) {
    writeBrowserStorageItem(PINNED_FILE_PREVIEW_TARGETS_KEY, JSON.stringify(migrated))
  }
  return migrated
}

function readStoredPreserveAcrossThreads(): boolean {
  return readBrowserStorageItem(PRESERVE_FILE_PREVIEW_TARGETS_KEY) === 'true'
}

function storePinnedTargetKeys(keys: string[]): void {
  writeBrowserStorageItem(
    PINNED_FILE_PREVIEW_TARGETS_KEY,
    JSON.stringify(keys.slice(-MAX_PINNED_FILE_PREVIEW_TARGETS))
  )
}

function storePreserveAcrossThreads(value: boolean): void {
  writeBrowserStorageItem(PRESERVE_FILE_PREVIEW_TARGETS_KEY, String(value))
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
  closeRightPanelTab
}: WorkbenchFileTreeControllerOptions) {
  const [composerFileReferences, setComposerFileReferences] = useState<ComposerFileReference[]>([])
  const [fileTreeSidePanelOpen, setFileTreeSidePanelOpen] = useState(false)
  const [fileTreeSidePanelView, setFileTreeSidePanelView] =
    useState<WorkbenchFileTreeSidePanelView>('workspace')
  const [generatedDocumentCollection, setGeneratedDocumentCollection] =
    useState<GeneratedDocumentCollection | null>(null)
  const [openFilePreviewTargets, setOpenFilePreviewTargets] = useState<WorkspaceFileTarget[]>([])
  const [pinnedFilePreviewTargetKeys, setPinnedFilePreviewTargetKeys] = useState<string[]>(
    readStoredPinnedTargetKeys
  )
  const [preserveFilePreviewTargets, setPreserveFilePreviewTargets] = useState(
    readStoredPreserveAcrossThreads
  )
  const openFilePreviewTargetsRef = useRef(openFilePreviewTargets)
  const pinnedFilePreviewTargetKeysRef = useRef(pinnedFilePreviewTargetKeys)
  const preserveFilePreviewTargetsRef = useRef(preserveFilePreviewTargets)
  const filePreviewTargetRef = useRef(filePreviewTarget)
  const previousActiveThreadIdRef = useRef(activeThreadId)
  const previousRightPanelModeRef = useRef(rightPanelMode)
  const officePreviewTurnsRef = useRef(new Map<string, OfficePreviewTurnState>())
  const latestOfficePreviewTurnRef = useRef('')
  filePreviewTargetRef.current = filePreviewTarget
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

  function restoreComposerFileReferences(references: readonly ComposerFileReference[]): void {
    if (references.length === 0) return
    setComposerFileReferences((current) => {
      const byKey = new Map(current.map((reference) => [composerFileReferenceKey(reference), reference]))
      for (const reference of references) byKey.set(composerFileReferenceKey(reference), reference)
      return [...byKey.values()]
    })
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

  function updateOpenFilePreviewTargets(next: WorkspaceFileTarget[]): void {
    openFilePreviewTargetsRef.current = next
    setOpenFilePreviewTargets(next)
  }

  function updatePinnedFilePreviewTargetKeys(next: string[]): void {
    const normalized = Array.from(new Set(next.filter(Boolean))).slice(-MAX_PINNED_FILE_PREVIEW_TARGETS)
    pinnedFilePreviewTargetKeysRef.current = normalized
    setPinnedFilePreviewTargetKeys(normalized)
    storePinnedTargetKeys(normalized)
  }

  const selectFilePreviewTarget = useCallback((target: WorkspaceFileTarget | null): void => {
    filePreviewTargetRef.current = target
    setFilePreviewTarget(target)
  }, [setFilePreviewTarget])

  function suppressCurrentOfficePreviewFocus(): void {
    const turnId = latestOfficePreviewTurnRef.current
    if (!turnId) return
    const current = officePreviewTurnsRef.current.get(turnId) ?? { focused: false, suppressed: false }
    officePreviewTurnsRef.current.set(turnId, { ...current, suppressed: true })
  }

  const upsertWorkspaceFilePreviewTarget = useCallback((
    target: WorkspaceFileTarget,
    options: { activate: boolean }
  ): void => {
    const nextTarget = {
      ...target,
      workspaceRoot: target.workspaceRoot ?? fileTreeWorkspaceRoot
    }
    if (!nextTarget.workspaceRoot) return
    const key = workspaceFileTargetKey(nextTarget)
    const current = openFilePreviewTargetsRef.current
    const existingIndex = current.findIndex((item) => workspaceFileTargetKey(item) === key)
    const next = existingIndex >= 0
      ? current.map((item, index) => index === existingIndex ? nextTarget : item)
      : [...current, nextTarget]
    openFilePreviewTargetsRef.current = next
    setOpenFilePreviewTargets(next)
    if (!options.activate) return
    selectFilePreviewTarget(nextTarget)
    setRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.file)
  }, [fileTreeWorkspaceRoot, selectFilePreviewTarget, setRightPanelMode])

  function openWorkspaceFilePreviewTarget(target: WorkspaceFileTarget): void {
    suppressCurrentOfficePreviewFocus()
    upsertWorkspaceFilePreviewTarget(target, { activate: true })
  }

  function openGeneratedDocumentPreview(
    file: GeneratedDocumentArtifact,
    owningWorkspaceRoot: string
  ): void {
    const root = normalizeWorkspaceRoot(owningWorkspaceRoot)
    if (!root || root !== fileTreeWorkspaceRoot) return
    openWorkspaceFilePreviewTarget({ path: file.path, workspaceRoot: root })
  }

  function openGeneratedDocuments(collection: GeneratedDocumentCollection): void {
    const root = normalizeWorkspaceRoot(collection.workspaceRoot)
    if (
      !activeThreadId ||
      collection.threadId !== activeThreadId ||
      !collection.turnId.trim() ||
      !root ||
      root !== fileTreeWorkspaceRoot ||
      collection.files.length === 0
    ) return
    setGeneratedDocumentCollection({
      ...collection,
      workspaceRoot: root,
      files: collection.files.slice()
    })
    setFileTreeSidePanelView('generated')
    setFileTreeSidePanelOpen(true)
    setRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.files)
  }

  function previewWorkspaceFileFromSidebar(path: string): void {
    const workspace = fileTreeWorkspaceRoot
    if (!workspace) return
    openWorkspaceFilePreviewTarget({ path, workspaceRoot: workspace })
  }

  function closeWorkspaceFilePreviewTarget(target: WorkspaceFileTarget): void {
    suppressCurrentOfficePreviewFocus()
    const next = closeFilePreviewTarget(
      openFilePreviewTargetsRef.current,
      pinnedFilePreviewTargetKeysRef.current,
      target,
      filePreviewTargetRef.current
    )
    updatePinnedFilePreviewTargetKeys(next.pinnedTargetKeys)
    updateOpenFilePreviewTargets(next.targets)
    if (next.activeTarget === filePreviewTargetRef.current) return
    selectFilePreviewTarget(next.activeTarget)
    if (!next.activeTarget) {
      if (closeRightPanelTab) closeRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.file)
      else setRightPanelMode(null)
    }
  }

  function togglePinnedFilePreviewTarget(target: WorkspaceFileTarget): void {
    const key = workspaceFileTargetKey(target)
    if (!key) return
    const current = pinnedFilePreviewTargetKeysRef.current
    updatePinnedFilePreviewTargetKeys(
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    )
  }

  function closeOtherWorkspaceFilePreviewTargets(target: WorkspaceFileTarget): void {
    suppressCurrentOfficePreviewFocus()
    const next = closeOtherFilePreviewTargets(
      openFilePreviewTargetsRef.current,
      target,
      new Set(pinnedFilePreviewTargetKeysRef.current)
    )
    updateOpenFilePreviewTargets(next)
    selectFilePreviewTarget(target)
  }

  function togglePreserveFilePreviewTargets(): void {
    const nextPreserve = !preserveFilePreviewTargetsRef.current
    preserveFilePreviewTargetsRef.current = nextPreserve
    setPreserveFilePreviewTargets(nextPreserve)
    storePreserveAcrossThreads(nextPreserve)
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
    suppressCurrentOfficePreviewFocus()
    updateOpenFilePreviewTargets([])
    updatePinnedFilePreviewTargetKeys([])
    selectFilePreviewTarget(null)
  }

  useEffect(() => {
    if (rightPanelMode !== BUILTIN_RIGHT_PANEL_IDS.file || !filePreviewTarget) return
    const current = openFilePreviewTargetsRef.current
    const key = workspaceFileTargetKey(filePreviewTarget)
    const existingIndex = current.findIndex((item) => workspaceFileTargetKey(item) === key)
    if (existingIndex < 0) {
      updateOpenFilePreviewTargets([...current, filePreviewTarget])
    } else if (current[existingIndex] !== filePreviewTarget) {
      updateOpenFilePreviewTargets(
        current.map((item, index) => index === existingIndex ? filePreviewTarget : item)
      )
    }
  }, [filePreviewTarget, rightPanelMode])

  useEffect(() => {
    const previous = previousRightPanelModeRef.current
    previousRightPanelModeRef.current = rightPanelMode
    if (previous === BUILTIN_RIGHT_PANEL_IDS.file && rightPanelMode !== BUILTIN_RIGHT_PANEL_IDS.file) {
      suppressCurrentOfficePreviewFocus()
    }
  }, [rightPanelMode])

  useEffect(() => {
    const onLiveOfficePreview = (rawEvent: Event): void => {
      if (route !== 'chat') return
      const detail = (rawEvent as CustomEvent<LiveOfficePreviewDetail>).detail
      if (!detail?.path || !detail.workspaceRoot) return
      if (normalizeWorkspaceRoot(detail.workspaceRoot) !== fileTreeWorkspaceRoot) return
      const path = normalizeLiveOfficePreviewPath(detail.path, detail.workspaceRoot)
      if (!path) return
      const turnId = detail.turnId || `office-preview:${detail.path}`
      const state = officePreviewTurnsRef.current.get(turnId) ?? { focused: false, suppressed: false }
      const activate = !state.focused && !state.suppressed
      officePreviewTurnsRef.current.set(turnId, { ...state, focused: state.focused || activate })
      latestOfficePreviewTurnRef.current = turnId
      upsertWorkspaceFilePreviewTarget({
        path,
        workspaceRoot: detail.workspaceRoot
      }, { activate })
    }
    window.addEventListener(LIVE_OFFICE_PREVIEW_EVENT, onLiveOfficePreview)
    return () => window.removeEventListener(LIVE_OFFICE_PREVIEW_EVENT, onLiveOfficePreview)
  }, [fileTreeWorkspaceRoot, route, upsertWorkspaceFilePreviewTarget])

  useEffect(() => {
    const previousThreadId = previousActiveThreadIdRef.current
    previousActiveThreadIdRef.current = activeThreadId
    if (previousThreadId === activeThreadId) return
    setGeneratedDocumentCollection(null)
    setFileTreeSidePanelView((view) => view === 'generated' ? 'workspace' : view)
    officePreviewTurnsRef.current.clear()
    latestOfficePreviewTurnRef.current = ''

    const retained = retainFilePreviewTargets(
      openFilePreviewTargetsRef.current,
      new Set(pinnedFilePreviewTargetKeysRef.current),
      preserveFilePreviewTargetsRef.current
    )
    updateOpenFilePreviewTargets(retained)
    const activeKey = workspaceFileTargetKey(filePreviewTargetRef.current)
    const nextTarget = retained.find((item) => workspaceFileTargetKey(item) === activeKey)
      ?? retained[0]
      ?? null
    selectFilePreviewTarget(nextTarget)
    if (!nextTarget && rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.file) {
      if (closeRightPanelTab) closeRightPanelTab(BUILTIN_RIGHT_PANEL_IDS.file)
      else setRightPanelMode(null)
    }
  }, [activeThreadId, closeRightPanelTab, rightPanelMode, selectFilePreviewTarget, setRightPanelMode])

  useEffect(() => {
    if (route === 'chat') return
    setComposerFileReferences([])
    setGeneratedDocumentCollection(null)
    setFileTreeSidePanelView((view) => view === 'generated' ? 'workspace' : view)
  }, [route])

  useEffect(() => {
    setGeneratedDocumentCollection((current) => {
      if (!current || normalizeWorkspaceRoot(current.workspaceRoot) === fileTreeWorkspaceRoot) {
        return current
      }
      return null
    })
    setFileTreeSidePanelView((view) => view === 'generated' ? 'workspace' : view)
  }, [fileTreeWorkspaceRoot])

  return {
    composerFileReferences,
    fileTreeSidePanelOpen,
    fileTreeSidePanelView,
    generatedDocumentCollection,
    openFilePreviewTargets,
    pinnedFilePreviewTargetKeys,
    preserveFilePreviewTargets,
    fileTreeWorkspaceRoot,
    clearComposerFileReferences,
    addComposerFileReference,
    restoreComposerFileReferences,
    pickComposerFileReferences,
    removeComposerFileReference,
    openWorkspaceFilePreviewTarget,
    openGeneratedDocumentPreview,
    openGeneratedDocuments,
    previewWorkspaceFileFromSidebar,
    closeWorkspaceFilePreviewTarget,
    togglePinnedFilePreviewTarget,
    closeOtherFilePreviewTargets: closeOtherWorkspaceFilePreviewTargets,
    togglePreserveFilePreviewTargets,
    addWorkspaceReferenceFromSidebar,
    toggleFileTreeSidePanel,
    openFileTreeSidePanel,
    openDesignFileTreeSidePanel,
    setFileTreeSidePanelView,
    clearFilePreviewTargets
  }
}
