import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gmailBindingQuery, gmailClient } from './gmail-client'
const request = vi.hoisted(() => vi.fn())
vi.mock('./rooms-client', () => ({ roomsRequest: request }))

describe('Gmail renderer public API', () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}))
  it('sends verified conversation references instead of claiming an arbitrary scope ID', async () => {
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
  it('prepares only the bound conversation’s host model and never accepts a caller-supplied URL', async () => {
    await gmailClient.prepareLocal({ threadId: 'thread' })
    expect(request).toHaveBeenCalledWith('/v1/gmail/local-model', 'POST', { threadId: 'thread' })
    await gmailClient.localStatus({ threadId: 'thread' })
    expect(request).toHaveBeenLastCalledWith('/v1/gmail/local-model?threadId=thread', 'GET', undefined, undefined)
  })
})
