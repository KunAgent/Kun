import type { TFunction } from 'i18next'
import type { WorkerRowData } from './worker-row-data'

/**
 * Presentation rules shared by the Collaboration list and worker tabs:
 * one status per worker, the list group it sits in, and the short
 * one-line activity text. Pure so the panel and its tests agree.
 */
export type WorkerStatusKind =
  | 'question'
  | 'approval'
  | 'waiting'
  | 'failed'
  | 'working'
  | 'done'
  | 'released'
  | 'idle'

export type WorkerTone = 'running' | 'warning' | 'danger' | 'success' | 'muted'

export type WorkerSection = 'needs-you' | 'working' | 'done'

export const WORKER_SECTIONS: readonly WorkerSection[] = ['needs-you', 'working', 'done']

export const WORKER_HUE_COUNT = 6

const TONE_BY_KIND: Readonly<Record<WorkerStatusKind, WorkerTone>> = {
  question: 'warning',
  approval: 'warning',
  waiting: 'warning',
  failed: 'danger',
  working: 'running',
  done: 'success',
  released: 'muted',
  idle: 'muted'
}

export function workerFailed(row: WorkerRowData): boolean {
  const activity = row.activityRow
  if (activity?.state === 'failed') return true
  return row.bucket !== 'working' && row.dispatchState === 'failed'
}

export function workerStatus(row: WorkerRowData): { kind: WorkerStatusKind; tone: WorkerTone } {
  const kind = workerStatusKind(row)
  return { kind, tone: TONE_BY_KIND[kind] }
}

function workerStatusKind(row: WorkerRowData): WorkerStatusKind {
  // A finished child agent is "done"; only team workers are ever released.
  if (row.state !== 'active' && !row.child) return 'released'
  if (row.openQuestion || row.waitingReason === 'question' || row.waitingReason === 'user_input') {
    return 'question'
  }
  if (row.waitingReason === 'approval') return 'approval'
  if (workerFailed(row)) return 'failed'
  if (row.bucket === 'working') return 'working'
  if (row.bucket === 'needs-you') return 'waiting'
  if (row.bucket === 'review' || row.bucket === 'done') return 'done'
  return 'idle'
}

/** Anything that waits on the user is listed first. */
export function workerSection(row: WorkerRowData): WorkerSection {
  const { kind } = workerStatus(row)
  if (kind === 'question' || kind === 'approval' || kind === 'waiting' || kind === 'failed') {
    return 'needs-you'
  }
  return kind === 'working' ? 'working' : 'done'
}

export function groupWorkerRows(rows: readonly WorkerRowData[]): Array<{
  section: WorkerSection
  rows: WorkerRowData[]
}> {
  return WORKER_SECTIONS
    .map((section) => ({ section, rows: rows.filter((row) => workerSection(row) === section) }))
    .filter((group) => group.rows.length > 0)
}

/** Live while the worker still holds a turn; the clock counts that turn. */
export function workerIsLive(row: WorkerRowData): boolean {
  const { kind } = workerStatus(row)
  return kind === 'working' || kind === 'question' || kind === 'approval' || kind === 'waiting'
}

const TOOL_VERBS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(read|read_file|view|cat|open_file)$/i, 'read'],
  [/^(write|edit|apply_patch|write_file|edit_file|str_replace|multi_edit|notebook_edit)/i, 'edit'],
  [/^(grep|glob|ls|list_dir|list_files|find|search|lsp|codebase_search)/i, 'search'],
  [/^(bash|shell|exec|run|terminal|command)/i, 'command'],
  [/^web_/i, 'web'],
  [/^(delegate_task|worker_create|spawn_agent|task)$/i, 'delegate']
]

export function workerToolActivity(toolName: string, t: TFunction): string {
  const name = toolName.trim()
  const match = TOOL_VERBS.find(([pattern]) => pattern.test(name))
  return match
    ? t(`workersTool.${match[1]}`)
    : t('workersTool.other', { tool: name })
}

