import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { NormalizedThread, RuntimeConnectionStatus } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { useChatStore, type AppRoute } from '../../store/chat-store'
import { isConversationWorkspacePath, normalizeWorkspaceRoot } from '../../lib/workspace-path'
import {
  buildSddDraftId,
  createSddDraft,
  resolveSddRequirementWorkspace,
  useSddDraftStore,
  type SddDraft,
  type SddDraftSaveStatus
} from '../../sdd/sdd-draft-store'
import { listSddDraftHistory, titleFromSddDraftContent } from '../../sdd/sdd-draft-history'
import { restoreSddDraft } from '../../sdd/sdd-draft-restore'
import { saveActiveSddDraftToDisk } from '../../sdd/sdd-draft-actions'
import {
  isSddAssistantThread,
  isEmptySddAssistantThreadCandidate,
  markSddAssistantThread,
  readSddThreadRegistry,
  sddAssistantThreadIdForDraft,
  sddThreadIdsForDraft,
  showSddAssistantThreadInSidebar,
  type SddThreadRegistry
} from '../../sdd/sdd-thread-registry'
import {
  refreshSddChatTranscriptFromProvider,
  sddDraftRefForThreadId,
  writeSddChatTranscriptForThread
} from '../../sdd/sdd-chat-transcript'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import type { WriteQuotedSelection } from '../../write/quoted-selection'

const SDD_ASSISTANT_TITLE_SYNC_DELAY_MS = 900

function sddAssistantThreadTitle(markdown: string, fallback: string): string {
  return titleFromSddDraftContent(markdown, fallback).trim() || fallback
}

