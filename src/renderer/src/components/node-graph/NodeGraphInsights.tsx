import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles, Unlink } from 'lucide-react'
import type {
  NodeGraphCentrality,
  NodeGraphClusters,
  NodeGraphSummary
} from '../../node-graph/node-graph-analysis'
import type { NodeGraphNode } from '../../node-graph/node-graph-types'
import { NodeGraphKindGlyph } from './NodeGraphKindLegend'
import { useKunNodeStyle } from '../../node-graph/kun-node-style'
import {
  NodeGraphClusterMark,
  NodeGraphRing,
  NodeGraphSparkline,
  NodeGraphStatCard
} from './NodeGraphStatCards'

type Props = {
  summary: NodeGraphSummary
  centrality: NodeGraphCentrality
  clusters: NodeGraphClusters
  nodesById: ReadonlyMap<string, NodeGraphNode>
  onSelectNode: (id: string) => void
  onFocusNode: (id: string) => void
  onApplyClusterGroups: () => void
}

const TOP_COUNT = 8
const ORPHAN_PREVIEW = 6

/**
 * Read-only analysis of the visible graph: what is central, how it clusters,
 * and what is stranded. PageRank rather than raw degree drives the ranking, so
 * a tie in link count breaks on neighbourhood structure rather than node id.
 */
export function NodeGraphInsights({
  summary,
  centrality,
  clusters,
  nodesById,
  onSelectNode,
  onFocusNode,
  onApplyClusterGroups
}: Props): ReactElement {
  const { t } = useTranslation('common')
  // Colour-by-cluster rewrites the groups, which paint nothing under Kun style.
  const kunStyle = useKunNodeStyle()
  const connected = centrality.ranked.filter((entry) => entry.degree > 0)
  const top = connected.slice(0, TOP_COUNT)
  const orphans = summary.orphanIds.slice(0, ORPHAN_PREVIEW)
  const multiClusters = clusters.clusters.filter((members) => members.length > 1)

  // Degree of the most connected nodes, ascending, so the sparkline shows the
  // shape of the tail rather than an arbitrary ordering.
  const degreeSeries = useMemo(
    () => connected.slice(0, 32).map((entry) => entry.degree).reverse(),
    [connected]
  )

  const nodeCount = Math.max(1, summary.nodeCount)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <NodeGraphStatCard
          label={t('nodeGraphInsightMostConnected')}
          value={String(top[0]?.degree ?? 0)}
          unit={t('nodeGraphInsightLinksUnit')}
          note={top[0] ? nodesById.get(top[0].id)?.label ?? '' : ''}
          mark={<NodeGraphSparkline values={degreeSeries} width={62} />}
        />
        <NodeGraphStatCard
          label={t('nodeGraphInsightClusters')}
          value={String(multiClusters.length)}
          note={t('nodeGraphInsightClustersNote')}
          mark={<NodeGraphClusterMark sizes={multiClusters.map((members) => members.length)} />}
        />
        <NodeGraphStatCard
          label={t('nodeGraphInsightLargest')}
          value={String(summary.largestClusterSize)}
          unit={t('nodeGraphInsightNodesUnit')}
          note={t('nodeGraphInsightShare', {
            percent: Math.round((summary.largestClusterSize / nodeCount) * 100)
          })}
          mark={<NodeGraphRing ratio={summary.largestClusterSize / nodeCount} />}
        />
        <NodeGraphStatCard
          label={t('nodeGraphInsightOrphans')}
          value={String(summary.orphanIds.length)}
          note={t('nodeGraphInsightShare', {
            percent: Math.round((summary.orphanIds.length / nodeCount) * 100)
          })}
          mark={
            <NodeGraphRing
              ratio={summary.orphanIds.length / nodeCount}
              color="var(--ds-danger)"
            />
          }
        />
      </div>

      <NodeGraphStatCard
        label={t('nodeGraphInsightAverageDegree')}
        value={summary.averageDegree.toFixed(1)}
        note={t('nodeGraphInsightAcrossAll')}
        mark={<NodeGraphSparkline values={degreeSeries} width={120} height={28} />}
      />

      {kunStyle ? null : (
        <>
          <button
            type="button"
            onClick={onApplyClusterGroups}
            disabled={multiClusters.length === 0}
            className="flex items-center gap-1.5 rounded-control border border-ds-border-muted px-2 py-1.5 text-[12px] text-ds-muted transition-colors hover:border-accent hover:text-ds-ink disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            {t('nodeGraphInsightColorClusters')}
          </button>
          <p className="text-[10.5px] leading-4 text-ds-faint">
            {t('nodeGraphInsightColorClustersHint')}
          </p>
        </>
      )}

      {top.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-ds-faint">
            {t('nodeGraphInsightMostCentral')}
          </p>
          <ul className="flex flex-col gap-0.5">
            {top.map((entry) => {
              const node = nodesById.get(entry.id)
              if (!node) return null
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNode(entry.id)}
                    onDoubleClick={() => onFocusNode(entry.id)}
                    className="flex w-full items-center gap-1.5 rounded-control px-1 py-0.5 text-left transition-colors hover:bg-ds-hover"
                  >
                    <NodeGraphKindGlyph kind={node.kind} size={12} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ds-ink">
                      {node.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-[11px] text-ds-faint">
                      {entry.degree}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {orphans.length > 0 ? (
        <div>
          <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-ds-faint">
            <Unlink className="h-3 w-3" strokeWidth={1.9} />
            {t('nodeGraphInsightUnlinked')}
          </p>
          <ul className="flex flex-col gap-0.5">
            {orphans.map((id) => {
              const node = nodesById.get(id)
              if (!node) return null
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onSelectNode(id)}
                    className="flex w-full items-center gap-1.5 rounded-control px-1 py-0.5 text-left transition-colors hover:bg-ds-hover"
                  >
                    <NodeGraphKindGlyph kind={node.kind} size={12} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ds-ink">
                      {node.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {summary.orphanIds.length > orphans.length ? (
            <p className="mt-0.5 px-1 text-[10.5px] text-ds-faint">
              {t('nodeGraphInsightMoreOrphans', {
                count: summary.orphanIds.length - orphans.length
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
