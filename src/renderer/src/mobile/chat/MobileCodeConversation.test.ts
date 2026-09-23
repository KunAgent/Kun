import { describe, expect, it } from 'vitest'
import { mobileCodeThreadReady } from './MobileCodeConversation'

describe('mobile Code thread isolation', () => {
  it('shows history, approvals and attachments only for the requested thread', () => {
    expect(mobileCodeThreadReady(null, 'requested')).toBe(false)
    expect(mobileCodeThreadReady('previous', 'requested')).toBe(false)
    expect(mobileCodeThreadReady('requested', 'requested')).toBe(true)
  })
})
