import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Copy, Crosshair, MessageSquare, Route } from 'lucide-react'
import type { NodeGraphView } from '../../node-graph/node-graph-filter'
import type {
  NodeGraphEdgeKind,
  NodeGraphNode
} from '../../node-graph/node-graph-types'
import { NODE_GRAPH_KIND_LABEL_KEYS } from './node-graph-theme'
import { NodeGraphKindGlyph } from './NodeGraphKindLegend'

type Props = {
  view: NodeGraphView
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
  onFocusNode: (id: string) => void
  onPathFrom: (id: string) => void
  onOpenThread?: (threadId: string) => void
}

const OUTGOING_EDGE_LABEL_KEYS: Record<NodeGraphEdgeKind, string> = {
  contains: 'nodeGraphEdgeContains',
  link: 'nodeGraphEdgeLink',
  mount: 'nodeGraphEdgeMount',
  parent: 'nodeGraphEdgeParent',
  fork: 'nodeGraphEdgeFork',
  workspace: 'nodeGraphEdgeWorkspace',
  agent: 'nodeGraphEdgeAgent',
  memoryOf: 'nodeGraphEdgeMemoryOf',
  tagged: 'nodeGraphEdgeTagged',
  touches: 'nodeGraphEdgeTouches'
}

const INCOMING_EDGE_LABEL_KEYS: Record<NodeGraphEdgeKind, string> = {
  contains: 'nodeGraphEdgeContainedBy',
  link: 'nodeGraphEdgeLinkedFrom',
  mount: 'nodeGraphEdgeMountedBy',
  parent: 'nodeGraphEdgeParentOf',
  fork: 'nodeGraphEdgeForkedInto',
  workspace: 'nodeGraphEdgeHolds',
  agent: 'nodeGraphEdgeUsedBy',
  memoryOf: 'nodeGraphEdgeRemembers',
  tagged: 'nodeGraphEdgeTags',
  touches: 'nodeGraphEdgeChangedBy'
}

