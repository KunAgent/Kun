import { describe, expect, it } from 'vitest'
import { subscriptionBillingKind } from '../shared/subscription-billing.js'

describe('subscriptionBillingKind', () => {
  it('marks configured subscription providers without trusting their URL', () => {
    expect(subscriptionBillingKind({
      authType: 'subscription',
      providerId: 'codex',
      baseUrl: 'https://proxy.example/v1'
    })).toBe('subscription')
  })

  it('recognizes the built-in Codex OAuth provider', () => {
    expect(subscriptionBillingKind({
      authType: 'oauth',
      presetSource: 'codex',
      providerId: 'work-codex',
      baseUrl: 'https://proxy.example/v1'
    })).toBe('subscription')
  })

  it('keeps API-key GPT routes out of subscription billing', () => {
    expect(subscriptionBillingKind({
      authType: 'api-key',
      presetSource: 'codex',
      providerId: 'codex',
      baseUrl: 'https://gateway.example/v1'
    })).toBeUndefined()
  })

  it('recognizes the legacy official Codex endpoint without configuration metadata', () => {
    expect(subscriptionBillingKind({
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses'
    })).toBe('subscription')
  })
})
