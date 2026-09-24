import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { NormalizedThread } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { useChatStore } from '../../store/chat-store'
import { threadLooksRunning } from '../../store/chat-store-runtime-helpers'
import { writeThreadActivity, type WriteResourceActivityContext } from '../../write/write-resource-activity'
import type { SidebarActivity } from '../sidebar/SidebarActivityIndicator'
import { workWhiteboardThreadIds } from '../../write/work-whiteboard'
import {
  readWriteThreadRegistry,
  writeFileKey,
  writeThreadIdsForFile,
  writeWorkspaceKey
} from '../../write/write-thread-registry'
import {
  useWriteWorkspaceStore,
  writeBasenameFromPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { usePaperStore } from '../../write/paper/paper-store'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { paperConversationResourcePath } from '../../paper/paper-conversation-scope'
import { normalizePath } from '../../write/write-workspace-store-helpers'

export type WriteResourceConversationEntry = {
  id: string
  title: string
  updatedAt: string | null
  current: boolean
  missing: boolean
  archived: boolean
  activity?: SidebarActivity
}

export type WriteResourceConversationHistoryModel = {
  scopeKey: string
  resourceKind: 'file' | 'whiteboard' | 'paper'
  resourceLabel: string
  entries: WriteResourceConversationEntry[]
  running: boolean
  runtimeReady: boolean
  workflowLocked: boolean
  loadMissingThreads: () => Promise<void>
  canStartConversation: () => Promise<boolean>
  selectConversation: (threadId: string) => Promise<void>
  renameConversation: (threadId: string, title: string) => Promise<void>
  archiveConversation: (threadId: string) => Promise<void>
}

type ResourceScope = {
  key: string
  kind: 'file' | 'whiteboard' | 'paper'
  workspaceRoot: string
  resourceId: string
  label: string
  threadIds: string[]
  workflowLocked: boolean
}

function associatedThreadLooksRunning(thread: NormalizedThread | undefined): boolean {
  return Boolean(thread && thread.archived !== true && threadLooksRunning(thread))
}

function scopeMatchesCurrentResource(scope: ResourceScope): boolean {
  const state = useWriteWorkspaceStore.getState()
  if (writeWorkspaceKey(state.workspaceRoot) !== writeWorkspaceKey(scope.workspaceRoot)) return false
  if (scope.kind === 'whiteboard') return state.activeWhiteboardId === scope.resourceId
  if (scope.kind === 'paper') {
    if (state.activeWhiteboardId) return false
    const resource = paperConversationResourcePath({
      surface: state.workSurface,
      workspaceRoot: state.workspaceRoot,
      activeFilePath: state.activeFilePath,
      unitDirs: Object.keys(usePaperStore.getState().unitsByDir),
      entriesByDir: state.entriesByDir,
      view: usePaperModeStore.getState().view
    })
    return writeFileKey(resource) === scope.resourceId
  }
  return !state.activeWhiteboardId && writeFileKey(state.activeFilePath) === scope.resourceId
}

async function listAssociatedThreads(
  workspaceRoot: string,
  wantedIds: Set<string>
): Promise<NormalizedThread[]> {
  if (wantedIds.size === 0) return []
  const provider = getProvider()
  const found = new Map<string, NormalizedThread>()
  if (typeof provider.listThreadsPage !== 'function') {
    const threads = await provider.listThreads({
      workspace: workspaceRoot,
      includeArchived: true,
      lean: true
    })
    return threads.filter((thread) => wantedIds.has(thread.id))
  }

  let cursor: string | undefined
  while (found.size < wantedIds.size) {
    const page = await provider.listThreadsPage({
      workspace: workspaceRoot,
      includeArchived: true,
      lean: true,
      limit: 100,
      ...(cursor ? { cursor } : {})
    })
    for (const thread of page.threads) {
      if (wantedIds.has(thread.id)) found.set(thread.id, thread)
    }
    if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor) break
    cursor = page.nextCursor
  }
  return [...found.values()]
}

