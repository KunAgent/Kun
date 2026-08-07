import { useEffect } from 'react'
import { getProvider } from '../agent/registry'
import {
  receiveGraphChildRuntimeEvent,
  receiveGraphPlanningRuntimeEvent,
  receiveGraphRuntimeEvent,
  useGraphStore
} from './graph-store'
import {
  startGraphThreadObserver,
  type GraphThreadSyncStatus
} from './graph-thread-observer'

/**
 * Owns Graph projection SSE for the Graph panel itself (not child-transcript
 * foregrounding). Independent of chat busy: Lead can finish while Graph runs
 * continue and this observer keeps projecting runtime state.
 *
 * Thread ownership is established only through `bindGraphThread` (atomic). This
 * hook never patches `threadId` alone, so React effect order cannot leave a
 * stale SSE cursor bound to a new thread.
 */
export function useGraphThreadObserver(
  threadId: string | null,
  active: boolean
): void {
  useEffect(() => {
    if (!active || !threadId) {
      const state = useGraphStore.getState()
      // Hide/reopen the same thread: keep projection + cursor; only mark idle.
      if (threadId && state.threadId === threadId) {
        state.setSyncStatus('idle', threadId)
      } else if (!threadId && state.syncStatus !== 'idle') {
        state.setSyncStatus('idle')
      }
      return
    }

    // Atomic: different thread clears projection + zeros threadEventSeq.
    useGraphStore.getState().bindGraphThread(threadId)
    const ownedThreadId = threadId

    const observer = startGraphThreadObserver({
      threadId: ownedThreadId,
      getSinceSeq: () => {
        const current = useGraphStore.getState()
        return current.threadId === ownedThreadId ? current.threadEventSeq : 0
      },
      onSeq: (seq) => {
        useGraphStore.getState().advanceThreadEventSeq(seq, ownedThreadId)
      },
      onStatus: (status: GraphThreadSyncStatus) => {
        useGraphStore.getState().setSyncStatus(status, ownedThreadId)
      },
      onGraphEvent: (event) => {
        if (useGraphStore.getState().threadId !== ownedThreadId) return
        receiveGraphRuntimeEvent(event)
      },
      onChildRuntimeEvent: (event) => {
        if (useGraphStore.getState().threadId !== ownedThreadId) return
        receiveGraphChildRuntimeEvent(event)
      },
      onGraphPlanningEvent: (event) => {
        if (useGraphStore.getState().threadId !== ownedThreadId) return
        receiveGraphPlanningRuntimeEvent(event)
      },
      subscribe: (id, sinceSeq, sink, signal) =>
        getProvider().subscribeThreadEvents(id, sinceSeq, sink, signal),
      shouldReconnect: () => useGraphStore.getState().threadId === ownedThreadId
    })

    return () => {
      observer.stop()
      const current = useGraphStore.getState()
      // Do not force 'stopped' over a newer thread's status after a switch.
      if (current.threadId === ownedThreadId) {
        current.setSyncStatus('stopped', ownedThreadId)
      }
    }
  }, [active, threadId])
}
