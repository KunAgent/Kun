import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from './ade-harnesses'
import { defaultKunHarnessSettings, normalizeKunHarnessSettings } from './app-settings-kun-harness'
import { harnessProfileEnabled, harnessProfileKey, harnessProfileReady, normalizeEnabledProfiles, readyHarnessProfiles } from './harness-enablement'

const native = { harnessId: 'claude-code', credentialMode: 'native-login' as const }
const row = (): AdeHarnessRow => ({
  definition: { id: 'claude-code', displayName: 'Claude', transport: 'agent-sdk', credentialModes: ['native-login', 'kun-gateway'],
    permissionModes: [], modelSource: 'probe', staticModels: [], builtin: true },
  status: { harnessId: 'claude-code', installed: 'yes', login: 'signed-in', ready: 'yes', checkedAt: new Date().toISOString() },
  enabled: true, enabledProfiles: [native], readyProfiles: [{ ...native, expiresAt: new Date(Date.now() + 60_000).toISOString() }]
})
describe('explicit exact agent profile enablement', () => {
  it('defaults every external agent off and never migrates installed/legacy choices into consent', () => {
    const settings = normalizeKunHarnessSettings({ disabledIds: [], defaults: { 'claude-code': { credentialMode: 'native-login' } }, defaultHarnessId: 'claude-code' })
    expect(settings.enabledProfiles).toEqual([])
    expect(harnessProfileEnabled(settings, native)).toBe(false)
  })
  it('preserves named native account identity and normalizes the system default', () => {
    expect(harnessProfileKey(native)).toBe(harnessProfileKey({ ...native, providerId: 'default' }))
    expect(harnessProfileKey({ ...native, providerId: 'account-a' })).not.toBe(harnessProfileKey({ ...native, providerId: 'account-b' }))
    expect(normalizeEnabledProfiles([{ ...native, providerId: 'account-a' }])).toEqual([{ ...native, providerId: 'account-a' }])
  })
  it('ignores malformed profiles and retired Gemini without changing histories or saved defaults', () => {
    expect(normalizeEnabledProfiles([{ ...native, harnessId: 'gemini-cli' }, { ...native, harnessId: 'kun' },
      { ...native, credentialMode: 'unknown' }, native, native])).toEqual([native])
    const settings = normalizeKunHarnessSettings({ defaults: { 'gemini-cli': { model: 'old' } }, enabledProfiles: [{ ...native, harnessId: 'gemini-cli' }] })
    expect(settings.defaults['gemini-cli']?.model).toBe('old')
  })
  it('requires opt-in and a current exact proof, not installed/signed-in/unknown statuses', () => {
    const current = row()
    expect(harnessProfileReady(current, native)).toBe(true)
    expect(harnessProfileReady(current, { ...native, providerId: 'account-a' })).toBe(false)
    expect(harnessProfileReady(current, { ...native, credentialMode: 'kun-gateway', providerId: 'provider-a' })).toBe(false)
    expect(readyHarnessProfiles({ ...current, enabled: false })).toEqual([])
    expect(readyHarnessProfiles({ ...current, enabledProfiles: [] })).toEqual([])
    expect(readyHarnessProfiles({ ...current, readyProfiles: [] })).toEqual([])
    expect(readyHarnessProfiles({ ...current, readyProfiles: [{ ...native }] })).toEqual([])
    expect(readyHarnessProfiles({ ...current, readyProfiles: [{ ...native, expiresAt: '2000-01-01T00:00:00Z' }] })).toEqual([])
  })
  it('legacy disable still overrides a profile opt-in', () => {
    expect(harnessProfileEnabled({ ...defaultKunHarnessSettings(), enabledProfiles: [native], disabledIds: ['claude-code'] }, native)).toBe(false)
  })
  it('keeps a current exact proof selectable during metadata refresh, but never revives expired proofs', () => {
    const current = row()
    current.status.detecting = true
    expect(harnessProfileReady(current, native)).toBe(true)
    current.status.installed = 'unknown'
    expect(harnessProfileReady(current, native)).toBe(true)
    expect(readyHarnessProfiles({ ...current, status: { ...current.status, detecting: false } })).toEqual([])
    expect(readyHarnessProfiles({ ...current, enabled: false })).toEqual([])
    expect(readyHarnessProfiles({ ...current, status: { ...current.status, installed: 'no' } })).toEqual([])
    expect(readyHarnessProfiles({ ...current, readyProfiles: [] })).toEqual([])
    expect(readyHarnessProfiles(current, Date.now() + 120_000)).toEqual([])
  })
})
