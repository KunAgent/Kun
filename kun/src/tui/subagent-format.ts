import { formatTokenCount, type ActivityVisualKind } from './activity.js'
import { elapsedDuration, formatDurationMs } from './render-utils.js'
import type { ProjectedChildRun } from './state.js'

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

/** "12 tools · 1m 12s": what a sidebar row or a tree branch has room for. */
export function childBriefMetrics(child: ProjectedChildRun, nowMs = Date.now()): string {
  const tools = child.toolInvocations
  return [
    tools ? `${tools} tool${tools === 1 ? '' : 's'}` : undefined,
    child.durationMs !== undefined
      ? formatDurationMs(child.durationMs)
      : elapsedDuration(child.startedAt, undefined, isActiveChildRun(child), nowMs)
  ].filter(Boolean).join(' · ')
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

/** "deepseek-flash · read-only · 12 tools · 18.4k tok · cache 82%": a card's second row. */
export function childCardMeta(child: ProjectedChildRun): string {
  const tools = child.toolInvocations
  const cost = [
    ...(child.costCny && child.costCny > 0 ? [`¥${child.costCny.toFixed(2)}`] : []),
    ...(child.costUsd && child.costUsd > 0 ? [`$${child.costUsd.toFixed(child.costUsd < 1 ? 3 : 2)}`] : [])
  ].join(' · ')
  return [
    child.model,
    child.toolPolicy === 'readOnly' ? 'read-only' : child.toolPolicy === 'inherit' ? 'inherit tools' : undefined,
    child.detached ? 'background' : undefined,
    tools !== undefined ? `${tools} tool${tools === 1 ? '' : 's'}` : undefined,
    child.totalTokens ? `${formatTokenCount(child.totalTokens)} tok` : undefined,
    child.cacheHitRate !== undefined && child.cacheHitRate !== null ? `cache ${Math.round(child.cacheHitRate * 100)}%` : undefined,
    cost || undefined
  ].filter(Boolean).join(' · ')
}

/** Right column of a card's title row: a state word (none while running) and the time. */
export function childCardStatus(child: ProjectedChildRun, nowMs = Date.now()): { state?: string; failed: boolean; elapsed: string } {
  const active = isActiveChildRun(child)
  const elapsed = child.durationMs !== undefined
    ? formatDurationMs(child.durationMs)
    : elapsedDuration(child.startedAt, undefined, active, nowMs)
  const failed = child.status === 'failed' || child.status === 'aborted'
  const state = child.detached && active
    ? 'background'
    : child.status === 'queued'
      ? 'waiting'
      : child.status === 'completed'
        ? 'done'
        : child.status === 'failed'
          ? 'failed'
          : child.status === 'aborted'
            ? 'stopped'
            : undefined
  return { ...(state ? { state } : {}), failed, elapsed }
}

/** "2 running · 1 done" for a parallel group's header. */
export function childGroupBreakdown(children: readonly ProjectedChildRun[]): string {
  const counts = childStatusCounts(children)
  return [
    counts.running ? `${counts.running} running` : undefined,
    counts.waiting ? `${counts.waiting} waiting` : undefined,
    counts.background ? `${counts.background} background` : undefined,
    counts.completed ? `${counts.completed} done` : undefined,
    counts.failed ? `${counts.failed} failed` : undefined
  ].filter(Boolean).join(' · ')
}