const PREVIEW_ROWS = 3

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatMoment(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

type Group = {
  kind: NodeGraphEdgeKind
  outgoing: boolean
  nodes: NodeGraphNode[]
}

/**
 * Property sheet for the selected node.
 *
 * Grouped by relationship *and* direction, because every edge kind means
 * something different from each end — labelling both the same way made an
 * incoming link read as one this file had written.
 */
export function NodeGraphInspector({
  view,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
  onPathFrom,
  onOpenThread
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const selected = useMemo(
    () => view.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, view.nodes]
  )

  const groups = useMemo<Group[]>(() => {
    if (!selected) return []
    const byId = new Map(view.nodes.map((node) => [node.id, node]))
    const buckets = new Map<string, Group>()
    for (const edge of view.edges) {
      const outgoing = edge.from === selected.id
      const otherId = outgoing ? edge.to : edge.to === selected.id ? edge.from : null
      if (!otherId) continue
      const node = byId.get(otherId)
      if (!node) continue
      const key = `${edge.kind}:${outgoing}`
      const bucket = buckets.get(key)
      if (bucket) bucket.nodes.push(node)
      else buckets.set(key, { kind: edge.kind, outgoing, nodes: [node] })
    }
    // Outgoing first: what this node points at is what is usually being checked.
    return [...buckets.values()].sort(
      (left, right) =>
        Number(right.outgoing) - Number(left.outgoing) ||
        right.nodes.length - left.nodes.length
    )
  }, [selected, view.edges, view.nodes])

  const totalConnections = groups.reduce((sum, group) => sum + group.nodes.length, 0)

  const copyPath = (value: string): void => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_200)
    }).catch(() => undefined)
  }

  if (!selected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Crosshair className="h-6 w-6 text-ds-faint" strokeWidth={1.5} />
        <p className="text-[12px] leading-5 text-ds-faint">{t('nodeGraphSelectionEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">
          <NodeGraphKindGlyph kind={selected.kind} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ds-ink">
            {selected.label}
          </span>
          <span className="block text-[11px] text-ds-faint">
            {t(NODE_GRAPH_KIND_LABEL_KEYS[selected.kind])}
          </span>
        </span>
        <span className="shrink-0 rounded-pill bg-accent-soft px-1.5 py-0.5 text-[10px] text-ds-ink">
          {t('nodeGraphSelected')}
        </span>
      </div>

      {selected.subtitle ? (
        <p className="line-clamp-3 text-[11.5px] leading-4 text-ds-muted">{selected.subtitle}</p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px]">
        <Property label={t('nodeGraphPropKind')} value={t(NODE_GRAPH_KIND_LABEL_KEYS[selected.kind])} />
        {selected.state ? <Property label={t('nodeGraphPropState')} value={selected.state} /> : null}
        {selected.workspace ? (
          <Property label={t('nodeGraphPropWorkspace')} value={selected.workspace} mono />
        ) : null}
        {selected.path ? (
          <Property
            label={t('nodeGraphPropPath')}
            value={selected.path}
            mono
            action={
              <button
                type="button"
                onClick={() => copyPath(selected.path!)}
                title={copied ? t('nodeGraphCopyPathDone') : t('nodeGraphCopyPath')}
                aria-label={t('nodeGraphCopyPath')}
                className="shrink-0 rounded p-0.5 text-ds-faint transition-colors hover:bg-ds-hover hover:text-ds-ink"
              >
                <Copy className="h-3 w-3" strokeWidth={1.9} />
              </button>
            }
          />
        ) : null}
        {typeof selected.sizeBytes === 'number' ? (
          <Property label={t('nodeGraphPropSize')} value={formatBytes(selected.sizeBytes)} />
        ) : null}
        {selected.createdAt ? (
          <Property label={t('nodeGraphPropCreated')} value={formatMoment(selected.createdAt)} />
        ) : null}
        {selected.updatedAt ? (
          <Property label={t('nodeGraphPropUpdated')} value={formatMoment(selected.updatedAt)} />
        ) : null}
        <Property
          label={t('nodeGraphPropConnections')}
          value={t('nodeGraphConnectionsTotal', { count: totalConnections })}
        />
      </dl>

      <div className="flex flex-wrap gap-1">
        {selected.threadId && onOpenThread ? (
          <Action
            icon={<MessageSquare className="h-3 w-3" strokeWidth={1.9} />}
            label={t('nodeGraphOpenThread')}
            onClick={() => onOpenThread(selected.threadId!)}
          />
        ) : null}
        <Action
          icon={<Crosshair className="h-3 w-3" strokeWidth={1.9} />}
          label={t('nodeGraphFocusLocal')}
          onClick={() => onFocusNode(selected.id)}
        />
        <Action
          icon={<Route className="h-3 w-3" strokeWidth={1.9} />}
          label={t('nodeGraphMenuPathStart')}
          onClick={() => onPathFrom(selected.id)}
        />
      </div>

      {groups.map((group) => {
        const key = `${group.kind}:${group.outgoing}`
        const open = expanded[key] ?? group.nodes.length <= PREVIEW_ROWS
        const shown = open ? group.nodes : group.nodes.slice(0, PREVIEW_ROWS)
        const labelKey = (group.outgoing ? OUTGOING_EDGE_LABEL_KEYS : INCOMING_EDGE_LABEL_KEYS)[group.kind]
        return (
          <section key={key} className="rounded-control border border-ds-border-muted">
            <button
              type="button"
              onClick={() => setExpanded((current) => ({ ...current, [key]: !open }))}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-ds-hover"
            >
              {open
                ? <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
                : <ChevronRight className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />}
              <span className="shrink-0 text-[10.5px] uppercase tracking-wide text-ds-faint">
                {group.outgoing ? '→' : '←'} {t(labelKey)}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-[10.5px] text-ds-faint">
                {group.nodes.length}
              </span>
            </button>
            <ul className="flex flex-col gap-0.5 px-1 pb-1">
              {shown.map((node, position) => (
                <li key={`${node.id}-${position}`}>
                  <button
                    type="button"
                    onClick={() => onSelectNode(node.id)}
                    onDoubleClick={() => onFocusNode(node.id)}
                    className="flex w-full items-center gap-1.5 rounded-control px-1 py-0.5 text-left transition-colors hover:bg-ds-hover"
                  >
                    <NodeGraphKindGlyph kind={node.kind} size={12} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ds-ink">
                      {node.label}
                    </span>
                  </button>
                </li>
              ))}
              {!open && group.nodes.length > PREVIEW_ROWS ? (
                <li className="px-1 pb-0.5">
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [key]: true }))}
                    className="text-[11px] text-accent transition-colors hover:underline"
                  >
                    {t('nodeGraphViewAll')} ({group.nodes.length - PREVIEW_ROWS})
                  </button>
                </li>
              ) : null}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Property({
  label,
  value,
  mono,
  action
}: {
  label: string
  value: string
  mono?: boolean
  action?: ReactElement
}): ReactElement {
  return (
    <>
      <dt className="whitespace-nowrap text-ds-faint">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className={`min-w-0 truncate text-ds-ink ${mono ? 'font-mono text-[11px]' : ''}`}>
          {value}
        </span>
        {action}
      </dd>
    </>
  )
}

function Action({
  icon,
  label,
  onClick
}: {
  icon: ReactElement
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-control border border-ds-border-muted px-1.5 py-0.5 text-[11px] text-ds-muted transition-colors hover:border-accent hover:text-ds-ink"
    >
      {icon}
      {label}
    </button>
  )
}
