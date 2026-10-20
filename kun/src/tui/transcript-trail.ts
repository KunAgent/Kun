import type { TurnItem } from '../contracts/items.js'
import { formatDurationMs } from './render-utils.js'
import type { ThreadProjection } from './state.js'
import { isActiveChildRun } from './subagent-format.js'
import { explorationEntryFailed } from './transcript-exploration.js'
import type { TranscriptEntry } from './transcript-model.js'

/**
 * Turn-level shaping of the transcript for the session view: finished turns
 * fold their tool work into one "Worked" line (failed steps stay visible) and
 * end with a footer naming the model and duration.
 */

export type ToolCategory = 'read' | 'search' | 'edit' | 'write' | 'run' | 'fetch' | 'agent' | 'other'

export const TOOL_GLYPHS: Readonly<Record<ToolCategory, string>> = {
  read: '→',
  search: '✱',
  edit: '←',
  write: '←',
  run: '$',
  fetch: '%',
  agent: '◈',
  other: '•'
}

export function toolCategory(toolName: string): ToolCategory {
  const name = toolName.toLowerCase()
  if (['bash', 'exec', 'shell'].some((part) => name.includes(part))) return 'run'
  if (name === 'delegate_task' || name.includes('subagent') || name === 'fast_context' || name === 'explore_agent') return 'agent'
  if (name.includes('web') || name.includes('fetch') || name.includes('url')) return 'fetch'
  if (name === 'write' || name.endsWith('_write')) return 'write'
  if (name.includes('edit') || name.includes('patch') || name.includes('write')) return 'edit'
  if (['grep', 'search', 'glob', 'find', 'repo_map', 'list'].some((part) => name.includes(part)) || name === 'rg' || name === 'ls') return 'search'
  if (name.includes('read') || name.includes('view') || name.includes('inspect')) return 'read'
  return 'other'
}

export type WorkTrailSummary = {
  read: number
  search: number
  edit: number
  run: number
  fetch: number
  agents: number
  other: number
  thoughtMs: number
  durationMs: number
}

export type TurnOutcome = 'completed' | 'failed' | 'aborted'

type ShapeOptions = {
  /** Tool details on: nothing folds. */
  expandAll: boolean
  /** Work trails the reader opened one by one (keys of their `work` entries). */
  expanded: ReadonlySet<string>
}

export function entryTurnId(entry: TranscriptEntry): string | undefined {
  switch (entry.kind) {
    case 'item': return entry.item.turnId
    case 'exploration': return entry.stage.turnId
    case 'child': return entry.child.parentTurnId
    case 'approval-review': return entry.review.turnId
    case 'reply-header':
    case 'child-group':
    case 'work':
    case 'turn-footer':
      return entry.turnId
  }
}

const WORK_ITEM_KINDS = new Set<TurnItem['kind']>(['tool_call', 'tool_result', 'assistant_reasoning'])

function isWork(entry: TranscriptEntry): boolean {
  if (entry.kind === 'item') return WORK_ITEM_KINDS.has(entry.item.kind)
  return entry.kind === 'exploration' || entry.kind === 'child' || entry.kind === 'child-group' || entry.kind === 'approval-review'
}

function isFailedWork(entry: TranscriptEntry): boolean {
  if (entry.kind === 'item') {
    const item = entry.item
    if (item.kind === 'tool_call') return item.status === 'failed' || Boolean(entry.toolResult?.isError)
    if (item.kind === 'tool_result') return Boolean(item.isError)
    return false
  }
  if (entry.kind === 'exploration') return entry.stage.entries.some(explorationEntryFailed)
  if (entry.kind === 'child') return entry.child.status === 'failed'
  if (entry.kind === 'child-group') return entry.children.some((child) => child.status === 'failed')
  return false
}

