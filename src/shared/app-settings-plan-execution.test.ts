import { describe, expect, it } from 'vitest'
import {
  defaultKunRuntimeSettings,
  mergeKunRuntimeSettings,
  normalizeAppSettings,
  type AppSettingsV1
} from './app-settings'

describe('Kun plan execution settings', () => {
  it('defaults Direct plan builds to isolated worktrees', () => {
    expect(defaultKunRuntimeSettings().planExecution).toEqual({ useWorktreeByDefault: true })
    expect(defaultKunRuntimeSettings().lab).not.toHaveProperty('planWorktree')
  })

  it('drops the retired Lab setting while retaining the formal preference', () => {
    const legacy = {
      ...defaultKunRuntimeSettings(),
      lab: {
        ...defaultKunRuntimeSettings().lab,
        planWorktree: { enabled: false }
      }
    }
    delete (legacy as Partial<typeof legacy>).planExecution
    const normalized = normalizeAppSettings({
      version: 1,
      agents: { kun: legacy }
    } as unknown as AppSettingsV1)

    expect(normalized.agents.kun.planExecution).toEqual({ useWorktreeByDefault: true })
    expect(normalized.agents.kun.lab).not.toHaveProperty('planWorktree')
  })

  it('retains an explicit formal opt-out', () => {
    expect(mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
      planExecution: { useWorktreeByDefault: false }
    }).planExecution).toEqual({ useWorktreeByDefault: false })
  })
})
