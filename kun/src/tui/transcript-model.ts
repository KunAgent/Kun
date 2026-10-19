import type { TurnItem } from '../contracts/items.js'
import { childIdFromToolResult, resolveReasoningEndAt } from './render-utils.js'
import type { ProjectedApprovalReview, ProjectedChildRun, ThreadProjection } from './state.js'
import { isActiveChildRun, sortChildRuns } from './subagent-format.js'
import {
  EXPLORE_GROUP_PREFIX,
  KUN_REPLY_GROUP_PREFIX,
  deriveExplorationStages,
  explorationToolAction,
  isKunReplyItem,
  isToolResultFinal,
  type ExplorationStage,
  type ToolResultItem
} from './transcript-exploration.js'
import { splitStableMarkdown } from './markdown-blocks.js'
import type { TurnOutcome, WorkTrailSummary } from './transcript-trail.js'

type VisibleItem = Exclude<TurnItem, { kind: 'goal_context' | 'model_context' | 'runtime_context_source' | 'interruption_note' }>

export type TranscriptItemEntry = {
  kind: 'item'
  key: string
  item: VisibleItem
  toolResult?: ToolResultItem
  turnRunning: boolean
  reasoningRunning: boolean
  reasoningEndedAt?: string
  showReasoning: boolean
  userAttachmentIds: readonly string[]
  /** Markdown chunk for split assistant text (`key` = `${item.id}#${index}`). */
  markdown?: { text: string; index: number; last: boolean; streaming: boolean }
}

export type TranscriptEntry = (
  | { kind: 'reply-header'; key: string; turnId: string }
  | TranscriptItemEntry
  | { kind: 'exploration'; key: string; stage: ExplorationStage }
  | { kind: 'child'; key: string; child: ProjectedChildRun }
  | { kind: 'child-group'; key: string; turnId: string; children: ProjectedChildRun[] }
  | { kind: 'approval-review'; key: string; review: ProjectedApprovalReview }
  | { kind: 'work'; key: string; turnId: string; trail: WorkTrailSummary; expanded: boolean }
  | { kind: 'turn-footer'; key: string; turnId: string; model?: string; durationMs?: number; outcome: TurnOutcome }
) & {
  /** Final: the entry will not change (in-progress entries show live hints). */
  settled: boolean
  /** Starts a new visual group, rendered with one blank line above it. */
  separated: boolean
}

export type TranscriptOptions = {
  showReasoning: boolean
  reasoningOverrides?: ReadonlyMap<string, boolean>
  /** Split streaming assistant text into stable markdown blocks. */
  splitAssistantText?: boolean
}

const HIDDEN_KINDS = new Set(['goal_context', 'model_context', 'runtime_context_source', 'interruption_note'])

/**
 * Ordered, renderer-neutral view of a thread: Kun reply headers, items,
 * exploration groups, subagents and approval reviews, each with a stable key
 * and a `settled` flag. The terminal app renders them in one scrollable
 * conversation; only unsettled entries keep changing.
 */
