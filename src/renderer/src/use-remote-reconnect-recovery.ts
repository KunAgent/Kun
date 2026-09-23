import { useEffect } from 'react'
import { useChatStore } from './store/chat-store'
import { resubscribeAllRemoteStreams } from './lib/remote-stream-resubscribers'

const QUIET_CHECK_THROTTLE_MS = 2_000
const RESUBSCRIBE_THROTTLE_MS = 2_000
/** A shorter absence is covered by the resumed activity observer. */
const QUIET_CHECK_MIN_HIDDEN_MS = 60_000

/**
 * Remote-web reconnect recovery, mounted once at the AppShell level.
 *
 * Quiet checks (`remote:stream-reconnected`, back online, or returning after a
 * long absence) only re-probe the runtime and refresh the thread inventory.
 * Streams that stayed registered on the hub keep flowing untouched — the hub
 * flushed its buffer on attach and any stream that lost frames got its own
 * terminal error, so no healthy subscription is interrupted.
 *
 * `remote:sender-reset` means every registration made through the previous
 * Remote sender is gone: resubscribe the active thread and every registered
 * remote stream subscriber. It has its own throttle — a reset arrives right
 * after the reconnect that triggered a quiet check and must never be swallowed
 * by it — and it is deferred until the runtime is ready instead of dropped.
 */
export function useRemoteReconnectRecovery(): void {
  useEffect(() => {
    const gui = window.kunGui
    if (!gui?.isRemoteWeb) return
    let lastQuietCheck = 0
    let lastResubscribe = 0
    let pendingReset = false
    let hiddenAt = document.visibilityState === 'visible' ? 0 : Date.now()

    const quietCheck = (): void => {
      const now = Date.now()
      if (now - lastQuietCheck < QUIET_CHECK_THROTTLE_MS) return
      lastQuietCheck = now
      const state = useChatStore.getState()
      if (state.runtimeConnection !== 'ready') {
        void state.probeRuntime('background')
        return
      }
      void state.refreshThreads()
    }

    const runResubscribe = (): void => {
      pendingReset = false
      lastResubscribe = Date.now()
      const state = useChatStore.getState()
      void state.refreshThreads()
      if (state.activeThreadId) {
        void state.recoverActiveTurn({ reason: 'remote_sender_reset' })
      }
      resubscribeAllRemoteStreams()
    }

    const resubscribeAll = (): void => {
      if (Date.now() - lastResubscribe < RESUBSCRIBE_THROTTLE_MS) return
      if (useChatStore.getState().runtimeConnection !== 'ready') {
        // Remember the reset; the store subscription below replays it on the
        // next transition to ready.
        pendingReset = true
        void useChatStore.getState().probeRuntime('background')
        return
      }
      runResubscribe()
    }

    const offStore = useChatStore.subscribe((state, previous) => {
      if (!pendingReset) return
      if (state.runtimeConnection === 'ready' && previous.runtimeConnection !== 'ready') {
        runResubscribe()
      }
    })

    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') {
        hiddenAt = Date.now()
        return
      }
      const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0
      hiddenAt = 0
      if (hiddenFor >= QUIET_CHECK_MIN_HIDDEN_MS) quietCheck()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', quietCheck)
    const offReconnect = typeof gui.onRemoteStreamReconnected === 'function'
      ? gui.onRemoteStreamReconnected(quietCheck)
      : () => undefined
    const offSenderReset = typeof gui.onRemoteSenderReset === 'function'
      ? gui.onRemoteSenderReset(resubscribeAll)
      : () => undefined
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', quietCheck)
      offReconnect()
      offSenderReset()
      offStore()
    }
  }, [])
}
