import { describe, expect, it } from 'vitest'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import { UsageService } from '../services/usage-service.js'
import { usageRecordsFromRows, type UsageRow } from '../adapters/hybrid/hybrid-thread-support.js'
import { buildThreadUsageResponse } from '../services/usage-service-responses.js'
import { withHarnessUsageLedger } from './harness-usage-ledger.js'
import { HarnessTurnTiming } from './harness-turn-timing.js'
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

  it('carries the measured stream timing into the turn and thread TTFT / TPS averages', async () => {
    const r = recorder()
    const events = withHarnessUsageLedger(r.events, { usage: new UsageService(), mode: 'increment', harnessId: 'devin' })
    const text = 'abcdefghij'.repeat(3) + 'abcde' // 10 estimated tokens
    const delta = { kind: 'assistant_text_delta', threadId: 'thread', turnId: 't', item: { text } } as unknown as RuntimeEventDraft
    // turn-1: first token after 1000 ms, then 9 deltas over 900 ms (90 tokens = 100 tok/s)
    // turn-2: first token after 500 ms, then 9 deltas over 450 ms (90 tokens = 200 tok/s)
    for (const [turnId, firstToken, step] of [['turn-1', 1_000, 100], ['turn-2', 500, 50]] as const) {
      let clock = 0
      const timing = new HarnessTurnTiming(() => clock)
      timing.requestStarted()
      for (let i = 0; i < 10; i += 1) { clock = firstToken + i * step; timing.observe([delta]) }
      const reported = draft(turnId, usage(1_000, 120))
      timing.observe([reported])
      await events.record(reported)
    }
    expect(r.recorded[0]!.kind === 'usage' && r.recorded[0]!.usage).toMatchObject({
      turnAvgTtftMs: 1_000, turnAvgTokensPerSecond: 100, avgTtftMs: 1_000, avgTokensPerSecond: 100
    })
    expect(r.recorded[1]!.kind === 'usage' && r.recorded[1]!.usage).toMatchObject({
      turnAvgTtftMs: 500, turnAvgTokensPerSecond: 200, avgTtftMs: 750
    })
    const bucket = aggregate(r.recorded)
    expect(bucket.avg_ttft_ms).toBeCloseTo(750, 5)
    expect(bucket.avg_tokens_per_second).toBeCloseTo(180 / 1.35, 5)
  })

  it('reports no timing for an Agent whose output was not streamed', async () => {
    const r = recorder()
    const events = withHarnessUsageLedger(r.events, { usage: new UsageService(), mode: 'increment' })
    await events.record(draft('turn-1', usage(500, 60)))
    expect(r.recorded[0]!.kind === 'usage' && r.recorded[0]!.usage).toMatchObject({ avgTtftMs: null, avgTokensPerSecond: null })
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
