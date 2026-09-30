import { beforeEach, expect, it, vi } from 'vitest'
import { privateRoomNotice } from './room-private-notices'
import { RoomNotificationQueue } from './room-notification-queue'
const request = vi.hoisted(() => vi.fn())
vi.mock('./rooms-client', () => ({ roomsRequest: request }))
beforeEach(() => request.mockReset())

it('notifies final private results, including reminder replies and attachment-only messages', async () => {
  const message = { id: 'reply', authorKind: 'member', status: 'final', deliveryPhase: 'final',
    originRunId: 'run', body: '', references: [{ titleSnapshot: 'report.pdf' }] }
  request.mockResolvedValueOnce({ message }).mockResolvedValueOnce({ run: { phase: 'conversation', threadId: 'thread' } })
  expect(await privateRoomNotice({ seq: 1, roomId: 'room', kind: 'message.created', payload: { id: 'reply' } }))
    .toEqual({ key: 'message:reply', threadId: 'thread', body: 'report.pdf' })
  for (const patch of [{ deliveryPhase: 'start' }, { deliveryPhase: 'progress' }, { status: 'streaming' }, { authorKind: 'system' }]) {
    request.mockResolvedValueOnce({ message: { ...message, ...patch } })
    expect(await privateRoomNotice({ seq: 1, roomId: 'room', kind: 'message.updated', payload: { id: 'reply' } })).toBeNull()
  }
})

it('uses the exact pending approval/input identity and drops resolved gates', async () => {
  const event = { seq: 1, roomId: 'room', kind: 'notification.requested',
    payload: { id: 'gate', threadId: 'thread', gateKind: 'approval' as const } }
  request.mockResolvedValueOnce({ approvals: [{ id: 'gate', summary: 'Allow file write' }], userInputs: [] })
  expect(await privateRoomNotice(event)).toEqual({ key: 'approval:gate', threadId: 'thread', body: 'Allow file write' })
  request.mockResolvedValueOnce({ approvals: [], userInputs: [] })
  expect(await privateRoomNotice(event)).toBeNull()
})

it('persists final-message and approval delivery intents through a disconnected reload', async () => {
  let saved = ''
  const queue = new RoomNotificationQueue(0, (value) => { saved = value })
  queue.accept({ seq: 1, roomId: 'room', kind: 'message.created', payload: { id: 'reply' } })
  queue.accept({ seq: 2, roomId: 'room', kind: 'notification.requested', payload: { id: 'approval', threadId: 'thread' } })
  const offline = vi.fn(async () => { throw new Error('offline') })
  await queue.drain(offline, 0)
  const resumed = new RoomNotificationQueue(100, (value) => { saved = value }, saved)
  expect(resumed.pendingCount).toBe(2)
  const delivered = vi.fn(async (event) => event.kind + ':' + event.payload.id)
  await resumed.drain(delivered, 1000)
  expect(delivered).toHaveBeenCalledTimes(2)
  expect(resumed.pendingCount).toBe(0)
  expect(new RoomNotificationQueue(100, () => {}, saved).cursor).toBe(2)
})
