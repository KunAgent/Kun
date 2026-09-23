import { describe, expect, it } from 'vitest'
import { shouldShowConversationRuntimeBanner } from './useWorkbenchRuntimeBanners'

describe('shouldShowConversationRuntimeBanner', () => {
  it('shows a conversation banner whenever a runtime error is visible', () => {
    expect(shouldShowConversationRuntimeBanner('Connect to the runtime before using AI actions.')).toBe(true)
  })

  it('does not hide the banner just because no thread is selected', () => {
    expect(shouldShowConversationRuntimeBanner('failed to start kun')).toBe(true)
  })

  it('hides the banner when there is no visible error', () => {
    expect(shouldShowConversationRuntimeBanner(null)).toBe(false)
    expect(shouldShowConversationRuntimeBanner('')).toBe(false)
    expect(shouldShowConversationRuntimeBanner(undefined)).toBe(false)
  })
})
