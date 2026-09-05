import { useEffect, useMemo, useRef } from 'react'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  buildComposerAssistantPickList,
  resolveComposerAssistantProviderId
} from '../chat/composer-model-selection'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useChatStore } from '../../store/chat-store'
import {
  activeWriteThreadForWorkspace,
  readWriteThreadRegistry
} from '../../write/write-thread-registry'
import { workWhiteboardThreadIds } from '../../write/work-whiteboard'

type WorkbenchWriteAssistantRuntimeOptions = {
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
}

export function useWorkbenchWriteAssistantRuntime({
  composerPickList,
  composerModelGroups
}: WorkbenchWriteAssistantRuntimeOptions) {
  const writeAssistantOpen = useWriteWorkspaceStore((s) => s.assistantOpen)
  const setWriteAssistantOpen = useWriteWorkspaceStore((s) => s.setAssistantOpen)
  const writeAssistantModel = useWriteWorkspaceStore((s) => s.assistantModel)
  const writeAssistantProviderId = useWriteWorkspaceStore((s) => s.assistantProviderId)
  const writeWorkspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const activeWriteFilePath = useWriteWorkspaceStore((s) => s.activeFilePath)
  const activeWhiteboardId = useWriteWorkspaceStore((s) => s.activeWhiteboardId)
  const activeWhiteboard = useWriteWorkspaceStore((s) =>
    s.activeWhiteboardId ? s.whiteboards[s.activeWhiteboardId] ?? null : null
  )
  const setWriteAssistantModel = useWriteWorkspaceStore((s) => s.setAssistantModel)
  const route = useChatStore((s) => s.route)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const pendingThreadIdRef = useRef<string | null>(null)
  const pendingBoardIdRef = useRef<string | null>(null)
  const writeAssistantPickList = useMemo(() => {
    return buildComposerAssistantPickList({
      composerPickList
    })
  }, [composerPickList])
  const resolvedWriteAssistantProviderId = useMemo(() => {
    return resolveComposerAssistantProviderId({
      composerModelGroups,
      model: writeAssistantModel,
      storedProviderId: writeAssistantProviderId
    })
  }, [composerModelGroups, writeAssistantModel, writeAssistantProviderId])

  useEffect(() => {
    if (route !== 'write' || !writeWorkspaceRoot) return
    const chatState = useChatStore.getState()
    if (activeWhiteboardId && activeWhiteboard) {
      if (runtimeConnection !== 'ready') {
        if (activeThreadId) chatState.clearActiveThreadSelection()
        return
      }
      const associatedThreadIds = workWhiteboardThreadIds(activeWhiteboard)
      const availableThreads = associatedThreadIds
        .map((threadId) => threads.find((thread) => thread.id === threadId) ?? null)
        .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread))
        .filter((thread) => thread.archived !== true)
      const targetThread = availableThreads.find((thread) => thread.id === activeWhiteboard.threadId) ??
        availableThreads[0] ?? null
      if (targetThread?.id === activeThreadId) return
      if (targetThread) {
        if (pendingThreadIdRef.current === targetThread.id) return
        pendingThreadIdRef.current = targetThread.id
        const bind = targetThread.id !== activeWhiteboard.threadId && !activeWhiteboard.workflowId
          ? useWriteWorkspaceStore.getState().bindWhiteboardThread(activeWhiteboardId, targetThread.id)
          : Promise.resolve(true)
        void bind.then((bound) => {
          if (!bound) return
          return chatState.selectWriteThread(targetThread.id, writeWorkspaceRoot)
        }).finally(() => {
          if (pendingThreadIdRef.current === targetThread.id) pendingThreadIdRef.current = null
        })
        return
      }
      if (associatedThreadIds.length > 0) {
        if (activeThreadId) chatState.clearActiveThreadSelection()
        return
      }
      if (pendingBoardIdRef.current === activeWhiteboardId) return
      pendingBoardIdRef.current = activeWhiteboardId
      // The board title is the whiteboard's own canonical metadata; seed the
      // bound session with it and lock the session title (titleAuto: false) so
      // the backend titler cannot overwrite the user-visible board name.
      void chatState.createWriteThread(writeWorkspaceRoot, undefined, {
        title: activeWhiteboard.title,
        titleAuto: false
      }).then(async (threadId) => {
        if (threadId) {
          await useWriteWorkspaceStore.getState().bindWhiteboardThread(activeWhiteboardId, threadId)
        }
      }).finally(() => {
        if (pendingBoardIdRef.current === activeWhiteboardId) pendingBoardIdRef.current = null
      })
      return
    }
    if (!activeWriteFilePath) {
      if (activeThreadId) chatState.clearActiveThreadSelection()
      return
    }
    if (runtimeConnection !== 'ready') {
      if (activeThreadId) chatState.clearActiveThreadSelection()
      return
    }

    const target = activeWriteThreadForWorkspace(
      writeWorkspaceRoot,
      threads,
      readWriteThreadRegistry(),
      activeWriteFilePath
    )
    if (target?.id === activeThreadId) return
    if (target) {
      if (pendingThreadIdRef.current === target.id) return
      pendingThreadIdRef.current = target.id
      void chatState.selectWriteThread(target.id, writeWorkspaceRoot, activeWriteFilePath).finally(() => {
        if (pendingThreadIdRef.current === target.id) pendingThreadIdRef.current = null
      })
    } else if (activeThreadId) {
      chatState.clearActiveThreadSelection()
    }
  }, [
    activeThreadId,
    activeWhiteboard,
    activeWhiteboardId,
    activeWriteFilePath,
    route,
    runtimeConnection,
    threads,
    writeWorkspaceRoot
  ])

  return {
    resolvedWriteAssistantProviderId,
    setWriteAssistantModel,
    setWriteAssistantOpen,
    writeAssistantModel,
    writeAssistantOpen,
    writeAssistantPickList
  }
}
