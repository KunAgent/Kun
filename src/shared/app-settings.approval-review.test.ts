import { describe, expect, it } from 'vitest'
import {
  defaultKunRuntimeSettings,
  mergeKunRuntimeSettings
} from './app-settings'

describe('approval review model settings', () => {
  it('atomically replaces the approval review model selection', () => {
    const current = mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      approvalReview: {
        mode: 'fixed',
        providerId: 'provider-a',
        accountId: 'account-a',
        model: 'review-a'
      }
    })
    expect(current.approvalReview).toEqual({
      mode: 'fixed',
      providerId: 'provider-a',
      accountId: 'account-a',
      model: 'review-a'
    })

    const next = mergeKunRuntimeSettings(current, {
      approvalReview: {
        mode: 'fixed',
        providerId: 'provider-b',
        model: 'review-b'
      }
    })
    expect(next.approvalReview).toEqual({
      mode: 'fixed',
      providerId: 'provider-b',
      model: 'review-b'
    })
    expect(next.approvalReview).not.toHaveProperty('accountId')

    expect(mergeKunRuntimeSettings(next, {
      approvalReview: { mode: 'inherit' }
    }).approvalReview).toEqual({ mode: 'inherit' })
  })
})
