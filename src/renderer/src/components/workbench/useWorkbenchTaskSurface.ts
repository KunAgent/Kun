import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NormalizedThread } from '../../agent/types'
import type { DesignTaskProfile } from '../../agent/design-task-profile'
import type { ChatState } from '../../store/chat-store-types'
import { useChatStore } from '../../store/chat-store'
import type { DesignTaskComposerProfile } from '../chat/FloatingComposerTaskProfile'
import type { ComposerTaskSurface } from '../chat/FloatingComposerTaskSurfacePicker'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { designContextFromTaskProfile } from '../../design/design-task-profile-input'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import {
  designDocRefForThreadId,
  readDesignThreadRegistry
} from '../../design/design-thread-registry'
import {
  isLegacyDesignWorkbenchThread
} from '../../design/design-task-classification'
import {
  useWorkbenchTaskIntent,
  hasWorkbenchTaskIntent,
  workbenchTaskIntentScope,
  writeWorkbenchTaskIntent,
  type WorkbenchTaskIntentDraft
} from './workbench-task-intent'

type ThreadWithDesignProfile = NormalizedThread & { designProfile?: DesignTaskProfile }

export function workbenchDesignProfileIsLocked(
  thread: Pick<NormalizedThread, 'designProfile'> | null
): boolean {
  return Boolean(thread?.designProfile)
}

export function workbenchTaskSurfaceIsLocked(
  thread: Pick<
    NormalizedThread,
    'agentSurface' | 'designProfile' | 'latestTurnId' | 'lockedTaskSurface'
  > | null
): boolean {
  if (!thread) return false
  // Only legacy standalone surfaces lock the task mode. Code-owned workbench
  // conversations always select Code or Design per turn; the optional Design
  // profile is a document/output lock, not a surface lock, and any stale
  // `lockedTaskSurface` signal on a Code-owned thread is ignored.
  return thread.agentSurface === 'write' || thread.agentSurface === 'design'
}

