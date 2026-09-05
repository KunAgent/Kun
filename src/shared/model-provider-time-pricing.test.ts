import { describe, expect, it } from 'vitest'
import type { ModelProviderProfileV1 } from './app-settings-types'
import { modelTimePricingState, resolveModelTimePricingRule, timePricingBenefitLabel, timePricingScheduleLabel } from './model-provider-time-pricing'

function provider(overrides: Partial<ModelProviderProfileV1>): ModelProviderProfileV1 {
  return {
    id: 'custom',
    name: 'Custom',
    apiKey: '',
    baseUrl: '',
    endpointFormat: 'chat_completions',
    useProxy: false,
    models: [],
    modelProfiles: {},
    ...overrides
  }
}

describe('model provider time pricing', () => {
  it('requires the official DeepSeek identity, endpoint, and model', () => {
    const official = provider({ id: 'deepseek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-v4-pro'] })
    expect(resolveModelTimePricingRule(official, 'deepseek-v4-pro')?.benefitKind).toBe('unit-price-discount')
    expect(resolveModelTimePricingRule({ ...official, baseUrl: 'https://proxy.example' }, 'deepseek-v4-pro')).toBeUndefined()
    expect(resolveModelTimePricingRule({ ...official, id: 'custom' }, 'deepseek-v4-pro')).toBeUndefined()
    expect(resolveModelTimePricingRule(official, 'fixed-price-model')).toBeUndefined()
  })

  it('classifies every DeepSeek Beijing-time boundary', () => {
    const official = provider({ id: 'deepseek', baseUrl: 'https://api.deepseek.com' })
    const state = (iso: string): string => modelTimePricingState(official, 'deepseek-v4-flash', iso).state
    expect(state('2030-01-07T00:59:00Z')).toBe('off-peak')
    expect(state('2030-01-07T01:00:00Z')).toBe('standard')
    expect(state('2030-01-07T03:59:00Z')).toBe('standard')
    expect(state('2030-01-07T04:00:00Z')).toBe('off-peak')
    expect(state('2030-01-07T05:59:00Z')).toBe('off-peak')
    expect(state('2030-01-07T06:00:00Z')).toBe('standard')
    expect(state('2030-01-07T09:59:00Z')).toBe('standard')
    expect(state('2030-01-07T10:00:00Z')).toBe('off-peak')
    expect(state('2030-01-12T01:00:00Z')).toBe('off-peak')
    expect(state('2030-01-12T06:00:00Z')).toBe('off-peak')
  })

  it('keeps Coding Plan quota semantics separate from API prices', () => {
    const zhipu = provider({
      id: 'zhipu-account-2',
      presetSource: { presetId: 'zhipu-coding-plan', mode: 'api' }
    })
    expect(modelTimePricingState(zhipu, 'glm-5.3', '2030-01-07T05:59:00Z').state).toBe('off-peak')
    expect(modelTimePricingState(zhipu, 'glm-5.3', '2030-01-07T06:00:00Z').state).toBe('standard')
    expect(modelTimePricingState(zhipu, 'glm-5.3', '2030-01-11T09:59:00Z').state).toBe('standard')
    expect(modelTimePricingState(zhipu, 'glm-5.3', '2030-01-11T10:00:00Z').state).toBe('off-peak')
    expect(modelTimePricingState(zhipu, 'glm-5.3', '2030-01-12T07:00:00Z').state).toBe('off-peak')
    expect(modelTimePricingState(zhipu, 'glm-4.5-air', '2030-01-07T07:00:00Z').state).toBe('standard')
    expect(resolveModelTimePricingRule({ ...zhipu, presetSource: { presetId: 'zhipu', mode: 'api' } }, 'glm-5.3')).toBeUndefined()
    expect(timePricingBenefitLabel('quota-multiplier')).toContain('quota')
    expect(timePricingBenefitLabel('unit-price-discount')).toContain('price')
  })

  it('describes structured peak windows in the requested locale', () => {
    const deepseek = resolveModelTimePricingRule(
      provider({ id: 'deepseek', baseUrl: 'https://api.deepseek.com' }),
      'deepseek-v4-pro'
    )!
    const zhipu = resolveModelTimePricingRule(provider({
      presetSource: { presetId: 'zhipu-coding-plan', mode: 'api' }
    }), 'glm-4.5-air')!
    const zai = resolveModelTimePricingRule(provider({
      presetSource: { presetId: 'zai-coding-plan', mode: 'api' }
    }), 'glm-5')!
    expect(timePricingScheduleLabel(deepseek, 'zh')).toContain('周一至周五 09:00–12:00、14:00–18:00（北京时间）')
    expect(timePricingScheduleLabel(zhipu, 'zh')).toContain('周一至周五 14:00–18:00（北京时间）')
    expect(timePricingScheduleLabel(deepseek, 'en')).toContain('Monday–Friday 09:00–12:00, 14:00–18:00 (Beijing time)')
    expect(timePricingScheduleLabel(zhipu, 'en')).toContain('Monday–Friday 14:00–18:00 (Beijing time)')
    expect(timePricingScheduleLabel(zai, 'en')).toContain('Singapore time')
  })
})