export function buildTranscriptEntries(
  projection: ThreadProjection | undefined,
  options: TranscriptOptions
): TranscriptEntry[] {
  if (!projection) return []
  const all = projection.items
  const runningTurnId = projection.runningTurnId
  const toolCalls = new Map(all.flatMap((item) => item.kind === 'tool_call' ? [[item.callId, item] as const] : []))
  const toolResults = new Map(all.flatMap((item) => item.kind === 'tool_result' ? [[item.callId, item] as const] : []))
  const attachmentIdsByTurn = new Map(projection.thread.turns.map((turn) => [turn.id, turn.attachmentIds] as const))
  const visible = all.filter((item): item is VisibleItem =>
    !HIDDEN_KINDS.has(item.kind) && (item.kind !== 'tool_result' || !toolCalls.has(item.callId))
  )
  const stages = deriveExplorationStages(visible, toolResults, runningTurnId)
  const stageAfterItem = new Map(stages.map((stage) => [stage.insertAfterItemId, stage] as const))
  const groupedIds = new Set(stages.flatMap((stage) => stage.timeline.map((entry) =>
    entry.kind === 'reasoning' ? entry.item.id : entry.entry.call.id
  )))
  const openTail = openExplorationTail(visible, runningTurnId)
  // Assistant text or reasoning followed by a later item of the same turn has
  // ended, even when the runtime only marks it completed with the turn. Tool
  // calls are excluded: parallel calls still wait for their results.
  const superseded = new Set<string>()
  const lastIndexByTurn = new Map<string, number>()
  visible.forEach((item, index) => lastIndexByTurn.set(item.turnId, index))
  visible.forEach((item, index) => {
    if (item.kind !== 'assistant_text' && item.kind !== 'assistant_reasoning') return
    if ((lastIndexByTurn.get(item.turnId) ?? index) > index) superseded.add(item.id)
  })
  const childRunsByTurn = new Map<string, ProjectedChildRun[]>()
  for (const child of projection.childRuns) {
    const siblings = childRunsByTurn.get(child.parentTurnId) ?? []
    siblings.push(child)
    childRunsByTurn.set(child.parentTurnId, siblings)
  }
  const lastDelegationByTurn = new Map<string, string>()
  for (const item of visible) {
    if (item.kind === 'tool_call' && item.toolName === 'delegate_task') lastDelegationByTurn.set(item.turnId, item.id)
  }

  const order: string[] = []
  const labeledTurns = new Set<string>()
  const placedChildren = new Set<string>()
  const addReplyLabel = (turnId: string): void => {
    if (labeledTurns.has(turnId)) return
    labeledTurns.add(turnId)
    order.push(`${KUN_REPLY_GROUP_PREFIX}${turnId}`)
  }
  for (const item of visible) {
    if (isKunReplyItem(item)) addReplyLabel(item.turnId)
    if (!groupedIds.has(item.id)) order.push(item.id)
    if (item.kind !== 'tool_call' || item.toolName !== 'delegate_task') continue
    const grouped = childRunsByTurn.get(item.turnId) ?? []
    if (grouped.length > 1) {
      if (lastDelegationByTurn.get(item.turnId) === item.id) {
        addReplyLabel(item.turnId)
        order.push(`child-group:${item.turnId}`)
        for (const child of grouped) placedChildren.add(child.childId)
      }
      continue
    }
    const resultChildId = childIdFromToolResult(toolResults.get(item.callId))
    const label = typeof item.arguments.label === 'string' ? item.arguments.label.trim() : ''
    for (const child of projection.childRuns) {
      if (child.parentTurnId !== item.turnId) continue
      if (child.childId !== resultChildId && (!label || child.label !== label)) continue
      addReplyLabel(child.parentTurnId)
      order.push(`child:${child.childId}`)
      placedChildren.add(child.childId)
    }
  }
  for (const [itemId, stage] of stageAfterItem) {
    const index = order.indexOf(itemId)
    if (index >= 0) {
      order.splice(index + 1, 0, stage.id)
      continue
    }
    const groupedIndex = visible.findIndex((item) => item.id === itemId)
    const nextId = groupedIndex >= 0
      ? visible.slice(groupedIndex + 1).map((item) => item.id).find((id) => order.includes(id))
      : undefined
    const nextIndex = nextId ? order.indexOf(nextId) : -1
    if (nextIndex >= 0) order.splice(nextIndex, 0, stage.id)
    else order.push(stage.id)
  }
  for (const child of projection.childRuns) {
    if (placedChildren.has(child.childId)) continue
    addReplyLabel(child.parentTurnId)
    const siblings = childRunsByTurn.get(child.parentTurnId) ?? []
    if (siblings.length > 1) {
      const groupId = `child-group:${child.parentTurnId}`
      if (!order.includes(groupId)) order.push(groupId)
      for (const sibling of siblings) placedChildren.add(sibling.childId)
    } else {
      order.push(`child:${child.childId}`)
    }
  }
  const reviews = [...projection.approvalReviews].sort((left, right) => left.startedAt.localeCompare(right.startedAt))
  const placedReviews = new Map<string, string[]>()
  for (const review of reviews) {
    const id = `approval-review:${review.reviewId}`
    if (!review.turnId) {
      order.push(id)
      continue
    }
    addReplyLabel(review.turnId)
    const next = visible.find((item) =>
      item.turnId === review.turnId && item.createdAt > review.startedAt && order.includes(item.id)
    )
    if (next) order.splice(order.indexOf(next.id), 0, id)
    else {
      const turnIds = [
        ...visible.filter((item) => item.turnId === review.turnId).map((item) => item.id),
        ...(placedReviews.get(review.turnId) ?? [])
      ]
      const last = turnIds.reduce((latest, candidate) => Math.max(latest, order.lastIndexOf(candidate)), -1)
      if (last >= 0) order.splice(last + 1, 0, id)
      else order.push(id)
    }
    const placed = placedReviews.get(review.turnId) ?? []
    placed.push(id)
    placedReviews.set(review.turnId, placed)
  }

  const itemsById = new Map(visible.map((item) => [item.id, item] as const))
  const stagesById = new Map(stages.map((stage) => [stage.id, stage] as const))
  const childrenById = new Map(projection.childRuns.map((child) => [child.childId, child] as const))
  const reviewsById = new Map(projection.approvalReviews.map((review) => [review.reviewId, review] as const))
  const turnRunning = (turnId: string | undefined): boolean => Boolean(turnId) && runningTurnId === turnId
  const childSettled = (child: ProjectedChildRun): boolean =>
    !isActiveChildRun(child) || !turnRunning(child.parentTurnId)

  const entries: TranscriptEntry[] = []
  for (const id of order) {
    if (id.startsWith(KUN_REPLY_GROUP_PREFIX)) {
      entries.push({ kind: 'reply-header', key: id, turnId: id.slice(KUN_REPLY_GROUP_PREFIX.length), settled: true, separated: true })
      continue
    }
    if (id.startsWith(EXPLORE_GROUP_PREFIX)) {
      const stage = stagesById.get(id)
      if (!stage) continue
      const open = stage.timeline.some((entry) => openTail.has(entry.kind === 'reasoning' ? entry.item.id : entry.entry.call.id))
      entries.push({ kind: 'exploration', key: id, stage, settled: !stage.active && !open, separated: false })
      continue
    }
    if (id.startsWith('child-group:')) {
      const turnId = id.slice('child-group:'.length)
      const children = sortChildRuns(childRunsByTurn.get(turnId) ?? [])
      entries.push({ kind: 'child-group', key: id, turnId, children, settled: children.every(childSettled), separated: false })
      continue
    }
    if (id.startsWith('child:')) {
      const child = childrenById.get(id.slice('child:'.length))
      if (child) entries.push({ kind: 'child', key: id, child, settled: childSettled(child), separated: false })
      continue
    }
    if (id.startsWith('approval-review:')) {
      const review = reviewsById.get(id.slice('approval-review:'.length))
      if (review) {
        entries.push({
          kind: 'approval-review', key: id, review,
          settled: review.status !== 'in-progress' || !turnRunning(review.turnId),
          separated: false
        })
      }
      continue
    }
    const item = itemsById.get(id)
    if (!item) continue
    entries.push(...itemEntries(item, {
      projection,
      all,
      toolResults,
      attachmentIdsByTurn,
      running: turnRunning(item.turnId) && !superseded.has(item.id),
      turnRunning: turnRunning(item.turnId),
      openTail,
      options
    }))
  }
  return entries
}

