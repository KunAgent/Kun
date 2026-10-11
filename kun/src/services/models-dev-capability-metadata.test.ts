import { describe, expect, it } from 'vitest'
import { ModelsDevCatalogService } from './models-dev-catalog.js'

describe('public catalog scope and field semantics', () => {
  const catalog = { deepseek: { api: 'https://api.deepseek.com', models: { 'deepseek-chat': {
    limit: { context: 128000, input: 120000, output: 8000 }, reasoning: true,
    reasoning_options: [{ type: 'effort', values: ['low', 'high'], default: 'high' }]
  } } } }
  it('preserves separate input and context constraints and declared efforts', async () => {
    const service = new ModelsDevCatalogService(async () => Response.json(catalog))
    const result = await service.fetch({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' })
    expect(result.models[0]).toMatchObject({ contextWindowTokens: 128000, maxInputTokens: 120000, maxOutputTokens: 8000,
      matchSpecificity: 'exact', reasoningOptions: { supportedEfforts: ['low', 'high'], defaultEffort: 'high' } })
  })
  it('keeps subscription-to-public-catalog lookups as suggestions', async () => {
    const service = new ModelsDevCatalogService(async () => Response.json({ openai: { models: { 'gpt-test': { limit: { context: 1000000 } } } } }))
    const result = await service.fetch({ providerId: 'codex', baseUrl: 'https://chatgpt.com/backend-api/codex' })
    expect(result.models[0]?.matchSpecificity).toBe('cross-provider')
  })

  it('allows Ollama cloud metadata for the same product while preserving membership enrichment mode', async () => {
    const service = new ModelsDevCatalogService(async () => Response.json({ 'ollama-cloud': { models: { 'gpt-oss:120b': { limit: { context: 128000 } } } } }))
    const result = await service.fetch({ providerId: 'ollama', baseUrl: 'https://ollama.com/v1' })
    expect(result).toMatchObject({ matchMode: 'enrichment-only', models: [{ matchSpecificity: 'exact' }] })
  })

  it('marks a renamed provider endpoint and cross-provider family lookup as suggestions', async () => {
    const service = new ModelsDevCatalogService(async () => Response.json(catalog))
    const moved = await service.fetch({ providerId: 'deepseek', baseUrl: 'https://relay.test/v1' })
    expect(moved.models[0]?.matchSpecificity).toBe('cross-provider')
    const relay = await service.fetch({ providerId: 'relay', baseUrl: 'https://relay.test/v1', modelHints: [{ id: 'deepseek-chat' }] })
    expect(relay.models[0]?.matchSpecificity).toBe('family')
  })
})
