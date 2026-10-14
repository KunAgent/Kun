import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { assertSafeThreadId } from '../../contracts/thread-id.js'
import { atomicWriteFile } from './atomic-write.js'

/** A separate generation survives restarts and Windows replacement fallbacks. */
export function bindItemHistoryVersion(pathFor: (threadId: string) => string) {
  return async (threadId: string): Promise<string> => {
    assertSafeThreadId(threadId)
    try {
      const version = await readFile(pathFor(threadId) + '.generation', 'utf8')
      if (!/^[a-f0-9-]{36}$/.test(version)) throw new Error('HISTORY_VERSION_UNAVAILABLE')
      return version
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'legacy'
      throw error
    }
  }
}
/** Invalidate old pages before an explicit replacement; a failed write is conservatively invalidated. */
export async function advanceItemHistoryVersion(path: string) {
  await atomicWriteFile(path + '.generation', randomUUID(), { durable: true, allowDirectWriteFallback: false })
}