const MARKDOWN_BLOCK_MARK = /^\s{0,3}(?:#{1,6}|>|[-*+](?=\s))\s*/gm
// Underscores stay: snake_case names are common in worker output.
const MARKDOWN_INLINE_MARK = /\*+|`+|~~/g
const LEADING_PUNCTUATION = /^[\s.,;:!?)\]}"'，。、；：！？）】」』…—–-]+/

/**
 * Activity previews are the streamed tail of the worker's answer, so they
 * may start mid-sentence and carry raw markdown. Returns '' when nothing
 * readable is left.
 */
export function previewLine(text: string | undefined, maxLength = 200): string {
  if (!text) return ''
  const plain = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(MARKDOWN_BLOCK_MARK, '')
    .replace(MARKDOWN_INLINE_MARK, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
  const trimmed = plain.replace(LEADING_PUNCTUATION, '').trim()
  if (trimmed.replace(/[\p{P}\p{S}\s]/gu, '').length < 2) return ''
  const cut = trimmed !== plain.trim() || text.length >= maxLength
  return cut ? `…${trimmed}` : trimmed
}

export function workerActivityText(row: WorkerRowData, t: TFunction): string {
  const { kind } = workerStatus(row)
  const activity = row.activityRow
  switch (kind) {
    case 'question':
      return t('workersStatus.question')
    case 'approval':
      return t('workersStatus.approval')
    case 'failed': {
      const reason = previewLine(row.lastMessagePreview)
      return reason ? `${t('workersStatus.failed')} · ${reason}` : t('workersStatus.failed')
    }
    case 'working': {
      if (activity?.currentTool) return workerToolActivity(activity.currentTool, t)
      const note = previewLine(row.progressNote)
      if (note) return note
      if (activity?.phase) return t(`workersPhase.${activity.phase}`)
      return t('workersStatus.working')
    }
    case 'waiting':
      return previewLine(row.progressNote) || t('workersStatus.waiting')
    case 'released':
      return t('workersStatus.released')
    default:
      return previewLine(row.progressNote) || previewLine(row.lastMessagePreview) ||
        t(kind === 'done' ? 'workersStatus.done' : 'workersStatus.idle')
  }
}

export function workerHue(workerId: string): number {
  let hash = 0
  for (let index = 0; index < workerId.length; index += 1) {
    hash = (hash * 31 + workerId.charCodeAt(index)) >>> 0
  }
  return hash % WORKER_HUE_COUNT
}

export function formatWorkerTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 1000) return String(Math.max(0, Math.round(tokens || 0)))
  if (tokens < 1_000_000) return `${trimDecimal(tokens / 1000)}K`
  return `${trimDecimal(tokens / 1_000_000)}M`
}

function trimDecimal(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return value.toFixed(digits).replace(/\.?0+$/, '')
}

/** `3:45`, or `1:02:03` past an hour. */
export function formatWorkerClock(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

export function formatWorkerAgo(elapsedMs: number, t: TFunction): string {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000)
  if (minutes < 1) return t('workersTime.justNow')
  if (minutes < 60) return t('workersTime.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('workersTime.hours', { n: hours })
  return t('workersTime.days', { n: Math.floor(hours / 24) })
}

/** Clock for a live worker, "x min ago" once it settled; '' without activity. */
export function workerTimeLabel(row: WorkerRowData, now: number, t: TFunction): string {
  const since = row.activityRow ? Date.parse(row.activityRow.stateSince) : Number.NaN
  if (!Number.isFinite(since)) return ''
  return workerIsLive(row) ? formatWorkerClock(now - since) : formatWorkerAgo(now - since, t)
}

/** Harness · model · tokens, skipping whatever the worker does not report. */
export function workerMetaParts(row: WorkerRowData): string[] {
  const parts: string[] = []
  const harness = row.harnessId ?? row.activityRow?.harnessId
  if (harness) parts.push(harness === 'kun' ? 'Kun' : harness)
  if (row.model) parts.push(row.model)
  if (typeof row.totalTokens === 'number' && row.totalTokens > 0) {
    parts.push(`${formatWorkerTokens(row.totalTokens)} tok`)
  }
  return parts
}
