import { describe, expect, it } from 'vitest'
import { usageRecordsFromRows, type UsageRow } from './hybrid-thread-support.js'

describe('usageRecordsFromRows', () => {
  it('preserves turn ids, cache writes, and current attribution across cumulative rows', () => {
    const rows: UsageRow[] = [
      row(1, 'turn-priority', {
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
        cacheWriteTokens: 20,
        cacheHitRate: null,
        turns: 1,
        actualProviderId: 'codex-work',
        actualModelId: 'gpt-5.6-sol',
        billingKind: 'subscription',
        serviceTier: 'priority'
      }),
      row(2, 'turn-standard', {
        promptTokens: 250,
        completionTokens: 30,
        totalTokens: 280,
        cacheWriteTokens: 50,
        cacheHitRate: null,
        turns: 2,
        actualProviderId: 'openai-api',
        actualModelId: 'gpt-5.4-mini',
        billingKind: 'api'
      })
    ]

    const records = usageRecordsFromRows(rows)
    expect(records[0]).toMatchObject({
      turnId: 'turn-priority',
      usage: {
        cacheWriteTokens: 20,
        actualProviderId: 'codex-work',
        billingKind: 'subscription',
        serviceTier: 'priority'
      }
    })
    expect(records[1]).toMatchObject({
      turnId: 'turn-standard',
      usage: {
        promptTokens: 150,
        completionTokens: 20,
        cacheWriteTokens: 30,
        actualProviderId: 'openai-api',
        actualModelId: 'gpt-5.4-mini',
        billingKind: 'api'
      }
    })
    expect(records[1]?.usage.serviceTier).toBeUndefined()
  })
})

function row(seq: number, turnId: string, usage: Record<string, unknown>): UsageRow {
  return {
    thread_id: 'thread-1',
    seq,
    timestamp: `2026-08-09T00:00:0${seq}.000Z`,
    turn_id: turnId,
    model: 'gpt-5.6-sol',
    usage_json: JSON.stringify(usage)
  }
}
