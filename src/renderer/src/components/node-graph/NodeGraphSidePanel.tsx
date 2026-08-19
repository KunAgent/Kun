import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  NodeGraphCentrality,
  NodeGraphClusters,
  NodeGraphSummary
} from '../../node-graph/node-graph-analysis'
import type { NodeGraphView as GraphView } from '../../node-graph/node-graph-filter'
import type { NodeGraphNode } from '../../node-graph/node-graph-types'
import { NodeGraphInsights } from './NodeGraphInsights'
import { NodeGraphInspector } from './NodeGraphInspector'

export type NodeGraphPanelTab = 'insights' | 'inspector'

type Props = {
  tab: NodeGraphPanelTab
  onTabChange: (tab: NodeGraphPanelTab) => void
  view: GraphView
  summary: NodeGraphSummary
  centrality: NodeGraphCentrality
  clusters: NodeGraphClusters
  nodesById: ReadonlyMap<string, NodeGraphNode>
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
  onFocusNode: (id: string) => void
  onPathFrom: (id: string) => void
  onApplyClusterGroups: () => void
  onOpenThread?: (threadId: string) => void
}

/**
 * Right panel: whole-graph analysis and single-node detail, as two tabs.
 *
 * They were stacked before, which meant the inspector took canvas height even
 * with nothing selected, and insights scrolled away as soon as it did. Tabs keep
 * both at full height and make the trade explicit.
 */
export function NodeGraphSidePanel({
  tab,
  onTabChange,
  view,
  summary,
  centrality,
  clusters,
  nodesById,
  selectedNodeId,
  onSelectNode,
  onFocusNode,
  onPathFrom,
  onApplyClusterGroups,
  onOpenThread
}: Props): ReactElement {
  const { t } = useTranslation('common')
  return (
    <aside className="flex h-full min-h-0 w-[330px] shrink-0 flex-col border-l border-ds-border-muted bg-ds-card">
      <div role="tablist" className="flex shrink-0 border-b border-ds-border-muted">
        {(['insights', 'inspector'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={tab === candidate}
            onClick={() => onTabChange(candidate)}
            className={`relative flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
              tab === candidate
                ? 'text-ds-ink'
                : 'text-ds-faint hover:text-ds-muted'
            }`}
          >
            {candidate === 'insights' ? t('nodeGraphTabInsights') : t('nodeGraphTabInspector')}
            {/* The underline marks the active tab without shifting layout. */}
            <span
              aria-hidden
              className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full ${
                tab === candidate ? 'bg-accent' : 'bg-transparent'
              }`}
            />
          </button>
        ))}
      </div>

      {tab === 'insights' ? (
        <NodeGraphInsights
          summary={summary}
          centrality={centrality}
          clusters={clusters}
          nodesById={nodesById}
          onSelectNode={onSelectNode}
          onFocusNode={onFocusNode}
          onApplyClusterGroups={onApplyClusterGroups}
        />
      ) : (
        <NodeGraphInspector
          view={view}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          onFocusNode={onFocusNode}
          onPathFrom={onPathFrom}
          {...(onOpenThread ? { onOpenThread } : {})}
        />
      )}
    </aside>
  )
}
