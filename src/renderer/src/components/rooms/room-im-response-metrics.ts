import type { RoomMessage } from '@shared/rooms-api'

const MAX_SAMPLES = 128
const pending = new Map<string, { roomId: string; committedAt: number }>()
const samples: Array<{ roomId: string; messageId: string; phase: string; commitToRenderMs: number }> = []

/** Selected-room SSE event starts a bounded commit-to-render observation. */
export function noteRoomMessageCommitted(event: {
  roomId: string; kind: string; createdAt?: string; payload?: { id?: string }
}): void {
  if (event.kind !== 'message.created' || !event.payload?.id || !event.createdAt) return
  const committedAt = Date.parse(event.createdAt)
  if (!Number.isFinite(committedAt)) return
  pending.delete(event.payload.id)
  pending.set(event.payload.id, { roomId: event.roomId, committedAt })
  while (pending.size > MAX_SAMPLES) pending.delete(pending.keys().next().value!)
}

/** Called after React commits the visible bubble; historical pages have no pending event. */
export function noteRoomMessageRendered(message: RoomMessage): void {
  const entry = pending.get(message.id)
  if (!entry || entry.roomId !== message.roomId || !message.deliveryPhase) return
  pending.delete(message.id)
  const elapsed = Date.now() - entry.committedAt
  if (elapsed < 0 || elapsed > 60_000) return
  samples.push({ roomId: message.roomId, messageId: message.id,
    phase: message.deliveryPhase, commitToRenderMs: elapsed })
  if (samples.length > MAX_SAMPLES) samples.shift()
}

export function roomResponseLatencySnapshot() { return samples.map((item) => ({ ...item })) }
