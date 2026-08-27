import type { ThreadStore } from '../ports/thread-store.js'
import type { ThreadStoreDiagnosticIssue } from '../contracts/thread-store-diagnostics.js'
import { scanThreadStore } from './thread-store-doctor.js'

export type ThreadStoreGuardianResult = {
  checkedAt: string
  scannedThreads: number
  inconsistentThreads: number
  repairedThreads: number
  remainingIssues: ThreadStoreDiagnosticIssue[]
}

/** Coalesces bounded doctor scans and repairs only the rebuildable SQLite index. */
export class ThreadStoreGuardian {
  private inflight?: Promise<ThreadStoreGuardianResult>

  constructor(private readonly options: {
    dataDir: string
    sqlitePath?: string
    attachmentRootDir?: string
    threadStore: Pick<ThreadStore, 'get'>
    nowIso?: () => string
  }) {}

  run(): Promise<ThreadStoreGuardianResult> {
    if (this.inflight) return this.inflight
    const run = this.execute().finally(() => {
      if (this.inflight === run) this.inflight = undefined
    })
    this.inflight = run
    return run
  }

  private async execute(): Promise<ThreadStoreGuardianResult> {
    const report = await scanThreadStore(this.scanOptions())
    const inconsistent = report.threads.filter((thread) =>
      thread.sqliteIndex === 'mismatch' &&
      thread.metadata !== 'missing' &&
      thread.metadata !== 'invalid'
    )
    let repairedThreads = 0
    for (const diagnostic of inconsistent) {
      if (await this.options.threadStore.get(diagnostic.threadId)) repairedThreads += 1
    }
    if (inconsistent.length === 0) {
      return this.result(report.checkedAt, report.scanned.threads, 0, 0, report.issues)
    }
    const verified = await scanThreadStore(this.scanOptions())
    const remaining = [
      ...verified.issues,
      ...verified.threads.flatMap((thread) => thread.issues)
    ].slice(0, 64)
    return this.result(
      verified.checkedAt,
      verified.scanned.threads,
      inconsistent.length,
      repairedThreads,
      remaining
    )
  }

  private scanOptions() {
    return {
      dataDir: this.options.dataDir,
      ...(this.options.sqlitePath ? { sqlitePath: this.options.sqlitePath } : {}),
      ...(this.options.attachmentRootDir ? { attachmentRootDir: this.options.attachmentRootDir } : {}),
      ...(this.options.nowIso ? { nowIso: this.options.nowIso } : {})
    }
  }

  private result(
    checkedAt: string,
    scannedThreads: number,
    inconsistentThreads: number,
    repairedThreads: number,
    remainingIssues: ThreadStoreDiagnosticIssue[]
  ): ThreadStoreGuardianResult {
    return { checkedAt, scannedThreads, inconsistentThreads, repairedThreads, remainingIssues }
  }
}
