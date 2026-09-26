import { join } from 'node:path'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { isSafeThreadId } from '../contracts/thread-id.js'
import { computeDirectoryByteSize } from './fs-directory-size.js'

/**
 * Session Consolidation Preview: read-only Phase 0 dry-run over candidate
 * eligibility (add-session-memory-consolidation). Reports what *would* be
 * selected without writing memory, trimming sessions, or deleting threads.
 */

export type ConsolidationExclusionReason =
  | 'not_archived'
  | 'active_turn'
  | 'pending_approval'
  | 'pending_user_input'
  | 'pinned'
  | 'fork_dependency'
  | 'no_completed_turn'
  | 'not_idle'
  | 'below_min_size'

export type ConsolidationThreadDiagnostics = {
  threadId: string
  /** `finishedAt` of the most recently completed turn; absent if none exist. */
  lastCompletedTurnFinishedAt?: string
  hasActiveTurn: boolean
  /**
   * Reported for visibility only. Never consulted to compute idle age or to
   * admit a candidate — a thread with no completed turn is always excluded
   * regardless of how old `updatedAt` is (see `no_completed_turn`).
   */
  updatedAt: string
  threadPayloadBytes: number
}

export type ConsolidationCandidatePreview = ConsolidationThreadDiagnostics

export type ConsolidationExcludedPreview = ConsolidationThreadDiagnostics & {
  reason: ConsolidationExclusionReason
}

export type ConsolidationPreviewReport = {
  candidates: ConsolidationCandidatePreview[]
  excluded: ConsolidationExcludedPreview[]
  candidateCount: number
  /** Sum of candidates' `threadPayloadBytes`. Bytes only, no SQLite/index accounting. */
  projectedReclaimableBytes: number
  generatedAt: string
}

export type SessionConsolidationPreviewOptions = {
  threadStore: Pick<ThreadStore, 'list' | 'get' | 'getMetadata'>
  dataDir: string
  nowIso?: () => string
  idleAfterMs: number
  minBytes: number
}

export class SessionConsolidationPreviewService {
  private readonly threadStore: Pick<ThreadStore, 'list' | 'get' | 'getMetadata'>
  private readonly dataDir: string
  private readonly nowIso: () => string
  private readonly idleAfterMs: number
  private readonly minBytes: number

  constructor(options: SessionConsolidationPreviewOptions) {
    this.threadStore = options.threadStore
    this.dataDir = options.dataDir
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.idleAfterMs = options.idleAfterMs
    this.minBytes = options.minBytes
  }

  /** Read-only: never calls `upsert`/`delete`/`touch`/`upsertIfRevision`. */
  async run(): Promise<ConsolidationPreviewReport> {
    const generatedAt = this.nowIso()
    const now = Date.parse(generatedAt)
    const summaries = await this.threadStore.list({ includeArchived: true, includeSide: true })

    const records: ThreadRecord[] = []
    for (const summary of summaries) {
      if (!isSafeThreadId(summary.id)) continue
      const record = this.threadStore.getMetadata
        ? await this.threadStore.getMetadata(summary.id).catch(() => null)
        : await this.threadStore.get(summary.id).catch(() => null)
      if (record) records.push(record)
    }

    // Reverse fork/child index: no such index exists on ThreadRecord itself,
    // so it is built once as a one-pass set over every fetched record.
    const dependedOn = new Set<string>()
    for (const record of records) {
      if (record.parentThreadId) dependedOn.add(record.parentThreadId)
      if (record.forkedFromThreadId) dependedOn.add(record.forkedFromThreadId)
    }

    const candidates: ConsolidationCandidatePreview[] = []
    const excluded: ConsolidationExcludedPreview[] = []

    for (const record of records) {
      const hasActiveTurn = record.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')
      const lastCompletedTurn = lastCompletedTurnOf(record.turns)
      const threadPayloadBytes = await computeDirectoryByteSize(join(this.dataDir, 'threads', record.id))
      const diagnostics: ConsolidationThreadDiagnostics = {
        threadId: record.id,
        ...(lastCompletedTurn?.finishedAt ? { lastCompletedTurnFinishedAt: lastCompletedTurn.finishedAt } : {}),
        hasActiveTurn,
        updatedAt: record.updatedAt,
        threadPayloadBytes
      }

      const reason = this.exclusionReason(record, hasActiveTurn, lastCompletedTurn, dependedOn, now, threadPayloadBytes)
      if (reason) {
        excluded.push({ ...diagnostics, reason })
      } else {
        candidates.push(diagnostics)
      }
    }

    const projectedReclaimableBytes = candidates.reduce((sum, candidate) => sum + candidate.threadPayloadBytes, 0)

    return { candidates, excluded, candidateCount: candidates.length, projectedReclaimableBytes, generatedAt }
  }

  private exclusionReason(
    record: ThreadRecord,
    hasActiveTurn: boolean,
    lastCompletedTurn: Turn | undefined,
    dependedOn: Set<string>,
    now: number,
    threadPayloadBytes: number
  ): ConsolidationExclusionReason | null {
    if (record.status !== 'archived') return 'not_archived'
    if (hasActiveTurn) return 'active_turn'
    if (hasPendingApproval(record)) return 'pending_approval'
    if (hasPendingUserInput(record)) return 'pending_user_input'
    if (record.pinned === true) return 'pinned'
    if (dependedOn.has(record.id)) return 'fork_dependency'
    // Hard rule: a thread with zero completed turns is always excluded here.
    // `updatedAt` is never consulted to admit it, no matter how old it is.
    if (!lastCompletedTurn) return 'no_completed_turn'
    const idleSince = Date.parse(lastCompletedTurn.finishedAt ?? lastCompletedTurn.createdAt)
    if (!Number.isFinite(idleSince) || now - idleSince < this.idleAfterMs) return 'not_idle'
    if (threadPayloadBytes < this.minBytes) return 'below_min_size'
    return null
  }
}

function lastCompletedTurnOf(turns: readonly Turn[]): Turn | undefined {
  let latest: Turn | undefined
  for (const turn of turns) {
    if (turn.status !== 'completed') continue
    if (!latest) { latest = turn; continue }
    const latestAt = Date.parse(latest.finishedAt ?? latest.createdAt)
    const turnAt = Date.parse(turn.finishedAt ?? turn.createdAt)
    if (turnAt > latestAt) latest = turn
  }
  return latest
}

function hasPendingApproval(record: ThreadRecord): boolean {
  return record.turns.some((turn) => turn.items.some((item) => item.kind === 'approval' && item.status === 'pending'))
}

function hasPendingUserInput(record: ThreadRecord): boolean {
  return record.turns.some((turn) => turn.items.some((item) => item.kind === 'user_input' && item.status === 'pending'))
}
