import { describe, expect, it } from 'vitest'
import { mergeBuiltinSubagentProfiles } from '../src/delegation/builtin-profiles.js'
import { SubagentsCapabilityConfig } from '../src/contracts/capabilities.js'

describe('mergeBuiltinSubagentProfiles', () => {
  it('deep-merges a thin GUI override onto a builtin, preserving its persona', () => {
    // The GUI persists a builtin override carrying only the edited fields (here
    // a tool policy + a deny-list); the builtin's promptPreamble/description
    // must survive (a shallow replace would wipe them).
    const config = SubagentsCapabilityConfig.parse({
      profiles: { general: { toolPolicy: 'inherit', blockedTools: ['bash'] } }
    })
    const general = mergeBuiltinSubagentProfiles(config).profiles.general!

    // User fields win.
    expect(general.toolPolicy).toBe('inherit')
    expect(general.blockedTools).toEqual(['bash'])
    // Builtin persona/description fall back instead of being clobbered.
    expect(general.promptPreamble).toContain('通用代理')
    expect(general.description).toBeTruthy()
    // An un-overridden builtin is untouched.
    expect(mergeBuiltinSubagentProfiles(config).profiles.explore!.promptPreamble).toContain('探索代理')
  })

  it('keeps user-only profiles alongside every builtin', () => {
    const config = SubagentsCapabilityConfig.parse({
      profiles: { mine: { mode: 'subagent', toolPolicy: 'readOnly' } }
    })
    const merged = mergeBuiltinSubagentProfiles(config)
    expect(Object.keys(merged.profiles).sort()).toEqual(
      [
        'component-designer',
        'design-reviewer',
        'explore',
        'general',
        'mine',
        'over-engineering-reviewer'
      ].sort()
    )
  })
})
