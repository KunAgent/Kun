import { describe, expect, it } from 'vitest'
import { settingsPatchSchema } from './app-ipc-schemas'

describe('settings IPC proactive subagent retry', () => {
  it('accepts the bounded retry policy', () => {
    const parsed = settingsPatchSchema.parse({
      agents: {
        kun: {
          subagents: {
            proactiveRetry: { enabled: true, maxAttempts: 3 }
          }
        }
      }
    })
    expect(parsed.agents?.kun?.subagents?.proactiveRetry).toEqual({
      enabled: true,
      maxAttempts: 3
    })
  })

  it('rejects attempt limits above three', () => {
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { subagents: { proactiveRetry: { maxAttempts: 4 } } } }
    })).toThrow()
  })
})
