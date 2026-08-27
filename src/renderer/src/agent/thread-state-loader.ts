import type {
  AgentProvider,
  ThreadRuntimeStateBatchResult
} from './provider-types'
import { getRuntimeErrorCode } from '../lib/format-runtime-error'

export const THREAD_STATE_FALLBACK_CONCURRENCY = 4
// Mirrors THREAD_RUNTIME_STATE_BATCH_MAX_IDS in kun/src/contracts/threads.ts:
// the runtime batch route rejects larger requests with a validation error.
export const THREAD_STATE_BATCH_MAX_IDS = 200

/**
 * Prefer the runtime's bounded bulk endpoint, one sequential chunk at a time
 * so a large reconciliation never turns into parallel batch bursts. Older
 * runtimes transparently fall back to single-state reads, still capped so
 * background work cannot saturate the renderer bridge.
 */
export async function loadThreadStates(
  provider: Pick<AgentProvider, 'getThreadState' | 'getThreadStates'>,
  requestedIds: readonly string[]
): Promise<ThreadRuntimeStateBatchResult[]> {
  const threadIds = [...new Set(requestedIds.filter(Boolean))]
  if (threadIds.length === 0) return []

  if (typeof provider.getThreadStates === 'function') {
    try {
      const results: ThreadRuntimeStateBatchResult[] = []
      for (
        let offset = 0;
        offset < threadIds.length;
        offset += THREAD_STATE_BATCH_MAX_IDS
      ) {
        // Chunks run sequentially; the runtime already bounds inner work to
        // THREAD_RUNTIME_STATE_BATCH_CONCURRENCY.
        results.push(...await provider.getThreadStates(
          threadIds.slice(offset, offset + THREAD_STATE_BATCH_MAX_IDS)
        ))
      }
      return results
    } catch (error) {
      // A new renderer can connect to an older Kun runtime that has no batch
      // route. The bounded single-read path below preserves compatibility.
      const code = getRuntimeErrorCode(error)
      if (code !== 'not_found' && code !== 'not_implemented') {
        const message = error instanceof Error ? error.message : String(error)
        return threadIds.map((id) => ({
          id,
          ok: false,
          error: { code: 'unavailable', message }
        }))
      }
    }
  }

  const results: ThreadRuntimeStateBatchResult[] = new Array(threadIds.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= threadIds.length) return
      const id = threadIds[index]
      try {
        results[index] = { id, ok: true, state: await provider.getThreadState(id) }
      } catch (error) {
        const missing = getRuntimeErrorCode(error) === 'not_found'
        results[index] = {
          id,
          ok: false,
          error: {
            code: missing ? 'not_found' : 'unavailable',
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(THREAD_STATE_FALLBACK_CONCURRENCY, threadIds.length) },
    worker
  ))
  return results
}
