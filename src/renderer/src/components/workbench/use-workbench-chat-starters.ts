/**
 * New-conversation starters shared by Code and ADE sidebars. Extracted from
 * useWorkbenchNavigationController so the creation variants (plain, manager
 * session, harness-pinned one-to-one, workspace-picked) live in one cohesive
 * hook. ADE starters open a local draft; Code starters guard async activation.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { harnessPermissionDefault } from '../../lib/harness-defaults'
import type { ChatState } from '../../store/chat-store-types'
import { readStoredComposerIsolation } from '../../store/chat-store-helpers'

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
    beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    const state = useChatStore.getState()
    state.startAdeDraft()
    state.setComposerHarness('kun', '')
    // A prior one-to-one harness model must not leak into the Kun manager.
    useChatStore.setState({ composerModel: '', composerProviderId: '', composerCollaborationEnabled: true })
    const isolation = readStoredComposerIsolation()
    state.setComposerIsolation(isolation, isolation === 'worktree' ? { kind: 'default-branch' } : undefined)
  }, [
    activeSddDraft,
    beginNavigation,
    dismissActiveSddDraft,
    setConnectPhoneSidebarOpen
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
    beginNavigation()
    if (activeSddDraft) dismissActiveSddDraft({ closeAssistant: true })
    setConnectPhoneSidebarOpen(false)
    const state = useChatStore.getState()
    state.startAdeDraft()
    state.setComposerHarness(input.harnessId, input.credentialMode ?? '')
    useChatStore.setState({
      composerModel: input.model?.trim() ?? '',
      composerProviderId: input.providerId?.trim() ?? '',
      composerIsolation: input.isolation ?? 'worktree',
      composerWorktreeStartFrom: input.isolation === 'local' ? undefined : { kind: 'default-branch' }
    })
    // P4-11: the harness's default permission level maps onto the composer
    // execution settings the new thread's first turn snapshots.
    if (input.permissionMode) {
      const execution = harnessPermissionDefault(definition, {
        permissionMode: input.permissionMode
      })
      if (execution) state.setComposerExecutionSettings(execution)
    }
  }, [
    activeSddDraft,
    beginNavigation,
    dismissActiveSddDraft,
    setConnectPhoneSidebarOpen
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
