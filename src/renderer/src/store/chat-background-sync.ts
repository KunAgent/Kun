import { getProvider } from '../agent/registry'
import { useCodexReferenceState } from '../history-reference/codex-reference-state'
import { useChatStore } from './chat-store'
import { createBackgroundThreadSync } from './thread-background-sync'
import { hasForegroundThreadRecovery } from './thread-recovery-coordinator'

/** App-lifetime data ownership; mounting a conversation is not required. */
export function startBackgroundThreadSync(): () => void {
  return createBackgroundThreadSync({
    getState: useChatStore.getState,
    subscribe: (changed) => {
      const offStore = useChatStore.subscribe((state, previous) => {
        if (state.activeThreadId !== previous.activeThreadId || state.threads !== previous.threads ||
          state.adeThreads !== previous.adeThreads || state.runtimeConnection !== previous.runtimeConnection) changed()
      })
      const offHistory = useCodexReferenceState.subscribe((state, previous) => {
        if (state.revision !== previous.revision) changed()
      })
      return () => { offStore(); offHistory() }
    },
    getProvider,
    canRequest: () => !hasForegroundThreadRecovery()
  })
}