function itemEntries(
  item: VisibleItem,
  context: {
    projection: ThreadProjection
    all: readonly TurnItem[]
    toolResults: ReadonlyMap<string, ToolResultItem>
    attachmentIdsByTurn: ReadonlyMap<string, readonly string[]>
    /** The item itself may still change (its turn runs and nothing follows it). */
    running: boolean
    turnRunning: boolean
    openTail: ReadonlySet<string>
    options: TranscriptOptions
  }
): TranscriptEntry[] {
  const { projection, running } = context
  const activity = projection.activity
  const reasoningRunning = item.kind === 'assistant_reasoning' && item.status === 'running' && running &&
    activity?.turnId === item.turnId && activity.phase === 'thinking'
  const base = {
    kind: 'item' as const,
    item,
    turnRunning: context.turnRunning,
    reasoningRunning,
    showReasoning: item.kind === 'assistant_reasoning'
      ? context.options.reasoningOverrides?.get(item.id) ?? context.options.showReasoning
      : context.options.showReasoning,
    userAttachmentIds: item.kind === 'user_message'
      ? item.attachmentIds?.length ? item.attachmentIds : context.attachmentIdsByTurn.get(item.turnId) ?? []
      : [],
    separated: item.kind === 'user_message' || item.kind === 'context_window',
    ...(item.kind === 'tool_call' && context.toolResults.get(item.callId)
      ? { toolResult: context.toolResults.get(item.callId)! }
      : {}),
    ...(item.kind === 'assistant_reasoning' && !reasoningRunning
      ? { reasoningEndedAt: resolveReasoningEndAt(item, context.all, projection) }
      : {})
  }
  if (item.kind === 'assistant_text' && context.options.splitAssistantText) {
    const streaming = running && item.status === 'running'
    const { blocks, stable } = splitStableMarkdown(item.text, streaming)
    return blocks.map((text, index) => ({
      ...base,
      key: `${item.id}#${index}`,
      // Only the still-growing tail shows the stream cursor; finished blocks
      // keep their renderables while the answer streams.
      markdown: { text, index, last: index === blocks.length - 1, streaming: index >= stable },
      settled: index < stable
    }))
  }
  return [{ ...base, key: item.id, settled: itemSettled(item, running, context.toolResults, context.openTail) }]
}

