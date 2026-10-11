import type { ContextSnapshotEvent } from '../../contracts/context-snapshot.js'
import type { SessionStore } from '../../ports/session-store.js'

/** Optional telemetry must not prevent history loading with an older owner. */
export async function threadContextSnapshot(
  store: SessionStore | undefined,
  threadId: string,
  maxSeq: number
): Promise<{ contextSnapshot?: ContextSnapshotEvent | null }> {
  if (!store?.loadLatestContextSnapshot) return {}
  try { return { contextSnapshot: await store.loadLatestContextSnapshot(threadId, maxSeq) } }
  catch { return {} }
}
