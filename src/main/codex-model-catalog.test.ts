import { describe, expect, it } from 'vitest'
import { parseCodexModelCatalog } from './codex-model-catalog'

describe('Codex catalog', () => {
  it('imports new models and capabilities without excluding subscription-only models', () => {
    const result = parseCodexModelCatalog(JSON.stringify({ models: [
      { slug: 'gpt-6-astra', visibility: 'list', context_window: 272000,
        input_modalities: ['text', 'image'], use_responses_lite: true,
        service_tiers: [{ id: 'priority' }], default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'ultra' }] },
      { slug: 'gpt-5.3-codex-spark', visibility: 'list', supported_in_api: false },
      { slug: 'internal-model', visibility: 'hide' },
      { slug: 'gpt-6-astra', visibility: 'list' }, null, { slug: ' ', visibility: 'list' }
    ] }))
    expect(result.modelIds).toEqual(['gpt-6-astra', 'gpt-5.3-codex-spark'])
    expect(result.modelProfiles['gpt-6-astra']).toMatchObject({
      contextWindowTokens: 272000, inputModalities: ['text', 'image'],
      responsesMode: 'lite', serviceTiers: ['priority'],
      reasoning: { supportedEfforts: ['low', 'medium'], defaultEffort: 'medium', requestProtocol: 'openai-responses' }
    })
  })

  it('keeps account-visible gpt-6-sol and gpt-6-luna but not hidden catalog rows', () => {
    const result = parseCodexModelCatalog(JSON.stringify({ models: [
      { slug: 'gpt-6-sol', visibility: 'list', context_window: 372000 },
      { slug: 'gpt-6-luna', visibility: 'list', supported_in_api: false },
      { slug: 'gpt-6-sol-internal', visibility: 'hide' },
      { slug: 'gpt-6-luna-preview', visibility: 'hide' }
    ] }))
    expect(result.modelIds).toEqual(['gpt-6-sol', 'gpt-6-luna'])
    expect(result.modelProfiles['gpt-6-sol'].contextWindowTokens).toBe(372000)
  })

  it('keeps a missing tier field unknown and a declared tier list explicit', () => {
    const result = parseCodexModelCatalog(JSON.stringify({ models: [
      { slug: 'gpt-6-astra', visibility: 'list', service_tiers: [] },
      { slug: 'gpt-6-vega', visibility: 'list', service_tiers: [{ id: 'flex' }, { id: 'standard' }] },
      { slug: 'gpt-6-nova', visibility: 'list', service_tiers: 'priority' },
      { slug: 'gpt-6-orion', visibility: 'list' }
    ] }))
    expect(result.modelProfiles['gpt-6-astra'].serviceTiers).toEqual([])
    expect(result.modelProfiles['gpt-6-vega'].serviceTiers).toEqual(['flex'])
    expect(result.modelProfiles['gpt-6-nova'].serviceTiers).toBeUndefined()
    expect(result.modelProfiles['gpt-6-orion'].serviceTiers).toBeUndefined()
  })

  it('rejects malformed responses instead of substituting a static catalog', () => {
    for (const body of ['<html>error</html>', '{}', 'null', '{"models":{}}']) {
      expect(() => parseCodexModelCatalog(body)).toThrow()
    }
    expect(parseCodexModelCatalog('{"models":[]}').modelIds).toEqual([])
  })
})
