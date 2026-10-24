import type { TFunction } from 'i18next'
import type { ActivityRow } from '@shared/activity-row'
import { displayBucket } from '@shared/activity-display'
import type { SessionExecutionSummary } from '../../../store/session-execution-summary'
import type { WorkerRowData } from '../../workers/worker-row-data'
import { previewLine, workerHue, workerToolActivity } from '../../workers/worker-presentation'
import type { TrayTone } from './tray-kind'
import type { TrayTranslate } from './tray-elapsed'

/*
 * Pure presentation rules of the Workers tray kind: one row per worker
 * activity row of the thread, the segment label and the sheet summary. The
 * classification mirrors selectSessionExecutionSummary (same buckets, same
 * restore / stale-feed rules) so the sheet never disagrees with the segment.
 */

export type WorkersTrayRowStatus =
  | 'waiting'
  | 'failed'
  | 'running'
  | 'starting'
  | 'review'
  | 'done'
  | 'unconfirmed'

/** Who can stop a running worker: the team (team members) or its own turn (child agents). */
export type WorkerStopTarget =
  | { kind: 'team'; workerId: string }
  | { kind: 'turn'; threadId: string; turnId: string }

export type WorkersTrayRow = {
  /** Worker id (the activity unit id, which is also its thread id). */
  id: string
  title: string
  glyph: string
  color: string
  status: WorkersTrayRowStatus
  /** Start of the current state; the running clock counts from it. */
  since: string
  stop: WorkerStopTarget | null
  source: ActivityRow
}

/** Needs the user first, then live work, then settled rows (the panel's grouping). */
const STATUS_ORDER: Readonly<Record<WorkersTrayRowStatus, number>> = {
  waiting: 0,
  failed: 1,
  running: 2,
  starting: 3,
  review: 4,
  done: 5,
  unconfirmed: 6
}

/**
 * Solid avatar fills, indexed by `workerHue` so a worker keeps the hue its
 * Collaboration panel tile uses. Dark enough for white initials in both themes.
 */
export const WORKER_AVATAR_COLORS: readonly string[] = [
  '#4561e0',
  '#0f766e',
  '#6d4fd8',
  '#be3455',
  '#8a6a1f',
  '#0369a1'
]

const GLYPH_SKIP = /[\s\p{P}\p{S}]/u

/** First letter of the worker title ("补 auth-store 单元测试" → "补", "docs" → "D"). */
export function workerAvatarGlyph(title: string, fallback = ''): string {
  for (const char of Array.from(`${title} ${fallback}`)) {
    if (!GLYPH_SKIP.test(char)) return char.toLocaleUpperCase()
  }
  return '?'
}

/**
 * The worker's own hue, exactly as its Collaboration panel tile picks it, so
 * a worker reads the same in the tray, the todo owner label and the panel.
 * It depends on the id alone: a teammate joining never repaints anyone.
 * Teammates whose hues collide share a color and are told apart by their
 * initial (remapping collisions would move a shown avatar mid-session).
 */
export function workerAvatarColor(workerId: string): string {
  return WORKER_AVATAR_COLORS[workerHue(workerId) % WORKER_AVATAR_COLORS.length]!
}

/**
 * Avatar colors of a worker team, keyed by worker id: every surface that
 * paints teammates (the Workers sheet, the todo owner label) asks this one
 * rule. Each worker gets its own `workerAvatarColor`, whoever its teammates are.
 */
export function assignWorkerAvatarColors(workerIds: readonly string[]): Map<string, string> {
  return new Map(workerIds.map((id) => [id, workerAvatarColor(id)]))
}

function rowFailed(row: ActivityRow): boolean {
  return row.state === 'failed' || row.lastOutcome === 'failed'
}

/** Null for rows the summary does not count either (archived, settled into idle). */
export function workerTrayRowStatus(
  row: ActivityRow,
  options: { now: number; feedError: boolean }
): WorkersTrayRowStatus | null {
  if (row.visibility === 'archived') return null
  // Restored facts await confirmation, so they never drive live UI.
  if (row.restoredUnconfirmed) return 'unconfirmed'
  const bucket = displayBucket(row, options.now)
  if (bucket === 'idle') return null
  // A stale feed can only report what was last confirmed.
  if (options.feedError) return 'unconfirmed'
  if (bucket === 'working') return row.state === 'initializing' ? 'starting' : 'running'
  if (bucket === 'needs-you') return rowFailed(row) ? 'failed' : 'waiting'
  return bucket === 'review' ? 'review' : 'done'
}

/** Team members stop through the team; other child agents by interrupting their turn. */
export function workerStopTarget(row: ActivityRow, status: WorkersTrayRowStatus): WorkerStopTarget | null {
  if (status !== 'running' && status !== 'starting') return null
  if (row.teamId) return { kind: 'team', workerId: row.unitId }
  return row.turnId ? { kind: 'turn', threadId: row.threadId, turnId: row.turnId } : null
}

