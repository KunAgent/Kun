import { randomUUID } from 'node:crypto'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomStore } from './room-store.js'
import { RoomStoreConflictError } from './room-store.js'

export async function roomAppConnectionMessage(store: RoomStore, roomId: string, messageId: string) {
  const row = await store.get<RoomMessage>('message', messageId)
  if (!row || row.roomId !== roomId || row.value.presentationKind !== 'app_connection' ||
    !row.value.appConnection || !row.value.originRunId || row.value.authorKind !== 'member') {
    throw new Error('app connection card not found')
  }
  const run = await store.get<RoomRunRecord>('room_run', row.value.originRunId)
  if (!run || run.roomId !== roomId || run.value.phase !== 'conversation' ||
    run.value.memberId !== row.value.authorMemberId || !run.value.threadId || !run.value.turnId) {
    throw new Error('app connection run not found')
  }
  return { row, run }
}

export async function setRoomAppConnectionStatus(store: RoomStore, roomId: string, messageId: string,
  status: 'connected' | 'skipped'): Promise<RoomMessage> {
  const { row } = await roomAppConnectionMessage(store, roomId, messageId)
  const current = row.value.appConnection!
  if (current.status === status) return row.value
  if (current.status !== 'requested') throw new RoomStoreConflictError('app connection was already resolved')
  const value: RoomMessage = { ...row.value, bodyRevision: row.value.bodyRevision + 1,
    appConnection: { ...current, status, resumed: false } }
  await store.commit({ requestId: randomUUID(),
    checks: [{ kind: 'message', id: messageId, expectedRevision: row.revision }],
    puts: [{ kind: 'message', id: messageId, roomId, value }],
    events: [{ roomId, kind: 'message.updated', payload: { id: messageId } }] })
  return value
}

export async function markRoomAppConnectionResumed(store: RoomStore, roomId: string, messageId: string): Promise<RoomMessage> {
  const { row } = await roomAppConnectionMessage(store, roomId, messageId)
  if (row.value.appConnection?.resumed) return row.value
  if (row.value.appConnection?.status === 'requested') throw new RoomStoreConflictError('app connection is pending')
  const value: RoomMessage = { ...row.value, bodyRevision: row.value.bodyRevision + 1,
    appConnection: { ...row.value.appConnection!, resumed: true } }
  await store.commit({ requestId: randomUUID(),
    checks: [{ kind: 'message', id: messageId, expectedRevision: row.revision }],
    puts: [{ kind: 'message', id: messageId, roomId, value }],
    events: [{ roomId, kind: 'message.updated', payload: { id: messageId } }] })
  return value
}
