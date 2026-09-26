import { readdir } from 'node:fs/promises'
import { isSafeThreadId } from '../../contracts/thread-id.js'
import { join } from 'node:path'
import type { ThreadRecord } from '../../contracts/threads.js'
import { sessionMayReferenceHistory } from '../file/session-history-reference-lookup.js'

export async function historyReferenceThreadIds(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && isSafeThreadId(entry.name)).map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Never trust the rebuildable sidebar index when deciding whether to delete data. */
export async function hasThreadHistoryReference(
  directory: string, referenceId: string,
  metadata: (threadId: string) => Promise<Pick<ThreadRecord, 'historyRefId'> | null>
): Promise<boolean> {
  for (const id of await historyReferenceThreadIds(directory)) {
    let thread
    try { thread = await metadata(id) } catch { return true }
    if (thread?.historyRefId === referenceId) return true
    if (!thread && await sessionMayReferenceHistory(join(directory, id), id, referenceId)) return true
  }
  return false
}
