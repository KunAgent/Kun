import { describe, expect, it } from 'vitest'
import {
  KOKORO_FIRST_CHUNK_CHARS,
  KOKORO_MAX_CHUNK_CHARS,
  KOKORO_MIN_CHUNK_CHARS
} from '@shared/kokoro-text'
import { estimatedChunkTotal, nextChunkBudget, synthesisLeadSeconds } from './speak-controller'

describe('synthesisLeadSeconds', () => {
  it('uses the floor before any chunk has been timed', () => {
    expect(synthesisLeadSeconds(0)).toBe(6)
    expect(synthesisLeadSeconds(Number.NaN)).toBe(6)
    expect(synthesisLeadSeconds(-3)).toBe(6)
  })

  it('keeps the floor while synthesis is comfortably fast', () => {
    expect(synthesisLeadSeconds(1.5)).toBe(6)
  })

  // A machine that needs 5 s to make a chunk cannot be paced by a 6 s buffer:
  // the next chunk has to fit inside the audio already scheduled.
  it('grows the buffer when a chunk takes longer than the floor allows', () => {
    expect(synthesisLeadSeconds(5)).toBe(10)
    expect(synthesisLeadSeconds(12)).toBe(24)
  })
})

describe('nextChunkBudget', () => {
  it('keeps the first chunk short, before anything has been measured', () => {
    expect(nextChunkBudget(0, 0)).toBe(KOKORO_FIRST_CHUNK_CHARS)
    expect(nextChunkBudget(12, Number.NaN)).toBe(KOKORO_FIRST_CHUNK_CHARS)
  })

  // The whole point: the next chunk has to be produced inside the audio that is
  // already scheduled, so the budget follows measured synthesis speed.
  it('sizes the chunk so its synthesis fits inside the buffered audio', () => {
    // 30 ms of synthesis per character, 10 s buffered -> 70% of 10 s / 0.03.
    expect(nextChunkBudget(10, 0.03)).toBe(233)
    // Same buffer, but synthesis is three times slower.
    expect(nextChunkBudget(10, 0.09)).toBe(77)
  })

  it('never proposes a chunk larger than the maximum', () => {
    expect(nextChunkBudget(600, 0.01)).toBe(KOKORO_MAX_CHUNK_CHARS)
  })

  it('falls back to the minimum when the buffer is nearly empty', () => {
    expect(nextChunkBudget(0.2, 0.05)).toBe(KOKORO_MIN_CHUNK_CHARS)
    expect(nextChunkBudget(-5, 0.05)).toBe(KOKORO_MIN_CHUNK_CHARS)
  })
})

describe('estimatedChunkTotal', () => {
  it('reports what has been spoken once the text runs out', () => {
    expect(estimatedChunkTotal(3, 0, 120)).toBe(3)
    expect(estimatedChunkTotal(0, 0, 0)).toBe(1)
  })

  it('estimates the rest from the last chunk size', () => {
    expect(estimatedChunkTotal(2, 300, 100)).toBe(5)
  })

  it('uses the first-chunk size before one has been measured', () => {
    expect(estimatedChunkTotal(0, KOKORO_FIRST_CHUNK_CHARS * 3, 0)).toBe(3)
  })
})
