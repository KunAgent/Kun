/** One IPC message carries every SSE event parsed from a network chunk. */
export type SseEventPayload = { streamId: string; events: unknown[]; batchId?: string }

export type SseOpenPayload = { streamId: string }

export type SseEndPayload = { streamId: string }

export type SseErrorCode = 'replay_reset_required' | 'renderer_ack_timeout'

export type SseErrorPayload = {
  streamId: string
  status?: number
  message?: string
  code?: SseErrorCode
  threadId?: string
  floorSeq?: number
  batchId?: string
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
    options?: { acknowledgedBatches?: boolean }
  ) => Promise<{ streamId: string }>
  stopSse: (streamId: string) => Promise<boolean>
  ackSse: (streamId: string, batchId: string) => Promise<boolean>
  onSseOpen: (handler: (payload: SseOpenPayload) => void) => () => void
  onSseEvent: (handler: (payload: SseEventPayload) => void) => () => void
  onSseEnd: (handler: (payload: SseEndPayload) => void) => () => void
  onSseError: (handler: (payload: SseErrorPayload) => void) => () => void
}
