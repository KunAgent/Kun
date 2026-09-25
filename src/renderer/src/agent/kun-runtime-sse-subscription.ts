import type { SseErrorCode } from '@shared/kun-gui-sse-contracts'
import type { CoreRuntimeEventJson } from './kun-contract'
import { dispatchKunRuntimeEvents } from './kun-mapper'
import { registerRemoteStreamResubscriber } from '../lib/remote-stream-resubscribers'
import { rendererRuntimeClient } from './runtime-client'
import type { ThreadEventSink } from './types'

const MAX_PENDING_SSE_DISPATCH_BATCHES = 32

/** Preserves the native SSE failure status for the store's recovery policy. */
/** Readable text for terminal frames that carry no runtime message. */
export function sseErrorFallbackMessage(code: SseErrorCode | undefined, status: number | undefined): string {
  if (code === 'remote_client_expired' || code === 'remote_buffer_overflow' || code === 'renderer_ack_timeout') {
    return 'Live updates were interrupted; reconnecting.'
  }
  return status ? `Live updates disconnected (HTTP ${status}).` : 'Live updates disconnected.'
}

export class KunSseSubscriptionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: SseErrorCode,
    readonly threadId?: string,
    readonly floorSeq?: number
  ) {
    super(message)
    this.name = 'KunSseSubscriptionError'
  }
}

