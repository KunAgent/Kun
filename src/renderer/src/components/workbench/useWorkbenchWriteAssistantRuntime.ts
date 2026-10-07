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
  readWriteThreadRegistry,
  writeThreadBelongsToWorkspace
} from '../../write/write-thread-registry'
import { paperResearchStageActive } from '../../paper/paper-view'
import { researchResourcePath } from '../../paper/paper-research-sessions'
import { useWorkSessionStore } from '../../write/work-session-store'
import { rememberWorkSessionTabs } from '../../write/work-session-tabs'
import { recordWorkRecentDocument } from '../../write/work-recent-documents'
import { useWorkConversationStage } from '../../write/work-conversation-stage'
import { writeWorkspaceKey } from '../../write/write-thread-registry'

type WorkbenchWriteAssistantRuntimeOptions = {
  composerPickList: string[]
  composerModelGroups: ModelProviderModelGroup[]
}

export function useWorkbenchWriteAssistantRuntime({
  composerPickList,
  composerModelGroups
}: WorkbenchWriteAssistantRuntimeOptions) {
  // With nothing open the assistant fills the center, so it is always shown.
  const conversationStage = useWorkConversationStage()
  const writeAssistantExpanded = useWriteWorkspaceStore((s) => s.writeRightPanel.expanded)
  const writeAssistantOpen = writeAssistantExpanded || conversationStage
  const currentSessions = useWorkSessionStore((s) => s.current)
  const sessionTransitions = useWorkSessionStore((s) => s.transitions)
  const setWriteAssistantOpen = useWriteWorkspaceStore((s) => s.setAssistantOpen)
  const writeAssistantModel = useWriteWorkspaceStore((s) => s.assistantModel)
  const writeAssistantProviderId = useWriteWorkspaceStore((s) => s.assistantProviderId)
  const writeWorkspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const researchFocus = useWriteWorkspaceStore((s) => paperResearchStageActive(s) ? s.paperResearch.sessionId ?? '' : null)
  const activeWhiteboard = useWriteWorkspaceStore((s) =>
    s.activeWhiteboardId ? s.whiteboards[s.activeWhiteboardId] ?? null : null
  )
  const setWriteAssistantModel = useWriteWorkspaceStore((s) => s.setAssistantModel)
  const route = useChatStore((s) => s.route)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const pendingThreadIdRef = useRef<string | null>(null)
  const seenActiveRef = useRef<string | null | undefined>(undefined)
  const seenBoardRef = useRef<string | null>(null)
  const seenResearchRef = useRef<string | null>(null)
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

  // The session law (work-session-store): the space's current session is the
  // conversation, whatever is open. Pages that are sessions themselves — a
  // PPT review board's task, an Agent research run — make theirs current
  // when they come to the front; a Work session selected from elsewhere (a
  // notification, search) is adopted.
  useEffect(() => {
    if (route !== 'write' || !writeWorkspaceRoot || sessionTransitions > 0) return
    const chatState = useChatStore.getState()
    const sessions = useWorkSessionStore.getState()
    const spaceKey = writeWorkspaceKey(writeWorkspaceRoot)
    const activeChanged = seenActiveRef.current !== undefined && seenActiveRef.current !== activeThreadId
    seenActiveRef.current = activeThreadId
    const current = currentSessions[spaceKey] ?? ''

    const boardKey = activeWhiteboard?.workflowId && activeWhiteboard.threadId
      ? `${activeWhiteboard.id}\u0000${activeWhiteboard.threadId}` : null
    if (boardKey !== seenBoardRef.current) {
      seenBoardRef.current = boardKey
      if (boardKey && activeWhiteboard?.threadId && activeWhiteboard.threadId !== current) {
        sessions.select(writeWorkspaceRoot, activeWhiteboard.threadId)
        return
      }
    }
    if (researchFocus !== seenResearchRef.current) {
      seenResearchRef.current = researchFocus
      if (researchFocus) {
        const research = activeWriteThreadForWorkspace(writeWorkspaceRoot, threads, readWriteThreadRegistry(),
          researchResourcePath(writeWorkspaceRoot, researchFocus))
        if (research && research.archived !== true && research.id !== current) {
          sessions.select(writeWorkspaceRoot, research.id)
          return
        }
      }
    }
    if (activeChanged && activeThreadId && activeThreadId !== current) {
      const active = threads.find((thread) => thread.id === activeThreadId)
      if (active && active.archived !== true &&
        writeThreadBelongsToWorkspace(active, writeWorkspaceRoot, readWriteThreadRegistry())) {
        sessions.select(writeWorkspaceRoot, activeThreadId)
        return
      }
    }

    if (!current) {
      if (activeThreadId) chatState.clearActiveThreadSelection()
      return
    }
    // A brand-new session is not listed until its first message lands.
    if (current === activeThreadId) return
    const thread = threads.find((candidate) => candidate.id === current) ?? null
    if (thread?.archived === true) {
      sessions.release(current)
      return
    }
    if (!thread || runtimeConnection !== 'ready') return
    if (pendingThreadIdRef.current === current) return
    pendingThreadIdRef.current = current
    void chatState.selectThread(current).finally(() => {
      if (pendingThreadIdRef.current === current) pendingThreadIdRef.current = null
    })
  }, [
    activeThreadId,
    activeWhiteboard,
    currentSessions,
    researchFocus,
    route,
    runtimeConnection,
    sessionTransitions,
    threads,
    writeWorkspaceRoot
  ])

  // Remember each session's tabs so opening it again restores its workbench,
  // and the documents opened in each space for the home cards.
  useEffect(() => {
    if (route !== 'write') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const save = (): void => {
      const write = useWriteWorkspaceStore.getState()
      const sessionId = useWorkSessionStore.getState().current[writeWorkspaceKey(write.workspaceRoot)] ?? ''
      if (!sessionId || sessionId !== useChatStore.getState().activeThreadId) return
      rememberWorkSessionTabs(sessionId, write.workspaceRoot, write.editorLayout)
    }
    const unsubscribe = useWriteWorkspaceStore.subscribe((state, previous) => {
      if (state.activeFilePath && state.activeFilePath !== previous.activeFilePath) {
        recordWorkRecentDocument(state.workspaceRoot, state.activeFilePath)
      }
      if (state.editorLayout === previous.editorLayout) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(save, 400)
    })
    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [route])

  return {
    resolvedWriteAssistantProviderId,
    setWriteAssistantModel,
    setWriteAssistantOpen,
    writeAssistantModel,
    writeAssistantOpen,
    writeAssistantPickList
  }
}
