/** In-renderer fan-out of room SSE events; kept free of i18n and store imports so light hooks can subscribe. */
export type RoomEvent = {
  seq: number
  roomId: string
  kind: string
  createdAt?: string
  payload?: { id?: string; taskId?: string; linkId?: string; status?: string; threadId?: string; gateKind?: 'approval' | 'input'; occurredAt?: string }
}
const listeners = new Set<(event: RoomEvent) => void>()
export function subscribeRoomEvents(listener: (event: RoomEvent) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function publishRoomEvent(event: RoomEvent): void {
  listeners.forEach((listener) => listener(event))
}
