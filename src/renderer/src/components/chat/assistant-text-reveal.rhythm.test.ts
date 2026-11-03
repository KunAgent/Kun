import { describe, expect, it } from 'vitest'
import {
  advanceTextReveal,
  createTextReveal,
  MAX_FINISH_MS,
  MAX_REVEAL_BACKLOG,
  retargetTextReveal,
  STREAM_FADE_MS,
  type TextRevealState
} from './assistant-text-reveal'

const FRAME_MS = 1000 / 60

type Arrival = { at: number; text: string }

/** Feeds arrivals into the reveal on a 60fps clock and records each commit. */
function simulate(arrivals: Arrival[], endAt: number | null, untilMs: number) {
  let state = createTextReveal('', true, 0)
  let received = ''
  let next = 0
  const commits: Array<{ at: number; count: number; received: number; visible: number }> = []
  for (let now = 0; now <= untilMs; now += FRAME_MS) {
    while (next < arrivals.length && arrivals[next].at <= now) {
      received += arrivals[next].text
      next += 1
      state = retargetTextReveal(state, received, endAt === null || now < endAt, now, false)
    }
    if (endAt !== null && now >= endAt && state.streaming) {
      state = retargetTextReveal(state, received, false, now, false)
    }
    const before = state.visibleLength
    state = advanceTextReveal(state, now)
    if (state.visibleLength !== before) {
      commits.push({ at: now, count: state.visibleLength - before, received: received.length, visible: state.visibleLength })
    }
  }
  return { state, received, commits }
}

function steadyArrivals(chunks: number, size: number, everyMs: number, startAt = 0): Arrival[] {
  return Array.from({ length: chunks }, (_, index) => ({
    at: startAt + index * everyMs,
    text: '字'.repeat(size)
  }))
}

describe('assistant reveal rhythm', () => {
  it('holds a small buffer behind steady input instead of painting each chunk as it lands', () => {
    const { commits } = simulate(steadyArrivals(40, 4, 60), null, 2400)
    const during = commits.filter((commit) => commit.at < 2300)
    expect(during.length).toBeGreaterThan(20)
    // While input is active the reveal trails the received text a little.
    expect(during.some((commit) => commit.received - commit.visible >= 2)).toBe(true)
    expect(Math.max(...during.map((commit) => commit.count))).toBeLessThanOrEqual(12)
  })

  it('keeps text flowing through a network stall and spreads a burst over several commits', () => {
    const arrivals = [
      { at: 0, text: '甲'.repeat(10) },
      { at: 100, text: '乙'.repeat(60) },
      // 700ms of silence before the reply continues.
      { at: 800, text: '丙'.repeat(10) }
    ]
    const { commits } = simulate(arrivals, null, 1600)
    const inStall = commits.filter((commit) => commit.at > 150 && commit.at < 800)
    expect(inStall.length).toBeGreaterThanOrEqual(4)
    const burst = commits.find((commit) => commit.at >= 100)
    expect(burst?.count ?? 0).toBeLessThan(60)
  })

  it('finishes the buffered tail within the finish deadline once the stream stops', () => {
    const { state } = simulate(steadyArrivals(20, 6, 40), 820, 820 + MAX_FINISH_MS + 400)
    expect(state.visibleLength).toBe(state.text.length)
    expect(state.fading).toHaveLength(0)
    expect(state.endedAt).toBeNull()
  })

  it('reveals the whole tail at the deadline even when the clock was throttled', () => {
    let state = createTextReveal('', true, 0)
    state = retargetTextReveal(state, 'x'.repeat(100), true, 0, false)
    state = retargetTextReveal(state, state.text, false, 10, false)
    state = advanceTextReveal(state, 20)
    state = advanceTextReveal(state, 10 + MAX_FINISH_MS)
    expect(state.visibleLength).toBe(100)
  })

  it('chains births in order, bounded to the commit window, and prunes settled ones', () => {
    let state = createTextReveal('', true, 0)
    state = retargetTextReveal(state, 'abcdefghij'.repeat(5), true, 0, false)
    state = retargetTextReveal(state, state.text, false, 1, false)
    let now = 1
    let observed: TextRevealState['fading'] = []
    while (state.visibleLength < state.text.length && now < 2000) {
      now += FRAME_MS
      state = advanceTextReveal(state, now)
      if (state.fading.length > observed.length) observed = state.fading
    }
    const births = observed.map((entry) => entry.birth)
    expect(births).toEqual([...births].sort((a, b) => a - b))
    for (const birth of births) expect(birth).toBeLessThanOrEqual(now + 160 + STREAM_FADE_MS)
    const offsets = observed.map((entry) => entry.offset)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
    state = advanceTextReveal(state, now + 400 + STREAM_FADE_MS)
    expect(state.fading).toHaveLength(0)
  })

  it('records one birth per grapheme, never inside a cluster', () => {
    let state = createTextReveal('', true, 0)
    const text = '👩‍💻 ok 🇨🇳'
    state = retargetTextReveal(state, text, true, 0, false)
    state = retargetTextReveal(state, text, false, 1, false)
    for (let now = 1; now < 1500 && state.visibleLength < text.length; now += FRAME_MS) {
      state = advanceTextReveal(state, now)
      const flag = text.indexOf('🇨🇳')
      expect(state.visibleLength === flag + 2).toBe(false)
    }
    const offsets = state.fading.map((entry) => entry.offset)
    expect(offsets).not.toContain(1)
  })

  it('shows large single appends at once and catch-up snapshots without fading', () => {
    const base = createTextReveal('start ', true, 0)
    const wave = retargetTextReveal(base, `start ${'y'.repeat(300)}`, true, 10, false)
    expect(wave.visibleLength).toBe(wave.text.length)
    expect(wave.fading.length).toBeGreaterThan(0)

    const block = retargetTextReveal(base, `start ${'y'.repeat(900)}`, true, 10, false)
    expect(block.visibleLength).toBe(block.text.length)
    expect(block.fading).toHaveLength(0)

    const snapshot = retargetTextReveal(base, `start ${'y'.repeat(MAX_REVEAL_BACKLOG)}`, true, 10, false)
    expect(snapshot.visibleLength).toBe(snapshot.text.length)
    expect(snapshot.fading).toHaveLength(0)
  })

  it('starts a new baseline for corrections, new live phases and replayed history', () => {
    let state = createTextReveal('old', true, 0)
    state = retargetTextReveal(state, 'old text', true, 5, false)
    expect(state.visibleLength).toBe(3)
    const corrected = retargetTextReveal(state, 'new', true, 6, false)
    expect(corrected.visibleLength).toBe(3)
    expect(corrected.fading).toHaveLength(0)

    const settled = createTextReveal('cached', false, 0)
    const replayed = retargetTextReveal(settled, 'cached plus replay', false, 5, false)
    expect(replayed.visibleLength).toBe(replayed.text.length)
    const resumed = retargetTextReveal(replayed, 'cached plus replay', true, 6, false)
    expect(resumed.visibleLength).toBe(resumed.text.length)
  })
})
