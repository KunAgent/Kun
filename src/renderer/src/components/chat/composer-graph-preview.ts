import type {
  GraphChildRuntime,
  GraphNodeProjection,
  GraphNodeStatus,
  GraphPlanEdge,
  GraphRun
} from '../../graph/graph-types'
import {
  GRAPH_ACTIVITY_QUIET_MS,
  graphLivenessIsProcessing,
  graphNodeLiveness,
  type GraphLivenessKind,
  type GraphNodeLiveness
} from '../../graph/graph-liveness'

const terminalRunStatuses = new Set(['completed', 'failed', 'cancelled'])
// Completion is deliberately stricter than terminality. A skipped,
// superseded, failed, or cancelled node may close scheduler work, but it has
// not passed Graph acceptance and must not advance the accepted-work bar.
const completedNodeStatuses = new Set<GraphNodeStatus>(['accepted'])
const currentNodeStatuses = new Set<GraphNodeStatus>([
  'queued',
  'running',
  'submitted',
  'reviewing',
  'repair_required',
  'ready'
])
const activeChildStatuses = new Set<GraphChildRuntime['status']>(['queued', 'running'])
// Liveness kinds that mean a person should look (a child asked a question, or
// supervision flagged the node).
const attentionLivenessKinds = new Set<GraphLivenessKind>(['needs_attention', 'waiting_human'])

/*
 * Tray node map geometry (Graph board): 132 x 52 node cards in phase columns
 * 30px apart, every column centered vertically. The canvas keeps this natural
 * size as its maximum width and shrinks down to COMPOSER_GRAPH_MIN_SCALE of it
 * before the card scrolls horizontally, so a wide plan never widens the tray.
 */
export const COMPOSER_GRAPH_NODE_WIDTH = 132
export const COMPOSER_GRAPH_NODE_HEIGHT = 52
export const COMPOSER_GRAPH_MIN_SCALE = 0.85
const COLUMN_GAP = 30
const PADDING_X = 28
const PADDING_Y = 12
const ROW_GAP = 22
const DENSE_ROW_GAP = 12
const MIN_HEIGHT = 96
const SAME_COLUMN_BOW = 22

export type ComposerGraphProgress = {
  completed: number
  total: number
  fraction: number
  activeAgents: string[]
  activeCount: number
  /** Nodes doing live work right now, in plan order (segment label). */
  activeNodeIds: string[]
  activeNodeTitles: string[]
  currentNodeTitle: string | null
  currentNodeId: string | null
  currentStatus: GraphNodeStatus | null
  currentAgent: string | null
  attemptNumber: number | null
  childThreadId: string | null
  childRuntime: GraphChildRuntime | null
}

export type ComposerGraphLayoutNode = {
  id: string
  phaseId: string
  phaseTitle: string
  title: string
  objective: string
  agentName: string
  status: GraphNodeStatus
  attemptNumber?: number
  childThreadId?: string
  childRuntime?: GraphChildRuntime
  processing: boolean
  livenessKind: GraphLivenessKind
  /** A running child that has been silent for GRAPH_ACTIVITY_QUIET_MS or longer. */
  quiet: boolean
  x: number
  y: number
  width: number
  height: number
}

export type ComposerGraphLayoutEdge = GraphPlanEdge & {
  path: string
  flowing: boolean
}

export type ComposerGraphLayout = {
  width: number
  height: number
  phases: Array<{ id: string; title: string; x: number; width: number }>
  nodes: ComposerGraphLayoutNode[]
  edges: ComposerGraphLayoutEdge[]
}

/**
 * Visual state of a node card: done (check on the tray tint), running (accent
 * ring), attention (amber dot), failed (red dot), pending (muted: waiting for
 * upstream, or closed without acceptance), idle (ready / queued / waiting for
 * the Lead).
 */
export type ComposerGraphNodeState = 'done' | 'running' | 'attention' | 'failed' | 'pending' | 'idle'

function currentPlan(run: GraphRun): GraphRun['plans'][number] | undefined {
  return run.plans.find((plan) => plan.revision === run.currentRevision) ?? run.plans.at(-1)
}

