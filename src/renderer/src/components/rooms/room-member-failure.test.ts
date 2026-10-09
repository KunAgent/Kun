import { describe, expect, it } from 'vitest'
import type { RoomPeerTopicSummary } from '@shared/rooms-api'
import { roomMemberFailureContext, summarizeRoomMemberError } from './room-member-failure'

describe('room member failure display', () => {
  it('shows the provider status and message instead of the raw JSON body', () => {
    const raw = 'model request failed with status 403: {"error":{"message":"Your current subscription does not have access to Kimi Code right now.","type":"access_terminated_error"}}'
    expect(summarizeRoomMemberError(raw)).toBe('403 · Your current subscription does not have access to Kimi Code right now.')
  })

  it('keeps plain errors and bounds very long text', () => {
    expect(summarizeRoomMemberError('Participation check failed')).toBe('Participation check failed')
    expect(summarizeRoomMemberError('x'.repeat(400))).toHaveLength(280)
  })

  it('names the model frozen into the topic rather than the member current choice', () => {
    const topic = { roomSnapshot: { members: [{ id: 'reviewer', modelRef: { providerId: 'kimi-code', model: 'k3' } }] } } as unknown as
      Pick<RoomPeerTopicSummary, 'roomSnapshot'>
    const context = roomMemberFailureContext(topic, { memberId: 'reviewer', updatedAt: '2026-10-05T05:37:19.888Z' })
    expect(context.startsWith('k3 · ')).toBe(true)
    expect(roomMemberFailureContext(topic, { memberId: 'missing' })).toBe('')
  })
})
