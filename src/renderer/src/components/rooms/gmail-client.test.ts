import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gmailBindingQuery, gmailClient } from './gmail-client'
const request = vi.hoisted(() => vi.fn())
vi.mock('./rooms-client', () => ({ roomsRequest: request }))

describe('Gmail renderer public API', () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}))
  it('uses verified conversation references rather than caller-owned scope IDs', async () => {
    const binding = { roomId: 'room/with-space', messageId: 'card&1' }
    expect(gmailBindingQuery(binding)).toBe('roomId=room%2Fwith-space&messageId=card%261')
    await gmailClient.authorize(binding, false)
    expect(request).toHaveBeenCalledWith('/v1/gmail/authorize', 'POST', { ...binding, allowModelSharing: false })
  })
  it('keeps local disconnect and Google revocation explicit', async () => {
    await gmailClient.disconnect({ threadId: 'thread' }, false)
    expect(request).toHaveBeenCalledWith('/v1/gmail/connection', 'DELETE', { threadId: 'thread', revoke: false })
    await gmailClient.cancel({ threadId: 'thread' }, 'id/one')
    expect(request).toHaveBeenLastCalledWith('/v1/gmail/authorization/id%2Fone?threadId=thread', 'DELETE')
  })
  it('grants conversation-wide model processing without provider proofs or route stamps', async () => {
    const binding = { threadId: 'thread' }
    await gmailClient.sharing(binding, true)
    expect(request).toHaveBeenLastCalledWith('/v1/gmail/sharing', 'PATCH', {
      ...binding, allowModelSharing: true, modelSharingPolicy: 'configured-models-v1'
    })
    await gmailClient.authorize(binding, true)
    expect(request).toHaveBeenLastCalledWith('/v1/gmail/authorize', 'POST', {
      ...binding, allowModelSharing: true, modelSharingPolicy: 'configured-models-v1'
    })
    await gmailClient.sharing(binding, false)
    expect(request).toHaveBeenLastCalledWith('/v1/gmail/sharing', 'PATCH', { ...binding, allowModelSharing: false })
  })
  it('preserves the exact recorded source turn and tool call when continuing', async () => {
    await gmailClient.continueTask('thread', 'source-turn', 'source-call')
    expect(request).toHaveBeenLastCalledWith('/v1/gmail/continue', 'POST', {
      threadId: 'thread', sourceTurnId: 'source-turn', toolCallId: 'source-call'
    })
  })
})
