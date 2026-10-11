import { describe, expect, it } from 'vitest'
import {
  initialOpenProviderSections, providerModelSections, providerQualifiedModel, providerSectionIconPreset, providerSectionModelName
} from './composer-provider-model-sections'

const info = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).map(([id, displayName]) => [id, { id, displayName }]))
const OPENCODE = {
  nativeHarnessId: 'opencode',
  modelInfo: info({ 'openai/gpt-6-luna': 'OpenAI/GPT-6 Luna', 'openai/gpt-6-sol': 'OpenAI/GPT-6 Sol',
    'opencode/big-pickle': 'OpenCode Zen/Big Pickle', 'google/gemini-2.5-pro': 'google/Gemini 2.5 Pro' })
}
const IDS = ['openai/gpt-6-luna', 'openai/gpt-6-sol', 'opencode/big-pickle', 'google/gemini-2.5-pro']

describe('provider sections in an Agent catalog', () => {
  it('splits provider-qualified ids and display names', () => {
    expect(providerQualifiedModel('opencode/big-pickle', 'OpenCode Zen/Big Pickle')).toEqual({ key: 'opencode', provider: 'OpenCode Zen', model: 'Big Pickle' })
    expect(providerQualifiedModel('openai/gpt-6')).toEqual({ key: 'openai', provider: 'openai', model: 'gpt-6' })
    expect(providerQualifiedModel('claude-sonnet-5', 'Claude Sonnet 5')).toBeUndefined()
    expect(providerQualifiedModel('trailing/')).toBeUndefined()
  })
  it('groups by provider in the Agent\'s order and names rows by model only', () => {
    expect(providerModelSections(OPENCODE, IDS)).toEqual([
      { key: 'openai', label: 'OpenAI', modelIds: ['openai/gpt-6-luna', 'openai/gpt-6-sol'] },
      { key: 'opencode', label: 'OpenCode Zen', modelIds: ['opencode/big-pickle'] },
      { key: 'google', label: 'google', modelIds: ['google/gemini-2.5-pro'] }
    ])
    expect(providerSectionModelName(OPENCODE, 'opencode/big-pickle')).toBe('Big Pickle')
  })
  it('keeps flat lists for one provider, mixed ids, Kun providers and Devin', () => {
    expect(providerModelSections(OPENCODE, ['openai/gpt-6-luna', 'openai/gpt-6-sol'])).toBeUndefined()
    expect(providerModelSections(OPENCODE, ['openai/gpt-6-luna', 'claude-sonnet-5'])).toBeUndefined()
    expect(providerModelSections({ modelInfo: OPENCODE.modelInfo }, IDS)).toBeUndefined()
    expect(providerModelSections({ ...OPENCODE, nativeHarnessId: 'devin' }, IDS)).toBeUndefined()
  })
  it('uses a provider\'s own mark and never Kun\'s for unknown providers', () => {
    expect(providerSectionIconPreset('openai')).toBe('openai-api')
    expect(providerSectionIconPreset('opencode')).toBe('opencode-zen')
    expect(providerSectionIconPreset('deepseek')).toBe('deepseek')
    expect(providerSectionIconPreset('some-local-lab')).toBeUndefined()
  })
  it('opens every section of a short list, else the one holding the current model', () => {
    const sections = providerModelSections(OPENCODE, IDS)!
    expect([...initialOpenProviderSections(sections, 'opencode/big-pickle', 12)]).toEqual(['openai', 'opencode', 'google'])
    expect([...initialOpenProviderSections(sections, 'opencode/big-pickle', 2)]).toEqual(['opencode'])
    expect([...initialOpenProviderSections(sections, 'default', 2)]).toEqual(['openai'])
  })
})
