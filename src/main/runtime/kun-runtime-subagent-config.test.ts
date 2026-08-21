import { describe, expect, it } from 'vitest'
import { subagentProfilesForRuntime } from './kun-runtime-subagent-config'

describe('subagentProfilesForRuntime proactive retry', () => {
  it('defaults enabled with three attempts and preserves explicit policy', () => {
    expect(subagentProfilesForRuntime({
      enabled: true,
      profiles: []
    }).proactiveRetry).toEqual({ enabled: true, maxAttempts: 3 })

    expect(subagentProfilesForRuntime({
      enabled: true,
      proactiveRetry: { enabled: false, maxAttempts: 2 },
      profiles: []
    }).proactiveRetry).toEqual({ enabled: false, maxAttempts: 2 })
  })
})
