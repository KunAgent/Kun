import { useChatStore } from '../store/chat-store'
import { useTaskWorkspaceStore } from '../store/task-workspace-store'

/** Reserve the plan path only after the task's one isolated workspace is bound. */
export async function prepareAutomaticWorkspace(workspaceRoot: string): Promise<{
  threadId: string
  workspaceRoot: string
}> {
  const state = useChatStore.getState()
  if (state.activeThreadId || state.composerIsolation !== 'worktree') {
    return { threadId: state.activeThreadId ?? '', workspaceRoot }
  }
  const start = state.composerWorktreeStartFrom
  const threadId = await state.createThread({
    workspaceRoot, forceNew: true, useWorktreePool: true,
    ...(start?.kind === 'branch' ? { worktreeBranch: start.name } : {}),
    model: state.composerModel, providerId: state.composerProviderId,
    harnessId: state.composerHarnessId,
    ...(state.composerCredentialMode ? { credentialMode: state.composerCredentialMode as 'native-login' | 'provider' | 'kun-gateway' } : {})
  })
  if (!threadId) throw new Error(useChatStore.getState().error || 'Could not prepare the task workspace.')
  return new Promise((resolve, reject) => {
    let stopChat = (): void => {}
    let stopPrep = (): void => {}
    const timer = setTimeout(() => finish(new Error('Workspace preparation is still pending. Retry when it is ready.')), 30_000)
    const finish = (error?: Error, path?: string): void => {
      clearTimeout(timer)
      stopChat()
      stopPrep()
      if (error) reject(error)
      else resolve({ threadId, workspaceRoot: path! })
    }
    const check = (): void => {
      const current = useChatStore.getState()
      if (current.activeThreadId !== threadId) return finish(new Error('The active task changed while preparing its workspace.'))
      const prep = useTaskWorkspaceStore.getState().prepByThread[threadId]
      if (prep?.state === 'failed') return finish(new Error(prep.error || 'Workspace preparation failed.'))
      const thread = current.threads.find((item) => item.id === threadId)
      if (thread?.taskWorkspaceId && thread.workspace) finish(undefined, thread.workspace)
    }
    stopChat = useChatStore.subscribe(check)
    stopPrep = useTaskWorkspaceStore.subscribe(check)
    check()
  })
}
