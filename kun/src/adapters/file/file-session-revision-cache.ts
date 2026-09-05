/** Bounded LRU revision tracker used to detect concurrent JSONL replacement. */
export class FileSessionRevisionCache {
  private readonly revisions = new Map<string, number>()
  private nextRevision = 0

  constructor(private readonly maxThreads: number) {}

  read(threadId: string): number {
    const revision = this.revisions.get(threadId)
    if (revision === undefined) return this.bump(threadId)
    this.revisions.delete(threadId)
    this.revisions.set(threadId, revision)
    return revision
  }

  bump(threadId: string): number {
    this.nextRevision += 1
    this.revisions.delete(threadId)
    this.revisions.set(threadId, this.nextRevision)
    while (this.revisions.size > this.maxThreads) {
      const oldest = this.revisions.keys().next().value
      if (oldest === undefined) break
      this.revisions.delete(oldest)
    }
    return this.nextRevision
  }

  clear(threadId?: string): void {
    if (threadId === undefined) this.revisions.clear()
    else this.revisions.delete(threadId)
  }
}
