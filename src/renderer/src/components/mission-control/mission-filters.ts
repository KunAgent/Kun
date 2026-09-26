import type { ActivityRow } from '@shared/activity-row'
import type { AdeTeamOverview } from '@shared/ade-teams'

/**
 * Mission Control toolbar state (docs/ade/12 §5.2) plus the card-data joins
 * the view resolves lazily from /v1/teams and /v1/task-workspaces (§5.3).
 */
export type MissionFilters = {
  search: string
  /** Workspace basename; '' = all projects. */
  project: string
  /** Harness id; '' = all agents. */
  harness: string
  /** Latest verdict status; '' = all. */
  verdict: string
  showIdle: boolean
}

export const EMPTY_MISSION_FILTERS: MissionFilters = {
  search: '',
  project: '',
  harness: '',
  verdict: '',
  showIdle: false
}

export function projectOfRow(row: ActivityRow): string {
  const normalized = row.workspace.path.replace(/[/\\]+$/, '')
  const tail = normalized.split(/[/\\]/).filter(Boolean)
  return tail[tail.length - 1] ?? normalized
}

/** Display text for the row's preview line (12 §5.1). */
export function missionPreviewOf(row: ActivityRow): string | undefined {
  if (row.progressNote) return row.progressNote
  if (row.state === 'waiting' && row.waitingReason) {
    return `waiting:${row.waitingReason}`
  }
  if (row.state === 'failed') return row.lastOutcome ?? 'failed'
  return row.lastMessagePreview
}

export function missionFiltered(filters: MissionFilters): boolean {
  return Boolean(filters.search || filters.project || filters.harness || filters.verdict)
}

/**
 * Search + project/agent/verdict filters (§5.2). Verdict filtering needs the
 * lazily loaded overviews; rows without verdict data only match '' filter.
 */
export function filterMissionRows(
  rows: ActivityRow[],
  filters: MissionFilters,
  verdictOf: (row: ActivityRow) => string | undefined
): ActivityRow[] {
  const search = filters.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.project && projectOfRow(row) !== filters.project) return false
    if (filters.harness && row.harnessId !== filters.harness) return false
    if (filters.verdict && verdictOf(row) !== filters.verdict) return false
    if (!search) return true
    const hay = `${row.title} ${projectOfRow(row)} ${row.harnessId}`.toLowerCase()
    return hay.includes(search)
  })
}

/** Latest capture/verdict for a worker from its manager's team overview. */
export function workerDispatchStats(
  overview: AdeTeamOverview | null | undefined,
  workerId: string
): { insertions?: number; deletions?: number; verdict?: string } {
  if (!overview) return {}
  const latest = [...overview.dispatches]
    .filter((d) => d.workerId === workerId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  return latest
    ? {
        insertions: latest.capture?.insertions,
        deletions: latest.capture?.deletions,
        verdict: latest.verdict?.status
      }
    : {}
}

/** Open question a needs-you worker row is blocked on, if any. */
export function openQuestionFor(
  overview: AdeTeamOverview | null | undefined,
  workerId: string
): AdeTeamOverview['questions'][number] | undefined {
  return overview?.questions.find((q) => q.state === 'open' && q.workerId === workerId)
}

/** Rows whose thread manages a team get an expander (12 §5.1). */
export function rowHasChildren(row: ActivityRow): boolean {
  const c = row.children
  return c.working + c.waiting + c.done + c.failed > 0
}
