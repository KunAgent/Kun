import { describe, expect, it } from 'vitest'
import { cursorModelMetadata } from './cursor-model-metadata'

describe('Cursor SDK capability metadata', () => {
  it('uses only the default executable variant and records alternatives as conditional', () => {
    const profile = cursorModelMetadata({ id: 'test', displayName: 'Test', variants: [
      { displayName: 'Default', isDefault: true, params: [{ id: 'context', value: '200k' }, { id: 'thinking', value: 'high' }] },
      { displayName: 'Max', params: [{ id: 'context', value: '1m' }] }
    ] })
    expect(profile).toMatchObject({ contextWindowTokens: 200_000, supportsReasoning: true,
      reasoning: { supportedEfforts: ['high'], defaultEffort: 'high', nativeEfforts: ['high'], effortMapping: { high: 'high' } },
      conditionalCapabilities: [{ condition: 'cursor-sdk-variant:Max', contextWindowTokens: 1_000_000 }] })
  })
  it('does not activate a possible variant when no default is declared', () => {
    expect(cursorModelMetadata({ id: 'test', displayName: 'Test', variants: [
      { displayName: 'Max', params: [{ id: 'context', value: '1m' }] }
    ] })).not.toHaveProperty('contextWindowTokens')
  })
  it('keeps standalone parameter options conditional when the SDK supplies no selected value', () => {
    const profile = cursorModelMetadata({ id: 'test', displayName: 'Test', parameters: [
      { id: 'context', values: [{ value: '200k' }, { value: '1m' }] },
      { id: 'reasoning', values: [{ value: 'high' }, { value: 'xhigh' }] }
    ] })
    expect(profile?.contextWindowTokens).toBeUndefined()
    expect(profile?.reasoning).toMatchObject({
      supportedEfforts: ['high', 'max'],
      defaultEffort: 'high',
      effortMapping: { high: 'high', max: 'xhigh' },
      nativeEfforts: ['high', 'xhigh']
    })
    expect(profile?.conditionalCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ condition: 'cursor-sdk-parameter:context=1m', contextWindowTokens: 1_000_000 })
    ]))
    expect(profile?.conditionalCapabilities?.some((entry) => 'reasoning' in entry)).toBe(false)
  })

  it('uses the default variant value and drops levels Kun cannot name', () => {
    const profile = cursorModelMetadata({ id: 'test', displayName: 'Test', parameters: [
      { id: 'reasoning_effort', values: [{ value: 'low' }, { value: 'high' }, { value: 'xhigh' }, { value: 'ultra' }] },
      { id: 'fast', values: [{ value: 'true' }, { value: 'false' }] }
    ], variants: [
      { displayName: 'Default', isDefault: true, params: [{ id: 'reasoning_effort', value: 'xhigh' }] }
    ] })
    expect(profile?.reasoning).toMatchObject({
      supportedEfforts: ['low', 'high', 'max'],
      defaultEffort: 'max',
      nativeEfforts: ['low', 'high', 'xhigh', 'ultra'],
      effortMapping: { low: 'low', high: 'high', max: 'xhigh' }
    })
    expect(cursorModelMetadata({ id: 'test', displayName: 'Test', parameters: [
      { id: 'optimize_for', values: [{ value: 'cost' }, { value: 'intelligence' }] }
    ] })).toBeUndefined()
    expect(cursorModelMetadata({ id: 'test', displayName: 'Test', parameters: [
      { id: 'thinking', values: [{ value: 'not-a-level' }] }
    ] })).toBeUndefined()
  })

  it('discards an invalid output limit without losing a valid context observation', () => {
    const profile = cursorModelMetadata({ id: 'test', displayName: 'Test', variants: [
      { displayName: 'Default', isDefault: true, params: [{ id: 'context', value: '200k' }, { id: 'maxOutputTokens', value: '10m' }] }
    ] })
    expect(profile?.contextWindowTokens).toBe(200_000)
    expect(profile?.maxOutputTokens).toBeUndefined()
  })

  it('keeps absent metadata unknown', () => {
    expect(cursorModelMetadata({ id: 'test', displayName: 'Test' })).toBeUndefined()
  })
})
