import { describe, expect, it } from 'vitest'
import { MODEL_PROVIDER_PRESETS } from '@shared/app-settings'
import {
  ONBOARDING_FEATURED_IDS,
  onboardingChatModels,
  onboardingConfigureIssue,
  onboardingEntryForSelection,
  onboardingProviderCount,
  onboardingProviderEntries,
  onboardingProviderEntry,
  onboardingTabCounts,
  onboardingTabEntries,
  searchOnboardingProviders
} from './onboarding-provider-catalog'
import {
  canOpenOnboardingStep,
  nextOnboardingStep,
  onboardingDirection,
  onboardingEnterAdvances,
  previousOnboardingStep
} from './onboarding-steps'

describe('onboarding provider catalog', () => {
  it('lists DeepSeek, every preset and every Token Plan once', () => {
    const entries = onboardingProviderEntries()
    const plans = MODEL_PROVIDER_PRESETS.filter((preset) => preset.tokenPlan).length
    expect(entries).toHaveLength(1 + MODEL_PROVIDER_PRESETS.length + plans)
    expect(onboardingProviderCount()).toBe(1 + MODEL_PROVIDER_PRESETS.length)
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length)
    const counts = onboardingTabCounts()
    expect(counts.api + counts.plan + counts.login + counts.local).toBe(entries.length)
  })

  it('keeps the featured row in its curated order', () => {
    expect(onboardingTabEntries('featured').map((entry) => entry.id)).toEqual([...ONBOARDING_FEATURED_IDS])
  })

  it('routes subscription logins, local servers and plans to their tabs', () => {
    expect(onboardingProviderEntry('codex')).toEqual(expect.objectContaining({ tab: 'login', connect: 'login', loginFlow: 'codex' }))
    expect(onboardingProviderEntry('claude-subscription')?.loginFlow).toBe('claude')
    expect(onboardingProviderEntry('cursor-subscription')).toEqual(expect.objectContaining({ tab: 'login', connect: 'key' }))
    expect(onboardingProviderEntry('ollama-local')).toEqual(expect.objectContaining({ tab: 'local', connect: 'local' }))
    expect(onboardingProviderEntry('kimi-code')?.tab).toBe('plan')
    expect(onboardingProviderEntry('xiaomi:token-plan')).toEqual(expect.objectContaining({ tab: 'plan', mode: 'token-plan', speech: true }))
    expect(onboardingProviderEntry('xiaomi')?.speech).toBe(true)
    expect(onboardingProviderEntry('minimax')?.image).toBe(true)
  })

  it('filters plans by region and searches the whole catalog', () => {
    const china = onboardingTabEntries('plan', 'china')
    expect(china.length).toBeGreaterThan(0)
    expect(china.every((entry) => entry.region === 'china')).toBe(true)
    expect(searchOnboardingProviders('ollama').map((entry) => entry.id)).toEqual(expect.arrayContaining(['ollama-local', 'ollama']))
    expect(searchOnboardingProviders('   ')).toEqual([])
  })

  it('maps a selection back to its entry', () => {
    expect(onboardingEntryForSelection({ presetId: 'minimax', mode: 'token-plan' })?.id).toBe('minimax:token-plan')
    expect(onboardingEntryForSelection({ presetId: 'deepseek', mode: 'api' })?.id).toBe('deepseek')
    expect(onboardingEntryForSelection({ presetId: 'custom', mode: 'api' })).toBeNull()
  })

  it('keeps discovered chat models in order and drops embeddings and audio', () => {
    expect(onboardingChatModels(['gpt-x', 'text-embedding-3', 'whisper-1', 'gpt-x', ' gpt-y '])).toEqual(['gpt-x', 'gpt-y'])
    expect(onboardingChatModels(Array.from({ length: 40 }, (_, index) => `m-${index}`), 5)).toHaveLength(5)
  })

  it('says what still blocks the configure page', () => {
    const openai = onboardingProviderEntry('openai-api')!
    expect(onboardingConfigureIssue(onboardingProviderEntry('deepseek'), 'deepseek', { apiKey: '', baseUrl: '' })).toBe('key')
    expect(onboardingConfigureIssue(openai, 'openai-api', { apiKey: '', baseUrl: '' })).toBe('key')
    expect(onboardingConfigureIssue(openai, 'openai-api', { apiKey: 'sk-1', baseUrl: '' })).toBe('model')
    expect(onboardingConfigureIssue(openai, 'openai-api', { apiKey: 'sk-1', baseUrl: '', models: ['gpt-x'] })).toBeNull()
    const local = onboardingProviderEntry('ollama-local')!
    expect(onboardingConfigureIssue(local, 'ollama-local', { apiKey: '', baseUrl: 'http://localhost:11434/v1', models: ['qwen3:8b'] })).toBeNull()
    expect(onboardingConfigureIssue(onboardingProviderEntry('codex'), 'codex', { apiKey: '', baseUrl: '' })).toBe('login')
    expect(onboardingConfigureIssue(null, 'custom-provider-onboarding', { apiKey: 'k', baseUrl: '' })).toBe('baseUrl')
  })
})

describe('onboarding steps', () => {
  it('walks forward and backward through the five steps', () => {
    expect(nextOnboardingStep('welcome')).toBe('model')
    expect(nextOnboardingStep('ready')).toBe('ready')
    expect(previousOnboardingStep('welcome')).toBe('welcome')
    expect(onboardingDirection('agents', 'model')).toBe('backward')
    expect(onboardingDirection('model', 'permission')).toBe('forward')
  })

  it('only lets the stepper jump forward past the save once it happened', () => {
    expect(canOpenOnboardingStep('welcome', 'permission', false)).toBe(true)
    expect(canOpenOnboardingStep('permission', 'welcome', false)).toBe(false)
    expect(canOpenOnboardingStep('agents', 'permission', false)).toBe(false)
    expect(canOpenOnboardingStep('ready', 'permission', true)).toBe(true)
  })

  it('advances on Enter only from single-line inputs', () => {
    expect(onboardingEnterAdvances({ tagName: 'INPUT', type: 'password' } as unknown as EventTarget)).toBe(true)
    expect(onboardingEnterAdvances({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false)
    expect(onboardingEnterAdvances({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
    expect(onboardingEnterAdvances(null)).toBe(false)
  })
})
