import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { harnessTurnTiming, setHarnessTimingClock } from '../harness-turn-timing.js'
import { AcpEventMapper } from './acp-event-mapper.js'
import { AcpPromptResultSchema, parseAcpSessionNotification } from './acp-schema.js'

/**
 * Replays a real `opencode acp` 1.18.35 turn (free reasoning model, ~60 s) at
 * its recorded arrival times through the production mapper, the way
 * AcpRuntime does: the prompt starts the clock, every session/update is
 * observed on arrival, and the prompt result carries the usage to stamp.
 * Ground truth from the same turn: 28.5 s of silence before the first
 * reasoning chunk, then 1868 reasoning + 204 answer tokens in 30.7 s
 * (67 tok/s) of continuous streaming.
 */
type Line = { t: number; dir: string; frame?: { method?: string; params?: unknown; result?: unknown } }

function replay(): UsageSnapshot {
  const journal = readFileSync(
    fileURLToPath(new URL('./__fixtures__/recorded/opencode-1.18.35-stream-timing.jsonl', import.meta.url)),
    'utf8'
  ).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line)
  let clock = 0
  setHarnessTimingClock(() => clock)
  let n = 0
  const mapper = new AcpEventMapper({
    threadId: 'thread_1', turnId: 'turn_1', harnessId: 'opencode', model: 'free-reasoning-model',
    nextId: (prefix) => `${prefix}_${++n}`, nowIso: () => '2026-10-09T00:00:00.000Z'
  })
  const timing = harnessTurnTiming('thread_1', 'turn_1')
  timing.requestStarted()
  let usage: UsageSnapshot | undefined
  for (const line of journal) {
    if (line.dir !== 'in' || !line.frame) continue
    clock = line.t
    if (line.frame.method === 'session/update') {
      timing.observe(mapper.apply(parseAcpSessionNotification(line.frame.params).update))
    } else if (line.frame.result) {
      const result = AcpPromptResultSchema.parse(line.frame.result)
      const drafts = mapper.applyPromptResult(result.usage)
      timing.observe(drafts)
      for (const draft of drafts) if (draft.kind === 'usage') usage = draft.usage
    }
  }
  return usage!
}

describe('ACP stream timing on a recorded OpenCode turn', () => {
  afterEach(() => setHarnessTimingClock(undefined))

  it('reads TTFT from the prompt to the first reasoning chunk, not from the commands update before it', () => {
    const usage = replay()
    expect(usage.requestTtftMs).toBeGreaterThan(28_000)
    expect(usage.requestTtftMs).toBeLessThan(29_200)
  })

  it('measures reasoning plus answer as one continuous stream', () => {
    const usage = replay()
    expect(usage.requestGenerationMs).toBeGreaterThan(29_500)
    expect(usage.requestGenerationMs).toBeLessThan(31_500)
    const tokensPerSecond = (usage.requestGenerationTokens! / usage.requestGenerationMs!) * 1_000
    expect(tokensPerSecond).toBeGreaterThan(58)
    expect(tokensPerSecond).toBeLessThan(80)
    // The Agent reported the thought tokens apart from the 204 answer tokens;
    // capping at the completion alone would have read as ~7 tok/s.
    expect(usage.completionTokens).toBe(204)
    expect(usage.reasoningTokens).toBe(1868)
  })
})