function createSseStreamId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sse-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function subscribeKunThreadEvents(
  threadId: string,
  sinceSeq: number,
  sink: ThreadEventSink,
  signal: AbortSignal
): Promise<void> {
  const streamId = createSseStreamId()
  await new Promise<void>(async (resolve) => {
    let settled = false
    let dispatchTail: Promise<void> = Promise.resolve()
    let queuedDispatchBatches = 0
    // The subscription cursor is also the projection high-water mark.  A
    // reconnect may replay already persisted non-delta events (tool running,
    // completion, approval, Graph activity, ...), so filter the whole wire
    // event before normalization.  This keeps reducer work and side effects
    // behind the same monotonic gate instead of deduplicating text only.
    let projectionSeqHighWater = sinceSeq
    let replaySynchronized = false
    const finish = (): void => {
      if (settled) return
      settled = true
      offData()
      offEnd()
      offErr()
      offOpen()
      signal.removeEventListener('abort', onAbort)
      offSenderReset()
      void dispatchTail.finally(() => resolve())
    }
    // A Remote sender reset drops this registration on the host without any
    // terminal frame. Synthesize the transport terminal locally so every
    // consumer (active thread, side threads, Graph observers) runs its own
    // reconnect path instead of waiting on a dead stream forever.
    const offSenderReset = registerRemoteStreamResubscriber(() => {
      if (settled || signal.aborted) return
      sink.onError(new KunSseSubscriptionError(
        sseErrorFallbackMessage('remote_client_expired', undefined),
        undefined,
        'remote_client_expired',
        threadId
      ))
      void rendererRuntimeClient.stopSse(streamId)
      finish()
    })
    const offData = rendererRuntimeClient.onSseEvent((payload) => {
      if (payload.streamId !== streamId) return
      // Older main processes (pre-batching) deliver a single event under
      // `data`; accept both shapes so a stale main/renderer pair during a
      // dev reload or partial update degrades gracefully instead of
      // silently dropping the stream.
      const legacySingle = (payload as { data?: unknown }).data
      const rawEvents = Array.isArray(payload.events)
        ? payload.events
        : legacySingle !== undefined
          ? [legacySingle]
          : []
      const batch = rawEvents.map((entry): CoreRuntimeEventJson =>
        entry && typeof entry === 'object' ? (entry as CoreRuntimeEventJson) : {}
      )
      if (batch.length === 0) return
      if (queuedDispatchBatches >= MAX_PENDING_SSE_DISPATCH_BATCHES) {
        sink.onError(new Error('SSE renderer dispatch backlog exceeded its safety limit'))
        void rendererRuntimeClient.stopSse(streamId)
        finish()
        return
      }
      // Keep batches strictly ordered. The main process reads no further SSE
      // data until this batch is acknowledged, so dispatch must not fan out
      // into an unbounded renderer-side promise set.
      queuedDispatchBatches += 1
      const task = dispatchTail.then(async () => {
        if (signal.aborted || settled) return
        let acceptedSegment: CoreRuntimeEventJson[] = []
        let acceptedMaxSeq: number | null = null
        let heartbeatSeq: number | null = null
        let synchronizedSeq: number | null = null
        let candidateSeqHighWater = projectionSeqHighWater
        const flushAcceptedSegment = async (): Promise<void> => {
          if (acceptedSegment.length === 0) return
          const segment = acceptedSegment
          acceptedSegment = []
          await dispatchKunRuntimeEvents(segment, sink, (runtimeEvent, eventSink) =>
            handleKunApprovalRequest(runtimeEvent, eventSink)
          )
        }
        for (const event of batch) {
          if (event.kind === 'replay_synchronized') {
            const cursor = event.cursor
            if (
              replaySynchronized ||
              event.threadId !== threadId ||
              typeof cursor !== 'number' ||
              !Number.isSafeInteger(cursor) ||
              cursor < 0
            ) {
              continue
            }
            // The marker is an ordering barrier, not a projected runtime
            // event. Apply every replay event before revealing the thread,
            // then process any live events that followed it in this batch.
            await flushAcceptedSegment()
            if (signal.aborted || settled) return
            candidateSeqHighWater = Math.max(candidateSeqHighWater, cursor)
            sink.onSeq(cursor)
            sink.onReplaySynchronized?.(cursor)
            synchronizedSeq = cursor
            replaySynchronized = true
            continue
          }
          if (typeof event.seq === 'number') {
            if (event.seq <= candidateSeqHighWater) {
              // Heartbeats deliberately reuse the current event cursor. They
              // are stale for projection purposes, but still prove that the
              // live stream is healthy and must keep the busy watchdog from
              // aborting a quiet, long-running tool call.
              if (event.kind === 'heartbeat') {
                heartbeatSeq = Math.max(heartbeatSeq ?? event.seq, event.seq)
              }
              continue
            }
            candidateSeqHighWater = event.seq
            acceptedMaxSeq = event.seq
          }
          acceptedSegment.push(event)
        }
        await flushAcceptedSegment()
        if (signal.aborted || settled) return
        // Commit the local replay gate only after every accepted event was
        // projected. If a reducer/effect throws, the unadvanced cursor lets
        // recovery replay the whole unacknowledged batch.
        projectionSeqHighWater = candidateSeqHighWater
        // Commit the renderer cursor only after the whole ordered batch has
        // been projected. ACK is flow control for the main process and must
        // never precede the renderer's durable in-memory projection.
        const observedSeq = acceptedMaxSeq ?? heartbeatSeq
        if (observedSeq !== null && (synchronizedSeq === null || observedSeq > synchronizedSeq)) {
          sink.onSeq(observedSeq)
        }
        if (signal.aborted || settled) return
        if (payload.batchId) {
          await rendererRuntimeClient.ackSse(streamId, payload.batchId)
        }
      }).catch((error) => {
        if (!settled) {
          sink.onError(error instanceof Error ? error : new Error(String(error)))
          void rendererRuntimeClient.stopSse(streamId)
          finish()
        }
      })
      dispatchTail = task
      void task.finally(() => {
        queuedDispatchBatches = Math.max(0, queuedDispatchBatches - 1)
      })
    })
    const offErr = rendererRuntimeClient.onSseError(({
      streamId: sid,
      message,
      status,
      code,
      threadId: resetThreadId,
      floorSeq
    }) => {
      if (sid !== streamId) return
      sink.onError(new KunSseSubscriptionError(
        message ?? sseErrorFallbackMessage(code, status),
        status,
        code,
        resetThreadId,
        floorSeq
      ))
      finish()
    })
    const offEnd = rendererRuntimeClient.onSseEnd(({ streamId: sid }) => {
      if (sid !== streamId) return
      finish()
    })
    const offOpen = rendererRuntimeClient.onSseOpen(({ streamId: sid }) => {
      if (sid !== streamId || settled || signal.aborted) return
      sink.onConnected?.()
    })
    const onAbort = (): void => {
      void rendererRuntimeClient.stopSse(streamId)
      finish()
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await rendererRuntimeClient.startSse(threadId, sinceSeq, streamId, { acknowledgedBatches: true })
    } catch (error) {
      sink.onError(error instanceof Error ? error : new Error(String(error)))
      finish()
    }
  })
  void rendererRuntimeClient.stopSse(streamId)
}

async function handleKunApprovalRequest(event: CoreRuntimeEventJson, sink: ThreadEventSink): Promise<void> {
  const approvalId = event.approvalId ?? event.itemId ?? ''
  if (!approvalId) return
  // Automatic review is owned by Kun and is deliberately not resolvable
  // through the user approval surface. Missing reviewer identity is legacy
  // manual review; never infer it from mutable global settings because the
  // emitting thread owns an immutable authority snapshot.
  if (event.approvalReviewer === 'agent') return
  sink.onApproval({
    approvalId,
    turnId: event.turnId,
    createdAt: event.timestamp,
    summary: event.summary ?? 'Approval required',
    toolName: event.toolName,
    ...(event.child ? { meta: { child: event.child } } : {})
  })
}
