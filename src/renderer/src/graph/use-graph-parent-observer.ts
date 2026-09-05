import { useEffect } from 'react'
import { getProvider } from '../agent/registry'
import type { ThreadEventSink } from '../agent/types'
import {
  receiveGraphChildRuntimeEvent,
  receiveGraphRuntimeEvent,
  useGraphStore
} from './graph-store'

function waitForReconnect(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const id = globalThis.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      globalThis.clearTimeout(id)
      resolve()
    }, { once: true })
  })
}

function graphObserverSink(
  onConnected: () => void,
  onSeq: (seq: number) => void,
  onConnectionError: (error?: Error) => void
): ThreadEventSink {
  return {
    onConnected,
    onSeq,
    onDeltas: () => undefined,
    onUserMessage: () => undefined,
    onTool: () => undefined,
    onCompaction: () => undefined,
    onApproval: () => undefined,
    onUserInput: () => undefined,
    onUserInputStatus: () => undefined,
    onGoal: () => undefined,
    onTurnComplete: () => undefined,
    onError: onConnectionError,
    onChildRuntimeEvent: receiveGraphChildRuntimeEvent,
    onGraphEvent: receiveGraphRuntimeEvent
  }
}

/**
 * Observes only Graph envelopes and safe child activity while a child transcript
 * is foregrounded. The active child keeps its normal subscription; this second
 * bounded observer shares the same Kun Server and never projects parent text.
 */
export function useGraphParentObserver(activeThreadId: string | null): void {
  const observerKey = useGraphStore((state) => state.childReturnTarget?.openedAt ?? null)

  useEffect(() => {
    const initial = useGraphStore.getState().childReturnTarget
    if (
      !initial ||
      !observerKey ||
      activeThreadId !== initial.childThreadId
    ) return

    const controller = new AbortController()
    let reconnectAttempt = 0
    let replayResetFloor: number | undefined
    const sink = graphObserverSink(
      () => {
        reconnectAttempt = 0
        useGraphStore.getState().updateChildObserver('live')
      },
      (seq) => {
        reconnectAttempt = 0
        useGraphStore.getState().updateChildObserver('live', seq)
      },
      (error?: Error) => {
        const reset = error as (Error & { code?: unknown; floorSeq?: unknown }) | undefined
        if (reset?.code === 'replay_reset_required' && typeof reset.floorSeq === 'number') {
          replayResetFloor = reset.floorSeq
        }
        useGraphStore.getState().updateChildObserver('reconnecting')
      }
    )

    const observe = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        const target = useGraphStore.getState().childReturnTarget
        if (!target || target.openedAt !== observerKey) return
        useGraphStore.getState().updateChildObserver(
          reconnectAttempt === 0 ? 'connecting' : 'reconnecting'
        )
        try {
          await getProvider().subscribeThreadEvents(
            target.parentThreadId,
            target.parentEventSeq,
            sink,
            controller.signal
          )
        } catch {
          if (controller.signal.aborted) return
        }
        if (controller.signal.aborted) return
        if (replayResetFloor !== undefined) {
          replayResetFloor = undefined
          try {
            const detail = await getProvider().getThreadDetail(target.parentThreadId)
            useGraphStore.getState().updateChildObserver('reconnecting', detail.latestSeq)
            reconnectAttempt = 0
            continue
          } catch {
            if (controller.signal.aborted) return
          }
        }
        reconnectAttempt += 1
        useGraphStore.getState().updateChildObserver('reconnecting')
        const delay = Math.min(5_000, 1_000 * (2 ** Math.min(2, reconnectAttempt - 1)))
        await waitForReconnect(delay, controller.signal)
      }
    }

    void observe()
    return () => {
      controller.abort()
      const target = useGraphStore.getState().childReturnTarget
      if (target?.openedAt === observerKey) {
        useGraphStore.getState().updateChildObserver('stopped')
      }
    }
  }, [activeThreadId, observerKey])
}
