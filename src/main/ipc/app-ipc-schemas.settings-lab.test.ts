import { describe, expect, it } from 'vitest'
import { settingsPatchSchema } from './app-ipc-schemas'

describe('app-ipc-schemas Laboratory settings', () => {
  it.each([true, false])(
    'accepts the conversation visualization enabled flag set to %s',
    (enabled) => {
      const payload = settingsPatchSchema.parse({
        agents: { kun: { lab: { conversationVisualization: { enabled } } } }
      })
      expect(payload.agents?.kun?.lab?.conversationVisualization).toEqual({ enabled })
    }
  )

  it('keeps conversation visualization settings strict and boolean-only', () => {
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { lab: { conversationVisualization: { enabled: 'yes' } } } }
    })).toThrow()
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { lab: { conversationVisualization: { unknown: true } } } }
    })).toThrow()
  })

  it('rejects the retired isolated plan-build experiment switch', () => {
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { lab: { planWorktree: { enabled: false } } } }
    })).toThrow()
  })

  it('keeps the formal plan execution preference boolean-only', () => {
    const payload = settingsPatchSchema.parse({
      agents: { kun: { planExecution: { useWorktreeByDefault: false } } }
    })
    expect(payload.agents?.kun?.planExecution?.useWorktreeByDefault).toBe(false)
    expect(() => settingsPatchSchema.parse({
      agents: { kun: { planExecution: { useWorktreeByDefault: 'yes' } } }
    })).toThrow()
  })
})
