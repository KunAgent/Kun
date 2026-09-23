import { describe, expect, it } from 'vitest'
import { mobileWorkAssistantThreadReady } from './MobileWorkAssistant'

describe('mobile Work assistant thread isolation', () => {
  it('shows history and pending actions only for the exact bound resource thread', () => {
    expect(mobileWorkAssistantThreadReady(null, 'old-thread')).toBe(false)
    expect(mobileWorkAssistantThreadReady('resource-thread', 'old-thread')).toBe(false)
    expect(mobileWorkAssistantThreadReady('resource-thread', null)).toBe(false)
    expect(mobileWorkAssistantThreadReady('resource-thread', 'resource-thread')).toBe(true)
  })
})
