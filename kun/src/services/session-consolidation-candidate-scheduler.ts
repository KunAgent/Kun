import type { ThreadStore } from '../ports/thread-store.js'
import type { ConsolidationJobStatus } from '../contracts/consolidation-job.js'
import type { ConsolidationJobStorePort } from './consolidation-job-store.js'
import {
  SessionConsolidationPreviewService,
  type ConsolidationExcludedPreview,
  type SessionConsolidationPreviewOptions
} from './session-consolidation-preview.js'

/**
 * Phase 1 stage 2 (tasks.md 3.2): wires Phase 0's candidate eligibility
 * (`SessionConsolidationPreviewService`) into the consolidation job store.
 *
 * Still strictly dry-run: the only side effect is deriving/creating a job
 * record via `ConsolidationJobStore.ensureJob`. This never calls MemoryStore
 * and never trims or deletes a thread or its content — extraction, episode
 * writing, and trim/delete are later stages (3.3+, 4.x, 5.x).
 */

export type ConsolidationCandidateScheduleEntry = {
  threadId: string
  jobId: string
  status: ConsolidationJobStatus
  cutoffRevision: string
}

export type ConsolidationCandidateScheduleReport = {
  scheduled: ConsolidationCandidateScheduleEntry[]
  excluded: ConsolidationExcludedPreview[]
  generatedAt: string
}

export type SessionConsolidationCandidateSchedulerOptions = SessionConsolidationPreviewOptions & {
  jobStore: ConsolidationJobStorePort
}

export class SessionConsolidationCandidateScheduler {
  private readonly preview: SessionConsolidationPreviewService
  private readonly threadStore: Pick<ThreadStore, 'list' | 'get' | 'getMetadata'>
  private readonly jobStore: ConsolidationJobStorePort

  constructor(options: SessionConsolidationCandidateSchedulerOptions) {
    this.preview = new SessionConsolidationPreviewService(options)
    this.threadStore = options.threadStore
    this.jobStore = options.jobStore
  }

  /**
   * Read the Phase 0 eligibility report, then call `ensureJob` for each
   * still-eligible thread using its durable `revision` as `cutoffRevision`
   * (matching design.md Decision 6's "thread revision is unchanged" signal).
   * `ensureJob` is itself idempotent, so re-running this on an unchanged
   * thread is always a safe no-op; a thread revised since the last run
   * derives a different job id rather than mutating the prior job.
   */
  async run(): Promise<ConsolidationCandidateScheduleReport> {
    const report = await this.preview.run()
    const scheduled: ConsolidationCandidateScheduleEntry[] = []

    for (const candidate of report.candidates) {
      const record = this.threadStore.getMetadata
        ? await this.threadStore.getMetadata(candidate.threadId).catch(() => null)
        : await this.threadStore.get(candidate.threadId).catch(() => null)
      // The thread vanished (or became unreadable) between the preview pass
      // and scheduling; skip rather than schedule a job against stale data.
      if (!record) continue

      const cutoffRevision = String(record.revision ?? 0)
      const job = await this.jobStore.ensureJob({ threadId: candidate.threadId, cutoffRevision })
      scheduled.push({ threadId: candidate.threadId, jobId: job.id, status: job.status, cutoffRevision })
    }

    return { scheduled, excluded: report.excluded, generatedAt: report.generatedAt }
  }
}
