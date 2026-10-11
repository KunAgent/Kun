import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { setHarnessTimingClock } from '../harness-turn-timing.js'
import { observeSdkMessage } from './agent-sdk-timing.js'
import { SdkEventMapper } from './sdk-event-mapper.js'
import type { SdkMessage } from './sdk-protocol.js'

/**
 * Replays real `claude -p --output-format stream-json --include-partial-messages`
 * captures (haiku, one English and one Chinese answer) through the production
 * mapper at their recorded arrival times. Ground truth from the same runs:
 * - en: 406 output tokens streamed in 2.33 s (174 tok/s), first delta 2.22 s after `init`.
 * - zh: 518 of 756 output tokens were hidden thinking; the 238-token answer
 *   streamed in 1.04 s (228 tok/s) after 5.15 s of silent thinking.
 */
function replay(name: 'en' | 'zh'): UsageSnapshot[] {
  const messages = JSON.parse(readFileSync(new URL(`./__fixtures__/claude-stream-${name}.json`, import.meta.url), 'utf8')) as Array<[number, SdkMessage]>
  let clock = 0
  setHarnessTimingClock(() => clock)
  let n = 0
  const mapper = new SdkEventMapper({ threadId: 'th', turnId: 'tn', nextId: (prefix) => `${prefix}_${++n}` })
  const usage: UsageSnapshot[] = []
  for (const [at, message] of messages) {
    clock = at
    for (const draft of observeSdkMessage('th', 'tn', message, mapper.map(message))) {
      if (draft.kind === 'usage') usage.push(draft.usage)
    }
  }
  return usage
}

const tokensPerSecond = (usage: UsageSnapshot): number =>
  (usage.requestGenerationTokens! / usage.requestGenerationMs!) * 1_000

describe('Claude Agent SDK stream timing', () => {
  afterEach(() => setHarnessTimingClock(undefined))

  it('measures an English answer within 15% of the server-side rate', () => {
    const [usage] = replay('en')
    expect(usage!.requestTtftMs).toBeGreaterThan(2_100)
    expect(usage!.requestTtftMs).toBeLessThan(2_350)
    expect(tokensPerSecond(usage!)).toBeGreaterThan(150)
    expect(tokensPerSecond(usage!)).toBeLessThan(200)
  })

  it('does not count hidden thinking as generation, but does as the wait for a first token', () => {
    const [usage] = replay('zh')
    // Empty thinking_delta frames are not tokens: the stream starts at the first visible character.
    expect(usage!.requestTtftMs).toBeGreaterThan(5_000)
    expect(usage!.requestTtftMs).toBeLessThan(5_300)
    expect(tokensPerSecond(usage!)).toBeGreaterThan(195)
    expect(tokensPerSecond(usage!)).toBeLessThan(250)
    // 756 reported output tokens over the whole 4 s would read as ~190 tok/s from hidden thinking.
    expect(usage!.requestGenerationMs).toBeLessThan(1_200)
  })

  it('returns the mapped drafts untouched', () => {
    const drafts = [] as const
    expect(observeSdkMessage('th', 'tn', { type: 'system', subtype: 'status' }, drafts)).toBe(drafts)
  })
})
