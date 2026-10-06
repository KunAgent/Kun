import { describe, expect, it } from 'vitest'
import { ModelsDevCatalogService } from './models-dev-catalog'

describe('public catalog capability facts', () => {
  it('imports explicit supported and unsupported facts without guessing absent fields', async () => {
    const service = new ModelsDevCatalogService(async () => Response.json({ deepseek: { name: 'DeepSeek', models: {
      declared: { id: 'declared', modalities: { input: ['text'], output: ['text'] }, tool_call: true,
        parallel_tool_calls: false, structured_output: true, reasoning: true },
      unknown: { id: 'unknown', modalities: { input: ['text'], output: ['text'] } }
    } } }), () => Date.parse('2026-09-01T00:00:00.000Z'))
    const result = await service.fetch({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('Expected fixture catalog')
    const declared = result.models.find((model) => model.id === 'declared')!
    expect(declared).toMatchObject({ parallelTools: false, structuredOutput: true, reasoning: true, observedAt: '2026-09-01T00:00:00.000Z' })
    expect(declared.streaming).toBeUndefined()
    const unknown = result.models.find((model) => model.id === 'unknown')!
    expect(unknown.parallelTools).toBeUndefined(); expect(unknown.structuredOutput).toBeUndefined(); expect(unknown.toolCalling).toBeUndefined()
  })
})
