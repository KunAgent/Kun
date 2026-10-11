import { describe, expect, it } from 'vitest'
import { resolveModelEndpointUrl, type ModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
import {
  MODEL_PROVIDER_PRESETS,
  modelProviderPresetProfile,
  modelProviderTokenPlanProfile,
  withPresetRegion
} from './model-provider-presets'
import type { ModelProviderEndpointsV1, ModelProviderProfileV1 } from './app-settings-types'

const FORMATS = ['chat_completions', 'responses', 'messages'] as const

/** Final request URLs a profile produces: the default format plus each declared protocol endpoint. */
function requestUrls(profile: ModelProviderProfileV1): Record<string, string> {
  const out: Record<string, string> = {}
  const generate = (base: string, format: ModelEndpointFormat): string => resolveModelEndpointUrl(base, format, 'generate')
  out[profile.endpointFormat] = generate(profile.endpoints?.[profile.endpointFormat as keyof ModelProviderEndpointsV1] ?? profile.baseUrl,
    profile.endpointFormat)
  for (const format of FORMATS) {
    const base = profile.endpoints?.[format]
    if (base) out[format] = generate(base, format)
  }
  return out
}

/**
 * Snapshot of every preset's final request URLs. A preset edit that adds a
 * stray version segment (the historical Gemini `/v1beta/openai/v1` bug) or
 * drops a protocol endpoint shows up as a reviewable snapshot diff.
 */
describe('preset request URLs', () => {
  it('builds stable URLs for every preset, region and plan', () => {
    const table: Record<string, Record<string, string>> = {}
    for (const preset of MODEL_PROVIDER_PRESETS) {
      if (preset.kind && preset.kind !== undefined && !preset.baseUrl) continue
      const api = modelProviderPresetProfile(preset)
      table[preset.id] = requestUrls(api)
      for (const region of preset.regions ?? []) {
        table[`${preset.id}@${region.id}`] = requestUrls(withPresetRegion(preset, api, region.baseUrl))
      }
      const plan = modelProviderTokenPlanProfile(preset)
      if (plan) {
        table[`${preset.id}:token-plan`] = requestUrls(plan)
        for (const region of preset.tokenPlan?.regions ?? []) {
          const regional = modelProviderTokenPlanProfile(preset, '', region.baseUrl)
          if (regional) table[`${preset.id}:token-plan@${region.id}`] = requestUrls(regional)
        }
      }
    }
    expect(table).toMatchSnapshot()
  })

  it('never doubles a version segment and never inherits endpoints for a custom host', () => {
    for (const preset of MODEL_PROVIDER_PRESETS) {
      for (const url of Object.values(requestUrls(modelProviderPresetProfile(preset)))) {
        expect(url).not.toMatch(/\/v1\/v1\/|\/v1beta\/openai\/v1\//)
      }
    }
    const bedrock = MODEL_PROVIDER_PRESETS.find((preset) => preset.id === 'amazon-bedrock')!
    const custom = withPresetRegion(bedrock, modelProviderPresetProfile(bedrock), 'https://proxy.example.test/v1')
    expect(custom.endpoints).toBeUndefined()
    const west = withPresetRegion(bedrock, modelProviderPresetProfile(bedrock), bedrock.regions![2]!.baseUrl)
    expect(requestUrls(west).messages).toBe('https://bedrock-runtime.us-west-2.amazonaws.com/anthropic/v1/messages')
  })

  it('selects the plan tier endpoints for Qianfan Token Plan', () => {
    const qianfan = MODEL_PROVIDER_PRESETS.find((preset) => preset.id === 'baidu-qianfan')!
    const team = modelProviderTokenPlanProfile(qianfan, 'k', qianfan.tokenPlan!.regions![1]!.baseUrl)!
    expect(requestUrls(team)).toEqual({
      chat_completions: 'https://qianfan.baidubce.com/v2/tokenplan/team/chat/completions',
      responses: 'https://qianfan.baidubce.com/v2/tokenplan/team/responses',
      messages: 'https://qianfan.baidubce.com/anthropic/tokenplan/team/v1/messages'
    })
  })
})
