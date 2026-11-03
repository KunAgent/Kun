import { describe, expect, it, vi, afterEach } from 'vitest'
import { parseCodexModelDescriptors, parseProviderModelDescriptor, parseNativeReasoning } from './provider-model-descriptors.js'
import { probeModelDescriptors } from './model-connection-probe.js'
import { resolvePresetDiscovery } from '@kun/provider-catalog'

afterEach(() => vi.unstubAllGlobals())
describe('account model metadata discovery', () => {
  it('retains xhigh default and wire mapping without activating a conditional context extension', () => {
    const result = parseCodexModelDescriptors(JSON.stringify({ models: [{ slug: 'test-model', visibility: 'list',
      context_window: 272000, max_context_window: 1000000, max_input_tokens: 250000, max_output_tokens: 128000,
      supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh'].map((effort) => ({ effort })), default_reasoning_level: 'xhigh', service_tiers: [] }] }))
    expect(result.modelProfiles['test-model']).toMatchObject({ contextWindowTokens: 272000, maxInputTokens: 250000,
      maxOutputTokens: 128000, reasoning: { defaultEffort: 'max', nativeDefaultEffort: 'xhigh', effortMapping: { max: 'xhigh' } },
      conditionalCapabilities: [{ contextWindowTokens: 1000000 }], serviceTiers: [] })
    expect(result.modelProfiles['test-model'].supportsToolCalling).toBeUndefined()
  })
  it('offers the standard Responses levels when a listed Codex model reports none, unless reasoning is denied', () => {
    const result = parseCodexModelDescriptors(JSON.stringify({ models: [
      { slug: 'no-levels', visibility: 'list' },
      { slug: 'denied', visibility: 'list', supports_reasoning: false }] }))
    expect(result.modelProfiles['no-levels'].reasoning).toMatchObject({ supportedEfforts: ['low', 'medium', 'high', 'max'],
      defaultEffort: 'medium', requestProtocol: 'openai-responses', effortMapping: { max: 'xhigh' } })
    expect(result.modelProfiles.denied.reasoning).toBeUndefined()
  })
  it('keeps unknown, false and missing values distinct and discards only malformed fields', () => {
    expect(parseProviderModelDescriptor({ context_window: -1, max_input_tokens: 128000, supports_tools: false })).toMatchObject({
      maxInputTokens: 128000, supportsToolCalling: false, metadataIssues: [{ field: 'contextWindowTokens', code: 'invalid' }] })
    expect(parseProviderModelDescriptor({ reasoning: true }).reasoning).toBeUndefined()
    expect(parseProviderModelDescriptor({}).inputModalities).toBeUndefined()
    expect(parseNativeReasoning(['unrecognized'], 'unrecognized', 'openai-responses')).toMatchObject({ supportedEfforts: ['auto'], nativeEfforts: ['unrecognized'], nativeDefaultEffort: 'unrecognized', effortMapping: {} })
    expect(parseNativeReasoning(['low', 'minimal', 'xhigh'], 'minimal', 'openai-responses')).toMatchObject({ defaultEffort: 'low', effortMapping: { low: 'minimal', max: 'xhigh' } })
  })
  it('preserves explicit reasoning denial and distinguishes disabled levels from unknown capability', () => {
    for (const field of ['reasoning', 'supports_reasoning']) {
      expect(parseProviderModelDescriptor({ [field]: false, reasoning_efforts: ['high', 'xhigh'] }).supportsReasoning).toBe(false)
    }
    expect(parseProviderModelDescriptor({ reasoning: false, supports_reasoning: 'invalid', reasoning_efforts: ['high'] }).supportsReasoning).toBe(false)
    expect(parseProviderModelDescriptor({ reasoning_efforts: ['off', 'none'] }).supportsReasoning).toBe(false)
    expect(parseProviderModelDescriptor({ reasoning_efforts: ['', '  ', null, {}, 3] }).supportsReasoning).toBeUndefined()
    expect(parseNativeReasoning(['', '  ', null, {}, 3, 'high'], '', 'openai-responses')).toMatchObject({ nativeEfforts: ['high'], supportedEfforts: ['high'], defaultEffort: 'high' })
    expect(parseProviderModelDescriptor({ reasoning_efforts: ['off', 'unknown-level'] }).supportsReasoning).toBe(true)
  })
  it('returns live profiles and a successful empty list without restoring fallback selections', async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ id: 'private', context_window: 65536, limit: { input: 60000 }, supports_tools: false }] }))
    vi.stubGlobal('fetch', fetcher)
    const input = { kind: 'http' as const, baseUrl: 'https://provider.test/v1', apiKey: 'test', fallbackModels: ['old'], proxyUrl: '' }
    expect(await probeModelDescriptors(input)).toMatchObject({ models: ['private'], modelProfiles: { private: { contextWindowTokens: 65536, maxInputTokens: 60000, supportsToolCalling: false } } })
    fetcher.mockResolvedValueOnce(Response.json({ data: [] }))
    expect((await probeModelDescriptors(input)).models).toEqual([])
  })
  it('applies plan policies only to matching endpoints and refuses authentication fallback', async () => {
    const preset = resolvePresetDiscovery({ id: 'baidu-qianfan-token-plan', presetSource: 'baidu-qianfan-token-plan', baseUrl: 'https://qianfan.baidubce.com/v2/tokenplan/personal' })
    expect(preset?.strategy).toBe('preset')
    expect(resolvePresetDiscovery({ id: 'baidu-qianfan-token-plan', presetSource: 'baidu-qianfan-token-plan', baseUrl: 'https://other.test' })).toBeNull()
    const fetcher = vi.fn(async () => new Response('{}', { status: 401 })); vi.stubGlobal('fetch', fetcher)
    const input = { kind: 'http' as const, baseUrl: 'https://provider.test/v1', apiKey: 'test', fallbackModels: [], proxyUrl: '',
      presetDiscovery: { strategy: 'live-with-fallback' as const, models: ['candidate'], sourceUrl: 'https://provider.test/docs', checkedAt: '2026-10-08' } }
    await expect(probeModelDescriptors(input)).rejects.toThrow('401')
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    expect(await probeModelDescriptors(input)).toMatchObject({ models: ['candidate'], source: 'preset', lastAttemptStatus: 'fallback' })
    fetcher.mockClear()
    expect((await probeModelDescriptors({ ...input, presetDiscovery: preset! })).source).toBe('preset')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
