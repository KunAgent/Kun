import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { graphNodeLiveness, type GraphNodeLiveness } from '../../graph/graph-liveness'
import type { GraphChildRuntime, GraphRun } from '../../graph/graph-types'
import { TrayAvatar, TrayButton } from './composer-tray/tray-primitives'
import {
  formatTrayAgo,
  formatTrayDuration,
  useTrayNow,
  type TrayTranslate
} from './composer-tray/tray-elapsed'
import {
  COMPOSER_GRAPH_MIN_SCALE,
  composerGraphLivenessNeedsAttention,
  composerGraphNavigationTarget,
  composerGraphNodeState,
  graphAgentAvatarColor,
  graphAgentInitials,
  isComposerGraphRunTerminal,
  layoutComposerGraph,
  type ComposerGraphLayoutNode,
  type ComposerGraphNodeState
} from './composer-graph-preview'
import './composer-tray/graph-tray.css'

export type GraphOpenChildHandler = (
  runId: string,
  nodeId: string,
  attemptId: string,
  childThreadId: string
) => void

const CLOSED_NODE_STATUSES = new Set<ComposerGraphLayoutNode['status']>([
  'accepted',
  'failed',
  'cancelled',
  'skipped',
  'superseded'
])

// Non-breaking on both sides: a leading space of a flex item would collapse.
const SEPARATOR = '\u00a0·\u00a0'

function percentOf(value: number, total: number): string {
  return `${total > 0 ? (value / total) * 100 : 0}%`
}

/** Second line of a node card: "Claude Code · 重试 1", "Kun · 已验收", "等待上游节点". */
export function graphNodeMetaLabel(
  node: ComposerGraphLayoutNode,
  runTerminal: boolean,
  t: TrayTranslate
): string {
  if (!runTerminal && (node.status === 'pending' || node.status === 'blocked')) {
    return t('graphLiveness_waiting_dependency')
  }
  const statusLabel = (): string => t(`graphStatus_${node.status}`, { defaultValue: node.status })
  let detail: string
  if (runTerminal || CLOSED_NODE_STATUSES.has(node.status)) {
    detail = statusLabel()
  } else if (node.processing && (node.attemptNumber ?? 1) > 1) {
    detail = t('composerTrayGraph.nodeRetry', { number: (node.attemptNumber ?? 1) - 1 })
  } else {
    detail = t(`graphLiveness_${node.livenessKind}`, { defaultValue: statusLabel() })
  }
  return `${node.agentName} · ${detail}`
}

/** "最后活动 4 秒前" / "最后活动 2 分钟前". */
export function graphLastActivityLabel(ageMs: number, t: TrayTranslate): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1_000))
  return seconds < 60
    ? t('composerTrayGraph.lastActivitySeconds', { seconds })
    : t('composerTrayGraph.lastActivityAgo', { ago: formatTrayAgo(seconds, t) })
}

/** Live status after the objective in the inspector strip. */
export function graphInspectorLivenessLabel({
  run,
  node,
  liveness,
  t
}: {
  run: Pick<GraphRun, 'status'>
  node: Pick<ComposerGraphLayoutNode, 'status'>
  liveness: GraphNodeLiveness | null
  t: TrayTranslate
}): string {
  if (isComposerGraphRunTerminal(run)) return t(`graphStatus_${run.status}`, { defaultValue: run.status })
  if (CLOSED_NODE_STATUSES.has(node.status)) {
    return t(`graphStatus_${node.status}`, { defaultValue: node.status })
  }
  if (!liveness) return ''
  if (liveness.kind === 'waiting_dependency') return t('graphLiveness_waiting_dependency')
  const lastActivity = liveness.lastActivityAgeMs !== undefined
    ? graphLastActivityLabel(liveness.lastActivityAgeMs, t)
    : null
  if (liveness.quiet) {
    return [t('composerTrayGraph.stillWaiting'), lastActivity].filter(Boolean).join(' · ')
  }
  // A working child reads as "最后活动 4 秒前"; any other phase (Lead review,
  // retry, queue) names itself first.
  const phase = liveness.kind === 'working' && lastActivity
    ? null
    : t(`graphLiveness_${liveness.kind}`, { defaultValue: liveness.kind })
  const activity = liveness.activityLabel ?? liveness.activityToolName ?? phase
  return [activity, lastActivity].filter(Boolean).join(' · ')
}

