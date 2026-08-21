import type { DesignTaskProfile } from '../agent/design-task-profile'
import { cloneDesignTaskProfile } from '../agent/design-task-profile'
import type { NormalizedThread } from '../agent/types'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { designContextFromTaskProfile } from './design-task-profile-input'
import { useCodeCanvasDesignSurface } from './code-canvas-design-surface'
import { canvasDocumentKey } from './canvas/canvas-persistence'
import { useCanvasShapeStore } from './canvas/canvas-shape-store'
import { requestCodeCanvasPanelOpen } from '../lib/code-canvas-panel-event'

const inflightProfileByThread = new Map<string, Promise<DesignTaskProfile | null>>()

export function mergeThreadDesignProfile(
  threads: readonly NormalizedThread[],
  threadId: string,
  profile: DesignTaskProfile
): NormalizedThread[] {
  const nextProfile = cloneDesignTaskProfile(profile)
  let changed = false
  const next = threads.map((thread) => {
    if (thread.id !== threadId) return thread
    changed = true
    return { ...thread, designProfile: nextProfile }
  })
  return changed ? next : [...threads]
}

export function preserveListedDesignProfiles<T extends { id: string; designProfile?: DesignTaskProfile }>(
  listed: readonly T[],
  localById: ReadonlyMap<string, { designProfile?: DesignTaskProfile }>
): T[] {
  return listed.map((thread) => {
    if (thread.designProfile) return thread
    const localProfile = localById.get(thread.id)?.designProfile
    return localProfile ? { ...thread, designProfile: cloneDesignTaskProfile(localProfile) } : thread
  })
}

export async function restoreLockedDesignDocument(profile: DesignTaskProfile): Promise<boolean> {
  const documentId = profile.documentTarget.documentId
  const boardArtifactId = profile.documentTarget.boardArtifactId
  const documentReady = (): boolean => {
    const state = useDesignWorkspaceStore.getState()
    const document = state.documents.find((candidate) => candidate.id === documentId)
    return Boolean(document?.artifacts.some(
      (artifact) => artifact.id === boardArtifactId && artifact.kind === 'canvas'
    ))
  }
  if (!documentReady()) {
    await useDesignWorkspaceStore.getState().rehydrateArtifacts().catch(() => undefined)
  }
  if (!documentReady()) return false
  const state = useDesignWorkspaceStore.getState()
  state.updateDesignContext(designContextFromTaskProfile(profile))
  if (state.activeDocumentId !== documentId) state.switchActiveDocument(documentId)
  return useDesignWorkspaceStore.getState().activeDocumentId === documentId && documentReady()
}

export async function activateLockedDesignDocument(
  profile: DesignTaskProfile | null,
  onError: (message: string) => void,
  options?: { threadId?: string | null; canvasReadyTimeoutMs?: number }
): Promise<boolean> {
  if (!profile) return true
  const restored = await restoreLockedDesignDocument(profile)
  if (!restored) {
    const message = 'The whiteboard bound to this Design task is unavailable.'
    useDesignWorkspaceStore.getState().setFileError(message)
    onError(message)
    return false
  }
  const threadId = options?.threadId?.trim()
  if (threadId) {
    const state = useDesignWorkspaceStore.getState()
    const workspaceRoot = state.workspaceRoot
    const { documentId, boardArtifactId } = profile.documentTarget
    useCodeCanvasDesignSurface.getState().showDesignDocument(
      threadId,
      workspaceRoot,
      documentId,
      { boardArtifactId }
    )
    requestCodeCanvasPanelOpen({ threadId })
    const expectedKey = canvasDocumentKey(
      workspaceRoot,
      boardArtifactId,
      `.kun-design/${documentId}`
    )
    const ready = await waitForCanvasDocumentKey(
      expectedKey,
      options?.canvasReadyTimeoutMs
    )
    if (!ready) {
      const message = 'The whiteboard bound to this Design task did not become ready.'
      useDesignWorkspaceStore.getState().setFileError(message)
      onError(message)
      return false
    }
  }
  return true
}

export function waitForCanvasDocumentKey(
  expectedKey: string,
  timeoutMs = 5_000,
  deps?: {
    getDocumentKey?: () => string | null
    subscribe?: (listener: () => void) => () => void
    setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  }
): Promise<boolean> {
  const getDocumentKey = deps?.getDocumentKey ?? (() => useCanvasShapeStore.getState().documentKey)
  if (getDocumentKey() === expectedKey) return Promise.resolve(true)
  const subscribe = deps?.subscribe ?? ((listener: () => void) => useCanvasShapeStore.subscribe(listener))
  const setTimer = deps?.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = deps?.clearTimer ?? ((timer) => clearTimeout(timer))
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe = (): void => undefined
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (ready: boolean): void => {
      if (settled) return
      settled = true
      unsubscribe()
      if (timer) clearTimer(timer)
      resolve(ready)
    }
    unsubscribe = subscribe(() => {
      if (getDocumentKey() === expectedKey) finish(true)
    })
    timer = setTimer(() => finish(false), Math.max(0, timeoutMs))
    if (getDocumentKey() === expectedKey) finish(true)
  })
}

export async function resolveAuthoritativeDesignProfile(input: {
  threadId?: string | null
  localProfile?: DesignTaskProfile | null
  refresh?: boolean
  getThread?: (threadId: string) => NormalizedThread | undefined
  fetchThreadDetail?: (threadId: string) => Promise<{ designProfile?: DesignTaskProfile } | null>
  applyProfile?: (threadId: string, profile: DesignTaskProfile) => void
}): Promise<DesignTaskProfile | null> {
  const threadId = input.threadId?.trim() || ''
  const localProfile = input.localProfile ?? (
    threadId ? input.getThread?.(threadId)?.designProfile : undefined
  ) ?? null
  if (localProfile && !input.refresh) return cloneDesignTaskProfile(localProfile)
  if (!threadId || !input.fetchThreadDetail) {
    return localProfile ? cloneDesignTaskProfile(localProfile) : null
  }

  const existing = inflightProfileByThread.get(threadId)
  if (existing) return existing

  const request = (async () => {
    try {
      const detail = await input.fetchThreadDetail!(threadId)
      const fetched = detail?.designProfile
      if (!fetched) return localProfile ? cloneDesignTaskProfile(localProfile) : null
      const profile = cloneDesignTaskProfile(fetched)
      input.applyProfile?.(threadId, profile)
      return profile
    } catch {
      return localProfile ? cloneDesignTaskProfile(localProfile) : null
    } finally {
      inflightProfileByThread.delete(threadId)
    }
  })()
  inflightProfileByThread.set(threadId, request)
  return request
}
