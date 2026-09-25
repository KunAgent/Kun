import { describe, expect, it } from 'vitest'
import {
  resolveModelEndpointUrl,
  type ModelEndpointFormat
} from '../../kun/src/contracts/model-endpoint-format.js'
import {
  upstreamOpenAiChatCompletionsUrl,
  upstreamOpenAiModelsUrl
} from './openai-compat-url'
import { MODEL_PROVIDER_PRESETS } from './model-provider-presets'

/** Any versioned path segment (`v1`, `v4`, `v1beta`, `v2alpha3`, ...) must not gain another `/v1` later in the path. */
const DOUBLE_VERSION_RE = /\/v\d+(?:alpha|beta)?\d*\/[^/?#]+\/v\d+(?:alpha|beta)?\d*\//i

function endpointSuffix(format: ModelEndpointFormat): string {
  return format === 'responses' ? 'responses' : format === 'messages' ? 'messages' : 'chat/completions'
}

describe('resolveModelEndpointUrl', () => {
  it('appends the suffix directly to any versioned path segment', () => {
    expect(resolveModelEndpointUrl('https://open.bigmodel.cn/api/paas/v4', 'chat_completions'))
      .toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    expect(resolveModelEndpointUrl('https://open.bigmodel.cn/api/paas/v4', 'chat_completions', 'models'))
      .toBe('https://open.bigmodel.cn/api/paas/v4/models')
    expect(resolveModelEndpointUrl('https://api.example.com/v2alpha3', 'responses'))
      .toBe('https://api.example.com/v2alpha3/responses')
  })

  it('fixes the Gemini preset: /v1beta/openai never gains another /v1', () => {
    const base = 'https://generativelanguage.googleapis.com/v1beta/openai'
    expect(resolveModelEndpointUrl(base, 'chat_completions'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(resolveModelEndpointUrl(base, 'chat_completions', 'models'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/models')
    expect(upstreamOpenAiChatCompletionsUrl(base))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(upstreamOpenAiModelsUrl(base))
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai/models')
  })

  it('appends /v1 for unversioned paths such as relay /anthropic mounts', () => {
    expect(resolveModelEndpointUrl('https://relay.example.com/anthropic', 'messages'))
      .toBe('https://relay.example.com/anthropic/v1/messages')
    expect(resolveModelEndpointUrl('https://relay.example.com/anthropic', 'messages', 'models'))
      .toBe('https://relay.example.com/anthropic/v1/models')
  })

  it('upgrades the DeepSeek /beta suffix to /v1 for generate and models', () => {
    expect(resolveModelEndpointUrl('https://api.deepseek.com/beta', 'chat_completions'))
      .toBe('https://api.deepseek.com/v1/chat/completions')
    expect(resolveModelEndpointUrl('https://api.deepseek.com/beta', 'chat_completions', 'models'))
      .toBe('https://api.deepseek.com/v1/models')
  })

  it('keeps full endpoint paths and custom endpoints untouched', () => {
    expect(resolveModelEndpointUrl('https://x.example.com/v1/chat/completions', 'chat_completions'))
      .toBe('https://x.example.com/v1/chat/completions')
    expect(resolveModelEndpointUrl('https://x.example.com/v1/chat/completions', 'messages'))
      .toBe('https://x.example.com/v1/messages')
    expect(resolveModelEndpointUrl('https://x.example.com/full/path?api-version=1', 'custom_endpoint'))
      .toBe('https://x.example.com/full/path?api-version=1')
    expect(() => resolveModelEndpointUrl('https://x.example.com/full/path', 'custom_endpoint', 'models'))
      .toThrow(/custom_endpoint/)
  })

  it('targets the Codex subscription endpoints for generate and models', () => {
    expect(resolveModelEndpointUrl('https://chatgpt.com/backend-api/codex', 'responses'))
      .toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(resolveModelEndpointUrl('https://chatgpt.com/backend-api/codex/responses', 'responses'))
      .toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(resolveModelEndpointUrl('https://chatgpt.com/backend-api/codex', 'responses', 'models'))
      .toBe('https://chatgpt.com/backend-api/codex/models')
  })
})

describe('provider preset URL coverage', () => {
  const httpPresets = MODEL_PROVIDER_PRESETS.filter((preset) => !preset.kind && preset.baseUrl.trim())

  it('every preset builds a single-version generate URL ending with the format suffix', () => {
    for (const preset of httpPresets) {
      const format = preset.endpointFormat
      const url = resolveModelEndpointUrl(preset.baseUrl, format)
      const suffix = endpointSuffix(format)
      if (format === 'custom_endpoint') {
        expect(url, preset.id).toBe(preset.baseUrl.trim().replace(/\/+$/, ''))
      } else {
        expect(url, `${preset.id}: ${url}`).not.toMatch(DOUBLE_VERSION_RE)
        expect(url.endsWith(`/${suffix}`), `${preset.id}: ${url}`).toBe(true)
      }
    }
  })

  it('every preset builds a single-version models URL', () => {
    for (const preset of httpPresets) {
      if (preset.endpointFormat === 'custom_endpoint') continue
      const url = resolveModelEndpointUrl(preset.baseUrl, preset.endpointFormat, 'models')
      expect(url, `${preset.id}: ${url}`).not.toMatch(DOUBLE_VERSION_RE)
      expect(url.endsWith('/models'), `${preset.id}: ${url}`).toBe(true)
    }
  })

  it('Token Plan and API regional bases build clean URLs', () => {
    const regionalBases: Array<{ id: string; baseUrl: string; format: ModelEndpointFormat }> = []
    for (const preset of MODEL_PROVIDER_PRESETS) {
      for (const region of preset.regions ?? []) {
        regionalBases.push({ id: `${preset.id}:${region.id}`, baseUrl: region.baseUrl, format: preset.endpointFormat })
      }
      const plan = preset.tokenPlan
      if (plan) {
        for (const region of plan.regions ?? [{ id: 'default', baseUrl: plan.baseUrl }]) {
          regionalBases.push({ id: `${preset.id}-token-plan:${region.id}`, baseUrl: region.baseUrl, format: plan.endpointFormat })
        }
      }
    }
    expect(regionalBases.length).toBeGreaterThan(0)
    for (const entry of regionalBases) {
      if (entry.format === 'custom_endpoint') continue
      const url = resolveModelEndpointUrl(entry.baseUrl, entry.format)
      expect(url, `${entry.id}: ${url}`).not.toMatch(DOUBLE_VERSION_RE)
      expect(url.endsWith(`/${endpointSuffix(entry.format)}`), `${entry.id}: ${url}`).toBe(true)
      const models = resolveModelEndpointUrl(entry.baseUrl, entry.format, 'models')
      expect(models, `${entry.id}: ${models}`).not.toMatch(DOUBLE_VERSION_RE)
      expect(models.endsWith('/models'), `${entry.id}: ${models}`).toBe(true)
    }
  })

  it('GUI url builders produce the same URLs as the shared contract', () => {
    const bases = [
      'https://api.deepseek.com',
      'https://api.deepseek.com/beta',
      'https://open.bigmodel.cn/api/paas/v4',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'https://relay.example.com/anthropic',
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/custom-path/'
    ]
    for (const base of bases) {
      expect(upstreamOpenAiChatCompletionsUrl(base))
        .toBe(resolveModelEndpointUrl(base, 'chat_completions', 'generate'))
      expect(upstreamOpenAiModelsUrl(base))
        .toBe(resolveModelEndpointUrl(base, 'chat_completions', 'models'))
    }
  })
})
