import type { TurnItem } from '../contracts/items.js'
import { elapsedDuration, toolAction } from './render-utils.js'

export const KUN_REPLY_GROUP_PREFIX = 'kun-reply:'
export const EXPLORE_GROUP_PREFIX = 'explore-group:'
export const EXPLORE_GROUP_COMPACT_LIMIT = 12

export type ToolCallItem = Extract<TurnItem, { kind: 'tool_call' }>
export type ToolResultItem = Extract<TurnItem, { kind: 'tool_result' }>

/** Command output streams into a running result before the call finishes. */
export function isToolResultFinal(result: ToolResultItem | undefined): result is ToolResultItem {
  return Boolean(result && result.status !== 'running')
}
export type ReasoningItem = Extract<TurnItem, { kind: 'assistant_reasoning' }>

export type ExplorationEntry = {
  call: ToolCallItem
  result?: ToolResultItem
}

export type ExplorationTimelineEntry =
  | { kind: 'reasoning'; item: ReasoningItem }
  | { kind: 'action'; entry: ExplorationEntry }

export type ExplorationStage = {
  id: string
  turnId: string
  entries: ExplorationEntry[]
  timeline: ExplorationTimelineEntry[]
  insertAfterItemId: string
  active: boolean
}

export function isKunReplyItem(item: TurnItem): boolean {
  return item.kind === 'assistant_text' ||
    item.kind === 'assistant_reasoning' ||
    item.kind === 'tool_call' ||
    item.kind === 'tool_result' ||
    item.kind === 'approval' ||
    item.kind === 'user_input' ||
    item.kind === 'review' ||
    item.kind === 'error'
}
export function deriveExplorationStages(
  items: readonly TurnItem[],
  toolResults: ReadonlyMap<string, ToolResultItem>,
  runningTurnId: string | undefined
): ExplorationStage[] {
  const stages: ExplorationStage[] = []
  const stageIndexes = new Map<string, number>()
  let turnId = ''
  let entries: ExplorationEntry[] = []
  let timeline: ExplorationTimelineEntry[] = []
  let leadingReasoning: ReasoningItem[] = []

  const flush = (closed: boolean): void => {
    const lastTimelineEntry = timeline.at(-1)
    const insertAfterItemId = lastTimelineEntry?.kind === 'reasoning'
      ? lastTimelineEntry.item.id
      : lastTimelineEntry?.entry.call.id
    if (entries.length >= 2 && turnId && insertAfterItemId) {
      const index = stageIndexes.get(turnId) ?? 0
      stageIndexes.set(turnId, index + 1)
      stages.push({
        id: `${EXPLORE_GROUP_PREFIX}${turnId}:${index}`,
        turnId,
        entries,
        timeline,
        insertAfterItemId,
        active: !closed && runningTurnId === turnId
      })
    }
    entries = []
    timeline = []
    leadingReasoning = []
  }

  for (const item of items) {
    if (turnId && item.turnId !== turnId) flush(true)
    turnId = item.turnId

    if (item.kind === 'tool_call' && explorationToolAction(item)) {
      if (entries.length === 0 && leadingReasoning.length > 0) {
        timeline.push(...leadingReasoning.map((reasoning) => ({
          kind: 'reasoning' as const,
          item: reasoning
        })))
        leadingReasoning = []
      }
      const entry = { call: item, result: toolResults.get(item.callId) }
      entries.push(entry)
      timeline.push({ kind: 'action', entry })
      continue
    }
    if (item.kind === 'assistant_reasoning') {
      if (entries.length > 0) timeline.push({ kind: 'reasoning', item })
      else leadingReasoning.push(item)
      continue
    }
    flush(true)
  }
  flush(false)
  return stages
}

export function explorationToolAction(item: ToolCallItem): { verb: string; subject: string } | undefined {
  if (item.toolKind !== 'tool_call') return undefined
  const name = item.toolName.toLowerCase()
  if (
    name.includes('browser_use') ||
    name.includes('computer_use') ||
    name.includes('delegate') ||
    name.includes('write') ||
    name.includes('edit') ||
    name.includes('patch')
  ) {
    return undefined
  }

  const tokens = name.split(/[^a-z0-9]+/u).filter(Boolean)
  const action = toolAction(item)
  if (
    name === 'rg' ||
    tokens.some((token) => token === 'search' || token === 'grep' || token === 'find' || token === 'glob')
  ) {
    return { ...action, verb: 'Search' }
  }
  if (tokens.includes('list')) return { ...action, verb: 'List' }
  if (
    name === 'open_url' ||
    tokens.some((token) => token === 'fetch' || token === 'download')
  ) {
    return { ...action, verb: 'Fetch' }
  }
  if (
    name === 'repo_map' ||
    tokens.some((token) => token === 'read' || token === 'view' || token === 'inspect')
  ) {
    return { ...action, verb: 'Read' }
  }
  return undefined
}

export function explorationEntryFailed(entry: ExplorationEntry): boolean {
  return Boolean(
    entry.result?.isError ||
    entry.call.status === 'failed' ||
    entry.call.status === 'aborted'
  )
}

export function explorationStageDuration(stage: ExplorationStage): string {
  const first = stage.timeline[0]
  const start = first?.kind === 'reasoning' ? first.item.createdAt : first?.entry.call.createdAt
  const last = stage.timeline.at(-1)
  const end = stage.active
    ? undefined
    : last?.kind === 'reasoning'
      ? last.item.finishedAt ?? last.item.createdAt
      : last?.entry.result?.finishedAt ??
        last?.entry.call.finishedAt ??
        last?.entry.result?.createdAt ??
        last?.entry.call.createdAt
  return elapsedDuration(start, end, stage.active)
}
