import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import {
  estimateStreamedTokens,
  HarnessTurnTiming,
  harnessTurnTiming,
  setHarnessTimingClock
} from './harness-turn-timing.js'

type UsageDraft = Extract<RuntimeEventDraft, { kind: 'usage' }>

const base = { threadId: 'th', turnId: 'tn' }
const delta = (text: string, reasoning = false): RuntimeEventDraft => ({
  ...base,
  kind: reasoning ? 'assistant_reasoning_delta' : 'assistant_text_delta',
  deltaOffset: 0,
  item: { id: 'item', ...base, role: 'assistant', status: 'running', createdAt: '2026-10-09T00:00:00Z', kind: reasoning ? 'assistant_reasoning' : 'assistant_text', text }
} as unknown as RuntimeEventDraft)
const tool = (kind: 'tool_call_ready' | 'tool_call_started' | 'tool_call_finished'): RuntimeEventDraft =>
  ({ ...base, kind, item: { id: 'tool', ...base, kind: 'tool_call' } } as unknown as RuntimeEventDraft)
const usage = (completionTokens: number): UsageDraft => ({
  ...base,
  kind: 'usage',
  usage: { promptTokens: 100, completionTokens, totalTokens: 100 + completionTokens, cacheHitRate: null, turns: 0 }
})
/** 35 ASCII chars: exactly 10 estimated tokens. */
const TEN_TOKENS = 'abcdefghij'.repeat(3) + 'abcde'

function harness(): { timing: HarnessTurnTiming; at: (ms: number) => void } {
  let clock = 0
  return { timing: new HarnessTurnTiming(() => clock), at: (ms) => { clock = ms } }
}
const stamped = (draft: UsageDraft): UsageSnapshot => draft.usage

describe('estimateStreamedTokens', () => {
  it('weighs ASCII, CJK and other scripts differently', () => {
    expect(estimateStreamedTokens(TEN_TOKENS)).toBeCloseTo(10, 5)
    expect(estimateStreamedTokens('自行车不容易倒')).toBeCloseTo(7 * 1.1, 5)
    expect(estimateStreamedTokens('привет')).toBeCloseTo(3, 5)
    expect(estimateStreamedTokens('')).toBe(0)
  })
})

