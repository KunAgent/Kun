import { createHash } from 'node:crypto'
import type { RoomResultInbox } from '../contracts/room-result-inbox.js'
import type { RoomRequestState } from './room-runtime-types.js'
import type { RoomStore } from './room-store.js'
import { putRoomDocument } from './room-service.js'

export function resultFingerprint(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex')
}

export async function settleRoomResultInbox(store: RoomStore, request: RoomRequestState): Promise<void> {
  const id = request.privateContinuation?.inboxId
  if (!id) return
  const row = await store.get<RoomResultInbox>('room_result_inbox', id)
  if (!row || row.value.requestId !== request.id || row.roomId !== request.roomId) return
  const status = request.cancellationRequested || ['cancelled', 'stopping'].includes(request.status) ? 'revoked'
    : request.status === 'completed' ? 'completed' : request.status === 'failed' ? 'failed'
      : request.turnId ? 'admitted' : 'pending'
  if (row.value.status === 'revoked' || row.value.status === 'completed') return
  if (row.value.status === status && row.value.turnId === request.turnId && row.value.reason === request.error) return
  await putRoomDocument(store, 'room_result_inbox', id, request.roomId, {
    ...row.value, status, ...(request.turnId ? { turnId: request.turnId } : {}),
    ...(request.error ? { reason: request.error } : {}), updatedAt: new Date().toISOString()
  }, row)
}

/** Listing repairs a lost status acknowledgement from the authoritative request. */
export async function roomResultInboxPage(store: RoomStore, roomId: string, limit: number, beforeSeq?: number) {
  const rows = await store.list<RoomResultInbox>('room_result_inbox', { roomId, limit, beforeSeq })
  for (const row of rows) {
    const request = await store.get<RoomRequestState>('request', row.value.requestId)
    if (request) await settleRoomResultInbox(store, request.value)
  }
  return { results: await Promise.all(rows.map(async (row) => {
    const current = (await store.get<RoomResultInbox>('room_result_inbox', row.id))!
    return { ...current.value, revision: current.revision }
  })), nextCursor: rows.length === limit ? String(rows.at(-1)!.seq) : undefined }
}
