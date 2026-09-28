/**
 * New-conversation starters shared by Code and ADE sidebars. Extracted from
 * useWorkbenchNavigationController so the creation variants (plain, manager
 * session, harness-pinned one-to-one, workspace-picked) live in one cohesive
 * hook; every starter still guards activation with the navigation request id.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { harnessPermissionDefault } from '../../lib/harness-defaults'
import { requestOpenWorkersPanel } from '../chat/FloatingComposerWorkersPill'
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
    // P4-16: a fresh manager session opens with the Workers panel so the
    // dispatched-agent view is visible from the first turn.
    requestOpenWorkersPanel()
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
    providerId?: string
    model?: string
    isolation?: 'local' | 'worktree'
    permissionMode?: string
  }): void => {
    const definition = useHarnessStore.getState().rows
      .find((row) => row.definition.id === input.harnessId)?.definition
    // P4-13: terminal-only agents cannot host turns; the menu lists are
    // filtered, so this guards stale persisted picks like defaultHarnessId.
    if (definition && definition.transport === 'terminal') return
    const requestId = beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    setRoute('ade')
    // P4-11: the harness's default permission level maps onto the composer
    // execution settings the new thread's first turn snapshots.
    if (input.permissionMode) {
      const execution = harnessPermissionDefault(definition, {
        permissionMode: input.permissionMode
      })
      if (execution) useChatStore.getState().setComposerExecutionSettings(execution)
    }
    // 00 §5: a one-to-one thread isolates into a fresh worktree by default;
    // the thread is pinned to the picked harness from creation. P4-11: a
    // configured `isolation: 'local'` default opts out of the worktree.
    void createThread({
      useWorktreePool: input.isolation !== 'local',
      worktreeBranch,
      agentSurface: 'code',
      workspaceMode: 'ade',
      harnessId: input.harnessId,
      credentialMode: input.credentialMode,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
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
