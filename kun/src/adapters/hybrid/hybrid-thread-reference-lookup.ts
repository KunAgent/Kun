import { readdir } from 'node:fs/promises'
import { isSafeThreadId } from '../../contracts/thread-id.js'
import type { HybridThreadStore } from './hybrid-thread-store.js'

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
export async function hasThreadHistoryReference(store: HybridThreadStore, referenceId: string): Promise<boolean> {
  await store.ready()
  for (const id of await store.filesystemThreadIds()) {
    if ((await store.getMetadata(id))?.historyRefId === referenceId) return true
  }
  return false
}
