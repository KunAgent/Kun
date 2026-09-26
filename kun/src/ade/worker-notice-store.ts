import {
  WorkerNoticeFileSchema,
  type WorkerNotice
} from '../contracts/ade.js'
import { adeNoticesFile } from './ade-paths.js'
import { readAdeJson, withAdeTeamMutex, writeAdeJson } from './ade-file.js'

/**
 * Pending-notice inbox per manager team. Notices persist before delivery;
 * `ack` marks them consumed after the manager turn is durably admitted, and
 * `pending` is the restart-replay source (09 §6.2).
 */
export class FileWorkerNoticeStore {
  constructor(
    private readonly dataDir: string,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async enqueue(notice: WorkerNotice): Promise<WorkerNotice> {
    return withAdeTeamMutex(notice.teamId, async () => {
      const file = await this.readFile(notice.teamId)
      const existing = file.notices.find((entry) => entry.noticeId === notice.noticeId)
      if (existing) return existing
      file.notices.push(notice)
      await this.writeFile(notice.teamId, file.notices)
      return notice
    })
  }

  async pending(teamId: string): Promise<WorkerNotice[]> {
    const file = await this.readFile(teamId)
    return file.notices
      .filter((entry) => entry.ackedAt === undefined)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async list(teamId: string): Promise<WorkerNotice[]> {
    const file = await this.readFile(teamId)
    return [...file.notices].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /** Acknowledge delivered notices; unknown ids are ignored. */
  async ack(teamId: string, noticeIds: readonly string[]): Promise<number> {
    if (noticeIds.length === 0) return 0
    const wanted = new Set(noticeIds)
    return withAdeTeamMutex(teamId, async () => {
      const file = await this.readFile(teamId)
      const now = this.nowIso()
      let count = 0
      for (const entry of file.notices) {
        if (wanted.has(entry.noticeId) && entry.ackedAt === undefined) {
          entry.ackedAt = now
          count += 1
        }
      }
      if (count > 0) await this.writeFile(teamId, file.notices)
      return count
    })
  }

  private async readFile(teamId: string): Promise<{ notices: WorkerNotice[] }> {
    const file = await readAdeJson(
      adeNoticesFile(this.dataDir, teamId),
      WorkerNoticeFileSchema,
      () => ({ version: 1 as const, notices: [] as WorkerNotice[] })
    )
    return { notices: [...file.notices] }
  }

  private async writeFile(teamId: string, notices: WorkerNotice[]): Promise<void> {
    await writeAdeJson(adeNoticesFile(this.dataDir, teamId), { version: 1, notices })
  }
}
