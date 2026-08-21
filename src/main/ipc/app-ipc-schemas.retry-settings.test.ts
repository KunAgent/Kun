import { describe, expect, it } from 'vitest'
import { settingsPatchSchema } from './app-ipc-schemas'

describe('app-ipc-schemas retry defaults version', () => {
  it('accepts the defaults marker for provider and resolved runtime retry settings', () => {
    const retry = {
      maxAttempts: 5,
      initialDelayMs: 3_000,
      httpStatusCodes: [429, 500, 502, 503, 504],
      defaultsVersion: 1
    }
    const payload = settingsPatchSchema.parse({
      provider: {
        providers: [{
          id: 'deepseek',
          name: 'DeepSeek',
          endpointFormat: 'chat_completions',
          retry,
          models: ['deepseek-chat'],
          modelProfiles: {}
        }]
      },
      agents: { kun: { retry } }
    })

    expect(payload.provider?.providers?.[0]?.retry).toEqual(retry)
    expect(payload.agents?.kun?.retry).toEqual(retry)
  })
})