function timeRange(entry: TranscriptEntry): { start?: string; end?: string } {
  if (entry.kind === 'item') return { start: entry.item.createdAt, end: entry.toolResult?.finishedAt ?? entry.item.finishedAt }
  if (entry.kind === 'exploration') {
    const calls = entry.stage.entries
    return { start: calls[0]?.call.createdAt, end: calls.at(-1)?.result?.finishedAt ?? calls.at(-1)?.call.finishedAt }
  }
  if (entry.kind === 'child') return { start: entry.child.startedAt, end: entry.child.updatedAt }
  if (entry.kind === 'child-group') {
    return { start: entry.children[0]?.startedAt, end: entry.children.at(-1)?.updatedAt }
  }
  return {}
}

function addCategory(summary: WorkTrailSummary, category: ToolCategory): void {
  if (category === 'write') summary.edit += 1
  else if (category === 'agent') summary.agents += 1
  else summary[category] += 1
}

export function summarizeWorkTrail(entries: readonly TranscriptEntry[]): WorkTrailSummary {
  const summary: WorkTrailSummary = { read: 0, search: 0, edit: 0, run: 0, fetch: 0, agents: 0, other: 0, thoughtMs: 0, durationMs: 0 }
  let first = Number.POSITIVE_INFINITY
  let last = 0
  for (const entry of entries) {
    if (entry.kind === 'item' && entry.item.kind === 'tool_call') addCategory(summary, toolCategory(entry.item.toolName))
    else if (entry.kind === 'item' && entry.item.kind === 'assistant_reasoning') {
      const start = Date.parse(entry.item.createdAt)
      const end = Date.parse(entry.item.finishedAt ?? entry.reasoningEndedAt ?? '')
      if (Number.isFinite(start) && Number.isFinite(end)) summary.thoughtMs += Math.max(0, end - start)
    } else if (entry.kind === 'exploration') {
      for (const call of entry.stage.entries) addCategory(summary, toolCategory(call.call.toolName))
    } else if (entry.kind === 'child') summary.agents += 1
    else if (entry.kind === 'child-group') summary.agents += entry.children.length
    const range = timeRange(entry)
    const start = Date.parse(range.start ?? '')
    const end = Date.parse(range.end ?? range.start ?? '')
    if (Number.isFinite(start)) first = Math.min(first, start)
    if (Number.isFinite(end)) last = Math.max(last, end)
  }
  summary.durationMs = Number.isFinite(first) && last >= first ? last - first : 0
  return summary
}

/** "Worked 38s · read 4 · edit 2 · run 1 · thought 2.1s" */
export function workTrailLabel(summary: WorkTrailSummary): string {
  const parts = [
    summary.durationMs > 0 ? `Worked ${formatDurationMs(summary.durationMs)}` : 'Worked',
    ...(summary.read ? [`read ${summary.read}`] : []),
    ...(summary.search ? [`search ${summary.search}`] : []),
    ...(summary.edit ? [`edit ${summary.edit}`] : []),
    ...(summary.run ? [`run ${summary.run}`] : []),
    ...(summary.fetch ? [`fetch ${summary.fetch}`] : []),
    ...(summary.agents ? [`${summary.agents} agent${summary.agents === 1 ? '' : 's'}`] : []),
    ...(summary.other ? [`${summary.other} other`] : []),
    ...(summary.thoughtMs > 0 ? [`thought ${formatDurationMs(summary.thoughtMs)}`] : [])
  ]
  return parts.join(' · ')
}

