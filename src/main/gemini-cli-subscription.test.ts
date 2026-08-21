import { describe, expect, it } from 'vitest'
import { GEMINI_CLI_SUBSCRIPTION_MODEL_IDS } from '../shared/model-provider-presets'
import { geminiCliSubscriptionModels } from './gemini-cli-subscription'

describe('geminiCliSubscriptionModels', () => {
  it('returns the direct Gemini CLI API catalog without Antigravity-only ids', () => {
    expect(geminiCliSubscriptionModels()).toEqual([
      'gemini-3.7-pro-preview',
      'gemini-3.7-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash'
    ])
    expect(geminiCliSubscriptionModels()).not.toContain('gemini-3.6-flash')
  })

  it('keeps the bootstrap catalog aligned with the shared preset constant', () => {
    expect(geminiCliSubscriptionModels()).toEqual([...GEMINI_CLI_SUBSCRIPTION_MODEL_IDS])
  })
})
