import { describe, expect, it } from 'vitest'
import { composeDispatchPreferencePrompt, dispatchPreferencesValid, normalizeDispatchPreferences, type AdeDispatchPreferenceRule } from './ade-collaboration-settings'
import { defaultKunAdeSettings, mergeKunAdeSettings, normalizeKunAdeSettings } from './app-settings-kun-harness'

const rule: AdeDispatchPreferenceRule = { id: 'review', scenario: 'Code review', agentId: 'codex', agentLabel: 'Codex', model: 'review-model', enabled: true }

describe('collaboration scenario preferences', () => {
  it('keeps legacy notes and omits inactive scenarios', () => {
    expect(composeDispatchPreferencePrompt()).toBe('')
    expect(composeDispatchPreferencePrompt({ preferencePrompt: ' old text ' })).toBe('old text')
    const prompt = composeDispatchPreferencePrompt({ preferences: [rule, { ...rule, id: 'off', enabled: false, scenario: 'Hidden' }], preferencePrompt: 'Keep changes small' })
    expect(prompt).toContain('Code review → Agent Codex (codex), model review-model')
    expect(prompt).not.toContain('Hidden')
    expect(prompt).toMatch(/Keep changes small$/)
  })
  it('includes unambiguous route metadata, notes and default model behavior', () => {
    const prompt = composeDispatchPreferencePrompt({ preferences: [{ ...rule, providerId: 'account-a', credentialMode: 'provider', note: 'Careful\nreview' }] })
    expect(prompt).toContain('provider account-a, credential mode provider (Careful review)')
    expect(composeDispatchPreferencePrompt({ preferences: [{ ...rule, model: undefined }] })).toContain('Agent default')
  })
  it('validates the untruncated length and bounds the runtime projection at whole lines', () => {
    const input = { preferences: [rule], preferencePrompt: 'x'.repeat(2000) }
    expect(dispatchPreferencesValid(input)).toBe(false)
    expect(composeDispatchPreferencePrompt(input, { truncate: false }).length).toBeGreaterThan(2000)
    expect(composeDispatchPreferencePrompt(input)).toBe(composeDispatchPreferencePrompt({ preferences: [rule] }))
    expect(composeDispatchPreferencePrompt({ preferencePrompt: 'x'.repeat(2001) })).toHaveLength(2000)
    expect(dispatchPreferencesValid({ preferences: [{ ...rule, scenario: ' ' }] })).toBe(false)
  })
  it('sanitizes invalid entries, bounds fields, deduplicates ids and generates stable ids', () => {
    const raw = [null, {}, { ...rule, scenario: ' ' }, rule, rule, { ...rule, id: '', scenario: 'x'.repeat(201), note: 'y'.repeat(301) }]
    const result = normalizeDispatchPreferences(raw)
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ id: 'pref-5', scenario: 'x'.repeat(200), note: 'y'.repeat(300) })
    expect(normalizeDispatchPreferences('bad')).toEqual([])
    expect(normalizeDispatchPreferences(Array.from({ length: 20 }, (_, i) => ({ ...rule, id: String(i) })))).toHaveLength(8)
  })
  it('defaults legacy settings and replaces rather than merges preference arrays', () => {
    expect(defaultKunAdeSettings().dispatch.preferences).toEqual([])
    expect(normalizeKunAdeSettings({ dispatch: { preferencePrompt: 'legacy' } }).dispatch).toMatchObject({ preferences: [], preferencePrompt: 'legacy' })
    const base = normalizeKunAdeSettings({ dispatch: { preferences: [rule], preferencePrompt: 'legacy' } })
    expect(mergeKunAdeSettings(base, { dispatch: { preferences: [] } }).dispatch).toMatchObject({ preferences: [], preferencePrompt: 'legacy' })
    expect(mergeKunAdeSettings(base, { dispatch: { autoStartSeconds: 0 } }).dispatch.preferences).toEqual([rule])
  })
})