describe('HarnessTurnTiming', () => {
  it('measures TTFT from the prompt reaching the Agent to the first non-empty delta', () => {
    const { timing, at } = harness()
    at(100); timing.requestStarted()
    at(900); timing.observe([delta('')])
    at(1_600); timing.observe([delta('Hi')])
    const draft = usage(5)
    at(1_700); timing.observe([draft])
    expect(stamped(draft).requestTtftMs).toBe(1_500)
  })

  it('keeps the timing an engine measured itself and still resets the window', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    at(1_000); timing.observe([delta(TEN_TOKENS)])
    const timed: UsageDraft = { ...usage(5), usage: { ...usage(5).usage, requestTtftMs: 2_388, requestGenerationMs: 605 } }
    at(1_100); timing.observe([timed])
    expect(stamped(timed)).toMatchObject({ requestTtftMs: 2_388, requestGenerationMs: 605 })
    expect(stamped(timed)).not.toHaveProperty('requestGenerationTokens')
    const next = usage(5)
    timing.observe([next])
    expect(stamped(next)).not.toHaveProperty('requestTtftMs')
  })

  it('counts a reasoning delta as the first token too', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    at(800); timing.observe([delta('thinking', true)])
    const draft = usage(5)
    timing.observe([draft])
    expect(stamped(draft).requestTtftMs).toBe(800)
  })

  it('times only the flowing stream: first delta of a burst marks its start, a pause closes it', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    // burst 1: 1000..1900 -> 9 deltas after the first = 90 tokens over 900 ms
    for (let i = 0; i < 10; i += 1) { at(1_000 + i * 100); timing.observe([delta(TEN_TOKENS)]) }
    // a long pause (tool arguments, thinking, a stalled link), then burst 2: 10_000..10_500
    for (let i = 0; i < 6; i += 1) { at(10_000 + i * 100); timing.observe([delta(TEN_TOKENS)]) }
    const draft = usage(500)
    at(12_000); timing.observe([draft])
    expect(stamped(draft)).toMatchObject({
      requestTtftMs: 1_000,
      requestGenerationMs: 900 + 500,
      requestGenerationTokens: 90 + 50
    })
  })

  it('never reports more tokens than the Agent reported for the window', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    for (let i = 0; i < 10; i += 1) { at(1_000 + i * 100); timing.observe([delta(TEN_TOKENS)]) }
    const draft = usage(40)
    timing.observe([draft])
    expect(stamped(draft).requestGenerationTokens).toBe(40)
    expect(stamped(draft).requestGenerationMs).toBe(900)
  })

  it('lets streamed reasoning count when the Agent reports it apart from the completion', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    // ACP reports `thoughtTokens` outside `outputTokens`: 5 reasoning + 5 answer deltas
    for (let i = 0; i < 5; i += 1) { at(1_000 + i * 100); timing.observe([delta(TEN_TOKENS, true)]) }
    for (let i = 0; i < 5; i += 1) { at(1_500 + i * 100); timing.observe([delta(TEN_TOKENS)]) }
    const draft = usage(20)
    draft.usage = { ...draft.usage, reasoningTokens: 90 }
    timing.observe([draft])
    expect(stamped(draft)).toMatchObject({ requestGenerationMs: 900, requestGenerationTokens: 90 })
  })

  it('splits bursts at tool calls and does not count tool time as generation', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    for (let i = 0; i < 5; i += 1) { at(1_000 + i * 100); timing.observe([delta(TEN_TOKENS)]) }
    at(1_450); timing.observe([tool('tool_call_ready')])
    at(1_460); timing.observe([tool('tool_call_started')])
    at(1_900); timing.observe([tool('tool_call_finished')])
    for (let i = 0; i < 5; i += 1) { at(2_000 + i * 100); timing.observe([delta(TEN_TOKENS)]) }
    const draft = usage(500)
    timing.observe([draft])
    // burst 1: 1000..1400 (4 x 10), burst 2: 2000..2400 (4 x 10); the 1.4s..2.0s gap is excluded
    expect(stamped(draft)).toMatchObject({ requestGenerationMs: 800, requestGenerationTokens: 80 })
  })

  it('gives a call that opens with a tool call no TTFT, and the next call one from the tool result', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    at(4_000); timing.observe([tool('tool_call_ready')])
    at(9_000); timing.observe([tool('tool_call_finished')])
    at(9_700); timing.observe([delta('answer')])
    const draft = usage(5)
    timing.observe([draft])
    expect(stamped(draft).requestTtftMs).toBe(700)
  })

  it('has no TTFT when the first call is a tool call and nothing streams afterwards', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    at(3_000); timing.observe([tool('tool_call_started')])
    const draft = usage(5)
    timing.observe([draft])
    expect(stamped(draft).requestTtftMs).toBeUndefined()
  })

  it('drops windows that are too short, too small or implausibly fast, keeping TTFT', () => {
    const short = harness()
    short.at(0); short.timing.requestStarted()
    short.at(500); short.timing.observe([delta(TEN_TOKENS)])
    short.at(600); short.timing.observe([delta(TEN_TOKENS)])
    const shortDraft = usage(50)
    short.timing.observe([shortDraft])
    expect(stamped(shortDraft)).toMatchObject({ requestTtftMs: 500 })
    expect(stamped(shortDraft).requestGenerationMs).toBeUndefined()

    const buffered = harness()
    buffered.at(0); buffered.timing.requestStarted()
    buffered.at(500); buffered.timing.observe([delta('x')])
    // 300 ms window carrying 5000 estimated tokens: the Agent buffered output
    buffered.at(800); buffered.timing.observe([delta('y'.repeat(17_500))])
    const bufferedDraft = usage(5_000)
    buffered.timing.observe([bufferedDraft])
    expect(stamped(bufferedDraft).requestGenerationMs).toBeUndefined()
    expect(stamped(bufferedDraft).requestGenerationTokens).toBeUndefined()
  })

  it('consumes the window at each usage report so per-call usage gets its own sample', () => {
    const { timing, at } = harness()
    at(0); timing.requestStarted()
    for (let i = 0; i < 10; i += 1) { at(1_000 + i * 100); timing.observe([delta(TEN_TOKENS)]) }
    const first = usage(100)
    at(2_000); timing.observe([first])
    at(2_100); timing.observe([tool('tool_call_finished')])
    for (let i = 0; i < 10; i += 1) { at(2_600 + i * 50); timing.observe([delta(TEN_TOKENS)]) }
    const second = usage(100)
    at(3_200); timing.observe([second])
    expect(stamped(first)).toMatchObject({ requestTtftMs: 1_000, requestGenerationMs: 900, requestGenerationTokens: 90 })
    expect(stamped(second)).toMatchObject({ requestTtftMs: 500, requestGenerationMs: 450, requestGenerationTokens: 90 })
  })

  it('leaves usage untouched when nothing streamed (no output, or a one-shot reply)', () => {
    const { timing } = harness()
    const draft = usage(30)
    const before = draft.usage
    timing.observe([draft])
    expect(draft.usage).toBe(before)
  })
})

describe('harnessTurnTiming registry', () => {
  afterEach(() => setHarnessTimingClock(undefined))

  it('shares one tracker per turn and uses the injected clock', () => {
    let clock = 0
    setHarnessTimingClock(() => clock)
    harnessTurnTiming('th', 'tn').requestStarted()
    clock = 700
    harnessTurnTiming('th', 'tn').observe([delta('Hello')])
    const draft = usage(5)
    harnessTurnTiming('th', 'tn').observe([draft])
    expect(stamped(draft).requestTtftMs).toBe(700)
    expect(harnessTurnTiming('th', 'other')).not.toBe(harnessTurnTiming('th', 'tn'))
  })

  it('forgets the oldest turns instead of growing without bound', () => {
    setHarnessTimingClock(() => 0)
    const first = harnessTurnTiming('th', 'turn-0')
    for (let i = 1; i <= 80; i += 1) harnessTurnTiming('th', `turn-${i}`)
    expect(harnessTurnTiming('th', 'turn-0')).not.toBe(first)
  })
})
