/**
 * Per-thread SSE sequence contract: gate + recovery policy (WP-03).
 *
 * Wire invariants (kun server `src/server/routes/events.ts`):
 * - `seq` is a per-thread, persisted, non-decreasing integer; an SSE
 *   connection replays events with `seq > since_seq` exactly once each and
 *   then delivers live events, so within one connection public events may
 *   only regress if the persisted log or the live bus is corrupt.
 * - Non-public (model-only) events consume seqs without being delivered, so
 *   a forward *jump* on the public stream (e.g. 5 -> 8) is normal and is
 *   NOT evidence of loss. Client-side "raw jump" gap detection is therefore
 *   impossible by design; the honest detection points are (a) transport
 *   boundary monotonicity and (b) structured server error frames.
 * - Heartbeats advertise the connection high-water mark. They may reuse an
 *   already delivered seq and must never rewind a client cursor; a client
 *   MAY advance its cursor to a heartbeat seq because the server guarantees
 *   every public event at or below that point has been delivered (any seqs
 *   in between belonged to hidden model-only records).
 *
 * This module is deliberately dependency-free so the renderer projection, the
 * main-process SSE bridge, and tests all share one implementation.
 */

/** Structured error code sent from the main-process SSE bridge when the wire violates monotonicity. */
export const SSE_SEQ_CONFLICT_CODE = 'seq_conflict'

export type SseSeqGateState = {
  /**
   * Committed projection high-water mark. Events at or below this seq were
   * already projected (or proven delivered) and must never be replayed into
   * the projection again.
   */
  readonly highWater: number
  /**
   * Highest seq the server advertised via heartbeats, including hidden
   * model-only seqs. Diagnostic only; never used to drop public events.
   */
  readonly advertisedHighWater: number
  /** Count of already-seen events observed and dropped (replay overlap). */
  readonly staleCount: number
  /** Count of accepted events that carried no numeric seq (legacy/tolerant path). */
  readonly unsequencedCount: number
}

export function createSseSeqGate(initialHighWater: number): SseSeqGateState {
  const base = Number.isSafeInteger(initialHighWater) && initialHighWater >= 0 ? initialHighWater : 0
  return {
    highWater: base,
    advertisedHighWater: base,
    staleCount: 0,
    unsequencedCount: 0
  }
}

export type SseSeqObservation =
  | { readonly kind: 'accept'; readonly seq: number; readonly state: SseSeqGateState }
  | { readonly kind: 'accept-heartbeat'; readonly seq: number; readonly state: SseSeqGateState }
  | { readonly kind: 'stale-heartbeat'; readonly seq: number; readonly state: SseSeqGateState }
  | { readonly kind: 'accept-unsequenced'; readonly state: SseSeqGateState }
  | { readonly kind: 'stale'; readonly seq: number; readonly state: SseSeqGateState }

/**
 * Observe one wire event against the gate. Pure: returns the next state plus
 * how the caller must treat the event.
 *
 * - `accept`: project the event and advance the cursor to `seq`.
 * - `accept-heartbeat`: cursor advances (server advertised delivery through
 *   `seq`), but the heartbeat itself carries no projection payload.
 * - `stale-heartbeat`: do not project and do not rewind; still proves the
 *   live stream is healthy (keep watchdogs fed) and may raise
 *   `advertisedHighWater` when it exceeds the current high-water.
 * - `accept-unsequenced`: project, cursor unchanged (events without a
 *   numeric seq cannot participate in the replay contract).
 * - `stale`: drop; the event was already projected (duplicate replay,
 *   reconnect overlap, or intra-batch duplicate).
 *
 * A heartbeat seq below the committed high-water is legal (heartbeats reuse
 * the server connection cursor after reconnect replay overlap) and is NOT a
 * regression signal on its own.
 */
export function observeSseSeq(
  state: SseSeqGateState,
  event: { seq?: unknown; kind?: unknown }
): SseSeqObservation {
  const seq = typeof event.seq === 'number' && Number.isSafeInteger(event.seq) && event.seq >= 0
    ? event.seq
    : null
  if (seq === null) {
    return {
      kind: 'accept-unsequenced',
      state: { ...state, unsequencedCount: state.unsequencedCount + 1 }
    }
  }
  const advertisedHighWater = Math.max(state.advertisedHighWater, seq)
  if (seq <= state.highWater) {
    if (event.kind === 'heartbeat') {
      return {
        kind: 'stale-heartbeat',
        seq,
        state: { ...state, advertisedHighWater, staleCount: state.staleCount + 1 }
      }
    }
    return {
      kind: 'stale',
      seq,
      state: { ...state, advertisedHighWater, staleCount: state.staleCount + 1 }
    }
  }
  const next: SseSeqGateState = { ...state, highWater: seq, advertisedHighWater }
  return event.kind === 'heartbeat'
    ? { kind: 'accept-heartbeat', seq, state: next }
    : { kind: 'accept', seq, state: next }
}

