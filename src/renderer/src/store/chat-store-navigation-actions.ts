import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createNavigationModeActions } from './chat-store-navigation-mode-actions'
import { createNavigationRuntimeActions } from './chat-store-navigation-runtime-actions'
import { createNavigationWorkspaceActions } from './chat-store-navigation-workspace-actions'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}
export function createNavigationActions(
  context: StoreActionContext
): Pick<ChatState, 'openCode' | 'openDesign' | 'clearActiveThreadSelection' | 'openWrite' | 'ensureWriteThreadForWorkspace' | 'createWriteThread' | 'selectWriteThread' | 'ensureDesignThreadForWorkspace' | 'createDesignThread' | 'probeRuntime' | 'boot' | 'chooseWorkspace' | 'selectWorkspaceRoot' | 'clearWorkspace' | 'removeWorkspace' | 'refreshThreads' | 'loadMoreThreads' | 'setThreadSearch' | 'setShowArchivedThreads'> {
  return {
    ...createNavigationModeActions(context),
    ...createNavigationRuntimeActions(context),
    ...createNavigationWorkspaceActions(context)
  }
}
