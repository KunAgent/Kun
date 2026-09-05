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

  it('rejects malformed responses instead of substituting a static catalog', () => {
    for (const body of ['<html>error</html>', '{}', 'null', '{"models":{}}']) {
      expect(() => parseCodexModelCatalog(body)).toThrow()
    }
    expect(parseCodexModelCatalog('{"models":[]}').modelIds).toEqual([])
  })
})