export function isComposerGraphRunTerminal(run: Pick<GraphRun, 'status'>): boolean {
  return terminalRunStatuses.has(run.status)
}

export function graphNodeAgentName(projection: GraphNodeProjection): string {
  const attemptName = projection.attempts.at(-1)?.assignment.name?.trim()
  if (attemptName) return attemptName
  const assignment = projection.node.assignment
  if (assignment?.kind === 'ephemeral') return assignment.name
  if (assignment?.kind === 'existing') return assignment.profileId
  return 'Kun'
}

export function selectComposerGraphRun(
  runs: readonly GraphRun[],
  selectedRunId: string | null
): GraphRun | null {
  const selected = runs.find((run) => run.id === selectedRunId)
  if (selected && !terminalRunStatuses.has(selected.status)) return selected
  return runs.find((run) => !terminalRunStatuses.has(run.status)) ?? null
}

/** The live run of one thread (null when the thread has none). */
export function selectThreadComposerGraphRun(
  runs: readonly GraphRun[],
  threadId: string | null,
  selectedRunId: string | null = null
): GraphRun | null {
  if (!threadId) return null
  return selectComposerGraphRun(runs.filter((run) => run.threadId === threadId), selectedRunId)
}

/**
 * True when a Graph run owns execution for this thread, so Graph node state —
 * not the originating plan checklist — is the authoritative progress metric.
 *
 * Deliberately shares `selectComposerGraphRun` with the Graph segment: the two
 * surfaces can never disagree about which one is reporting live progress.
 */
export function graphRunOwnsThreadProgress(
  runs: readonly GraphRun[],
  threadId: string | null,
  selectedRunId: string | null = null
): boolean {
  return selectThreadComposerGraphRun(runs, threadId, selectedRunId) != null
}

export function getComposerGraphProgress(
  run: GraphRun,
  childRuns: Readonly<Record<string, GraphChildRuntime>> = {},
  now = Date.now()
): ComposerGraphProgress {
  const runTerminal = terminalRunStatuses.has(run.status)
  const plan = currentPlan(run)
  const projections = (plan?.nodes ?? [])
    .map((node) => run.nodes[node.id])
    .filter((node): node is GraphNodeProjection => Boolean(node))
  const completed = projections.filter((projection) => (
    completedNodeStatuses.has(projection.status)
  )).length
  const childForProjection = (projection: GraphNodeProjection): GraphChildRuntime | null => {
    const childThreadId = projection.attempts.at(-1)?.childThreadId
    return childThreadId ? childRuns[childThreadId] ?? null : null
  }
  const projectionIsActive = (projection: GraphNodeProjection): boolean =>
    !runTerminal && (
      graphLivenessIsProcessing(
        graphNodeLiveness(projection, childRuns, now, run.supervision)
      ) ||
      activeChildStatuses.has(childForProjection(projection)?.status ?? 'completed')
    )
  const active = projections.filter(projectionIsActive)
  const current = active[0] ??
    projections.find((projection) => currentNodeStatuses.has(projection.status))
  const activeAgents = [...new Set(active.map(graphNodeAgentName))]
  const currentAttempt = current?.attempts.at(-1)
  const childThreadId = currentAttempt?.childThreadId ?? null
  const childRuntime = childThreadId ? childRuns[childThreadId] ?? null : null

  return {
    completed,
    total: plan?.nodes.length ?? projections.length,
    fraction: plan?.nodes.length ? completed / plan.nodes.length : 0,
    activeAgents,
    activeCount: active.length,
    activeNodeIds: active.map((projection) => projection.node.id),
    activeNodeTitles: active.map((projection) => projection.node.title),
    currentNodeTitle: current?.node.title ?? null,
    currentNodeId: current?.node.id ?? null,
    currentStatus: current?.status ?? null,
    currentAgent: current ? graphNodeAgentName(current) : null,
    attemptNumber: currentAttempt?.attemptNumber ?? null,
    childThreadId,
    childRuntime
  }
}

/**
 * Node titles for the segment label: the nodes working right now, else the
 * current node. Capped so the label stays a short, truncatable string.
 */
