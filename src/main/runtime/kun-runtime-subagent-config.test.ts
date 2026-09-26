import { describe, expect, it } from 'vitest'
import { SubagentsCapabilityConfig } from '../../../kun/src/contracts/capabilities.js'
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

describe('subagentProfilesForRuntime ADE harness binding', () => {
  it('round-trips harnessId/credentialMode/delegationNotes through config parse (10 §3.1)', () => {
    const config = subagentProfilesForRuntime({
      enabled: true,
      profiles: [{
        id: 'claude-reviewer',
        enabled: true,
        name: 'Claude Reviewer',
        description: 'reviews diffs',
        color: '#fff',
        mode: 'subagent',
        surfaces: ['code'],
        model: 'claude-sonnet-4-6',
        harnessId: 'claude-code',
        credentialMode: 'native-login',
        delegationNotes: 'security-sensitive review specialist',
        systemPrompt: 'Review carefully.',
        toolPolicy: 'readOnly',
        allowedTools: ['file:read'],
        blockedTools: [],
        blockedMcpServers: [],
        blockedSkills: [],
        reasoningEffort: 'auto'
      }]
    })
    expect(config.profiles['claude-reviewer']).toMatchObject({
      name: 'Claude Reviewer',
      harnessId: 'claude-code',
      credentialMode: 'native-login',
      delegationNotes: 'security-sensitive review specialist',
      model: 'claude-sonnet-4-6'
    })
    // kun reads config.json through the same schema — a serialized round-trip
    // must preserve every worker-selection field.
    const reread = SubagentsCapabilityConfig.parse(JSON.parse(JSON.stringify(config)))
    expect(reread.profiles['claude-reviewer']).toMatchObject({
      harnessId: 'claude-code',
      credentialMode: 'native-login',
      delegationNotes: 'security-sensitive review specialist'
    })
  })

  it('drops a bare model override only when no harness binding justifies it', () => {
    const config = subagentProfilesForRuntime({
      enabled: true,
      profiles: [{
        id: 'bound',
        enabled: true,
        name: 'Bound',
        mode: 'subagent',
        surfaces: ['shared'],
        model: 'claude-sonnet-4-6',
        harnessId: 'claude-code',
        credentialMode: 'native-login',
        toolPolicy: 'inherit',
        allowedTools: [],
        blockedTools: []
      }]
    })
    // Harness owns the model list — a bare model is meaningful and kept.
    expect(config.profiles.bound?.model).toBe('claude-sonnet-4-6')

    const unbound = subagentProfilesForRuntime({
      enabled: true,
      profiles: [{
        id: 'unbound',
        enabled: true,
        name: 'Unbound',
        mode: 'subagent',
        surfaces: ['shared'],
        model: 'orphan-model',
        toolPolicy: 'inherit',
        allowedTools: [],
        blockedTools: []
      }]
    })
    expect(unbound.profiles.unbound?.model).toBeUndefined()
  })

  it('sanitizes an invalid harnessId instead of failing the whole roster', () => {
    const config = subagentProfilesForRuntime({
      enabled: true,
      profiles: [{
        id: 'ok',
        enabled: true,
        name: 'OK',
        mode: 'subagent',
        surfaces: ['shared'],
        toolPolicy: 'inherit',
        allowedTools: [],
        blockedTools: []
      }, {
        id: 'bad',
        enabled: true,
        name: 'Bad',
        mode: 'subagent',
        surfaces: ['shared'],
        harnessId: 'Bad Id!',
        credentialMode: 'native-login',
        delegationNotes: 'x'.repeat(1200),
        toolPolicy: 'inherit',
        allowedTools: [],
        blockedTools: []
      } as never]
    })
    expect(config.profiles.ok).toBeDefined()
    expect(config.profiles.bad).toMatchObject({ name: 'Bad' })
    expect(config.profiles.bad?.harnessId).toBeUndefined()
    expect(config.profiles.bad?.credentialMode).toBeUndefined()
    expect(config.profiles.bad?.delegationNotes).toBeUndefined()
  })
})
