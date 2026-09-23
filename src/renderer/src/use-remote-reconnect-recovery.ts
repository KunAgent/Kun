import { useEffect } from 'react'
import { useChatStore } from './store/chat-store'
import { resubscribeAllRemoteStreams } from './lib/remote-stream-resubscribers'

const RECOVER_THROTTLE_MS = 2_000

/**
 * Remote-web reconnect recovery, mounted once at the AppShell level.
 *
 * Quiet checks (page visible, back online, `remote:stream-reconnected`) only
 * re-probe the runtime and refresh the thread inventory. Streams that stayed
 * registered on the hub keep flowing untouched — the hub flushed its buffer on
 * attach and any stream that lost frames got its own terminal error, so no
 * healthy subscription is interrupted and no recovery UI flashes.
 *
 * `remote:sender-reset` means every registration made through the previous
 * Remote sender is gone: resubscribe the active thread (preemptive — a stale
 * catching-up entry must not keep it waiting) and every registered remote
 * stream subscriber such as the rooms feed.
 */
export function useRemoteReconnectRecovery(): void {
  useEffect(() => {
    const gui = window.kunGui
    if (!gui?.isRemoteWeb) return
    let lastRecover = 0
    const quietCheck = (): void => {
      const now = Date.now()
      if (now - lastRecover < RECOVER_THROTTLE_MS) return
      lastRecover = now
      const state = useChatStore.getState()
      if (state.runtimeConnection !== 'ready') {
        void state.probeRuntime('background')
        return
      }
      void state.refreshThreads()
    }
    const resubscribeAll = (): void => {
      const now = Date.now()
      if (now - lastRecover < RECOVER_THROTTLE_MS) return
      lastRecover = now
      const state = useChatStore.getState()
      if (state.runtimeConnection !== 'ready') {
        void state.probeRuntime('background')
        return
      }
      void state.refreshThreads()
      if (state.activeThreadId) {
        void state.recoverActiveTurn({ reason: 'remote_sender_reset' })
      }
      resubscribeAllRemoteStreams()
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') quietCheck()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', quietCheck)
    const offReconnect = typeof gui.onRemoteStreamReconnected === 'function'
      ? gui.onRemoteStreamReconnected(quietCheck)
      : () => undefined
    const offSenderReset = typeof gui.onRemoteSenderReset === 'function'
      ? gui.onRemoteSenderReset(resubscribeAll)
      : () => undefined
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', quietCheck)
      offReconnect()
      offSenderReset()
    }
  }, [])
}
