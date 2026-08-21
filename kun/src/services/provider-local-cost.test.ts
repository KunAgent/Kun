import { describe, expect, it } from 'vitest'
import { aggregateCodexProviderLocalCosts } from './provider-local-cost.js'

describe('provider local Codex costs', () => {
  const now = new Date('2026-08-20T12:00:00.000Z')

  it('keeps configured Codex accounts isolated and marks ambiguous legacy usage', () => {
    const result = aggregateCodexProviderLocalCosts({
      now,
      profiles: [
        { id: 'codex-work', presetId: 'codex' },
        { id: 'codex-personal', presetId: 'codex' },
        { id: 'deepseek', presetId: 'deepseek' }
      ],
      records: [{
        completedAt: '2026-08-20T10:00:00.000Z',
        model: 'gpt-5.6-sol',
        usage: {
          promptTokens: 1_000,
          completionTokens: 100,
          totalTokens: 1_100,
          actualProviderId: 'codex-work',
          actualModelId: 'gpt-5.6-sol',
          billingKind: 'subscription'
        }
      }, {
        completedAt: '2026-08-18T10:00:00.000Z',
        model: 'gpt-future-codex',
        usage: {
          promptTokens: 500,
          completionTokens: 50,
          totalTokens: 550,
          actualProviderId: 'codex-personal',
          billingKind: 'subscription'
        }
      }, {
        completedAt: '2026-08-20T09:00:00.000Z',
        model: 'codex/gpt-5.6-luna',
        usage: {
          promptTokens: 400,
          completionTokens: 40,
          totalTokens: 440,
          billingKind: 'subscription'
        }
      }]
    })

    expect(result['codex-work']).toMatchObject({
      kind: 'reference_api_estimate',
      currency: 'USD',
      today: {
        requests: 1,
        totalTokens: 1_100,
        coverage: 'complete'
      },
      last30Days: {
        requests: 1,
        totalTokens: 1_100,
        coverage: 'complete'
      }
    })
    expect(result['codex-work']?.today.amount).toBeGreaterThan(0)
    expect(result['codex-personal']).toMatchObject({
      today: { requests: 0, totalTokens: 0, amount: 0, coverage: 'complete' },
      last30Days: { requests: 1, totalTokens: 550, amount: null, coverage: 'unavailable' }
    })
    expect(result.deepseek).toBeUndefined()
  })

  it('attributes legacy usage only when exactly one Codex account exists', () => {
    const result = aggregateCodexProviderLocalCosts({
      now,
      profiles: [{ id: 'codex-only', presetId: 'codex' }],
      records: [{
        completedAt: '2026-08-20T08:00:00.000Z',
        model: 'codex/gpt-5.6-luna',
        usage: {
          promptTokens: 2_000,
          completionTokens: 200,
          totalTokens: 2_200
        }
      }, {
        completedAt: '2026-08-20T08:30:00.000Z',
        model: 'openai/gpt-5.6-sol',
        usage: {
          promptTokens: 9_000,
          completionTokens: 900,
          totalTokens: 9_900,
          billingKind: 'api'
        }
      }]
    })

    expect(result['codex-only']?.today).toMatchObject({
      requests: 1,
      totalTokens: 2_200,
      coverage: 'complete'
    })
    expect(result['codex-only']?.today.amount).toBeGreaterThan(0)
  })

  it('reports an exact complete zero for empty windows', () => {
    const result = aggregateCodexProviderLocalCosts({
      now,
      profiles: [{ id: 'codex', presetId: 'codex' }],
      records: [{
        completedAt: '2026-08-20T10:00:00.000Z',
        model: 'gpt-5.6-sol',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          turns: 0,
          actualProviderId: 'codex'
        }
      }]
    })

    expect(result.codex?.today).toEqual({
      requests: 0,
      totalTokens: 0,
      amount: 0,
      coverage: 'complete'
    })
    expect(result.codex?.last30Days).toEqual(result.codex?.today)
  })
})