export function useWorkbenchTaskSurface(input: {
  activeThreadId: string | null
  threads: NormalizedThread[]
  workspaceRoot: string
  activeSkillWorkspace: string
  createThread: ChatState['createThread']
  deleteThread: ChatState['deleteThread']
  setComposerMode: ChatState['setComposerMode']
  setComposerOrchestration: ChatState['setComposerOrchestration']
  composerMode?: ChatState['composerMode']
  composerOrchestration?: ChatState['composerOrchestration']
  imageGenerationEnabled?: boolean
}) {
  const draftWorkspace = normalizeWorkspaceRoot(input.activeSkillWorkspace || input.workspaceRoot)
  const provisionalDesignThreadIdsRef = useRef(new Set<string>())
  const [pendingDesignThreadIntent, setPendingDesignThreadIntent] = useState(false)
  const ensuredDesignTaskIdRef = useRef<string | null>(null)
  const restoreGenerationRef = useRef(0)
  const activeThread = useMemo<ThreadWithDesignProfile | null>(() => (
    input.activeThreadId
      ? (input.threads.find((thread) => thread.id === input.activeThreadId) as ThreadWithDesignProfile | undefined) ?? null
      : null
  ), [input.activeThreadId, input.threads])
  const lockedProfile = activeThread?.designProfile
  const cachedDesignSurface = useCodeCanvasDesignSurface((state) => state.surface)
  const taskSurfaceLocked = workbenchTaskSurfaceIsLocked(activeThread)
  const draftScope = workbenchTaskIntentScope(activeThread?.id ?? null, draftWorkspace)
  const draft = useWorkbenchTaskIntent(draftScope, draftWorkspace)
  const draftNeedsImageFallback =
    !taskSurfaceLocked &&
    !lockedProfile &&
    input.imageGenerationEnabled === false &&
    draft.profile.outputMedium === 'image'
  const effectiveDraft = useMemo<WorkbenchTaskIntentDraft>(() => (
    draftNeedsImageFallback
      ? { ...draft, profile: { ...draft.profile, outputMedium: 'html' } }
      : draft
  ), [draft, draftNeedsImageFallback])
  const hasPersistedDraft = hasWorkbenchTaskIntent(draftScope)
  const designRegistry = readDesignThreadRegistry()
  const legacyDesignThread = Boolean(activeThread &&
    isLegacyDesignWorkbenchThread(activeThread.id, activeThread, designRegistry))
  // Next-turn surface: legacy standalone Design stays Design; Code-owned
  // conversations follow the per-thread draft, fall back to Design when a
  // locked profile exists, and default to Code otherwise. The selector stays
  // available because taskSurfaceLocked is false for Code-owned threads.
  const taskSurface: ComposerTaskSurface = legacyDesignThread
    ? 'design'
    : hasPersistedDraft
      ? effectiveDraft.surface
      : pendingDesignThreadIntent
        ? 'design'
        : lockedProfile
          ? 'design'
          : 'code'
  const profile: DesignTaskComposerProfile = lockedProfile
      ? {
        outputMedium: lockedProfile.outputMedium,
        target: lockedProfile.target,
        preset: lockedProfile.preset,
        ...(lockedProfile.presetSource ? { presetSource: lockedProfile.presetSource } : {}),
        ...(lockedProfile.styleSnapshot
          ? {
              styleSourceName: lockedProfile.styleSnapshot.sourceName,
              styleSourceHash: lockedProfile.styleSnapshot.sourceHash
            }
          : {})
      }
    : effectiveDraft.profile
  const designProfileLocked = workbenchDesignProfileIsLocked(activeThread)
  const lockedProfileRef = useRef(lockedProfile)
  lockedProfileRef.current = lockedProfile
  const legacyDesignRef = activeThread
    ? designDocRefForThreadId(activeThread.id, designRegistry)
    : null
  const restoreDesignDocumentId = legacyDesignRef?.docId ??
    lockedProfile?.documentTarget.documentId ?? ''
  const restoreDesignTaskId = restoreDesignDocumentId ? activeThread?.id ?? '' : ''
  const restoreDesignWorkspace = normalizeWorkspaceRoot(
    legacyDesignRef?.workspaceRoot || activeThread?.workspace || input.workspaceRoot
  )
  // The whiteboard mounts the Design document whenever the thread has a locked
  // document target (or a legacy registry binding). This is deliberately
  // independent of the next-turn surface so Code turns keep the Design
  // whiteboard visible and referenceable.
  const activeThreadWorkspace = normalizeWorkspaceRoot(
    activeThread?.workspace || input.workspaceRoot
  )
  const hasProvisionalDesignDocument = Boolean(
    input.activeThreadId &&
    cachedDesignSurface?.threadId === input.activeThreadId &&
    (cachedDesignSurface.surfaceKind ?? 'kun-design') === 'kun-design' &&
    normalizeWorkspaceRoot(cachedDesignSurface.workspaceRoot) === activeThreadWorkspace
  )
  const threadHasDesignDocument = Boolean(
    restoreDesignDocumentId || hasProvisionalDesignDocument ||
    (pendingDesignThreadIntent && input.activeThreadId)
  )
  const unresolvedLegacyDesignTaskId = legacyDesignThread && !legacyDesignRef
    ? activeThread?.id ?? ''
    : ''

  useEffect(() => {
    if (taskSurface === 'code') useDesignWorkspaceStore.getState().cancelDrawingCreation()
  }, [taskSurface])

  useEffect(() => {
    // The Design document binding is independent of the next-turn surface:
    // once a thread owns a Design document, it stays mounted (and
    // referenceable) even while the composer sends a Code turn.
    if (!threadHasDesignDocument || !restoreDesignTaskId || !restoreDesignDocumentId) return
    const surface = useCodeCanvasDesignSurface.getState().surface
    const boardArtifactId = lockedProfile?.documentTarget.boardArtifactId
    if (
      surface?.threadId === restoreDesignTaskId &&
      surface.documentId === restoreDesignDocumentId &&
      (surface.boardArtifactId ?? undefined) === (boardArtifactId || undefined) &&
      surface.readOnly !== true
    ) return
    useCodeCanvasDesignSurface.getState().showDesignDocument(
      restoreDesignTaskId,
      restoreDesignWorkspace,
      restoreDesignDocumentId,
      { boardArtifactId }
    )
  }, [restoreDesignDocumentId, restoreDesignTaskId, restoreDesignWorkspace, threadHasDesignDocument, lockedProfile])

  useEffect(() => {
    if (!unresolvedLegacyDesignTaskId || !restoreDesignWorkspace) return
    let cancelled = false
    const restoreLegacyDefaultDocument = async (): Promise<void> => {
      const store = useDesignWorkspaceStore.getState()
      if (normalizeWorkspaceRoot(store.workspaceRoot) !== restoreDesignWorkspace) {
        store.setWorkspaceRoot(restoreDesignWorkspace)
      }
      await useDesignWorkspaceStore.getState().rehydrateArtifacts().catch(() => undefined)
      if (cancelled) return
      const restored = useDesignWorkspaceStore.getState()
      const registryRef = designDocRefForThreadId(
        unresolvedLegacyDesignTaskId,
        readDesignThreadRegistry()
      )
      const documentId = registryRef?.docId ?? restored.activeDocumentId
      if (!documentId) return
      useCodeCanvasDesignSurface.getState().showDesignDocument(
        unresolvedLegacyDesignTaskId,
        registryRef?.workspaceRoot ?? restoreDesignWorkspace,
        documentId
      )
      if (restored.documents.some((document) => document.id === documentId)) {
        restored.switchActiveDocument(documentId)
      }
      requestCodeCanvasPanelOpen()
    }
    void restoreLegacyDefaultDocument()
    return () => { cancelled = true }
  }, [restoreDesignWorkspace, unresolvedLegacyDesignTaskId])

  useEffect(() => {
    const generation = ++restoreGenerationRef.current
    const targetIsCurrent = (): boolean => generation === restoreGenerationRef.current
    const profileToRestore = lockedProfileRef.current
    if (!restoreDesignTaskId || !restoreDesignDocumentId) {
      ensuredDesignTaskIdRef.current = null
      return
    }
    provisionalDesignThreadIdsRef.current.delete(restoreDesignTaskId)
    if (ensuredDesignTaskIdRef.current === restoreDesignTaskId) return
    ensuredDesignTaskIdRef.current = restoreDesignTaskId
    const workspace = restoreDesignWorkspace
    if (!workspace) return
    useCodeCanvasDesignSurface.getState().showDesignDocument(
      restoreDesignTaskId,
      workspace,
      restoreDesignDocumentId,
      { boardArtifactId: profileToRestore?.documentTarget.boardArtifactId }
    )
    const store = useDesignWorkspaceStore.getState()
    const restoreDesignExecutionContext = (): void => {
      if (!targetIsCurrent()) return
      const restored = useDesignWorkspaceStore.getState()
      if (profileToRestore) {
        restored.updateDesignContext(designContextFromTaskProfile(profileToRestore))
      }
      if (restored.documents.some(
        (document) => document.id === restoreDesignDocumentId
      )) {
        restored.switchActiveDocument(restoreDesignDocumentId)
      }
    }
    restoreDesignExecutionContext()
    if (normalizeWorkspaceRoot(store.workspaceRoot) !== workspace) {
      store.setWorkspaceRoot(workspace)
      restoreDesignExecutionContext()
      void useDesignWorkspaceStore.getState().loadDesignSettings().then(
        () => { if (targetIsCurrent()) restoreDesignExecutionContext() }
      )
    } else if (store.documents.some((document) => document.id === restoreDesignDocumentId)) {
      restoreDesignExecutionContext()
    } else {
      void store.rehydrateArtifacts().then(() => {
        if (targetIsCurrent()) restoreDesignExecutionContext()
      })
    }
    requestCodeCanvasPanelOpen()
  }, [
    restoreDesignDocumentId,
    restoreDesignTaskId,
    restoreDesignWorkspace
  ])

  const updateDraft = useCallback((next: WorkbenchTaskIntentDraft): void => {
    writeWorkbenchTaskIntent(draftScope, next)
  }, [draftScope])

  useEffect(() => {
    if (draftNeedsImageFallback) updateDraft(effectiveDraft)
  }, [draftNeedsImageFallback, effectiveDraft, updateDraft])

  const onSurfaceChange = useCallback((surface: ComposerTaskSurface): void => {
    if (taskSurfaceLocked || surface === taskSurface) return
    const next = surface === 'design'
      ? {
          ...effectiveDraft,
          surface,
          codeExecution: effectiveDraft.codeExecution ?? {
            mode: input.composerMode ?? 'agent',
            orchestration: input.composerOrchestration ?? 'direct'
          }
        }
      : { ...effectiveDraft, surface }
    updateDraft(next)
    if (surface === 'design') {
      input.setComposerMode('agent')
      input.setComposerOrchestration('direct')
      const workspace = normalizeWorkspaceRoot(draftWorkspace)
      if (!workspace) return
      const store = useDesignWorkspaceStore.getState()
      if (normalizeWorkspaceRoot(store.workspaceRoot) !== workspace) store.setWorkspaceRoot(workspace)
      void useDesignWorkspaceStore.getState().loadDesignSettings().then(() => {
        useDesignWorkspaceStore.getState().updateDesignContext({
          designTarget: next.profile.target,
          designSystemPreset: next.profile.preset
        })
      })
    } else {
      const codeExecution = next.codeExecution
      if (codeExecution?.mode && codeExecution.orchestration) {
        input.setComposerMode(codeExecution.mode)
        input.setComposerOrchestration(codeExecution.orchestration)
      }
      useDesignWorkspaceStore.getState().cancelDrawingCreation()
    }
  }, [draftWorkspace, effectiveDraft, input, taskSurface, taskSurfaceLocked, updateDraft])

  const onProfileChange = useCallback((patch: Partial<DesignTaskComposerProfile>): void => {
    if (taskSurfaceLocked) return
    const nextProfile = { ...effectiveDraft.profile, ...patch }
    updateDraft({ ...effectiveDraft, profile: nextProfile })
    useDesignWorkspaceStore.getState().updateDesignContext({
      designTarget: nextProfile.target,
      designSystemPreset: nextProfile.preset
    })
  }, [effectiveDraft, taskSurfaceLocked, updateDraft])

  const ensureDesignThread = useCallback(async (
    workspaceRoot: string,
    documentId: string
  ): Promise<string | null> => {
    const stateThreadId = input.activeThreadId
    const stateThread = stateThreadId
      ? input.threads.find((thread) => thread.id === stateThreadId)
      : null
    const stateThreadIsLegacyDesign = Boolean(stateThread &&
      isLegacyDesignWorkbenchThread(stateThread.id, stateThread, readDesignThreadRegistry()))
    let threadId =
      stateThread && !stateThreadIsLegacyDesign && stateThread.agentSurface !== 'write' &&
      normalizeWorkspaceRoot(stateThread.workspace) === normalizeWorkspaceRoot(workspaceRoot)
        ? stateThread.id
        : null
    if (!threadId) {
      // createThread activates the new Code-owned conversation before it
      // returns. Preserve the Design fallback during that gap so the task-mode
      // effect cannot cancel the provisional drawing before its per-thread
      // draft is persisted.
      setPendingDesignThreadIntent(true)
      try {
        threadId = await input.createThread({
          workspaceRoot,
          forceNew: true,
          agentSurface: 'code'
        })
        if (threadId) {
          provisionalDesignThreadIdsRef.current.add(threadId)
          writeWorkbenchTaskIntent(workbenchTaskIntentScope(threadId, workspaceRoot), {
            surface: 'design',
            profile: effectiveDraft.profile
          })
        }
      } finally {
        setPendingDesignThreadIntent(false)
      }
    }
    if (!threadId) return null
    const shouldOpenPanel = ensuredDesignTaskIdRef.current !== threadId
    ensuredDesignTaskIdRef.current = threadId
    useCodeCanvasDesignSurface.getState().showDesignDocument(
      threadId,
      workspaceRoot,
      documentId,
      // A locked task pins its board so the panel resolves the exact
      // whiteboard instead of the most recently updated one.
      { boardArtifactId: lockedProfile?.documentTarget.boardArtifactId }
    )
    if (shouldOpenPanel) requestCodeCanvasPanelOpen()
    return threadId
  }, [effectiveDraft.profile, input, lockedProfile])

  const rollbackProvisionalThread = useCallback(async (threadId: string): Promise<boolean> => {
    if (!provisionalDesignThreadIdsRef.current.has(threadId)) return true
    const thread = useChatStore.getState().threads.find((candidate) => candidate.id === threadId) ??
      input.threads.find((candidate) => candidate.id === threadId)
    if (thread?.latestTurnId || thread?.designProfile) {
      provisionalDesignThreadIdsRef.current.delete(threadId)
      return false
    }
    try {
      await input.deleteThread(threadId)
      provisionalDesignThreadIdsRef.current.delete(threadId)
      return true
    } catch {
      return false
    }
  }, [input])

  return {
    taskSurface,
    taskSurfaceTransitioning: legacyDesignThread,
    taskSurfaceLocked,
    designProfileLocked,
    threadHasDesignDocument,
    designTaskProfile: profile,
    lockedDesignProfile: lockedProfile,
    onTaskSurfaceChange: onSurfaceChange,
    onDesignTaskProfileChange: onProfileChange,
    ensureDesignThread,
    rollbackProvisionalThread
  }
}
