import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../file/atomic-write.js'

const JOURNAL_VERSION = 1

type DirtyJournal = { version: number; threadIds: string[] }

/**
 * Tracks thread ids whose SQLite index write failed and have not yet been
 * repaired. The in-memory set covers the current session; a sidecar journal
 * (`index-dirty.json` next to the sqlite file) preserves the set across
 * restarts so a stale row written before a crash is re-marked dirty instead
 * of being trusted forever.
 */
export class HybridThreadIndexDirtyTracker {
  private readonly threadIds = new Set<string>()
  private readonly journalPath: string
  private readonly warn: (action: string, error: unknown) => void

  constructor(sqlitePath: string, warn: (action: string, error: unknown) => void) {
    this.journalPath = join(dirname(sqlitePath), 'index-dirty.json')
    this.warn = warn
  }

  async load(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.journalPath, 'utf-8')
    } catch (error) {
      // A missing journal is the normal first-run case, not a failure.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.warn('load index dirty journal', error)
      }
      return
    }
    try {
      const parsed = JSON.parse(raw) as DirtyJournal
      if (parsed && parsed.version === JOURNAL_VERSION && Array.isArray(parsed.threadIds)) {
        for (const id of parsed.threadIds) if (typeof id === 'string' && id) this.threadIds.add(id)
      }
    } catch (error) {
      this.warn('parse index dirty journal', error)
    }
  }

  add(threadId: string): void {
    if (this.threadIds.has(threadId)) return
    this.threadIds.add(threadId)
    void this.persist()
  }

  remove(threadId: string): void {
    if (!this.threadIds.delete(threadId)) return
    void this.persist()
  }

  has(threadId: string): boolean { return this.threadIds.has(threadId) }

  get size(): number { return this.threadIds.size }

  ids(): string[] { return [...this.threadIds] }

  private async persist(): Promise<void> {
    const journal: DirtyJournal = { version: JOURNAL_VERSION, threadIds: [...this.threadIds].sort() }
    try {
      await atomicWriteFile(this.journalPath, JSON.stringify(journal))
    } catch (error) {
      this.warn('persist index dirty journal', error)
    }
  }
}
