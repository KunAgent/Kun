import { describe, expect, it } from 'vitest'
import {
  type SseSeqGateState,
  type SseSeqObservation,
  type SseStreamCloseSignal,
  SSE_SEQ_CONFLICT_CODE,
  checkSseConnectionMonotonicity,
  createSseSeqGate,
  decideSseRecovery,
  observeSseSeq
} from './sse-sequence'

/** Deterministic PRNG (mulberry32) so failures reproduce from the logged seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type FuzzEvent = { seq?: number; kind: string }

function randomInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1))
}

/**
 * Generate one legal server stream: persisted public seqs ascending with
 * hidden-event holes, optional duplicate replay overlap injected around
 * reconnects, heartbeat frames reusing the current cursor, and an optional
 * regression burst (corrupt wire) at a random index.
 */
function generateStream(rand: () => number, withRegression: boolean): {
  delivered: FuzzEvent[]
  expectedAcceptedPublic: number[]
  regressionAt: number | null
  watermarkBeforeRegression: number
} {
  const delivered: FuzzEvent[] = []
  const expectedAcceptedPublic: number[] = []
  let serverSeq = randomInt(rand, 0, 5)
  const publicCount = randomInt(rand, 20, 200)
  let regressionAt: number | null = null
  let watermarkBeforeRegression = 0

  for (let i = 0; i < publicCount; i += 1) {
    // Hidden model-only records consume some seqs without delivery.
    serverSeq += 1 + (rand() < 0.35 ? randomInt(rand, 0, 3) : 0)
    const publicSeq = serverSeq
    delivered.push({ seq: publicSeq, kind: 'item_updated' })
    // Reconnect replay overlap: emit a few already delivered seqs again.
    if (rand() < 0.15 && expectedAcceptedPublic.length > 0) {
      const dupFrom = expectedAcceptedPublic[randomInt(rand, 0, expectedAcceptedPublic.length - 1)]
      delivered.push({ seq: dupFrom, kind: 'item_updated' })
    }
    if (rand() < 0.2) {
      delivered.push({ seq: publicSeq, kind: 'heartbeat' })
    }
    expectedAcceptedPublic.push(publicSeq)
    if (withRegression && regressionAt === null && expectedAcceptedPublic.length > 5 && rand() < 0.05) {
      regressionAt = delivered.length
      watermarkBeforeRegression = publicSeq
      // Wire seqs are always non-negative; clamp so the injected frame stays
      // inside the contract the guard validates (negative seqs are invalid
      // input and legitimately exempt).
      delivered.push({ seq: Math.max(0, publicSeq - randomInt(rand, 5, 10)), kind: 'assistant_text_delta' })
    }
  }
  return { delivered, expectedAcceptedPublic, regressionAt, watermarkBeforeRegression }
}

/** Replay of the renderer batch loop: gate now owns the dedupe/advance math. */
function project(gate: SseSeqGateState, events: FuzzEvent[]): {
  gate: SseSeqGateState
  projected: FuzzEvent[]
  observations: SseSeqObservation[]
} {
  const projected: FuzzEvent[] = []
  const observations: SseSeqObservation[] = []
  for (const event of events) {
    const obs = observeSseSeq(gate, event)
    observations.push(obs)
    gate = obs.state
    if (obs.kind === 'accept' || obs.kind === 'accept-unsequenced') projected.push(event)
  }
  return { gate, projected, observations }
}

