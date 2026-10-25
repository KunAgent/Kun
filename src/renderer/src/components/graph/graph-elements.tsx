import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { ExternalLink } from 'lucide-react'
import {
  graphLivenessIsProcessing,
  graphNodeLiveness
} from '../../graph/graph-liveness'
import type {
  GraphChildRuntime,
  GraphPlanNode,
  GraphRun
} from '../../graph/graph-types'
import {
  formatSubagentElapsed,
  SubagentLiveAvatar,
  SubagentLivenessLane
} from '../subagents/SubagentLiveness'
import { StatusPill, terminalRunStatuses } from './graph-panel-shared'

export function graphElements(
  run: GraphRun,
  reducedMotion = false,
  selectedNodeId: string | null = null,
  options: {
    childRuns?: Readonly<Record<string, GraphChildRuntime>>
    now?: number
    onOpenChild?: (
      nodeId: string,
      attemptId: string,
      childThreadId: string
    ) => void
    waitingUpstreamLabel?: string
    viewLiveWorkLabel?: string
  } = {}
): { nodes: Node[]; edges: Edge[] } {
  const plan = run.plans.at(-1)
  if (!plan) return { nodes: [], edges: [] }
  const phaseIndex = new Map(
    [...plan.phases].sort((a, b) => a.order - b.order).map((phase, index) => [phase.id, index])
  )
  const critical = criticalPathNodeIds(run)
  const rows = new Map<string, number>()
  const livenessByNodeId = new Map(plan.nodes.map((node) => {
    const projection = run.nodes[node.id]
    return [
      node.id,
      projection
        ? graphNodeLiveness(
            projection,
            options.childRuns ?? {},
            options.now,
            run.supervision
          )
        : null
    ] as const
  }))
  const runTerminal = terminalRunStatuses.has(run.status)
  const processingNodeIds = new Set(plan.nodes
    .filter((node) => (
      !runTerminal && graphLivenessIsProcessing(livenessByNodeId.get(node.id))
    ))
    .map((node) => node.id))
  const nodes: Node[] = plan.nodes.map((node) => {
    const phase = phaseIndex.get(node.phaseId) ?? 0
    const row = rows.get(node.phaseId) ?? 0
    rows.set(node.phaseId, row + 1)
    const projection = run.nodes[node.id]
    const status = projection?.status ?? 'pending'
    const attempt = projection?.attempts.at(-1)
    const liveness = livenessByNodeId.get(node.id) ?? null
    const selected = selectedNodeId === node.id
    const phaseTitle = plan.phases.find((item) => item.id === node.phaseId)?.title ?? node.phaseId
    const effectiveAssignment = attempt?.assignment.name ?? plannedAssignmentLabel(node)
    return {
      id: node.id,
      ariaLabel: `${node.title}: ${status.replaceAll('_', ' ')}; ${plannedAssignmentLabel(node)}`,
      position: { x: phase * 292 + 56, y: row * 172 + 64 },
      selected,
      data: {
        label: (
          <article className="graph-node-card w-[220px] text-left">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-[8px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                {phaseTitle}
              </span>
              <StatusPill status={status} />
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-[12px] font-semibold leading-4 text-ds-ink">{node.title}</span>
              <span className="shrink-0 rounded-md bg-ds-hover px-1.5 py-0.5 text-[8px] text-ds-muted">
                {node.kind.replaceAll('_', ' ')}
              </span>
            </div>
            <div className="mt-1.5 line-clamp-2 min-h-8 text-[9px] leading-4 text-ds-muted">
              {node.objective}
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-ds-border-muted pt-2">
              <SubagentLiveAvatar
                poseId={liveness?.child?.profile ?? effectiveAssignment}
                status={
                  status === 'failed' || status === 'cancelled'
                    ? 'failed'
                    : status === 'accepted'
                      ? 'done'
                      : status === 'blocked' || status === 'pending' || status === 'queued'
                        ? 'queued'
                        : status === 'reviewing' || status === 'repair_required'
                          ? 'awaiting-permission'
                          : 'running'
                }
                compact
                animate={!reducedMotion && status === 'running'}
              />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[9px] font-semibold text-ds-ink"
                  title={effectiveAssignment}
                >
                  {effectiveAssignment}
                  {attempt ? ` · #${attempt.attemptNumber}` : ''}
                </span>
                <span className="mt-0.5 block truncate text-[8px] text-ds-faint">
                  {liveness?.activityLabel ??
                    (status === 'blocked'
                      ? options.waitingUpstreamLabel ?? 'Waiting for upstream node'
                      : liveness && !['idle', 'done', 'failed'].includes(liveness.kind)
                        ? liveness.kind.replaceAll('_', ' ')
                        : status.replaceAll('_', ' '))}
                  {liveness?.activityToolName ? ` · ${liveness.activityToolName}` : ''}
                  {liveness?.elapsedMs ? ` · ${formatSubagentElapsed(liveness.elapsedMs)}` : ''}
                </span>
              </span>
              {attempt?.childThreadId && options.onOpenChild ? (
                <button
                  type="button"
                  title={options.viewLiveWorkLabel ?? 'View live work'}
                  aria-label={`${options.viewLiveWorkLabel ?? 'View live work'}: ${node.title}`}
                  className="nodrag nopan flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent/20 text-accent transition hover:bg-accent/10"
                  onClick={(event) => {
                    event.stopPropagation()
                    options.onOpenChild?.(node.id, attempt.id, attempt.childThreadId!)
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            {liveness && ['working', 'active_review', 'retrying'].includes(liveness.kind) ? (
              <div className="mt-2 overflow-hidden rounded-full">
                <SubagentLivenessLane
                  status={liveness.kind === 'active_review' || liveness.kind === 'retrying'
                    ? 'awaiting-permission'
                    : 'running'}
                  animate={!reducedMotion && graphLivenessIsProcessing(liveness)}
                />
              </div>
            ) : null}
            {projection?.lastProgress?.percent !== undefined ? (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-ds-hover">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${projection.lastProgress.percent}%` }}
                />
              </div>
            ) : null}
          </article>
        )
      },
      style: {
        width: 244,
        padding: 11,
        borderRadius: 16,
        border: selected
          ? '1.5px solid rgb(79 70 229 / 0.95)'
          : status === 'running'
          ? '1px solid rgb(99 102 241 / 0.55)'
          : status === 'repair_required'
            ? '1px solid rgb(245 158 11 / 0.55)'
            : status === 'failed'
              ? '1px solid rgb(239 68 68 / 0.55)'
          : critical.has(node.id) && status !== 'blocked' && status !== 'pending'
            ? '1px solid rgb(245 158 11 / 0.5)'
            : '1px solid var(--ds-border-muted)',
        background: 'color-mix(in srgb, var(--ds-surface-card) 96%, transparent)',
        boxShadow: selected
          ? '0 0 0 4px rgb(79 70 229 / 0.12), 0 14px 32px rgb(15 23 42 / 0.12)'
          : status === 'running'
          ? '0 0 0 3px rgb(99 102 241 / 0.08), 0 10px 25px rgb(15 23 42 / 0.08)'
          : critical.has(node.id) && status !== 'blocked' && status !== 'pending'
            ? '0 0 0 2px rgb(245 158 11 / 0.06), 0 8px 22px rgb(15 23 42 / 0.06)'
            : '0 8px 22px rgb(15 23 42 / 0.055)'
      }
    }
  })
  const loopTargets = new Set(plan.nodes.flatMap((node) =>
    node.loopGate ? [`${node.id}->${node.loopGate.continueTargetNodeId}`] : []))
  const edges: Edge[] = plan.edges.map((edge) => {
    const isLoop = loopTargets.has(`${edge.from}->${edge.to}`)
    const isCritical = critical.has(edge.from) && critical.has(edge.to) && !isLoop
    const targetProcessing = processingNodeIds.has(edge.to)
    const stroke = isLoop
      ? '#f59e0b'
      : edge.kind === 'message'
        ? '#8b5cf6'
        : edge.kind === 'data'
          ? '#0ea5e9'
          : isCritical
            ? '#f59e0b'
            : '#94a3b8'
    const strokeWidth = isCritical || isLoop ? 2 : 1.25
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'smoothstep',
      label: edge.label ??
        (isLoop ? 'loop' : edge.kind === 'data' ? edge.artifactName : undefined),
      animated: !reducedMotion && targetProcessing,
      className: targetProcessing ? 'graph-flow-edge-processing' : undefined,
      interactionWidth: 18,
      style: {
        stroke,
        strokeWidth: targetProcessing ? Math.max(strokeWidth, 1.8) : strokeWidth,
        opacity: targetProcessing ? 1 : 0.88,
        strokeDasharray: edge.kind === 'message' || isLoop ? '5 5' : undefined
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }
    }
  })
  return { nodes, edges }
}

export function plannedAssignmentLabel(node: GraphPlanNode): string {
  const assignment = node.assignment
  if (!assignment) return 'Kun auto route'
  if (assignment.kind === 'existing') {
    return assignment.profileVersion
      ? `${assignment.profileId}@${assignment.profileVersion}`
      : assignment.profileId
  }
  return assignment.name
}

export function filterGraphElementsByPhases(
  run: GraphRun,
  elements: { nodes: Node[]; edges: Edge[] },
  collapsedPhaseIds: ReadonlySet<string>
): { nodes: Node[]; edges: Edge[] } {
  if (collapsedPhaseIds.size === 0) return elements
  const plan = run.plans.at(-1)
  if (!plan) return { nodes: [], edges: [] }
  const hidden = new Set(plan.nodes
    .filter((node) => collapsedPhaseIds.has(node.phaseId))
    .map((node) => node.id))
  return {
    nodes: elements.nodes.filter((node) => !hidden.has(node.id)),
    edges: elements.edges.filter((edge) =>
      !hidden.has(edge.source) && !hidden.has(edge.target))
  }
}

export function runProgress(run: GraphRun): { completed: number; total: number } {
  const values = Object.values(run.nodes)
  return {
    completed: values.filter((node) => node.status === 'accepted').length,
    total: values.length
  }
}

export function criticalPathNodeIds(run: GraphRun): Set<string> {
  const plan = run.plans.at(-1)
  if (!plan) return new Set()
  const phaseOrder = new Map(plan.phases.map((phase) => [phase.id, phase.order]))
  const nodeOrder = new Map(plan.nodes.map((node, index) => [node.id, index]))
  const ordered = [...plan.nodes].sort((a, b) =>
    (phaseOrder.get(a.phaseId) ?? 0) - (phaseOrder.get(b.phaseId) ?? 0) ||
    (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0))
  const rank = new Map(ordered.map((node, index) => [node.id, index]))
  const incoming = new Map<string, string[]>()
  for (const edge of plan.edges) {
    if (edge.kind === 'message') continue
    if ((rank.get(edge.from) ?? 0) >= (rank.get(edge.to) ?? 0)) continue
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from])
  }
  const distance = new Map<string, number>()
  const previous = new Map<string, string>()
  for (const node of ordered) {
    const best = (incoming.get(node.id) ?? [])
      .map((id) => ({ id, distance: distance.get(id) ?? 1 }))
      .sort((a, b) => b.distance - a.distance)[0]
    distance.set(node.id, (best?.distance ?? 0) + 1)
    if (best) previous.set(node.id, best.id)
  }
  const end = plan.completionNodeIds
    .map((id) => ({ id, distance: distance.get(id) ?? 0 }))
    .sort((a, b) => b.distance - a.distance)[0]?.id
  const result = new Set<string>()
  let cursor: string | undefined = end
  while (cursor) {
    result.add(cursor)
    cursor = previous.get(cursor)
  }
  return result
}