/** The row shape `useWorkerActions().stop` expects, for a stoppable worker. */
export function workerStopRowData(row: WorkersTrayRow): WorkerRowData | null {
  const target = row.stop
  if (!target) return null
  return {
    workerId: row.id,
    label: row.title,
    state: 'active',
    control: 'manager',
    reviewer: false,
    bucket: 'working',
    activityRow: row.source,
    ...(target.kind === 'turn' ? { child: { threadId: target.threadId, turnId: target.turnId } } : {})
  }
}

/** Sheet rows, most urgent first (stable within a status: pinned, then newest). */
export function buildWorkersTrayRows(
  rows: readonly ActivityRow[],
  options: { now: number; feedError: boolean }
): WorkersTrayRow[] {
  const built: WorkersTrayRow[] = []
  for (const row of rows) {
    const status = workerTrayRowStatus(row, options)
    if (!status) continue
    const title = row.title.trim() || row.unitId
    built.push({
      id: row.unitId,
      title,
      glyph: workerAvatarGlyph(row.title, row.harnessId),
      color: workerAvatarColor(row.unitId),
      status,
      since: row.stateSince,
      stop: workerStopTarget(row, status),
      source: row
    })
  }
  return built
    .map((row, index) => ({ row, index }))
    .sort((left, right) =>
      STATUS_ORDER[left.row.status] - STATUS_ORDER[right.row.status] || left.index - right.index)
    .map(({ row }) => row)
}

export type WorkersSegmentStatus = {
  tone: TrayTone
  /** Label color: warning / danger / success, or the bar's muted default. */
  labelTone: 'waiting' | 'error' | 'done' | 'default'
  label: string
  /**
   * The label already says "collaborators" ("2 位协作者在做", "协作已完成"),
   * so the open chip does not prefix it with the "协作" title.
   */
  selfNamed: boolean
}

/** Segment label by priority: needs you > failed > review > working > done; unknown stays muted. */
export function workersSegmentStatus(summary: SessionExecutionSummary, t: TrayTranslate): WorkersSegmentStatus {
  const { counts } = summary
  switch (summary.kind) {
    case 'waiting-user':
      return {
        tone: 'waiting',
        labelTone: 'waiting',
        label: t('composerTrayWorkers.segment.waiting', { count: counts.waiting }),
        selfNamed: false
      }
    case 'failed':
      return {
        tone: 'error',
        labelTone: 'error',
        label: t('composerTrayWorkers.segment.failed', { count: counts.failed }),
        selfNamed: false
      }
    case 'review':
      return {
        tone: 'default',
        labelTone: 'default',
        label: t('composerTrayWorkers.segment.review', { count: counts.review }),
        selfNamed: false
      }
    case 'running':
    case 'starting':
      return {
        tone: 'running',
        labelTone: 'default',
        label: t('composerTrayWorkers.segment.working', { count: counts.running + counts.starting }),
        selfNamed: true
      }
    case 'continuing':
    case 'completed':
      // Every child settled (review verdicts included); the main turn may still run.
      return { tone: 'done', labelTone: 'done', label: t('composerTrayWorkers.segment.done'), selfNamed: true }
    default:
      return { tone: 'default', labelTone: 'default', label: t('composerTrayWorkers.segment.unknown'), selfNamed: false }
  }
}

/** How many workers the segment label itself already counts. */
function segmentLabelCount(summary: SessionExecutionSummary): number {
  const { counts } = summary
  switch (summary.kind) {
    case 'waiting-user':
      return counts.waiting
    case 'failed':
      return counts.failed
    case 'review':
      return counts.review
    case 'running':
    case 'starting':
      return counts.running + counts.starting
    default:
      return 0
  }
}

/**
 * Accessible status of the segment ("协作：1 个等你处理，3 个未结束"): its
 * button name and the tray's polite announcement. Like the old strip it adds
 * the unfinished count, unless the label already says it; a stale feed cannot
 * confirm one, so the unknown state never claims it.
 */
export function workersAccessibleStatus(
  summary: SessionExecutionSummary,
  status: WorkersSegmentStatus,
  t: TrayTranslate
): string {
  const remaining = summary.kind === 'unknown' ? 0 : summary.unfinished
  return remaining > segmentLabelCount(summary)
    ? t('composerTrayWorkers.ariaLabelUnfinished', { status: status.label, remaining })
    : t('composerTrayWorkers.ariaLabel', { status: status.label })
}

/** The old status strip's count line ("1 running · 1 waiting · 1 done"), kept as the tooltip. */
export function workersCountDetail(summary: SessionExecutionSummary, t: TrayTranslate): string {
  const parts: string[] = []
  const push = (value: number, key: string): void => {
    if (value > 0) parts.push(t(key, { value }))
  }
  push(summary.counts.running, 'backgroundTaskCountRunning')
  push(summary.counts.starting, 'backgroundTaskCountStarting')
  push(summary.counts.waiting, 'backgroundTaskCountWaiting')
  push(summary.counts.review, 'backgroundTaskCountReview')
  push(summary.counts.failed, 'backgroundTaskCountFailed')
  push(summary.counts.completed, 'backgroundTaskCountDone')
  return parts.join(' · ')
}

