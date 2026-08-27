import { describe, expect, it } from 'vitest'
import { usageRecordsFromRows, usageRowFromEvent, type UsageRow } from './hybrid-thread-support.js'

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

  it('round-trips a persisted per-event provider id', () => {
    const rows: UsageRow[] = [
      row(1, 'turn-a', { promptTokens: 10, completionTokens: 1, totalTokens: 11, cacheHitRate: null, turns: 1 }, 'provider-a'),
      row(2, 'turn-b', { promptTokens: 30, completionTokens: 3, totalTokens: 33, cacheHitRate: null, turns: 2 }, 'provider-b')
    ]

    const records = usageRecordsFromRows(rows)
    expect(records[0]).toMatchObject({ turnId: 'turn-a', providerId: 'provider-a' })
    expect(records[1]).toMatchObject({ turnId: 'turn-b', providerId: 'provider-b' })
  })

  it('treats legacy rows without provider ids as unattributed', () => {
    const rows: UsageRow[] = [
      row(1, 'turn-legacy', { promptTokens: 10, completionTokens: 1, totalTokens: 11, cacheHitRate: null, turns: 1 })
    ]

    const records = usageRecordsFromRows(rows)
    expect(records).toHaveLength(1)
    expect(records[0].providerId).toBeUndefined()
  })
})

describe('usageRowFromEvent', () => {
  it('carries the event provider id into the provider_id column', () => {
    const row = usageRowFromEvent({
      kind: 'usage',
      threadId: 'thread-1',
      seq: 7,
      timestamp: '2026-08-23T00:00:00.000Z',
      turnId: 'turn-7',
      model: 'glm-5.3',
      providerId: 'zhipu-coding-plan',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheHitRate: null, turns: 1 }
    })
    expect(row.provider_id).toBe('zhipu-coding-plan')
  })

  it('writes null for events recorded before provider attribution', () => {
    const row = usageRowFromEvent({
      kind: 'usage',
      threadId: 'thread-1',
      seq: 8,
      timestamp: '2026-08-23T00:00:00.000Z',
      turnId: 'turn-8',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheHitRate: null, turns: 1 }
    })
    expect(row.provider_id).toBeNull()
  })
})

function row(
  seq: number,
  turnId: string,
  usage: Record<string, unknown>,
  providerId?: string
): UsageRow {
  return {
    thread_id: 'thread-1',
    seq,
    timestamp: `2026-08-09T00:00:0${seq}.000Z`,
    turn_id: turnId,
    model: 'gpt-5.6-sol',
    provider_id: providerId ?? null,
    usage_json: JSON.stringify(usage)
  }
}