export function composerGraphSegmentTitles(
  progress: Pick<ComposerGraphProgress, 'activeNodeTitles' | 'currentNodeTitle'>,
  limit = 3
): string[] {
  const titles = progress.activeNodeTitles.length > 0
    ? progress.activeNodeTitles
    : progress.currentNodeTitle ? [progress.currentNodeTitle] : []
  return titles.map((title) => title.replace(/\s+/gu, ' ').trim()).filter(Boolean).slice(0, limit)
}

/**
 * Epoch ms at which a running node becomes "quiet" (no child activity for
 * GRAPH_ACTIVITY_QUIET_MS), or null when it cannot become quiet from here
 * (already quiet, terminal, or no running child). Lets the tray schedule one
 * re-render at the transition instead of ticking every second.
 */
export function composerGraphQuietDeadline(
  liveness: GraphNodeLiveness | null | undefined,
  nowMs: number
): number | null {
  if (!liveness || liveness.quiet) return null
  if (liveness.kind === 'done' || liveness.kind === 'failed') return null
  if (liveness.child?.status !== 'running' || liveness.lastActivityAgeMs === undefined) return null
  return nowMs + Math.max(0, GRAPH_ACTIVITY_QUIET_MS - liveness.lastActivityAgeMs)
}

/** True when the node should pull the user's eye (silent too long, or asking). */
export function composerGraphLivenessNeedsAttention(
  liveness: Pick<GraphNodeLiveness, 'kind' | 'quiet'> | null | undefined
): boolean {
  return Boolean(liveness && (liveness.quiet || attentionLivenessKinds.has(liveness.kind)))
}

/**
 * Why a node pulls the user's eye: a child is asking the user, supervision
 * flagged it, or a running child has been silent for GRAPH_ACTIVITY_QUIET_MS.
 */
export type ComposerGraphAttentionReason = 'asking' | 'flagged' | 'quiet'

// Most actionable first: an open question beats a flag beats silence.
const ATTENTION_REASON_RANK: Record<ComposerGraphAttentionReason, number> = {
  asking: 3,
  flagged: 2,
  quiet: 1
}

function livenessAttentionReason(
  liveness: Pick<GraphNodeLiveness, 'kind' | 'quiet'>
): ComposerGraphAttentionReason | null {
  if (liveness.kind === 'waiting_human') return 'asking'
  if (liveness.kind === 'needs_attention') return 'flagged'
  return liveness.quiet ? 'quiet' : null
}

/**
 * Whether any open node of a live run needs the user right now (a running
 * child silent for GRAPH_ACTIVITY_QUIET_MS, a child asking, a supervision
 * flag), the most actionable reason, and the earliest moment another node
 * goes quiet.
 */
export function composerGraphAttention(
  run: GraphRun,
  childRuns: Readonly<Record<string, GraphChildRuntime>>,
  nowMs: number
): { attention: boolean; reason: ComposerGraphAttentionReason | null; quietDeadline: number | null } {
  if (terminalRunStatuses.has(run.status)) return { attention: false, reason: null, quietDeadline: null }
  let reason: ComposerGraphAttentionReason | null = null
  let quietDeadline: number | null = null
  for (const node of currentPlan(run)?.nodes ?? []) {
    const projection = run.nodes[node.id]
    if (!projection || completedNodeStatuses.has(projection.status)) continue
    const liveness = graphNodeLiveness(projection, childRuns, nowMs, run.supervision)
    if (liveness.kind === 'done' || liveness.kind === 'failed') continue
    const nodeReason = livenessAttentionReason(liveness)
    if (nodeReason && (!reason || ATTENTION_REASON_RANK[nodeReason] > ATTENTION_REASON_RANK[reason])) {
      reason = nodeReason
    }
    const deadline = composerGraphQuietDeadline(liveness, nowMs)
    if (deadline != null && (quietDeadline == null || deadline < quietDeadline)) quietDeadline = deadline
  }
  return { attention: reason != null, reason, quietDeadline }
}

/**
 * Roving-focus target in the node map for `key` pressed on `currentId`.
 * Nodes arrive column by column, top to bottom (layoutComposerGraph order):
 * ↑/↓ walk that order, ←/→ jump to the nearest node of the neighbouring
 * column, Home/End go to the first/last node. Null when nothing moves.
 */