export function countWorkerRows(rows: readonly WorkersTrayRow[]): Record<WorkersTrayRowStatus, number> {
  const counts: Record<WorkersTrayRowStatus, number> = {
    waiting: 0, failed: 0, running: 0, starting: 0, review: 0, done: 0, unconfirmed: 0
  }
  for (const row of rows) counts[row.status] += 1
  return counts
}

/** Earliest start among running workers (the header's "longest running" clock). */
export function longestRunningSince(rows: readonly WorkersTrayRow[]): number | null {
  let earliest: number | null = null
  for (const row of rows) {
    if (row.status !== 'running') continue
    const since = Date.parse(row.since)
    if (Number.isFinite(since) && (earliest == null || since < earliest)) earliest = since
  }
  return earliest
}

/**
 * Header summary after the elapsed clock: "1 个在后台 · 1 个等你处理". Finished
 * rows are only counted when nothing else is going on.
 */
export function workersSheetSummaryParts(rows: readonly WorkersTrayRow[], t: TrayTranslate): string[] {
  const counts = countWorkerRows(rows)
  const parts: string[] = []
  const inBackground = counts.running + counts.starting
  if (inBackground > 0) parts.push(t('composerTrayWorkers.summary.inBackground', { count: inBackground }))
  if (counts.waiting > 0) parts.push(t('composerTrayWorkers.segment.waiting', { count: counts.waiting }))
  if (counts.failed > 0) parts.push(t('composerTrayWorkers.segment.failed', { count: counts.failed }))
  if (counts.review > 0) parts.push(t('composerTrayWorkers.segment.review', { count: counts.review }))
  if (counts.unconfirmed > 0) parts.push(t('composerTrayWorkers.summary.unconfirmed', { count: counts.unconfirmed }))
  if (parts.length === 0 && counts.done > 0) parts.push(t('composerTrayWorkers.summary.done', { count: counts.done }))
  return parts
}

/** Readable tail of a worker's own words (progress note or last message). */
function preview(row: ActivityRow, prefer: 'note' | 'message'): string {
  const note = previewLine(row.progressNote)
  const message = previewLine(row.lastMessagePreview)
  return prefer === 'note' ? note || message : message || note
}

const VERDICT_KEYS: Readonly<Partial<Record<NonNullable<ActivityRow['reviewStatus']>, string>>> = {
  passed: 'workersVerdict.passed',
  needs_changes: 'workersVerdict.needs_changes',
  rejected: 'workersVerdict.rejected',
  waived: 'workersVerdict.waived'
}

/**
 * Subtitle of a settled or waiting row. Running rows build theirs live in the
 * sheet (elapsed clock + current activity).
 */
export function workerRowNote(row: WorkersTrayRow, t: TrayTranslate): string {
  const source = row.source
  switch (row.status) {
    case 'waiting': {
      if (source.waitingReason === 'question' || source.waitingReason === 'user_input') {
        return preview(source, 'message') || t('workersStatus.question')
      }
      if (source.waitingReason === 'approval') return preview(source, 'note') || t('workersStatus.approval')
      return preview(source, 'note') || t('workersStatus.waiting')
    }
    case 'failed':
      return preview(source, 'message') || t('workersStatus.failed')
    case 'review': {
      const verdict = source.reviewStatus === 'needs_changes'
        ? t('workersVerdict.needs_changes')
        : t('composerTrayWorkers.reviewPending')
      const text = preview(source, 'message')
      return text ? `${verdict} · ${text}` : verdict
    }
    case 'done': {
      const verdictKey = source.reviewStatus ? VERDICT_KEYS[source.reviewStatus] : undefined
      const text = preview(source, 'message')
      const parts = [verdictKey ? t(verdictKey) : '', text].filter(Boolean)
      if (parts.length) return parts.join(' · ')
      return source.lastOutcome === 'cancelled'
        ? t('composerTrayWorkers.status.cancelled')
        : t('workersStatus.done')
    }
    case 'starting':
      return t('composerTrayWorkers.starting')
    case 'unconfirmed':
      return preview(source, 'note') || t('backgroundTaskUnknown')
    default:
      return preview(source, 'note')
  }
}

/** What a running worker is doing now: its tool, its own progress note, or its phase. */
export function workerRunningActivity(row: WorkersTrayRow, t: TrayTranslate): string {
  const source = row.source
  if (source.currentTool) return workerToolActivity(source.currentTool, t as unknown as TFunction)
  const note = previewLine(source.progressNote)
  if (note) return note
  return source.phase ? t(`workersPhase.${source.phase}`) : ''
}

/** Waiting on an answer ("去回答") rather than another kind of attention ("去处理"). */
export function workerAwaitsAnswer(row: WorkersTrayRow): boolean {
  const reason = row.source.waitingReason
  return reason === 'question' || reason === 'user_input'
}