function finishedTurns(projection: ThreadProjection | undefined): Map<string, ThreadProjection['thread']['turns'][number]> {
  const turns = projection?.thread.turns ?? []
  return new Map(turns
    .filter((turn) => turn.id !== projection?.runningTurnId && (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted'))
    .map((turn) => [turn.id, turn] as const))
}

/** One footer after the last entry of every finished turn that Kun answered. */
export function withTurnFooters(entries: readonly TranscriptEntry[], projection: ThreadProjection | undefined): TranscriptEntry[] {
  const finished = finishedTurns(projection)
  const lastIndex = new Map<string, number>()
  entries.forEach((entry, index) => {
    const turnId = entryTurnId(entry)
    if (!turnId || !finished.has(turnId)) return
    if (entry.kind === 'item' && entry.item.kind === 'user_message') return
    lastIndex.set(turnId, index)
  })
  if (!lastIndex.size) return [...entries]
  const out: TranscriptEntry[] = []
  entries.forEach((entry, index) => {
    out.push(entry)
    const turnId = entryTurnId(entry)
    if (!turnId || lastIndex.get(turnId) !== index) return
    const turn = finished.get(turnId)!
    const start = Date.parse(turn.startedAt ?? turn.createdAt)
    const end = Date.parse(turn.finishedAt ?? '')
    out.push({
      kind: 'turn-footer',
      key: `turn-footer:${turnId}`,
      turnId,
      ...(turn.model ? { model: turn.model } : {}),
      ...(Number.isFinite(start) && Number.isFinite(end) ? { durationMs: Math.max(0, end - start) } : {}),
      outcome: turn.status as TurnOutcome,
      settled: true,
      separated: true
    })
  })
  return out
}

/**
 * Fold each run of finished, successful work entries of one turn into a
 * `work` entry. A run worth folding has two or more entries, or one entry
 * that renders several rows (an exploration group, a subagent group).
 */
export function foldWorkTrails(
  entries: readonly TranscriptEntry[],
  projection: ThreadProjection | undefined,
  options: ShapeOptions
): TranscriptEntry[] {
  if (options.expandAll) return [...entries]
  const finished = finishedTurns(projection)
  const out: TranscriptEntry[] = []
  let run: TranscriptEntry[] = []
  const flush = (): void => {
    if (!run.length) return
    const single = run.length === 1 && run[0]!.kind !== 'exploration' && run[0]!.kind !== 'child-group'
    if (single) {
      out.push(...run)
    } else {
      const key = `work:${run[0]!.key}`
      const expanded = options.expanded.has(key)
      out.push({
        kind: 'work',
        key,
        turnId: entryTurnId(run[0]!)!,
        trail: summarizeWorkTrail(run),
        expanded,
        settled: true,
        separated: false
      })
      if (expanded) out.push(...run)
    }
    run = []
  }
  for (const entry of entries) {
    const turnId = entryTurnId(entry)
    const childActive = entry.kind === 'child' && isActiveChildRun(entry.child)
    const foldable = isWork(entry) && !isFailedWork(entry) && !childActive && entry.settled && Boolean(turnId && finished.has(turnId))
    if (foldable && run.length && entryTurnId(run[0]!) !== turnId) flush()
    if (foldable) {
      run.push(entry)
      continue
    }
    flush()
    out.push(entry)
  }
  flush()
  return out
}

/** Entries that render as quiet work rows rather than prose. */
function isWorkRow(entry: TranscriptEntry): boolean {
  return entry.kind === 'work' || isWork(entry) || (entry.kind === 'item' && entry.item.kind === 'error')
}

function isProse(entry: TranscriptEntry): boolean {
  return entry.kind === 'item' && entry.item.kind === 'assistant_text' && (!entry.markdown || entry.markdown.index === 0)
}

/**
 * One blank line where a turn switches between prose and work rows, so the
 * answer reads apart from the tool calls around it.
 */
export function withPartSpacing(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry, index) => {
    const previous = entries[index - 1]
    if (!previous || entry.separated || entryTurnId(previous) !== entryTurnId(entry)) return entry
    const switches = (isProse(entry) && isWorkRow(previous)) || (isWorkRow(entry) && isProse(previous)) ||
      (isWorkRow(entry) && previous.kind === 'item' && previous.item.kind === 'assistant_text')
    return switches ? { ...entry, separated: true } : entry
  })
}

/** First line of reasoning text, without Markdown emphasis, for "Thought: …". */
export function reasoningSummary(text: string, maxLength = 56): string {
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) ?? ''
  const plain = line.replace(/^#+\s*/u, '').replace(/\*\*|__|`/gu, '').trim()
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain
}
