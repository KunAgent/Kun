import { formatTokenCount, type ActivityVisualKind } from './activity.js'
import { elapsedDuration, formatDurationMs } from './render-utils.js'
import type { ProjectedChildRun } from './state.js'

export type ChildStatusTone = 'focus' | 'success' | 'danger'

export function sortChildRuns(children: readonly ProjectedChildRun[]): ProjectedChildRun[] {
  return [...children].sort((left, right) =>
    (left.childSeq ?? Number.MAX_SAFE_INTEGER) - (right.childSeq ?? Number.MAX_SAFE_INTEGER) ||
    left.startedAt.localeCompare(right.startedAt) ||
    left.childId.localeCompare(right.childId)
  )
}

export function childStatusCounts(children: readonly ProjectedChildRun[]): {
  completed: number
  failed: number
  running: number
  waiting: number
  background: number
} {
  const counts = { completed: 0, failed: 0, running: 0, waiting: 0, background: 0 }
  for (const child of children) {
    if (child.detached && isActiveChildRun(child)) {
      counts.background += 1
      continue
    }
    if (child.status === 'completed') counts.completed += 1
    else if (child.status === 'failed' || child.status === 'aborted') counts.failed += 1
    else if (child.status === 'queued') counts.waiting += 1
    else if (child.status === 'running') counts.running += 1
  }
  return counts
}

export function childStatusLabel(child: ProjectedChildRun): string {
  if (child.detached && isActiveChildRun(child)) return '◐ Background'
  switch (child.status) {
    case 'queued': return 'Waiting'
    case 'running': return 'Running'
    case 'completed': return '✓ Completed'
    case 'failed': return '✗ Failed'
    case 'aborted': return '✗ Stopped'
  }
}

export function childStatusTone(child: ProjectedChildRun): ChildStatusTone {
  if (child.status === 'failed' || child.status === 'aborted') return 'danger'
  if (child.status === 'completed') return 'success'
  return 'focus'
}

export function childMetrics(child: ProjectedChildRun, nowMs = Date.now()): string {
  const active = isActiveChildRun(child)
  return [
    child.detached ? 'background' : undefined,
    child.toolInvocations !== undefined ? `${child.toolInvocations} tools` : undefined,
    child.totalTokens ? `${formatTokenCount(child.totalTokens)} tok` : undefined,
    child.cacheHitRate !== undefined && child.cacheHitRate !== null
      ? `${Math.round(child.cacheHitRate * 100)}% cache`
      : undefined,
    child.durationMs !== undefined
      ? formatDurationMs(child.durationMs)
      : elapsedDuration(child.startedAt, undefined, active, nowMs)
  ].filter(Boolean).join(' · ')
}

export function childGroupSummary(children: readonly ProjectedChildRun[], nowMs = Date.now()): {
  active: boolean
  failed: boolean
  title: string
  breakdown: string
  metrics: string
} {
  const counts = childStatusCounts(children)
  const active = counts.running + counts.waiting + counts.background > 0
  const breakdown = [
    counts.completed ? `${counts.completed} done` : undefined,
    counts.failed ? `${counts.failed} failed` : undefined,
    counts.running ? `${counts.running} running` : undefined,
    counts.waiting ? `${counts.waiting} waiting` : undefined,
    counts.background ? `${counts.background} background` : undefined
  ].filter(Boolean).join(', ')
  const totalTools = children.reduce((sum, child) => sum + (child.toolInvocations ?? 0), 0)
  const totalTokens = children.reduce((sum, child) => sum + (child.totalTokens ?? 0), 0)
  const maxElapsed = Math.max(0, ...children.map((child) =>
    child.durationMs ?? elapsedMilliseconds(child.startedAt, child.updatedAt, isActiveChildRun(child), nowMs)
  ))
  return {
    active,
    failed: counts.failed > 0,
    title: active ? `Running ${children.length} agents` : `${children.length} agents finished`,
    breakdown,
    metrics: [
      totalTools ? `${totalTools} tools` : undefined,
      totalTokens ? `${formatTokenCount(totalTokens)} tok` : undefined,
      maxElapsed ? formatDurationMs(maxElapsed) : undefined
    ].filter(Boolean).join(' · ')
  }
}

export function elapsedMilliseconds(startedAt: string, updatedAt: string, active: boolean, nowMs = Date.now()): number {
  const started = Date.parse(startedAt)
  const ended = active ? nowMs : Date.parse(updatedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0
  return Math.max(0, ended - started)
}

export function isActiveChildRun(child: ProjectedChildRun): boolean {
  return child.status === 'queued' || child.status === 'running'
}

export function isForegroundChildRun(child: ProjectedChildRun): boolean {
  return !child.detached && isActiveChildRun(child)
}

export function childActivityVisualKind(child: ProjectedChildRun): ActivityVisualKind {
  switch (child.activity?.phase) {
    case 'thinking': return 'thinking'
    case 'responding': return 'responding'
    case 'tool': return 'tool'
    case 'retrying': return 'retrying'
    default: return 'waiting'
  }
}
