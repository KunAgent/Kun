import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomMessage, RoomTask } from '@shared/rooms-api'
import { roomsClient, mergeRoomMessages } from './rooms-client'
import { roomTaskActions } from './RoomTaskPanel'

const request = vi.hoisted(() => vi.fn())
vi.mock('../../agent/runtime-client', () => ({
  rendererRuntimeClient: { runtimeRequest: request }
}))

describe('Rooms renderer API', () => {
  beforeEach(() =>
    request.mockReset().mockResolvedValue({ ok: true, status: 200, body: '{}' })
  )
  it('preserves structured input and the retry identity over the existing bridge', async () => {
    const input = {
      clientRequestId: 'same-request',
      body: 'Implement this',
      mentionMemberIds: ['developer'],
      executionIntent: 'execute' as const,
      taskId: 'task',
      attachmentIds: ['image-id']
    }
    await roomsClient.send('room', input)
    await roomsClient.send('room', input)
    expect(request.mock.calls[0].slice(0, 3)).toEqual([
      '/v1/rooms/room/messages',
      'POST',
      JSON.stringify(input)
    ])
    expect(request.mock.calls[1]).toEqual(request.mock.calls[0])
  })
  it('uses opaque escaped cursors without turning cursor data into new query parameters', async () => {
    await roomsClient.messages('room', 'cursor&task_id=other')
    expect(request.mock.calls[0][0]).toBe(
      '/v1/rooms/room/messages?limit=50&cursor=cursor%26task_id%3Dother'
    )
  })
  it('surfaces runtime errors and malformed success bodies', async () => {
    request.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: JSON.stringify({ error: { message: 'Room was changed' } })
    })
    await expect(roomsClient.get('room')).rejects.toThrow('Room was changed')
    request.mockResolvedValueOnce({ ok: true, status: 200, body: 'invalid' })
    await expect(roomsClient.get('room')).rejects.toThrow(
      'Invalid Rooms response'
    )
  })
  it('merges replayed and revised messages in sequence without reverting a streamed body', () => {
    const a = {
      id: 'a',
      messageSeq: 1,
      body: 'complete',
      bodyRevision: 3
    } as RoomMessage
    const b = {
      id: 'b',
      messageSeq: 2,
      body: 'next',
      bodyRevision: 0
    } as RoomMessage
    expect(
      mergeRoomMessages([a], [b, { ...a, body: 'partial', bodyRevision: 1 }])
    ).toEqual([a, b])
    expect(
      mergeRoomMessages([a, b], [{ ...b, body: 'done', bodyRevision: 2 }])
    ).toEqual([a, { ...b, body: 'done', bodyRevision: 2 }])
  })
  it('requires an accepted current delivery before offering Apply', () => {
    const task = {
      status: 'awaiting_acceptance',
      latestDeliveryId: 'v2',
      acceptedDeliveryId: 'v1',
      applicationStatus: 'not_applied'
    } as RoomTask
    expect(roomTaskActions(task)).toEqual(['review', 'accept'])
    expect(
      roomTaskActions({
        ...task,
        acceptedDeliveryId: 'v2',
        status: 'completed'
      })
    ).toEqual(['apply'])
    expect(roomTaskActions({ ...task, applicationStatus: 'applied' })).toEqual(
      []
    )
    expect(
      roomTaskActions({
        ...task,
        status: 'stopping',
        latestDeliveryId: undefined
      })
    ).toEqual([])
  })
})
