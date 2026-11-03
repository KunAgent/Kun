import { isSafeThreadId } from '../../contracts/thread-id.js'
import type { ThreadRow } from './hybrid-thread-index-mapping.js'
import { pathExists } from './hybrid-thread-support.js'

type ThreadPaths = {
  threadDir(threadId: string): string
  metadataPath(threadId: string): string
  legacyThreadPath(threadId: string): string
  messagesPath(threadId: string): string
  eventsPath(threadId: string): string
}

/** Rows proven readable recently are trusted for this long when listing. */
export const THREAD_ROW_READABLE_TTL_MS = 30_000

/**
 * Index rows are only listed while their canonical JSONL still exists. That
 * check costs three stats per row, so listing a large history (thousands of
 * threads) used to stat the disk thousands of times per request. A row
 * verified within the TTL is trusted; deleting a row forgets it at once and
 * single-thread reads keep validating their files.
 */
export class ThreadRowReadability {
  private readonly verifiedAt = new Map<string, number>()

  constructor(
    private readonly paths: ThreadPaths,
    private readonly repairPaths: (threadId: string) => void,
    private readonly now: () => number = Date.now
  ) {}

  async check(row: ThreadRow): Promise<boolean> {
    if (!isSafeThreadId(row.id)) return false
    const pathsCurrent = row.metadata_path === this.paths.metadataPath(row.id) &&
      row.messages_path === this.paths.messagesPath(row.id) &&
      row.events_path === this.paths.eventsPath(row.id)
    const verified = this.verifiedAt.get(row.id)
    if (pathsCurrent && verified !== undefined && this.now() - verified < THREAD_ROW_READABLE_TTL_MS) return true
    this.verifiedAt.delete(row.id)
    if (!(await pathExists(this.paths.threadDir(row.id)))) return false
    const readable =
      (await pathExists(this.paths.metadataPath(row.id))) ||
      (await pathExists(this.paths.legacyThreadPath(row.id)))
    if (!readable) return false
    // JSONL is canonical and the SQLite paths are derived. Moving a Runtime
    // data directory (including the GUI's legacy migration) must not make a
    // valid thread disappear merely because its cached absolute paths still
    // point at the previous root.
    if (!pathsCurrent) this.repairPaths(row.id)
    else this.verifiedAt.set(row.id, this.now())
    return true
  }

  forget(threadId: string): void {
    this.verifiedAt.delete(threadId)
  }
}