export function composerGraphNavigationTarget(
  nodes: ReadonlyArray<Pick<ComposerGraphLayoutNode, 'id' | 'x' | 'y'>>,
  currentId: string | null,
  key: string
): string | null {
  const first = nodes[0]
  const last = nodes.at(-1)
  if (!first || !last) return null
  if (key === 'Home') return first.id === currentId ? null : first.id
  if (key === 'End') return last.id === currentId ? null : last.id
  const index = nodes.findIndex((node) => node.id === currentId)
  const current = nodes[index]
  if (!current) return key.startsWith('Arrow') ? first.id : null
  if (key === 'ArrowDown') return nodes[index + 1]?.id ?? null
  if (key === 'ArrowUp') return nodes[index - 1]?.id ?? null
  if (key !== 'ArrowRight' && key !== 'ArrowLeft') return null
  const columns = [...new Set(nodes.map((node) => node.x))].sort((left, right) => left - right)
  const targetX = columns[columns.indexOf(current.x) + (key === 'ArrowRight' ? 1 : -1)]
  if (targetX === undefined) return null
  let target: Pick<ComposerGraphLayoutNode, 'id' | 'x' | 'y'> | null = null
  for (const node of nodes) {
    if (node.x !== targetX) continue
    if (!target || Math.abs(node.y - current.y) < Math.abs(target.y - current.y)) target = node
  }
  return target?.id ?? null
}

export function composerGraphNodeState(
  node: Pick<ComposerGraphLayoutNode, 'status' | 'processing' | 'livenessKind' | 'quiet'>,
  runTerminal: boolean
): ComposerGraphNodeState {
  if (node.status === 'accepted') return 'done'
  if (node.status === 'failed' || node.status === 'cancelled') return 'failed'
  if (
    node.status === 'skipped' || node.status === 'superseded' ||
    node.status === 'pending' || node.status === 'blocked'
  ) {
    return 'pending'
  }
  if (runTerminal) return 'idle'
  if (composerGraphLivenessNeedsAttention({ kind: node.livenessKind, quiet: node.quiet })) return 'attention'
  if (node.processing) return 'running'
  return 'idle'
}

const AGENT_AVATAR_COLORS = [
  '#c46a3a',
  '#3f8a5c',
  '#5b6fd6',
  '#8a5cc7',
  '#b8577a',
  '#2f8487',
  '#9a7428'
]

/** "Claude Code" → "CC", "Codex" → "C", "测试代理" → "测". */
export function graphAgentInitials(name: string): string {
  const words = name.trim().split(/[\s_\-·.]+/u).filter(Boolean)
  if (words.length === 0) return 'K'
  const glyph = (word: string): string => (Array.from(word)[0] ?? '').toUpperCase()
  const latin = (word: string): boolean => /^[a-z0-9]/iu.test(word)
  const second = words.length > 1 && latin(words[0]!) && latin(words[1]!) ? glyph(words[1]!) : ''
  return `${glyph(words[0]!)}${second}`
}

/** Stable avatar color per agent name (white glyphs stay readable on each). */
export function graphAgentAvatarColor(name: string): string {
  let hash = 0
  for (const character of name.trim().toLowerCase()) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  }
  return AGENT_AVATAR_COLORS[hash % AGENT_AVATAR_COLORS.length]!
}

