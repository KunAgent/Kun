import { RoomNotificationPreferenceSchema, UpdateRoomNotificationPreferenceSchema,
  type RoomNotificationPreference, type RoomPreferenceDetail } from '../contracts/room-experience.js'
import type { RoomStore } from './room-store.js'
import { roomFingerprint } from './room-service.js'
import { RoomStoreConflictError } from './room-store.js'

export async function getRoomNotificationPreference(store: RoomStore, roomId: string): Promise<RoomPreferenceDetail> {
  if (!await store.get('room', roomId)) throw new Error('room not found')
  const row = await store.get<RoomNotificationPreference>('room_preference', roomId)
  return { preference: row?.value ?? { roomId, mode: 'all', updatedAt: new Date(0).toISOString() }, revision: row?.revision ?? null }
}
export async function updateRoomNotificationPreference(store: RoomStore, roomId: string, raw: unknown): Promise<RoomPreferenceDetail> {
  const input = UpdateRoomNotificationPreferenceSchema.parse(raw)
  const key = `room-notification:${roomId}:${input.clientRequestId}`
  const fingerprint = roomFingerprint(input)
  const replay = await store.getRequest(key)
  if (replay) {
    if (replay.fingerprint !== fingerprint) throw new RoomStoreConflictError('notification preference identity changed')
    return replay.result as RoomPreferenceDetail
  }
  const current = await getRoomNotificationPreference(store, roomId)
  if (current.revision !== input.expectedRevision) throw new RoomStoreConflictError('notification preference changed', current.revision)
  const preference = RoomNotificationPreferenceSchema.parse({ roomId, mode: input.mode,
    mutedUntil: input.mode === 'until' ? input.mutedUntil : undefined,
    silencedThrough: input.mode === 'until' ? input.mutedUntil : input.mode === 'all' && current.preference.mode !== 'all'
      ? new Date(current.preference.mode === 'until' ? Math.min(Date.now(), Date.parse(current.preference.mutedUntil!)) : Date.now()).toISOString()
      : current.preference.silencedThrough,
    updatedAt: new Date().toISOString() })
  const result = { preference, revision: (current.revision ?? -1) + 1 }
  await store.commit({ requestId: key, fingerprint,
    checks: [{ kind: 'room_preference', id: roomId, expectedRevision: current.revision }],
    puts: [{ kind: 'room_preference', id: roomId, roomId, value: preference }],
    events: [{ roomId, kind: 'presentation.preference.updated', payload: { id: roomId } }], result })
  return result
}