function GraphMapNode({
  node,
  state,
  meta,
  inspected,
  tabStop,
  layoutWidth,
  onHover,
  onHoverEnd,
  onFocusNode,
  onOpen
}: {
  node: ComposerGraphLayoutNode
  state: ComposerGraphNodeState
  meta: string
  inspected: boolean
  /** The map's single Tab stop (roving tabindex); arrows move between nodes. */
  tabStop: boolean
  layoutWidth: number
  onHover: (nodeId: string) => void
  onHoverEnd: () => void
  onFocusNode: (nodeId: string) => void
  onOpen: (nodeId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const style: CSSProperties = {
    left: percentOf(node.x, layoutWidth),
    top: node.y,
    width: percentOf(node.width, layoutWidth)
  }
  return (
    <button
      type="button"
      className="ds-graph-tray-node ds-no-drag"
      style={style}
      data-graph-preview-node={node.id}
      data-state={state}
      data-inspected={inspected ? 'true' : undefined}
      tabIndex={tabStop ? 0 : -1}
      aria-label={t('graphComposerNodeAria', {
        title: node.title,
        status: t(`graphStatus_${node.status}`, { defaultValue: node.status }),
        agent: node.agentName
      })}
      title={node.phaseTitle ? `${node.title} · ${node.phaseTitle}` : node.title}
      onClick={() => onOpen(node.id)}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={onHoverEnd}
      onFocus={() => onFocusNode(node.id)}
    >
      <span className="ds-graph-tray-node-title">
        {state === 'done' ? (
          <Check className="ds-graph-tray-node-check" size={12} strokeWidth={3} aria-hidden="true" />
        ) : (
          <span className="ds-graph-tray-node-dot" aria-hidden="true" />
        )}
        <span className="ds-graph-tray-node-title-text" data-graph-preview-node-title>{node.title}</span>
      </span>
      <span className="ds-graph-tray-node-meta" data-graph-preview-node-meta>{meta}</span>
    </button>
  )
}

function GraphPreviewInspector({
  run,
  node,
  childRuns,
  onOpenChild
}: {
  run: GraphRun
  node: ComposerGraphLayoutNode
  childRuns: Readonly<Record<string, GraphChildRuntime>>
  onOpenChild?: GraphOpenChildHandler
}): ReactElement {
  const { t } = useTranslation('common')
  const terminal = isComposerGraphRunTerminal(run)
  const projection = run.nodes[node.id]
  const attempt = projection?.attempts.at(-1)
  // "最后活动 4 秒前" ticks only while this node can still change.
  const nowMs = useTrayNow(!terminal && !CLOSED_NODE_STATUSES.has(node.status))
  const liveness = projection ? graphNodeLiveness(projection, childRuns, nowMs, run.supervision) : null
  const livenessLabel = graphInspectorLivenessLabel({ run, node, liveness, t })
  const attention = !terminal && composerGraphLivenessNeedsAttention(liveness)
  const elapsedTitle = liveness?.elapsedMs
    ? t('composerTrayGraph.elapsedTitle', { duration: formatTrayDuration(liveness.elapsedMs / 1_000, t) })
    : undefined
  const childThreadId = node.childThreadId
  return (
    <div className="ds-graph-tray-inspector" data-graph-preview-inspector={node.id}>
      <TrayAvatar size="lg" label={graphAgentInitials(node.agentName)} color={graphAgentAvatarColor(node.agentName)} />
      <span className="ds-graph-tray-inspector-body">
        <span className="ds-graph-tray-inspector-title">
          <span className="ds-graph-tray-inspector-name">{node.title}</span>
          <span className="ds-graph-tray-inspector-agent">
            {`${SEPARATOR}${t('graphComposerAssignedAgent', { agent: node.agentName })}`}
          </span>
        </span>
        <span className="ds-graph-tray-inspector-line" title={node.objective || undefined}>
          {node.objective ? <span className="ds-graph-tray-inspector-objective">{node.objective}</span> : null}
          {livenessLabel ? (
            <span
              className="ds-graph-tray-inspector-liveness"
              data-tone={attention ? 'waiting' : undefined}
              title={elapsedTitle}
            >
              {node.objective ? `${SEPARATOR}${livenessLabel}` : livenessLabel}
            </span>
          ) : null}
        </span>
      </span>
      {childThreadId && attempt && onOpenChild ? (
        <TrayButton
          variant="outline"
          data-graph-view-live-work
          onClick={() => onOpenChild(run.id, node.id, attempt.id, childThreadId)}
        >
          {t('graphViewLiveWork')}
        </TrayButton>
      ) : null}
    </div>
  )
}

/**
 * How long the pointer must rest on a card before the inspector follows it.
 * Crossing another card on the way down to 查看实时工作 keeps the node that
 * was inspected; the inspector stays on the last node rested on.
 */
export const GRAPH_INSPECT_HOVER_DELAY_MS = 160

const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * Node map for the Graph tray sheet: phase columns of node cards over neutral
 * edges, then an inspector strip for the inspected node (by default the
 * current one). Clicking a node opens the full Graph at that node.
 *
 * Keyboard: the map is one Tab stop (roving tabindex); arrows and Home/End
 * move between nodes and inspect the focused one, so Tab leaves the map
 * straight to that node's 查看实时工作. Pointer: a short hover intent
 * (GRAPH_INSPECT_HOVER_DELAY_MS) picks the inspected node.
 *
 * The canvas is at most its natural width and shrinks with the sheet down to
 * COMPOSER_GRAPH_MIN_SCALE (node positions and widths are percentages, edges
 * stretch with a non-scaling stroke); below that the card scrolls sideways.
 */
export function FloatingComposerGraphPreview({
  run,
  childRuns = {},
  now,
  initialNodeId = null,
  onOpenGraph,
  onOpenChild
}: {
  run: GraphRun
  childRuns?: Readonly<Record<string, GraphChildRuntime>>
  now?: number
  /** Node shown in the inspector until another is hovered (the current node). */
  initialNodeId?: string | null
  onOpenGraph: (runId: string, nodeId?: string) => void
  onOpenChild?: GraphOpenChildHandler
}): ReactElement {
  const { t } = useTranslation('common')
  const mapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const terminal = isComposerGraphRunTerminal(run)
  const layout = layoutComposerGraph(run, childRuns, now)
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(initialNodeId)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inspectedNode = layout.nodes.find((node) => node.id === inspectedNodeId)
    ?? layout.nodes.find((node) => node.processing)
    ?? layout.nodes.find((node) => !CLOSED_NODE_STATUSES.has(node.status))
    ?? layout.nodes[0]
    ?? null
  const inspectedId = inspectedNode?.id ?? null
  // The Tab stop is the last focused node, else the inspected one.
  const tabStopId = focusNodeId && layout.nodes.some((node) => node.id === focusNodeId)
    ? focusNodeId
    : inspectedId

  const cancelHover = (): void => {
    if (hoverTimerRef.current == null) return
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
  }
  useEffect(() => () => {
    if (hoverTimerRef.current != null) clearTimeout(hoverTimerRef.current)
  }, [])
  const hoverNode = (nodeId: string): void => {
    cancelHover()
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null
      setInspectedNodeId(nodeId)
    }, GRAPH_INSPECT_HOVER_DELAY_MS)
  }
  const focusNode = (nodeId: string): void => {
    cancelHover()
    setFocusNodeId(nodeId)
    setInspectedNodeId(nodeId)
  }
  const onMapKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (!NAVIGATION_KEYS.has(event.key)) return
    const from = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-graph-preview-node]')
      : null
    if (!from) return
    // Arrows never scroll the card: focusing the target brings it into view.
    event.preventDefault()
    const targetId = composerGraphNavigationTarget(layout.nodes, from.dataset.graphPreviewNode ?? null, event.key)
    if (!targetId) return
    const target = Array.from(mapRef.current?.querySelectorAll<HTMLElement>('[data-graph-preview-node]') ?? [])
      .find((element) => element.dataset.graphPreviewNode === targetId)
    target?.focus()
  }

  // When the map scrolls sideways, start with the inspected node in view.
  useEffect(() => {
    const map = mapRef.current
    const canvas = canvasRef.current
    if (!map || !canvas || !inspectedId || map.scrollWidth <= map.clientWidth) return
    const node = layout.nodes.find((candidate) => candidate.id === inspectedId)
    if (!node) return
    const scale = canvas.clientWidth / layout.width
    map.scrollLeft = Math.max(0, node.x * scale - 24)
    // Only on mount: later hovers must not scroll the map under the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canvasStyle: CSSProperties = {
    width: '100%',
    maxWidth: layout.width,
    minWidth: Math.ceil(layout.width * COMPOSER_GRAPH_MIN_SCALE),
    height: layout.height
  }

  return (
    <>
      <div
        ref={mapRef}
        className="ds-graph-tray-map"
        role="group"
        aria-label={t('graphComposerPreviewSummary', {
          phases: layout.phases.length,
          nodes: layout.nodes.length
        })}
        data-graph-composer-preview={run.id}
        onKeyDown={onMapKeyDown}
      >
        <div ref={canvasRef} className="ds-graph-tray-canvas" style={canvasStyle}>
          <svg
            className="ds-graph-tray-edges"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                className="ds-graph-tray-edge"
                vectorEffect="non-scaling-stroke"
                data-kind={edge.kind}
                data-flowing={edge.flowing ? 'true' : undefined}
                data-graph-preview-edge={edge.id}
              />
            ))}
          </svg>
          {layout.nodes.map((node) => {
            const state = composerGraphNodeState(node, terminal)
            return (
              <GraphMapNode
                key={node.id}
                node={node}
                state={state}
                meta={graphNodeMetaLabel(node, terminal, t)}
                inspected={node.id === inspectedId}
                tabStop={node.id === tabStopId}
                layoutWidth={layout.width}
                onHover={hoverNode}
                onHoverEnd={cancelHover}
                onFocusNode={focusNode}
                onOpen={(nodeId) => onOpenGraph(run.id, nodeId)}
              />
            )
          })}
        </div>
      </div>
      {inspectedNode ? (
        <GraphPreviewInspector
          run={run}
          node={inspectedNode}
          childRuns={childRuns}
          onOpenChild={onOpenChild}
        />
      ) : null}
    </>
  )
}