function sddDraftFromRegisteredThread(threadId: string): SddDraft | null {
  const ref = sddDraftRefForThreadId(threadId)
  if (!ref) return null
  const timestamp = new Date(0).toISOString()
  return {
    id: buildSddDraftId(ref.workspaceRoot, ref.draftRelativePath),
    workspaceRoot: ref.workspaceRoot,
    relativePath: ref.draftRelativePath,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function sddThreadOwnsDraft(
  threadId: string,
  draft: SddDraft,
  registry: SddThreadRegistry = readSddThreadRegistry()
): boolean {
  const ref = sddDraftRefForThreadId(threadId, registry)
  return Boolean(
    ref &&
    normalizeWorkspaceRoot(ref.workspaceRoot) === normalizeWorkspaceRoot(draft.workspaceRoot) &&
    ref.draftRelativePath.trim().replaceAll('\\', '/') ===
      draft.relativePath.trim().replaceAll('\\', '/')
  )
}

/** 当前线程是否仍属于“需求 AI 会话”(Plan release 前的需求阶段)。
 * 仅用于分类,不代表打开草稿。 */
export function isRequirementSessionThread(
  threadId: string,
  thread: NormalizedThread | null,
  registry?: SddThreadRegistry
): boolean {
  const normalizedThreadId = threadId.trim()
  return Boolean(
    normalizedThreadId &&
    isSddAssistantThread(thread ?? { id: normalizedThreadId }, registry)
  )
}

/** 挑选草稿当前最合适的 AI 会话:优先仍存在于运行时列表中的最近会话,避免
 * 新建或切回已经 release 成普通 Code 会话的旧主线程。 */
function sddRecentThreadIdForDraft(draft: SddDraft): string {
  const knownThreadIds = new Set(useChatStore.getState().threads.map((thread) => thread.id))
  const allThreadIds = sddThreadIdsForDraft(draft)
  return allThreadIds.find((threadId) => knownThreadIds.has(threadId)) ?? allThreadIds[0] ?? ''
}

type UseWorkbenchSddThreadControllerParams = {
  activeThreadId: string | null
  codeThreads: NormalizedThread[]
  conversationWorkspaceRoot: string
  input: string
  rightPanelMode: RightPanelMode
  runtimeConnection: RuntimeConnectionStatus
  workspaceRoot: string
  selectThread: (id: string) => Promise<void>
  setComposerMode: (mode: 'plan' | 'agent' | 'auto') => void
  setError: (message: string | null) => void
  setInput: (value: string) => void
  setRightPanelMode: (mode: RightPanelMode) => void
  setRightSidebarWidth: Dispatch<SetStateAction<number>>
  setRoute: (route: AppRoute) => void
}

export type WorkbenchSddThreadController = {
  activeSddDraft: SddDraft | null
  sddDraftContent: string
  sddDraftOperationStatus: ReturnType<typeof useSddDraftStore.getState>['operationStatus']
  createSddAssistantThreadForDraft: (draft: SddDraft) => Promise<string | null>
  dismissActiveSddDraft: (options?: { closeAssistant?: boolean }) => void
  findSddDraftForSidebarThread: (
    threadId: string,
    thread: NormalizedThread | null
  ) => Promise<SddDraft | null>
  openSddAssistantPanel: () => Promise<void>
  openSddRequirementDraftFromHistory: (draft: SddDraft) => Promise<void>
  quoteToSddAssistant: (prompt: string, selection?: WriteQuotedSelection) => void
  renameSddAssistantThreadToDraft: (threadId: string, draft: SddDraft) => Promise<void>
  startNewSddAssistantConversation: () => void
  startNewSddRequirement: () => Promise<void>
  toggleSddAssistantPanel: () => Promise<void>
  ensureSddAssistantThreadForDraft: (draft: SddDraft) => Promise<string | null>
}

export function useWorkbenchSddThreadController({
  activeThreadId,
  codeThreads,
  conversationWorkspaceRoot,
  input,
  rightPanelMode,
  runtimeConnection,
  workspaceRoot,
  selectThread,
  setComposerMode,
  setError,
  setInput,
  setRightPanelMode,
  setRightSidebarWidth,
  setRoute
}: UseWorkbenchSddThreadControllerParams): WorkbenchSddThreadController {
  const { t } = useTranslation('common')
  const activeSddDraft = useSddDraftStore((s) => s.activeDraft)
  const sddDraftContent = useSddDraftStore((s) => s.content)
  const sddDraftOperationStatus = useSddDraftStore((s) => s.operationStatus)
  const sddTitleSyncTimerRef = useRef<number | null>(null)
  const lastSyncedSddTitleRef = useRef<Record<string, string>>({})
  const forceNewSddAssistantThreadRef = useRef(false)

  const titleForSddDraft = useCallback((draft: SddDraft): string => {
    const snapshot = useSddDraftStore.getState()
    const markdown = snapshot.activeDraft?.id === draft.id ? snapshot.content : ''
    return sddAssistantThreadTitle(markdown, t('sddUntitledRequirement'))
  }, [t])

  const renameSddAssistantThreadToDraft = useCallback(async (
    threadId: string,
    draft: SddDraft
  ): Promise<void> => {
    const targetId = threadId.trim()
    const nextTitle = titleForSddDraft(draft)
    if (!targetId || !nextTitle || runtimeConnection !== 'ready') return
    const currentTitle = useChatStore.getState().threads.find((thread) => thread.id === targetId)?.title.trim()
    if (currentTitle === nextTitle || lastSyncedSddTitleRef.current[targetId] === nextTitle) return
    try {
      await getProvider().renameThread(targetId, nextTitle)
      lastSyncedSddTitleRef.current[targetId] = nextTitle
      useChatStore.setState((state) => ({
        threads: state.threads.map((thread) =>
          thread.id === targetId ? { ...thread, title: nextTitle } : thread
        )
      }))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [runtimeConnection, setError, titleForSddDraft])

  const createSddAssistantThreadForDraft = useCallback(async (
    draft: SddDraft
  ): Promise<string | null> => {
    const normalizedWorkspace = normalizeWorkspaceRoot(draft.workspaceRoot)
    if (!normalizedWorkspace) {
      setError(t('workspaceRequiredToCreateThread'))
      return null
    }
    if (runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return null
    }
    try {
      const provider = getProvider()
      const thread = await provider.createThread({
        workspace: normalizedWorkspace,
        title: titleForSddDraft(draft),
        mode: 'agent'
      })
      const normalizedThread = {
        ...thread,
        workspace: normalizeWorkspaceRoot(thread.workspace) || normalizedWorkspace
      }
      markSddAssistantThread(draft, normalizedThread.id)
      showSddAssistantThreadInSidebar(normalizedThread.id)
      void writeSddChatTranscriptForThread({
        workspaceRoot: draft.workspaceRoot,
        draftRelativePath: draft.relativePath,
        threadId: normalizedThread.id,
        blocks: []
      })
      useChatStore.setState((state) => ({
        activeThreadId: normalizedThread.id,
        threads: state.threads.some((item) => item.id === normalizedThread.id)
          ? state.threads
          : [normalizedThread, ...state.threads]
      }))
      setRoute('chat')
      await selectThread(normalizedThread.id)
      forceNewSddAssistantThreadRef.current = false
      void useChatStore.getState().refreshThreads()
      return normalizedThread.id
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [runtimeConnection, selectThread, setError, setRoute, t, titleForSddDraft])

  const ensureSddAssistantThreadForDraft = useCallback(async (
    draft: SddDraft
  ): Promise<string | null> => {
    const currentThreadId = useChatStore.getState().activeThreadId?.trim() ?? ''
    const registeredThreadId = forceNewSddAssistantThreadRef.current
      ? ''
      : sddThreadOwnsDraft(currentThreadId, draft)
        ? currentThreadId
        : sddRecentThreadIdForDraft(draft) || sddAssistantThreadIdForDraft(draft)
    if (registeredThreadId) {
      showSddAssistantThreadInSidebar(registeredThreadId)
      setRoute('chat')
      if (useChatStore.getState().activeThreadId !== registeredThreadId) {
        await selectThread(registeredThreadId)
      }
      if (useChatStore.getState().activeThreadId === registeredThreadId) {
        void renameSddAssistantThreadToDraft(registeredThreadId, draft)
        return registeredThreadId
      }
    }
    return createSddAssistantThreadForDraft(draft)
  }, [
    createSddAssistantThreadForDraft,
    renameSddAssistantThreadToDraft,
    selectThread,
    setRoute
  ])

  useEffect(() => {
    const draft = activeSddDraft
    if (!draft || runtimeConnection !== 'ready') return
    const threadId = sddAssistantThreadIdForDraft(draft)
    if (!threadId) return
    const nextTitle = sddAssistantThreadTitle(sddDraftContent, t('sddUntitledRequirement'))
    if (!nextTitle || lastSyncedSddTitleRef.current[threadId] === nextTitle) return
    if (sddTitleSyncTimerRef.current) {
      window.clearTimeout(sddTitleSyncTimerRef.current)
    }
    sddTitleSyncTimerRef.current = window.setTimeout(() => {
      sddTitleSyncTimerRef.current = null
      const latestDraft = useSddDraftStore.getState().activeDraft
      if (!latestDraft || latestDraft.id !== draft.id) return
      const latestThreadId = sddAssistantThreadIdForDraft(latestDraft)
      if (latestThreadId !== threadId) return
      void renameSddAssistantThreadToDraft(threadId, latestDraft)
    }, SDD_ASSISTANT_TITLE_SYNC_DELAY_MS)
    return () => {
      if (sddTitleSyncTimerRef.current) {
        window.clearTimeout(sddTitleSyncTimerRef.current)
        sddTitleSyncTimerRef.current = null
      }
    }
  }, [activeSddDraft, renameSddAssistantThreadToDraft, runtimeConnection, sddDraftContent, t])

  const openSddRequirementDraft = useCallback(async (
    draft: SddDraft,
    content: string,
    options: {
      lastSavedContent?: string
      saveStatus?: SddDraftSaveStatus
      openAssistant?: boolean
    } = {}
  ): Promise<boolean> => {
    forceNewSddAssistantThreadRef.current = false
    useSddDraftStore.getState().setActiveDraft(draft, content, {
      lastSavedContent: options.lastSavedContent,
      saveStatus: options.saveStatus
    })
    void refreshSddChatTranscriptFromProvider(draft)
    setInput('')
    setComposerMode('agent')
    setRoute('chat')
    if (options.openAssistant ?? runtimeConnection === 'ready') {
      setRightSidebarWidth((width) => Math.max(width, 420))
      const currentThreadId = useChatStore.getState().activeThreadId?.trim() ?? ''
      // 优先保留当前且确实拥有该草稿的会话(含已 release 的会话);其次选仍然
      // 存在的最近需求 AI 会话;最后才回退到注册表中的主线程。
      let sddThreadId = sddThreadOwnsDraft(currentThreadId, draft)
        ? currentThreadId
        : sddRecentThreadIdForDraft(draft) || sddAssistantThreadIdForDraft(draft)
      if (sddThreadId && useChatStore.getState().activeThreadId !== sddThreadId) {
        showSddAssistantThreadInSidebar(sddThreadId)
        await selectThread(sddThreadId)
      }
      if (!sddThreadId && runtimeConnection === 'ready') {
        sddThreadId = await createSddAssistantThreadForDraft(draft) ?? ''
      }
      if (!sddThreadId) useChatStore.getState().clearActiveThreadSelection()
      setRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.sddAi)
    } else {
      setRightPanelMode(null)
    }
    return true
  }, [
    createSddAssistantThreadForDraft,
    runtimeConnection,
    selectThread,
    setComposerMode,
    setInput,
    setRightPanelMode,
    setRightSidebarWidth,
    setRoute
  ])

  const dismissActiveSddDraft = useCallback((
    options: { closeAssistant?: boolean } = {}
  ): void => {
    const draft = useSddDraftStore.getState().activeDraft
    if (draft) {
      void saveActiveSddDraftToDisk()
      useSddDraftStore.getState().clearActiveDraft()
    }
    if (options.closeAssistant && rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi) setRightPanelMode(null)
  }, [rightPanelMode, setRightPanelMode])

  const openSddAssistantPanel = useCallback(async (): Promise<void> => {
    const draft = useSddDraftStore.getState().activeDraft
    if (!draft) return
    setRightSidebarWidth((width) => Math.max(width, 420))
    const currentThreadId = useChatStore.getState().activeThreadId?.trim() ?? ''
    const threadId = forceNewSddAssistantThreadRef.current
      ? ''
      : sddThreadOwnsDraft(currentThreadId, draft)
        ? currentThreadId
        : sddRecentThreadIdForDraft(draft) || sddAssistantThreadIdForDraft(draft)
    if (threadId && useChatStore.getState().activeThreadId !== threadId) {
      await selectThread(threadId)
    }
    if (!threadId) useChatStore.getState().clearActiveThreadSelection()
    setRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.sddAi)
  }, [selectThread, setRightPanelMode, setRightSidebarWidth])

  const toggleSddAssistantPanel = useCallback(async (): Promise<void> => {
    if (rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi) {
      setRightPanelMode(null)
      return
    }
    await openSddAssistantPanel()
  }, [openSddAssistantPanel, rightPanelMode, setRightPanelMode])

  const quoteToSddAssistant = useCallback((prompt: string, selection?: WriteQuotedSelection): void => {
    const trimmed = prompt.trim()
    if (!trimmed && !selection) return
    if (selection) useSddDraftStore.getState().addAssistantQuotedSelection(selection)
    const visiblePrompt = trimmed || t('writeAssistantPolishSelectionPrompt')
    setInput(input.trim() ? `${input.trim()}\n\n${visiblePrompt}` : visiblePrompt)
    void openSddAssistantPanel()
  }, [input, openSddAssistantPanel, setInput, t])

  const startNewSddRequirement = useCallback(async (): Promise<void> => {
    const targetWorkspace = resolveSddRequirementWorkspace(codeThreads, activeThreadId, workspaceRoot)
    if (!targetWorkspace) {
      setError(t('workspaceRequiredToCreateThread'))
      return
    }
    if (isConversationWorkspacePath(targetWorkspace, conversationWorkspaceRoot)) {
      setError(t('workspaceInsideConversationDir'))
      return
    }

    if (useSddDraftStore.getState().activeDraft && !await saveActiveSddDraftToDisk()) return

    const draftUuid = globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`
    const draft = createSddDraft({ id: draftUuid, workspaceRoot: targetWorkspace })
    const initialContent = [
      `# ${t('sddUntitledRequirement')}`,
      '',
      `## ${t('sddTemplateBackground')}`,
      '',
      `## ${t('sddTemplateGoal')}`,
      '',
      `## ${t('sddTemplateAcceptance')}`,
      ''
    ].join('\n')
    const result = await window.kunGui.createWorkspaceFile({
      workspaceRoot: targetWorkspace,
      path: draft.relativePath,
      content: initialContent
    })
    if (!result.ok) {
      setError(result.message)
      return
    }
    const activeDraft = { ...draft, absolutePath: result.path }
    await openSddRequirementDraft(activeDraft, initialContent)
  }, [
    activeThreadId,
    codeThreads,
    conversationWorkspaceRoot,
    openSddRequirementDraft,
    setError,
    t,
    workspaceRoot
  ])

  const openSddRequirementDraftFromHistory = useCallback(async (
    draft: SddDraft
  ): Promise<void> => {
    const current = useSddDraftStore.getState().activeDraft
    if (current && current.id !== draft.id) {
      await saveActiveSddDraftToDisk()
    }
    const restored = await restoreSddDraft({
      draft,
      readWorkspaceFile: window.kunGui.readWorkspaceFile
    })
    if (restored.kind !== 'restored') {
      setError(restored.kind === 'unreadable' ? restored.message : t('sddDraftHistoryOpenFailed'))
      return
    }
    await openSddRequirementDraft(restored.draft, restored.content, {
      lastSavedContent: restored.lastSavedContent,
      saveStatus: restored.saveStatus
    })
  }, [openSddRequirementDraft, setError, t])

  const findSddDraftForSidebarThread = useCallback(async (
    threadId: string,
    thread: NormalizedThread | null
  ): Promise<SddDraft | null> => {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return null

    if (isRequirementSessionThread(normalizedThreadId, thread)) {
      return sddDraftFromRegisteredThread(normalizedThreadId)
    }

    if (thread && !isEmptySddAssistantThreadCandidate(thread)) return null
    const listWorkspaceDirectory = window.kunGui?.listWorkspaceDirectory
    const readWorkspaceFile = window.kunGui?.readWorkspaceFile
    if (typeof listWorkspaceDirectory !== 'function' || typeof readWorkspaceFile !== 'function') {
      return null
    }

    const targetWorkspace = normalizeWorkspaceRoot(thread?.workspace || workspaceRoot)
    if (!targetWorkspace) return null
    const history = await listSddDraftHistory({
      workspaceRoot: targetWorkspace,
      listWorkspaceDirectory,
      readWorkspaceFile,
      limit: 80
    }).catch(() => [])
    return history.find((draft) => draft.chatThreadIds?.includes(normalizedThreadId)) ?? null
  }, [workspaceRoot])

  const startNewSddAssistantConversation = useCallback((): void => {
    const draft = useSddDraftStore.getState().activeDraft
    if (!draft) return
    forceNewSddAssistantThreadRef.current = true
    useSddDraftStore.getState().clearAssistantQuotedSelections()
    setInput('')
    useChatStore.getState().clearActiveThreadSelection()
    setRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.sddAi)
  }, [setInput, setRightPanelMode])

  return {
    activeSddDraft,
    sddDraftContent,
    sddDraftOperationStatus,
    createSddAssistantThreadForDraft,
    dismissActiveSddDraft,
    ensureSddAssistantThreadForDraft,
    findSddDraftForSidebarThread,
    openSddAssistantPanel,
    openSddRequirementDraftFromHistory,
    quoteToSddAssistant,
    renameSddAssistantThreadToDraft,
    startNewSddAssistantConversation,
    startNewSddRequirement,
    toggleSddAssistantPanel
  }
}
