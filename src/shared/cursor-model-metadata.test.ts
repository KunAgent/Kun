import { describe, expect, it } from 'vitest'
import { cursorModelMetadata } from './cursor-model-metadata'

describe('Cursor SDK capability metadata', () => {
  it('uses only the default executable variant and records alternatives as conditional', () => {
    const profile = cursorModelMetadata({ id: 'test', displayName: 'Test', variants: [
      { displayName: 'Default', isDefault: true, params: [{ id: 'context', value: '200k' }, { id: 'thinking', value: 'high' }] },
      { displayName: 'Max', params: [{ id: 'context', value: '1m' }] }
    ] })
    expect(profile).toMatchObject({ contextWindowTokens: 200_000, supportsReasoning: true,
      reasoning: { supportedEfforts: ['auto'], nativeEfforts: ['high'] },
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
    expect(profile?.reasoning).toBeUndefined()
    expect(profile?.conditionalCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ condition: 'cursor-sdk-parameter:context=1m', contextWindowTokens: 1_000_000 }),
      expect.objectContaining({ condition: 'cursor-sdk-parameter:reasoning=xhigh', reasoning: expect.objectContaining({ nativeEfforts: ['xhigh'] }) })
    ]))
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