/**
 * Per-connection transport invariant check, used by the main-process SSE
 * bridge. Within one HTTP connection the server must deliver non-decreasing
 * seqs (replay ascending, then buffered live drained in seq order, then
 * live). Heartbeats are exempt: they reuse the connection cursor.
 *
 * Returns the next connection watermark, or a conflict descriptor when
 * `seq` regressed below the watermark — proof the wire stream is corrupt
 * and replay from the same cursor cannot heal the projection.
 */
export function checkSseConnectionMonotonicity(
  connectionWatermark: number | null,
  event: { seq?: unknown; kind?: unknown }
):
  | { readonly ok: true; readonly watermark: number | null }
  | { readonly ok: false; readonly regressedFrom: number; readonly observed: number } {
  const seq = typeof event.seq === 'number' && Number.isSafeInteger(event.seq) && event.seq >= 0
    ? event.seq
    : null
  if (seq === null || event.kind === 'heartbeat') {
    return { ok: true, watermark: connectionWatermark }
  }
  if (connectionWatermark !== null && seq < connectionWatermark) {
    return { ok: false, regressedFrom: connectionWatermark, observed: seq }
  }
  return { ok: true, watermark: connectionWatermark === null ? seq : Math.max(connectionWatermark, seq) }
}

export type SseStreamCloseSignal =
  | { readonly kind: 'client-abort' }
  | { readonly kind: 'stream-ended' }
  | {
      readonly kind: 'stream-error'
      readonly status?: number
      readonly code?: string
    }

export type SseRecoveryDecision =
  /** No recovery; the client deliberately stopped listening. */
  | { readonly strategy: 'none' }
  /**
   * Reconnect with `since_seq = sinceSeq`; the cursor is still
   * authoritative and replay heals the interruption.
   */
  | { readonly strategy: 'replay-from-cursor'; readonly sinceSeq: number }
  /**
   * The cursor can no longer be trusted (wire regression, corrupt persisted
   * tail). Refetch the authoritative thread snapshot, re-baseline the
   * cursor to the snapshot's `latestSeq`, then resubscribe from there.
   */
  | { readonly strategy: 'authoritative-resync' }

/**
 * Recovery policy for a terminated subscription. Total function: every close
 * signal maps to exactly one decision.
 *
 * - `client-abort` never recovers (user navigating away / stream replaced).
 * - `seq_conflict` demands an authoritative resync: the projection cursor
 *   can no longer be trusted (a truncated `events.jsonl` tail that lets the
 *   persisted stream regress is the canonical case). The caller must refetch
 *   the thread snapshot, re-baseline the cursor to the snapshot's
 *   `latestSeq`, then resubscribe from there — replaying from the old cursor
 *   would silently freeze the projection at a watermark the runtime can no
 *   longer reproduce. Anything else (clean end, transient transport
 *   failure, fatal or throttled HTTP status) still trusts the cursor and
 *   replays from it, since every resubscribe in this codebase rehydrates
 *   from the authoritative snapshot before listening.
 *
 * The main process keeps a deliberately separate connect-time policy
 * (`isFatalSseStatus` in `runtime-sse-ipc.ts`): it decides whether to OPEN
 * a connection at all (fatal 4xx short-circuits the retry loop). That is a
 * different decision from this post-close recovery policy; do not unify
 * them by importing one into the other's domain.
 */
export function decideSseRecovery(signal: SseStreamCloseSignal, cursor: number): SseRecoveryDecision {
  if (signal.kind === 'client-abort') return { strategy: 'none' }
  if (signal.kind === 'stream-error' && signal.code === SSE_SEQ_CONFLICT_CODE) {
    return { strategy: 'authoritative-resync' }
  }
  return { strategy: 'replay-from-cursor', sinceSeq: Math.max(0, cursor | 0) }
}
