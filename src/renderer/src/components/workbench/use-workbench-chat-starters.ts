/**
 * New-conversation starters shared by Code and ADE sidebars. Extracted from
 * useWorkbenchNavigationController so the creation variants (plain, manager
 * session, harness-pinned one-to-one, workspace-picked) live in one cohesive
 * hook; every starter still guards activation with the navigation request id.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ChatState } from '../../store/chat-store-types'

export type WorkbenchChatStarterDeps = {
  /** True while an SDD design draft is open — starters dismiss it first. */
  activeSddDraft: boolean
  beginNavigation: () => number
  createThread: ChatState['createThread']
  dismissActiveSddDraft: (options?: { closeAssistant?: boolean }) => void
  navigationIsCurrent: (requestId: number) => boolean
  setConnectPhoneSidebarOpen: Dispatch<SetStateAction<boolean>>
  setRoute: ChatState['setRoute']
  setUseWorktreePool: Dispatch<SetStateAction<boolean>>
  useWorktreePool: boolean
  worktreeBranch: string
}

export function useWorkbenchChatStarters(deps: WorkbenchChatStarterDeps) {
  const {
    activeSddDraft,
    beginNavigation,
    createThread,
    dismissActiveSddDraft,
    navigationIsCurrent,
    setConnectPhoneSidebarOpen,
    setRoute,
    setUseWorktreePool,
    useWorktreePool,
    worktreeBranch
  } = deps

  const startNewChat = useCallback((): void => {
    const requestId = beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    void createThread({
      useWorktreePool,
      worktreeBranch,
      agentSurface: 'code',
      activationGuard: () => navigationIsCurrent(requestId)
    })
    if (useWorktreePool) setUseWorktreePool(false)
  }, [
    activeSddDraft,
    beginNavigation,
    createThread,
    dismissActiveSddDraft,
    navigationIsCurrent,
    setConnectPhoneSidebarOpen,
    setRoute,
    setUseWorktreePool,
    useWorktreePool,
    worktreeBranch
  ])

  const startNewAdeChat = useCallback((): void => {
    const requestId = beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('ade')
    void createThread({
      useWorktreePool,
      worktreeBranch,
      agentSurface: 'code',
      workspaceMode: 'ade',
      activationGuard: () => navigationIsCurrent(requestId)
    })
    if (useWorktreePool) setUseWorktreePool(false)
  }, [
    activeSddDraft,
    beginNavigation,
    createThread,
    dismissActiveSddDraft,
    navigationIsCurrent,
    setConnectPhoneSidebarOpen,
    setRoute,
    setUseWorktreePool,
    useWorktreePool,
    worktreeBranch
  ])

  const startNewAdeOneOnOne = useCallback((input: {
    harnessId: string
    credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
  }): void => {
    const requestId = beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('ade')
    // 00 §5: a one-to-one thread isolates into a fresh worktree by default;
    // the thread is pinned to the picked harness from creation.
    void createThread({
      useWorktreePool: true,
      worktreeBranch,
      agentSurface: 'code',
      workspaceMode: 'ade',
      harnessId: input.harnessId,
      credentialMode: input.credentialMode,
      activationGuard: () => navigationIsCurrent(requestId)
    })
  }, [
    activeSddDraft,
    beginNavigation,
    createThread,
    dismissActiveSddDraft,
    navigationIsCurrent,
    setConnectPhoneSidebarOpen,
    setRoute,
    worktreeBranch
  ])

  const startNewChatInWorkspace = useCallback(async (
    targetWorkspaceRoot: string,
    options?: { forceNew?: boolean }
  ): Promise<string | null> => {
    const requestId = beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('chat')
    const threadId = await createThread({
      workspaceRoot: targetWorkspaceRoot,
      forceNew: options?.forceNew,
      agentSurface: 'code',
      useWorktreePool,
      worktreeBranch,
      activationGuard: () => navigationIsCurrent(requestId)
    })
    if (useWorktreePool) setUseWorktreePool(false)
    return threadId
  }, [
    activeSddDraft,
    beginNavigation,
    createThread,
    dismissActiveSddDraft,
    navigationIsCurrent,
    setConnectPhoneSidebarOpen,
    setRoute,
    setUseWorktreePool,
    useWorktreePool,
    worktreeBranch
  ])

  return { startNewChat, startNewAdeChat, startNewAdeOneOnOne, startNewChatInWorkspace }
}
