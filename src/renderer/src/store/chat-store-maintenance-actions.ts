import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createMaintenanceMetadataActions } from './chat-store-maintenance-metadata-actions'
import { createMaintenanceSessionActions } from './chat-store-maintenance-session-actions'
import { createMaintenanceRecoveryActions } from './chat-store-maintenance-recovery-actions'
import { createMaintenanceInteractionActions } from './chat-store-maintenance-interaction-actions'
import type { MaintenanceActionDependencies } from './chat-store-maintenance-metadata-actions'

export type { MaintenanceActionDependencies } from './chat-store-maintenance-metadata-actions'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}
export function createMaintenanceActions(
  context: StoreActionContext,
  dependencies: MaintenanceActionDependencies = {}
): Pick<ChatState, 'renameActiveThread' | 'renameThread' | 'pinThread' | 'archiveThread' | 'compactActiveThread' | 'archiveActiveThreadToTurn' | 'forkActiveThread' | 'forkThreadFromTurn' | 'setActiveThreadGoal' | 'setActiveThreadGoalStatus' | 'clearActiveThreadGoal' | 'setActiveThreadTodoStatus' | 'clearActiveThreadTodos' | 'syncPlanTodosFromMarkdown' | 'resumeSessionIntoThread' | 'clearDesignHistory' | 'deleteThread' | 'rewindAndResend' | 'rollbackWorkspaceToCheckpoint' | 'resolveApproval' | 'resolveUserInput' | 'interrupt' | 'cancelToolCall'> {
  return {
    ...createMaintenanceMetadataActions(context, dependencies),
    ...createMaintenanceSessionActions(context, dependencies),
    ...createMaintenanceRecoveryActions(context, dependencies),
    ...createMaintenanceInteractionActions(context, dependencies)
  }
}
