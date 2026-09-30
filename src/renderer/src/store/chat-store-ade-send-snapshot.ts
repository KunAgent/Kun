import type { TaskWorkspaceStartFrom } from '@shared/task-workspace'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { workspaceDirectoryExists, workspaceMissingError } from '../lib/workspace-availability'
import type { ChatState } from './chat-store-types'
import type { PreSendSnapshot, StoreActionContext } from './chat-store-thread-actions-support'

export type AdeDraftSendSnapshot = {
  workspaceRoot: string
  draftOpen: boolean
  draftRevision: number
  isolation: 'local' | 'worktree'
  startFrom?: TaskWorkspaceStartFrom
  composer: Pick<ChatState,
    'composerModel' | 'composerProviderId' | 'composerModelGroups' |
    'composerHarnessId' | 'composerCredentialMode' | 'composerExecutionSettings'>
}

/** Capture the draft's project and worktree choice before send-side awaits. */
export function captureAdeDraftSendSnapshot(state: ChatState): AdeDraftSendSnapshot | undefined {
  if (state.route !== 'ade' || state.activeThreadId || !state.adeDraftOpen) return undefined
  return {
    workspaceRoot: normalizeWorkspaceRoot(state.workspaceRoot),
    draftOpen: state.adeDraftOpen,
    draftRevision: state.adeDraftRevision,
    isolation: state.composerIsolation,
    startFrom: state.composerWorktreeStartFrom ??
      (state.composerIsolation === 'worktree' ? { kind: 'default-branch' } : undefined),
    composer: {
      composerModel: state.composerModel,
      composerProviderId: state.composerProviderId,
      composerModelGroups: state.composerModelGroups,
      composerHarnessId: state.composerHarnessId,
      composerCredentialMode: state.composerCredentialMode,
      composerExecutionSettings: state.composerExecutionSettings
    }
  }
}

export function adeDraftStillCurrent(state: ChatState, snapshot: AdeDraftSendSnapshot): boolean {
  return state.route === 'ade' && !state.activeThreadId &&
    state.adeDraftOpen === snapshot.draftOpen &&
    state.adeDraftRevision === snapshot.draftRevision &&
    normalizeWorkspaceRoot(state.workspaceRoot) === snapshot.workspaceRoot
}

/** A navigation may have replaced the projection while thread creation was in flight. */
export function cancelStaleAdeDraftSend(
  context: StoreActionContext,
  previous: PreSendSnapshot,
  userBlockId: string,
  persistActiveQueuedMessages: () => void
): false {
  context.set((state) => state.currentTurnUserId === userBlockId ? {
    blocks: state.blocks.filter((block) => block.id !== userBlockId),
    busy: false,
    busyUnconfirmed: false,
    currentTurnUserId: previous.currentTurnUserId,
    currentTurnOrchestration: previous.currentTurnOrchestration,
    queuedMessages: state.activeThreadId === previous.activeThreadId
      ? previous.queuedMessages : state.queuedMessages
  } : {})
  persistActiveQueuedMessages()
  return false
}

/** Recheck the frozen project before the first worktree thread is created. */
export async function validateAdeDraftWorkspace(
  workspaceRoot: string,
  snapshot: AdeDraftSendSnapshot,
  canCreateTaskWorkspace: boolean,
  stillCurrent: () => boolean
): Promise<boolean> {
  const exists = await workspaceDirectoryExists(workspaceRoot)
  if (!stillCurrent()) return false
  if (!exists) throw new Error(workspaceMissingError())
  if (snapshot.isolation !== 'worktree') return stillCurrent()
  if (!canCreateTaskWorkspace) throw new Error('Worktree creation is unavailable.')
  if (typeof window.kunGui?.getGitBranches !== 'function') {
    throw new Error('Git branch verification is unavailable.')
  }
  const result = await window.kunGui.getGitBranches(workspaceRoot)
  if (!result.ok) throw new Error(result.message)
  const startFrom = snapshot.startFrom
  if (startFrom?.kind === 'branch' &&
    !result.branches.some((branch) => branch.name === startFrom.name)) {
    throw new Error(`Git branch is no longer available: ${startFrom.name}`)
  }
  return stillCurrent()
}
