import { describe, expect, it } from 'vitest'
import { isAttentionRequestStatus, isCurrentPeerRequest } from './room-activity-predicates.js'

describe('room activity request predicates', () => {
  it('treats non-peer requests as current and peer children only when they are latest', () => {
    expect(isCurrentPeerRequest({ id: 'legacy', collaborationProtocol: 'legacy' })).toBe(true)
    expect(isCurrentPeerRequest({ id: 'root', collaborationProtocol: 'peer', peerLatestRequestId: 'child' },
      { id: 'root', peerLatestRequestId: 'child' })).toBe(false)
    expect(isCurrentPeerRequest({ id: 'child', collaborationProtocol: 'peer', rootRequestId: 'root' },
      { id: 'root', peerLatestRequestId: 'child' })).toBe(true)
    expect(isAttentionRequestStatus('needs_input')).toBe(true)
    expect(isAttentionRequestStatus('completed')).toBe(false)
  })
})