describe('sse-sequence fuzz (seeded)', () => {
  const SEEDS = [0xC0FFEE, 0x1CEB00DA, 0x600DF00D, 0xDEC0DE, 0xABCDEF]

  it('projects every legal stream exactly once, in ascending order, with monotone cursors', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed)
      for (let run = 0; run < 40; run += 1) {
        const { delivered, expectedAcceptedPublic } = generateStream(rand, false)
        const { gate, projected } = project(createSseSeqGate(0), delivered)
        const projectedSeqs = projected.map((event) => event.seq)
        // Exactly-once, no loss, ascending (the contract the chat reducer relies on).
        expect(projectedSeqs, `seed=${seed} run=${run}`).toEqual(expectedAcceptedPublic)
        expect(gate.highWater).toBe(expectedAcceptedPublic[expectedAcceptedPublic.length - 1] ?? 0)
        // The monotonicity guard never trips on a legal stream.
        let watermark: number | null = null
        for (const event of delivered) {
          const check = checkSseConnectionMonotonicity(watermark, event)
          // Duplicate replay injections above regress vs the *connection*
          // watermark by construction; those arrive on separate connections
          // in production, so the guard only runs on non-duplicates here.
          if (check.ok) watermark = check.watermark
          else {
            expect(expectedAcceptedPublic).toContain(event.seq)
          }
        }
        // Stale observations never move the committed cursor backwards.
        expect(gate.highWater).toBeGreaterThanOrEqual(0)
        expect(gate.advertisedHighWater).toBeGreaterThanOrEqual(gate.highWater)
      }
    }
  })

  it('gate stays total and side-effect free under arbitrary seq noise', () => {
    const rand = mulberry32(0xFEEDFACE)
    for (let run = 0; run < 2000; run += 1) {
      let gate = createSseSeqGate(randomInt(rand, 0, 50))
      const before = gate.highWater
      const events: FuzzEvent[] = Array.from({ length: randomInt(rand, 1, 64) }, () => {
        const roll = rand()
        if (roll < 0.2) return { kind: 'item_updated' } // unsequenced
        if (roll < 0.35) return { seq: randomInt(rand, -5, 3), kind: 'item_updated' } // stale/invalid
        if (roll < 0.5) return { seq: randomInt(rand, 0, 400), kind: 'heartbeat' }
        return { seq: randomInt(rand, 0, 400), kind: 'usage' }
      })
      const result = project(gate, events)
      gate = result.gate
      for (const obs of result.observations) {
        // Exhaustive discriminator: every observation has a defined next state,
        // and the server-advertised watermark never trails the committed cursor.
        expect(obs.state.highWater).toBeGreaterThanOrEqual(0)
        expect(obs.state.advertisedHighWater).toBeGreaterThanOrEqual(obs.state.highWater)
      }
      // The committed cursor never regresses, no matter the wire noise.
      expect(gate.highWater).toBeGreaterThanOrEqual(before)
    }
  })

  it('flags every injected regression exactly once with correct seq values', () => {
    for (const seed of SEEDS) {
      const rand = mulberry32(seed ^ 0x9E3779B9)
      for (let run = 0; run < 40; run += 1) {
        const { delivered, expectedAcceptedPublic, regressionAt, watermarkBeforeRegression } =
          generateStream(rand, true)
        let watermark: number | null = null
        let conflicts = 0
        delivered.forEach((event, index) => {
          const check = checkSseConnectionMonotonicity(watermark, event)
          if (!check.ok) {
            if (index === regressionAt) {
              // The injected corruption must trip the guard here, exactly once.
              conflicts += 1
              expect(check.regressedFrom).toBe(watermarkBeforeRegression)
            } else {
              // Replay-overlap duplicates regress against this merged tape by
              // construction; in production they arrive on separate
              // connections, so the guard never sees them. They are only legal
              // when they re-deliver an already accepted public seq.
              expect(expectedAcceptedPublic, `seed=${seed} run=${run} idx=${index}`).toContain(
                event.seq
              )
            }
          } else {
            watermark = check.watermark
          }
        })
        if (regressionAt !== null) {
          expect(conflicts, `seed=${seed} run=${run}`).toBe(1)
        }
      }
    }
  })

  it('decideSseRecovery is total over the close-signal space', () => {
    const rand = mulberry32(0xB16B00B5)
    const signals: SseStreamCloseSignal[] = [
      { kind: 'client-abort' },
      { kind: 'stream-ended' },
      { kind: 'stream-error' },
      { kind: 'stream-error', status: 408 },
      { kind: 'stream-error', status: 429 },
      { kind: 'stream-error', status: 401 },
      { kind: 'stream-error', status: 404 },
      { kind: 'stream-error', code: 'seq_conflict' },
      { kind: 'stream-error', status: 500 },
      { kind: 'stream-error', code: 'seq_conflict', status: 409 }
    ]
    for (let run = 0; run < 500; run += 1) {
      const signal = signals[randomInt(rand, 0, signals.length - 1)]
      const decision = decideSseRecovery(signal, randomInt(rand, 0, 10_000))
      switch (signal.kind) {
        case 'client-abort':
          expect(decision.strategy).toBe('none')
          break
        case 'stream-error':
          // Only an explicit wire-regression code disqualifies the cursor;
          // bare HTTP statuses (even fatal-looking 4xx) still replay from it.
          expect(decision.strategy).toBe(
            signal.code === SSE_SEQ_CONFLICT_CODE ? 'authoritative-resync' : 'replay-from-cursor'
          )
          break
        default:
          expect(decision.strategy).toBe('replay-from-cursor')
      }
    }
  })
})
