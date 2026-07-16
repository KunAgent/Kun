import { describe, expect, it } from 'vitest'
import { buildMoaPresetPayload, type MoaPresetDraft } from './MoaPresetEditor'

describe('MoaPresetEditor', () => {
  it('builds a bounded virtual model preset without credentials', () => {
    const draft: MoaPresetDraft = {
      id: 'review-board', name: 'Review Board', description: 'Cross-check answers',
      references: ['deepseek/deepseek-chat', 'openai/gpt-4o-mini'],
      aggregator: 'deepseek/deepseek-chat',
      maxConcurrency: 2, contextBudgetTokens: 32_000,
      inputModalities: ['text', 'image']
    }
    const payload = buildMoaPresetPayload(draft)

    expect(payload).toMatchObject({
      id: 'review-board',
      layers: [
        { type: 'proposer', models: draft.references },
        { type: 'aggregator', models: [draft.aggregator] }
      ],
      maxConcurrency: 2,
      contextBudgetTokens: 32_000
    })
    expect(JSON.stringify(payload)).not.toMatch(/apiKey|credential|secret/i)
  })
})
