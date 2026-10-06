import { describe, expect, it } from 'vitest'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import { UsageService } from '../services/usage-service.js'
import { usageRecordsFromRows, type UsageRow } from '../adapters/hybrid/hybrid-thread-support.js'
import { buildThreadUsageResponse } from '../services/usage-service-responses.js'
import { withHarnessUsageLedger } from './harness-usage-ledger.js'
import type { UsageSnapshot } from '../contracts/usage.js'

function recorder() {
  const recorded: RuntimeEventDraft[] = []
  return { recorded, events: { record: async (draft: RuntimeEventDraft) => { recorded.push(draft); return draft }, extra: () => 'kept' } }
}

const usage = (prompt: number, completion: number, cached = 0): UsageSnapshot => ({
  promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion,
  cacheHitRate: cached ? cached / prompt : null, turns: 0,
  ...(cached ? { cachedTokens: cached, cacheHitTokens: cached, cacheMissTokens: prompt - cached } : {})
})
const draft = (turnId: string, snapshot: UsageSnapshot): RuntimeEventDraft =>
  ({ kind: 'usage', threadId: 'thread', turnId, model: 'swe-2-high', usage: snapshot }) as RuntimeEventDraft

/** Feed recorded events through the real usage-index diff + thread aggregation. */
function aggregate(recorded: RuntimeEventDraft[]) {
  const rows: UsageRow[] = recorded.flatMap((event, index) => event.kind === 'usage' ? [{
    thread_id: event.threadId, seq: index + 1, timestamp: new Date(1_000 + index).toISOString(),
    turn_id: event.turnId ?? null, model: event.model ?? null, provider_id: null,
    source: event.source ?? null, harness_id: event.harnessId ?? null, usage_json: JSON.stringify(event.usage)
  } as unknown as UsageRow] : [])
  return buildThreadUsageResponse(usageRecordsFromRows(rows)).buckets[0]!
}

describe('withHarnessUsageLedger', () => {
  it('turns per-turn agent reports into a correct thread total (Devin regression)', async () => {
    const r = recorder()
    const events = withHarnessUsageLedger(r.events, { usage: new UsageService(), mode: 'increment', harnessId: 'devin' })
    // Values reported by Devin 3000.11.3 prompt results for two real turns.
    await events.record(draft('turn-1', usage(22_301, 192, 22_001)))
    await events.record(draft('turn-2', usage(24_589, 1_325, 18_524)))
    const bucket = aggregate(r.recorded)
    expect(bucket.input_tokens).toBe(22_301 + 24_589)
    expect(bucket.output_tokens).toBe(192 + 1_325)
    expect(bucket.cached_tokens).toBe(22_001 + 18_524)
    expect(bucket.cached_tokens).toBeLessThan(bucket.input_tokens)
    expect(bucket.turns).toBe(2)
    expect(r.recorded[1]).toMatchObject({ source: 'harness-reported', harnessId: 'devin' })
  })

  it('counts only growth for turn-cumulative transports', async () => {
    const r = recorder()
    const events = withHarnessUsageLedger(r.events, { usage: new UsageService(), mode: 'turn-snapshot' })
    await events.record(draft('turn-1', usage(1_000, 10)))
    await events.record(draft('turn-1', usage(1_500, 40)))
    await events.record(draft('turn-1', usage(1_500, 40)))
    await events.record(draft('turn-2', usage(800, 5)))
    const bucket = aggregate(r.recorded)
    expect(bucket.input_tokens).toBe(1_500 + 800)
    expect(bucket.output_tokens).toBe(45)
    expect(r.recorded).toHaveLength(3)
  })

  it('passes non-usage drafts, gateway-metered usage and other recorder methods through', async () => {
    const r = recorder()
    const events = withHarnessUsageLedger(r.events, { usage: new UsageService(), mode: 'increment' })
    const text = { kind: 'turn_started', threadId: 'thread', turnId: 't' } as unknown as RuntimeEventDraft
    const gateway = { ...draft('t', usage(5, 5)), source: 'harness-gateway' } as RuntimeEventDraft
    await events.record(text)
    await events.record(gateway)
    expect(r.recorded).toEqual([text, gateway])
    expect(events.extra()).toBe('kept')
  })
})