function itemSettled(
  item: VisibleItem,
  running: boolean,
  toolResults: ReadonlyMap<string, ToolResultItem>,
  openTail: ReadonlySet<string>
): boolean {
  if (!running) return true
  if (openTail.has(item.id)) return false
  switch (item.kind) {
    case 'assistant_text':
    case 'assistant_reasoning':
      return item.status !== 'running'
    case 'tool_call':
      // A failed call still waits for its result, which carries the reason
      // (for example a denied approval); the turn ending settles it anyway.
      return isToolResultFinal(toolResults.get(item.callId))
    case 'approval':
    case 'user_input':
      return item.status !== 'pending'
    default:
      return true
  }
}

/**
 * Trailing reasoning and read-only exploration calls of the running turn can
 * still be absorbed into an "Exploring" group by the next item, so they stay
 * live until a closing item arrives. Committing them earlier would print the
 * same action twice once the group forms.
 */
function openExplorationTail(items: readonly VisibleItem[], runningTurnId: string | undefined): Set<string> {
  const open = new Set<string>()
  if (!runningTurnId) return open
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!
    if (item.turnId !== runningTurnId) break
    if (item.kind === 'assistant_reasoning' || (item.kind === 'tool_call' && explorationToolAction(item))) {
      open.add(item.id)
      continue
    }
    break
  }
  return open
}

function sameShallow(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/**
 * Two builds of one entry that render identically. Entries are rebuilt on
 * every projection change while unchanged items keep their identity, so the
 * view compares field by field and leaves untouched entries mounted as is.
 */
export function sameTranscriptEntry(left: TranscriptEntry, right: TranscriptEntry): boolean {
  if (left === right) return true
  const a = left as unknown as Record<string, unknown>
  const b = right as unknown as Record<string, unknown>
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  // A Markdown block renders only its own text; the item it was cut from
  // keeps growing while the answer streams.
  const block = Boolean(a.markdown && b.markdown)
  return keys.every((key) => a[key] === b[key] ||
    ((key === 'markdown' || key === 'userAttachmentIds') && sameShallow(a[key], b[key])) ||
    (key === 'item' && block && (a.item as { id: string }).id === (b.item as { id: string }).id))
}
