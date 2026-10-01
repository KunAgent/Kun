import type { RoomMessage } from '@shared/rooms-api'
import type { RoomNotice } from './room-notifications'
import type { RoomNotificationEvent } from './room-notification-queue'
import { roomsRequest } from './rooms-client'

export async function privateRoomNotice(event: RoomNotificationEvent): Promise<RoomNotice | null> {
  const id = event.payload?.id
  if (!id) return null
  const roomPath = '/v1/rooms/' + encodeURIComponent(event.roomId)
  if (event.kind === 'notification.requested') {
    const threadId = event.payload?.threadId
    if (!threadId) return null
    const current = await roomsRequest<{
      approvals: Array<{ id: string; summary?: string }>
      userInputs: Array<{ id: string; prompt?: string }>
    }>(roomPath + '/direct')
    if (event.payload?.gateKind === 'approval') {
      const gate = current.approvals.find((entry) => entry.id === id)
      return gate ? { key: 'approval:' + id, threadId, body: gate.summary || 'Approval requested' } : null
    }
    const gate = current.userInputs.find((entry) => entry.id === id)
    return gate ? { key: 'input:' + id, threadId, body: gate.prompt || 'Your input is needed' } : null
  }
  const { message } = await roomsRequest<{ message: RoomMessage }>(roomPath + '/messages/' + encodeURIComponent(id))
  if (message.authorKind !== 'member' || message.status !== 'final' || !message.originRunId ||
    message.deliveryPhase === 'start' || message.deliveryPhase === 'progress') return null
  const { run } = await roomsRequest<{ run: { phase: string; threadId?: string } }>(
    roomPath + '/runs/' + encodeURIComponent(message.originRunId))
  if (run.phase !== 'conversation' || !run.threadId) return null
  return { key: 'message:' + message.id, threadId: run.threadId,
    body: message.body.trim() || message.references?.map((reference) => reference.titleSnapshot).filter(Boolean).join(', ') || 'New attachment' }
}
