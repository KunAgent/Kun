import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow, AdeHarnessTransport } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import {
  enqueueOnboardingAgent,
  onboardingAgentEligible,
  onboardingAgentLists,
  onboardingAgentStatus,
  onboardingConnectedAgentNames,
  settleOnboardingAgent,
  shortAgentVersion
} from './onboarding-agents'

function row(id: string, overrides: {
  transport?: AdeHarnessTransport
  credentialModes?: AdeHarnessRow['definition']['credentialModes']
  status?: Partial<AdeHarnessRow['status']>
  name?: string
} = {}): AdeHarnessRow {
  return {
    definition: {
      id,
      displayName: overrides.name ?? id,
      transport: overrides.transport ?? 'acp',
      credentialModes: overrides.credentialModes ?? ['native-login'],
      permissionModes: [],
      modelSource: 'probe',
      staticModels: [],
      builtin: true
    },
    status: {
      harnessId: id,
      installed: 'yes',
      ready: 'yes',
      login: 'signed-in',
      checkedAt: '2026-10-07T00:00:00.000Z',
      ...overrides.status
    }
  }
}

const settings = (patch: Partial<KunHarnessSettingsV1> = {}): KunHarnessSettingsV1 => ({
  enabledProfiles: [],
  disabledIds: [],
  binaryPaths: {},
  custom: [],
  defaults: {},
  defaultHarnessId: 'kun',
  agentOrder: [],
  terminalAgents: [],
  ...patch
})

describe('onboarding agents', () => {
  it('offers only native-login chat Agents', () => {
    const base = settings()
    expect(onboardingAgentEligible(row('claude-code'), base)).toBe(true)
    expect(onboardingAgentEligible(row('kun', { transport: 'native-loop' }), base)).toBe(false)
    expect(onboardingAgentEligible(row('crush', { transport: 'terminal' }), base)).toBe(false)
    expect(onboardingAgentEligible(row('zed', { transport: 'application' }), base)).toBe(false)
    expect(onboardingAgentEligible(row('cursor', { credentialModes: ['provider'] }), base)).toBe(false)
    expect(onboardingAgentEligible(row('codex', { credentialModes: ['native-login', 'kun-gateway'] }), settings({
      defaults: { codex: { credentialMode: 'kun-gateway' } }
    }))).toBe(false)
  })

  it('classifies detection, sign-in, version and readiness', () => {
    const base = settings()
    expect(onboardingAgentStatus(row('a', { status: { detecting: true, installed: 'unknown' } }), base)).toBe('detecting')
    expect(onboardingAgentStatus(row('a', { status: { installed: 'no' } }), base)).toBe('missing')
    expect(onboardingAgentStatus(row('a', { status: { versionSupported: false } }), base)).toBe('outdated')
    expect(onboardingAgentStatus(row('a', { status: { login: 'signed-out' } }), base)).toBe('login')
    expect(onboardingAgentStatus(row('a'), base)).toBe('ready')
    const ready = withHarnessReadiness(row('claude-code'))
    const enabled = settings({ enabledProfiles: [{ harnessId: 'claude-code', credentialMode: 'native-login' }] })
    expect(onboardingAgentStatus(ready, enabled)).toBe('connected')
  })

  it('sorts installed Agents best first and suggests popular missing ones', () => {
    const enabled = settings({ enabledProfiles: [{ harnessId: 'gemini-cli', credentialMode: 'native-login' }] })
    const lists = onboardingAgentLists([
      row('zzz-agent'),
      row('devin', { status: { login: 'signed-out' } }),
      withHarnessReadiness(row('gemini-cli', { name: 'Gemini CLI' })),
      row('codex'),
      row('claude-code', { status: { installed: 'no' } }),
      row('obscure', { status: { installed: 'no' } })
    ], enabled)
    expect(lists.installed.map((entry) => entry.definition.id)).toEqual(['gemini-cli', 'codex', 'zzz-agent', 'devin'])
    expect(lists.suggestions.map((entry) => entry.definition.id)).toEqual(['claude-code'])
    expect(onboardingConnectedAgentNames([withHarnessReadiness(row('gemini-cli', { name: 'Gemini CLI' }))], enabled))
      .toEqual(['Gemini CLI'])
  })

  it('runs one readiness check at a time in arrival order', () => {
    let slot = enqueueOnboardingAgent([], null, 'a')
    expect(slot).toEqual({ queue: [], active: 'a' })
    slot = enqueueOnboardingAgent(slot.queue, slot.active, 'b')
    slot = enqueueOnboardingAgent(slot.queue, slot.active, 'c')
    slot = enqueueOnboardingAgent(slot.queue, slot.active, 'b')
    expect(slot).toEqual({ queue: ['b', 'c'], active: 'a' })
    slot = settleOnboardingAgent(slot.queue, slot.active, 'c')
    expect(slot).toEqual({ queue: ['b'], active: 'a' })
    slot = settleOnboardingAgent(slot.queue, slot.active, 'a')
    expect(slot).toEqual({ queue: [], active: 'b' })
    expect(settleOnboardingAgent(slot.queue, slot.active, 'b')).toEqual({ queue: [], active: null })
  })

  it('keeps only the release number of a long version string', () => {
    expect(shortAgentVersion('0.162.0-alpha.3')).toBe('0.162.0')
    expect(shortAgentVersion('codex-cli 0.37.2 (build 41)')).toBe('0.37.2')
    expect(shortAgentVersion('nightly')).toBe('nightly')
  })
})