function edgePath(from: ComposerGraphLayoutNode, to: ComposerGraphLayoutNode): string {
  const fromY = from.y + from.height / 2
  const toY = to.y + to.height / 2
  if (from.x === to.x) {
    // Same phase column: bow out past the right edge so the curve never runs
    // through the cards stacked between the two nodes.
    const edgeX = from.x + from.width
    const bowX = edgeX + SAME_COLUMN_BOW
    return `M ${edgeX} ${fromY} C ${bowX} ${fromY} ${bowX} ${toY} ${edgeX} ${toY}`
  }
  const forward = to.x > from.x
  const fromX = forward ? from.x + from.width : from.x
  const toX = forward ? to.x : to.x + to.width
  // Forward edges bend at the middle of the gap (Graph board); a backward
  // edge loops out so it stays readable.
  const bend = forward ? (toX - fromX) / 2 : -Math.max(34, Math.abs(toX - fromX) * 0.45)
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY} ${toX - bend} ${toY} ${toX} ${toY}`
}

export function layoutComposerGraph(
  run: GraphRun,
  childRuns: Readonly<Record<string, GraphChildRuntime>> = {},
  now = Date.now()
): ComposerGraphLayout {
  const plan = currentPlan(run)
  if (!plan) return { width: PADDING_X * 2, height: MIN_HEIGHT, phases: [], nodes: [], edges: [] }
  const runTerminal = terminalRunStatuses.has(run.status)
  const phases = [...plan.phases].sort((left, right) => left.order - right.order)
  const phaseTitles = new Map(phases.map((phase) => [phase.id, phase.title]))
  const columns = new Map<string, Array<Omit<ComposerGraphLayoutNode, 'x' | 'y'>>>(
    phases.map((phase) => [phase.id, []])
  )

  for (const node of plan.nodes) {
    const projection = run.nodes[node.id]
    if (!projection) continue
    const attempt = projection.attempts.at(-1)
    const childThreadId = attempt?.childThreadId
    const liveness = graphNodeLiveness(projection, childRuns, now, run.supervision)
    // A node whose phase is missing from the plan gets its own trailing column.
    const column = columns.get(node.phaseId) ?? []
    column.push({
      id: node.id,
      phaseId: node.phaseId,
      phaseTitle: phaseTitles.get(node.phaseId) ?? '',
      title: node.title,
      objective: node.objective,
      agentName: graphNodeAgentName(projection),
      status: projection.status,
      ...(attempt ? { attemptNumber: attempt.attemptNumber } : {}),
      ...(childThreadId ? { childThreadId } : {}),
      ...(childThreadId && childRuns[childThreadId]
        ? { childRuntime: childRuns[childThreadId] }
        : {}),
      processing: !runTerminal && graphLivenessIsProcessing(liveness),
      livenessKind: liveness.kind,
      quiet: !runTerminal && liveness.quiet,
      width: COMPOSER_GRAPH_NODE_WIDTH,
      height: COMPOSER_GRAPH_NODE_HEIGHT
    })
    columns.set(node.phaseId, column)
  }

  // Empty phases take no column.
  const filled = [...columns.entries()].filter(([, column]) => column.length > 0)
  const maximumRows = Math.max(1, ...filled.map(([, column]) => column.length))
  const rowGap = maximumRows > 2 ? DENSE_ROW_GAP : ROW_GAP
  const stackHeight = (rows: number): number =>
    rows * COMPOSER_GRAPH_NODE_HEIGHT + Math.max(0, rows - 1) * rowGap
  const height = Math.max(MIN_HEIGHT, PADDING_Y * 2 + stackHeight(maximumRows))
  const columnX = (index: number): number =>
    PADDING_X + index * (COMPOSER_GRAPH_NODE_WIDTH + COLUMN_GAP)
  const nodes = filled.flatMap(([, column], index) => {
    const top = (height - stackHeight(column.length)) / 2
    return column.map((node, row) => ({
      ...node,
      x: columnX(index),
      y: top + row * (COMPOSER_GRAPH_NODE_HEIGHT + rowGap)
    }))
  })
  const nodeLookup = new Map(nodes.map((node) => [node.id, node]))
  const edges = plan.edges.flatMap((edge) => {
    const from = nodeLookup.get(edge.from)
    const to = nodeLookup.get(edge.to)
    return from && to
      ? [{ ...edge, path: edgePath(from, to), flowing: to.processing }]
      : []
  })
  const width = PADDING_X * 2 + filled.length * COMPOSER_GRAPH_NODE_WIDTH +
    Math.max(0, filled.length - 1) * COLUMN_GAP

  return {
    width,
    height,
    phases: filled.map(([id], index) => ({
      id,
      title: phaseTitles.get(id) ?? '',
      x: columnX(index),
      width: COMPOSER_GRAPH_NODE_WIDTH
    })),
    nodes,
    edges
  }
}
