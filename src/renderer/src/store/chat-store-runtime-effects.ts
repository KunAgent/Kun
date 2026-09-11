import type { AgentProvider } from '../agent/provider-types'
import type { ChatProjectionEffect } from './chat-projection-effects'
import type { ChatState } from './chat-store-types'
import type { StorePatch } from './chat-store-batch'
import { reconcileCompletedTurnFromThreadDetail } from './chat-store-runtime-reconcile'
import { notifySddChatTranscriptMirror } from '../sdd/sdd-chat-transcript'
import { notifyDesignChatTranscriptMirror } from '../design/design-chat-transcript'
import { notifyTurnComplete } from './chat-store-runtime-notifications'
import {
  notifyWriteWorkspaceFileRefresh,
  releaseThreadWorktreeIfNeeded
} from './chat-store-runtime-projection-support'

type EffectStoreAccess = {
  set: (patch: StorePatch<ChatState>) => void
  get: () => ChatState
}

type RuntimeEffectDeps = EffectStoreAccess & {
  armBusyWatchdog: (set: EffectStoreAccess['set'], get: EffectStoreAccess['get']) => void
  syncTurnCompletionPoll: (set: EffectStoreAccess['set'], get: EffectStoreAccess['get']) => void
  loadThreadDetail: AgentProvider['getThreadDetail']
}

/** Side-effect runner for projection effects emitted by a ThreadEventSink. */
export function createChatRuntimeEffectRunner(
  deps: RuntimeEffectDeps
): (effects: readonly ChatProjectionEffect[]) => void {
  const { set, get } = deps
  return (effects) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'arm_stream_watchdog':
          deps.armBusyWatchdog(set, get)
          break
        case 'refresh_write_workspace':
          notifyWriteWorkspaceFileRefresh(get, effect.event)
          break
        case 'mirror_claw_reply':
          if (typeof window.kunGui?.mirrorClawChannelMessage === 'function') {
            void window.kunGui.mirrorClawChannelMessage(effect.threadId, effect.text, 'assistant')
              .catch(() => undefined)
          }
          break
        case 'notify_turn_complete':
          notifyTurnComplete(effect.threadId, effect.state, effect.dedupeKey, undefined, effect.turnId)
          break
        case 'mirror_sdd_transcript':
          notifySddChatTranscriptMirror(get)
          break
        case 'mirror_design_transcript':
          notifyDesignChatTranscriptMirror(get)
          break
        case 'sync_completion_poll':
          deps.syncTurnCompletionPoll(set, get)
          break
        case 'reload_completed_turn':
          void reconcileCompletedTurnFromThreadDetail({
            threadId: effect.threadId,
            turnId: effect.turnId,
            userBlockId: effect.userBlockId,
            loadThreadDetail: deps.loadThreadDetail,
            set,
            get
          })
          break
        case 'refresh_threads':
          void get().refreshThreads?.()
          break
        case 'release_worktree':
          releaseThreadWorktreeIfNeeded(effect.threadId)
          break
        case 'drain_queued_messages':
          void get().drainQueuedMessages?.()
          break
      }
    }
  }
}