export function useWriteResourceConversationHistory(
  busy: boolean
): WriteResourceConversationHistoryModel | null {
  const {
    workspaceRoot,
    activeFilePath,
    activeWhiteboardId,
    activeWhiteboard,
    workSurface,
    bindWhiteboardThread
  } = useWriteWorkspaceStore(
    useShallow((state) => ({
      workspaceRoot: state.workspaceRoot,
      activeFilePath: state.activeFilePath,
      activeWhiteboardId: state.activeWhiteboardId,
      activeWhiteboard: state.activeWhiteboardId
        ? state.whiteboards[state.activeWhiteboardId] ?? null
        : null,
      workSurface: state.workSurface,
      bindWhiteboardThread: state.bindWhiteboardThread
    }))
  )
  const paperView = usePaperModeStore((s) => s.view)
  const {
    activeThreadId,
    threads,
    runtimeConnection,
    selectWriteThread,
    renameThread,
    archiveThread,
    storeBusy,
    watchTurnCompletion,
    awaitingUserInputThreadIds,
    unreadThreadIds
  } = useChatStore(
    useShallow((state) => ({
      activeThreadId: state.activeThreadId,
      threads: state.threads,
      runtimeConnection: state.runtimeConnection,
      selectWriteThread: state.selectWriteThread,
      renameThread: state.renameThread,
      archiveThread: state.archiveThread,
      storeBusy: state.busy,
      watchTurnCompletion: state.watchTurnCompletion,
      awaitingUserInputThreadIds: state.awaitingUserInputThreadIds,
      unreadThreadIds: state.unreadThreadIds
    }))
  )
  const [cachedThreads, setCachedThreads] = useState<Record<string, NormalizedThread>>({})
  const activityContext: WriteResourceActivityContext = {
    threads,
    activeThreadId,
    busy: storeBusy,
    watchTurnCompletion,
    awaitingUserInputThreadIds,
    unreadThreadIds
  }

  const scope = useMemo<ResourceScope | null>(() => {
    const normalizedWorkspace = normalizeWorkspaceRoot(workspaceRoot)
    if (!normalizedWorkspace) return null
    if (activeWhiteboardId && activeWhiteboard) {
      return {
        key: `whiteboard:${writeWorkspaceKey(normalizedWorkspace)}:${activeWhiteboardId}`,
        kind: 'whiteboard',
        workspaceRoot: normalizedWorkspace,
        resourceId: activeWhiteboardId,
        label: activeWhiteboard.title,
        threadIds: workWhiteboardThreadIds(activeWhiteboard),
        workflowLocked: Boolean(activeWhiteboard.workflowId)
      }
    }
    if (workSurface === 'papers') {
      const state = useWriteWorkspaceStore.getState()
      const resource = paperConversationResourcePath({
        surface: workSurface,
        workspaceRoot: normalizedWorkspace,
        activeFilePath,
        unitDirs: Object.keys(usePaperStore.getState().unitsByDir),
        entriesByDir: state.entriesByDir,
        view: paperView
      })
      const fileKey = writeFileKey(resource)
      if (!fileKey) return null
      const activeKey = writeFileKey(activeFilePath)
      const isPaperScope = fileKey !== activeKey
      const relDir = normalizePath(fileKey).startsWith(`${normalizePath(normalizedWorkspace)}/`)
        ? normalizePath(fileKey).slice(normalizePath(normalizedWorkspace).length + 1)
        : ''
      const paperMeta = relDir ? usePaperStore.getState().unitsByDir[relDir] : undefined
      return {
        key: `paper:${writeWorkspaceKey(normalizedWorkspace)}:${fileKey}`,
        kind: isPaperScope ? 'paper' : 'file',
        workspaceRoot: normalizedWorkspace,
        resourceId: fileKey,
        label: paperMeta?.title?.trim() ||
          writeRelativeToWorkspace(normalizedWorkspace, fileKey) ||
          writeBasenameFromPath(fileKey),
        threadIds: writeThreadIdsForFile(
          normalizedWorkspace,
          fileKey,
          readWriteThreadRegistry()
        ),
        workflowLocked: false
      }
    }
    const fileKey = writeFileKey(activeFilePath)
    if (!fileKey || !activeFilePath) return null
    return {
      key: `file:${writeWorkspaceKey(normalizedWorkspace)}:${fileKey}`,
      kind: 'file',
      workspaceRoot: normalizedWorkspace,
      resourceId: fileKey,
      label: writeRelativeToWorkspace(normalizedWorkspace, activeFilePath) ||
        writeBasenameFromPath(activeFilePath),
      threadIds: writeThreadIdsForFile(
        normalizedWorkspace,
        activeFilePath,
        readWriteThreadRegistry()
      ),
      workflowLocked: false
    }
  }, [activeFilePath, activeWhiteboard, activeWhiteboardId, paperView, workSurface, workspaceRoot])

  useEffect(() => {
    setCachedThreads({})
  }, [scope?.key])

  const resolvedThreads = useMemo(() => {
    const byId = new Map<string, NormalizedThread>()
    for (const thread of Object.values(cachedThreads)) byId.set(thread.id, thread)
    for (const thread of threads) byId.set(thread.id, thread)
    return byId
  }, [cachedThreads, threads])

  const resolveScopeThreads = useCallback(async (): Promise<Map<string, NormalizedThread>> => {
    const next = new Map(resolvedThreads)
    if (!scope || runtimeConnection !== 'ready' || !scopeMatchesCurrentResource(scope)) return next
    const wantedIds = new Set(scope.threadIds.filter((id) => !next.has(id)))
    if (wantedIds.size === 0) return next
    try {
      const loaded = await listAssociatedThreads(scope.workspaceRoot, wantedIds)
      if (!scopeMatchesCurrentResource(scope) || loaded.length === 0) return next
      for (const thread of loaded) next.set(thread.id, thread)
      setCachedThreads((current) => ({
        ...current,
        ...Object.fromEntries(loaded.map((thread) => [thread.id, thread]))
      }))
    } catch {
      // The main runtime status surface owns connection errors. History remains
      // usable with locally known titles when on-demand enrichment fails.
    }
    return next
  }, [resolvedThreads, runtimeConnection, scope])

  const loadMissingThreads = useCallback(async (): Promise<void> => {
    await resolveScopeThreads()
  }, [resolveScopeThreads])

  const canStartConversation = useCallback(async (): Promise<boolean> => {
    if (!scope || runtimeConnection !== 'ready' || scope.workflowLocked || !scopeMatchesCurrentResource(scope)) {
      return false
    }
    const latestThreads = await resolveScopeThreads()
    if (!scopeMatchesCurrentResource(scope)) return false
    if (scope.threadIds.some((id) => !latestThreads.has(id))) return false
    return !busy && !scope.threadIds.some((id) => associatedThreadLooksRunning(latestThreads.get(id)))
  }, [busy, resolveScopeThreads, runtimeConnection, scope])

  const selectConversation = useCallback(async (threadId: string): Promise<void> => {
    if (!scope || !scope.threadIds.includes(threadId) || !scopeMatchesCurrentResource(scope)) return
    const latestThreads = await resolveScopeThreads()
    if (!scopeMatchesCurrentResource(scope)) return
    if (scope.threadIds.some((id) => !latestThreads.has(id))) return
    const resourceRunning = busy || scope.threadIds.some((id) =>
      associatedThreadLooksRunning(latestThreads.get(id)))
    if (runtimeConnection !== 'ready' || resourceRunning || scope.workflowLocked) return
    if (scope.kind === 'file' || scope.kind === 'paper') {
      await selectWriteThread(threadId, scope.workspaceRoot, scope.resourceId)
      return
    }
    const bound = await bindWhiteboardThread(scope.resourceId, threadId)
    if (bound && scopeMatchesCurrentResource(scope)) {
      await selectWriteThread(threadId, scope.workspaceRoot)
    }
  }, [bindWhiteboardThread, busy, resolveScopeThreads, runtimeConnection, scope, selectWriteThread])

  const renameConversation = useCallback(async (threadId: string, title: string): Promise<void> => {
    if (!scope || !scope.threadIds.includes(threadId) || !scopeMatchesCurrentResource(scope)) return
    const latestThreads = await resolveScopeThreads()
    if (!scopeMatchesCurrentResource(scope)) return
    if (scope.threadIds.some((id) => !latestThreads.has(id))) return
    const resourceRunning = busy || scope.threadIds.some((id) =>
      associatedThreadLooksRunning(latestThreads.get(id)))
    if (runtimeConnection !== 'ready' || resourceRunning) return
    await renameThread(threadId, title)
    setCachedThreads((current) => {
      const thread = current[threadId]
      return thread ? { ...current, [threadId]: { ...thread, title, titleAuto: false } } : current
    })
  }, [busy, renameThread, resolveScopeThreads, runtimeConnection, scope])

  const archiveConversation = useCallback(async (threadId: string): Promise<void> => {
    if (!scope || !scope.threadIds.includes(threadId) || !scopeMatchesCurrentResource(scope)) return
    const latestThreads = await resolveScopeThreads()
    if (!scopeMatchesCurrentResource(scope)) return
    if (scope.threadIds.some((id) => !latestThreads.has(id))) return
    const resourceRunning = busy || scope.threadIds.some((id) =>
      associatedThreadLooksRunning(latestThreads.get(id)))
    if (runtimeConnection !== 'ready' || resourceRunning || scope.workflowLocked) return
    const fallbackThreadId = threadId === activeThreadId
      ? scope.threadIds.find((id) => {
          const thread = latestThreads.get(id)
          return id !== threadId && Boolean(thread) && thread?.archived !== true
        }) ?? null
      : null
    await archiveThread(threadId, true)
    setCachedThreads((current) => {
      const thread = current[threadId]
      return thread ? { ...current, [threadId]: { ...thread, archived: true } } : current
    })
    if (!fallbackThreadId || !scopeMatchesCurrentResource(scope)) return
    if (scope.kind === 'file' || scope.kind === 'paper') {
      await selectWriteThread(fallbackThreadId, scope.workspaceRoot, scope.resourceId)
      return
    }
    const bound = await bindWhiteboardThread(scope.resourceId, fallbackThreadId)
    if (bound && scopeMatchesCurrentResource(scope)) {
      await selectWriteThread(fallbackThreadId, scope.workspaceRoot)
    }
  }, [
    activeThreadId,
    archiveThread,
    bindWhiteboardThread,
    busy,
    resolveScopeThreads,
    runtimeConnection,
    scope,
    selectWriteThread
  ])

  if (!scope) return null
  const entries = scope.threadIds.map((id): WriteResourceConversationEntry => {
    const thread = resolvedThreads.get(id)
    return {
      id,
      title: thread?.title?.trim() ?? '',
      updatedAt: thread?.updatedAt ?? null,
      current: id === activeThreadId,
      missing: !thread,
      archived: thread?.archived === true,
      activity: writeThreadActivity(id, activityContext)
    }
  }).filter((entry) => !entry.archived)
  const running = busy || scope.threadIds.some((id) =>
    associatedThreadLooksRunning(resolvedThreads.get(id)))

  return {
    scopeKey: scope.key,
    resourceKind: scope.kind,
    resourceLabel: scope.label,
    entries,
    running,
    runtimeReady: runtimeConnection === 'ready',
    workflowLocked: scope.workflowLocked,
    loadMissingThreads,
    canStartConversation,
    selectConversation,
    renameConversation,
    archiveConversation
  }
}
