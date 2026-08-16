import { describe, expect, it } from 'vitest'
import {
  SSE_SEQ_CONFLICT_CODE,
  checkSseConnectionMonotonicity,
  createSseSeqGate,
  decideSseRecovery,
  observeSseSeq
} from './sse-sequence'

describe('observeSseSeq', () => {
  it('accepts ascending events and advances the high-water with hidden-seq holes tolerated', () => {
    let state = createSseSeqGate(5)
    // Public jump 5 -> 8: seqs 6/7 belonged to hidden model-only records.
    const a = observeSseSeq(state, { seq: 8, kind: 'item_updated' })
    expect(a.kind).toBe('accept')
    state = a.state
    expect(state.highWater).toBe(8)
    const b = observeSseSeq(state, { seq: 9, kind: 'assistant_text_delta' })
    expect(b.kind).toBe('accept')
    expect(b.state.highWater).toBe(9)
  })

  it('drops duplicates and replay overlap without advancing', () => {
    let state = createSseSeqGate(10)
    const dup = observeSseSeq(state, { seq: 10, kind: 'item_updated' })
    expect(dup.kind).toBe('stale')
    expect(dup.state.highWater).toBe(10)
    expect(dup.state.staleCount).toBe(1)
    const older = observeSseSeq(dup.state, { seq: 3, kind: 'turn_completed' })
    expect(older.kind).toBe('stale')
    state = older.state
    expect(state.highWater).toBe(10)
    expect(state.staleCount).toBe(2)
  })

  it('accepts events without a numeric seq without moving the cursor', () => {
    const state = createSseSeqGate(4)
    for (const seq of [undefined, 'nope', -1, 1.5, Number.NaN]) {
      const obs = observeSseSeq(state, { seq, kind: 'item_created' })
      expect(obs.kind).toBe('accept-unsequenced')
      expect(obs.state.highWater).toBe(4)
    }
  })

  it('implements heartbeat semantics: stale heartbeats never rewind, fresh ones advance', () => {
    let state = createSseSeqGate(20)
    // Heartbeat reusing the already delivered cursor: liveness only.
    const staleHb = observeSseSeq(state, { seq: 20, kind: 'heartbeat' })
    expect(staleHb.kind).toBe('stale-heartbeat')
    expect(staleHb.state.highWater).toBe(20)
    // Heartbeat may advertise hidden seqs beyond the last public event.
    const freshHb = observeSseSeq(staleHb.state, { seq: 25, kind: 'heartbeat' })
    expect(freshHb.kind).toBe('accept-heartbeat')
    state = freshHb.state
    expect(state.highWater).toBe(25)
    expect(state.advertisedHighWater).toBe(25)
    // An older heartbeat afterwards is stale, not a regression.
    const rewind = observeSseSeq(state, { seq: 22, kind: 'heartbeat' })
    expect(rewind.kind).toBe('stale-heartbeat')
    expect(rewind.state.highWater).toBe(25)
  })

  it('keeps advertisedHighWater monotone across accepted and stale heartbeats', () => {
    let state = createSseSeqGate(0)
    state = observeSseSeq(state, { seq: 30, kind: 'heartbeat' }).state
    state = observeSseSeq(state, { seq: 12, kind: 'heartbeat' }).state
    state = observeSseSeq(state, { seq: 31, kind: 'item_updated' }).state
    expect(state.advertisedHighWater).toBe(31)
    expect(state.highWater).toBe(31)
  })
})

describe('checkSseConnectionMonotonicity', () => {
  it('accepts ascending streams and resets per connection', () => {
    let watermark: number | null = null
    for (const seq of [1, 2, 3, 40]) {
      const check = checkSseConnectionMonotonicity(watermark, { seq, kind: 'item_updated' })
      expect(check.ok).toBe(true)
      if (check.ok) watermark = check.watermark
    }
    expect(watermark).toBe(40)
  })

  it('flags a regression with the offending seq values', () => {
    const check = checkSseConnectionMonotonicity(25, { seq: 7, kind: 'assistant_text_delta' })
    expect(check).toEqual({ ok: false, regressedFrom: 25, observed: 7 })
  })

  it('exempts heartbeats and unsequenced frames from the invariant', () => {
    const hb = checkSseConnectionMonotonicity(25, { seq: 25, kind: 'heartbeat' })
    expect(hb.ok).toBe(true)
    if (hb.ok) expect(hb.watermark).toBe(25)
    const bare = checkSseConnectionMonotonicity(25, { kind: 'usage' })
    expect(bare).toEqual({ ok: true, watermark: 25 })
  })
})

describe('decideSseRecovery', () => {
  it('never recovers from a client abort', () => {
    expect(decideSseRecovery({ kind: 'client-abort' }, 42)).toEqual({ strategy: 'none' })
  })

  it('demands an authoritative resync for a wire seq conflict', () => {
    expect(decideSseRecovery({ kind: 'stream-error', code: SSE_SEQ_CONFLICT_CODE }, 42)).toEqual({
      strategy: 'authoritative-resync'
    })
    // The conflict code wins over every status heuristic: the cursor is dead.
    expect(
      decideSseRecovery({ kind: 'stream-error', code: SSE_SEQ_CONFLICT_CODE, status: 409 }, 7)
    ).toEqual({ strategy: 'authoritative-resync' })
  })

  it('replays from the cursor for clean ends and transient or fatal-status errors', () => {
    expect(decideSseRecovery({ kind: 'stream-ended' }, 42)).toEqual({
      strategy: 'replay-from-cursor',
      sinceSeq: 42
    })
    expect(decideSseRecovery({ kind: 'stream-error' }, 7)).toEqual({
      strategy: 'replay-from-cursor',
      sinceSeq: 7
    })
    // HTTP statuses never disqualify the cursor: only a wire regression does.
    for (const status of [429, 408, 401, 403, 404, 500]) {
      expect(decideSseRecovery({ kind: 'stream-error', status }, 3)).toEqual({
        strategy: 'replay-from-cursor',
        sinceSeq: 3
      })
    }
  })

  it('normalizes a bogus cursor to zero instead of propagating it', () => {
    expect(decideSseRecovery({ kind: 'stream-ended' }, -3.7)).toEqual({
      strategy: 'replay-from-cursor',
      sinceSeq: 0
    })
  })
})
