import type { RequestContextSnapshot } from '../agent/types'

/** Undefined is a legacy server; explicit null means no durable telemetry. */
export function restoredThreadContextSnapshot(
  threadId: string,
  snapshot: RequestContextSnapshot | null | undefined,
  previous?: RequestContextSnapshot | null
): RequestContextSnapshot | null {
  const selected = snapshot === undefined ? previous : snapshot
  return selected?.threadId === threadId ? selected : null
}
