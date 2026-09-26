/** One IPC message carries every SSE event parsed from a network chunk. */
export type SseEventPayload = { streamId: string; events: unknown[]; batchId?: string }

export type SseOpenPayload = { streamId: string }

export type SseEndPayload = { streamId: string }

export type SseErrorCode =
  | 'replay_reset_required'
  | 'renderer_ack_timeout'
  | 'remote_client_expired'
  | 'remote_buffer_overflow'

export type SseErrorPayload = {
  /** Every terminal frame names the stream it tears down, including
   * remote-side overflow/expiry errors which are always per-stream. */
  streamId: string
  status?: number
  message?: string
  code?: SseErrorCode
  threadId?: string
  floorSeq?: number
  batchId?: string
}

export type SseStartOptions = {
  acknowledgedBatches?: boolean
  scope?: 'rooms' | 'room-run'
  roomId?: string
  runId?: string
  cursor?: string
}

/**
 * The SSE subscription slice of the GUI bridge. Kept here so the 700-line
 * `KunGuiApi` surface stays under the file-line gate while the transport
 * contracts and their surface signature live beside each other.
 */
export interface KunGuiSseSurface {
  startSse: (
    threadId: string,
    sinceSeq: number,
    streamId?: string,
    options?: SseStartOptions
  ) => Promise<{ streamId: string }>
  stopSse: (streamId: string) => Promise<boolean>
  ackSse: (streamId: string, batchId: string) => Promise<boolean>
  onSseOpen: (handler: (payload: SseOpenPayload) => void) => () => void
  onSseEvent: (handler: (payload: SseEventPayload) => void) => () => void
  onSseEnd: (handler: (payload: SseEndPayload) => void) => () => void
  onSseError: (handler: (payload: SseErrorPayload) => void) => () => void
  /**
   * Remote-web only: fires when the browser's EventSource re-opens after a
   * drop, so the renderer can reconcile thread inventory and resubscribe any
   * stream whose terminal frame was lost. Absent in the Electron preload.
   */
  onRemoteStreamReconnected?: (handler: () => void) => () => void
  /**
   * Remote-web only: the remote event hub recreated (or forgot) this client's
   * sender, so every stream registered through it is gone. The renderer must
   * resubscribe all active streams. Absent in the Electron preload.
   */
  onRemoteSenderReset?: (handler: () => void) => () => void
}
