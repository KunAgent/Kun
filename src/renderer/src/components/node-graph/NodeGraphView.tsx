import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { Network, Route, TriangleAlert, X } from 'lucide-react'
import {
  buildAdjacency,
  computeCentrality,
  computeClusters,
  findShortestPath,
  summarizeGraph
} from '../../node-graph/node-graph-analysis'
import { buildNodeGraphView, neighborIds } from '../../node-graph/node-graph-filter'
import { useNodeGraphStore } from '../../node-graph/node-graph-store'
import { useNodeGraphAutoRefresh } from '../../node-graph/use-node-graph-auto-refresh'
import type { NodeGraphEdgeKind, NodeGraphNodeKind } from '../../node-graph/node-graph-types'
import { NodeGraphCanvas, type NodeGraphCanvasHandle } from './NodeGraphCanvas'
import { NodeGraphContextMenu, type NodeGraphContextMenuState } from './NodeGraphContextMenu'
import { NodeGraphControls } from './NodeGraphControls'
import { NodeGraphMinimap } from './NodeGraphMinimap'
import { NodeGraphSidePanel, type NodeGraphPanelTab } from './NodeGraphSidePanel'
import { NodeGraphTopBar } from './NodeGraphTopBar'
import { NodeGraphZoomBar } from './NodeGraphZoomBar'
import { NODE_GRAPH_KIND_LABEL_KEYS } from './node-graph-theme'
import type { NodeGraphCamera } from './node-graph-paint'

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  workspaceRoot: string
  source?:
    | { kind: 'folder'; roots: readonly string[]; allRoots?: readonly string[] }
    | { kind: 'workspace' }
  embedded?: boolean
  onClose?: () => void
  onOpenThread?: (threadId: string) => void
}

const EDGE_LABEL_KEYS: Record<NodeGraphEdgeKind, string> = {
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

export function NodeGraphView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  workspaceRoot,
  source = { kind: 'workspace' },
  embedded = false,
  onClose,
  onOpenThread
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const projection = useNodeGraphStore((state) => state.projection)
  const status = useNodeGraphStore((state) => state.status)
  const error = useNodeGraphStore((state) => state.error)
  const settings = useNodeGraphStore((state) => state.settings)
  const selectedNodeId = useNodeGraphStore((state) => state.selectedNodeId)
  const focusNodeId = useNodeGraphStore((state) => state.focusNodeId)
  const load = useNodeGraphStore((state) => state.load)
  const loadFolder = useNodeGraphStore((state) => state.loadFolder)
  const reload = useNodeGraphStore((state) => state.reload)
  const patchSettings = useNodeGraphStore((state) => state.patchSettings)
  const toggleKind = useNodeGraphStore((state) => state.toggleKind)
  const resetSettings = useNodeGraphStore((state) => state.resetSettings)
  const addGroup = useNodeGraphStore((state) => state.addGroup)
  const updateGroup = useNodeGraphStore((state) => state.updateGroup)
  const removeGroup = useNodeGraphStore((state) => state.removeGroup)
  const selectNode = useNodeGraphStore((state) => state.selectNode)
  const focusNode = useNodeGraphStore((state) => state.focusNode)
  const setPathEndpoint = useNodeGraphStore((state) => state.setPathEndpoint)
  const clearPath = useNodeGraphStore((state) => state.clearPath)
  const pathFrom = useNodeGraphStore((state) => state.pathFrom)
  const pathTo = useNodeGraphStore((state) => state.pathTo)
  const applyClusterGroups = useNodeGraphStore((state) => state.applyClusterGroups)

  const canvasRef = useRef<NodeGraphCanvasHandle | null>(null)
  const [paused, setPaused] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<NodeGraphPanelTab>('insights')
  const [scopeAll, setScopeAll] = useState(true)
  const [camera, setCamera] = useState<NodeGraphCamera>({ x: 0, y: 0, scale: 1 })
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [contextMenu, setContextMenu] = useState<NodeGraphContextMenuState | null>(null)

  const folderMode = source.kind === 'folder'
  const folderRoots = useMemo(() => {
    if (source.kind !== 'folder') return []
    const all = source.allRoots ?? source.roots
    return scopeAll ? [...all] : [...source.roots]
  }, [scopeAll, source])
  const folderRootsKey = folderRoots.join('\u0000')
  const scopedWorkspace = scopeAll ? '' : workspaceRoot

  useEffect(() => {
    if (folderMode) {
      if (folderRoots.length > 0) void loadFolder(folderRoots)
      return
    }
    void load({ workspace: scopedWorkspace })
    // folderRootsKey stands in for the array identity so a re-render with the
    // same roots does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderMode, folderRootsKey, load, loadFolder, scopedWorkspace])

  const autoRefresh = useCallback(() => {
    if (useNodeGraphStore.getState().status === 'loading') return
    void reload({ refresh: true, background: true })
  }, [reload])
  useNodeGraphAutoRefresh({ enabled: folderMode, onRefresh: autoRefresh })

  // The visible subgraph — and the PageRank/cluster analysis hanging off it —
  // depends only on the filter settings. Depending on the whole settings
  // object recomputed all of it for every display or physics slider tick.
  // Search is deferred so typing stays responsive on large graphs: keystrokes
  // land immediately, the heavy recompute follows at deferred priority.
  const search = useDeferredValue(settings.search)
  const { kinds, minDegree, showOrphans, localDepth, groups } = settings
  const view = useMemo(
    () => buildNodeGraphView({
      projection,
      settings: { search, kinds, minDegree, showOrphans, localDepth, groups },
      focusNodeId
    }),
    [focusNodeId, groups, kinds, localDepth, minDegree, projection, search, showOrphans]
  )
  const nodesById = useMemo(
    () => new Map(view.nodes.map((node) => [node.id, node])),
    [view.nodes]
  )
  const focusedLabel = useMemo(
    () => projection.nodes.find((node) => node.id === focusNodeId)?.label ?? null,
    [focusNodeId, projection.nodes]
  )
  const adjacency = useMemo(() => buildAdjacency(view.nodes, view.edges), [view.nodes, view.edges])
  const centrality = useMemo(() => computeCentrality(adjacency), [adjacency])
  const clusters = useMemo(() => computeClusters(adjacency), [adjacency])
  const summary = useMemo(
    () => summarizeGraph(view.nodes, view.edges, adjacency, clusters),
    [adjacency, clusters, view.edges, view.nodes]
  )
  const path = useMemo(
    () => (pathFrom && pathTo ? findShortestPath(adjacency, view.edges, pathFrom, pathTo) : null),
    [adjacency, pathFrom, pathTo, view.edges]
  )
  const pathNodeIds = useMemo(() => new Set(path?.nodeIds ?? []), [path])
  const pathEdgeIds = useMemo(() => new Set(path?.edgeIds ?? []), [path])

  const kindLabel = useCallback(
    (kind: NodeGraphNodeKind) => t(NODE_GRAPH_KIND_LABEL_KEYS[kind]),
    [t]
  )
  const edgeLabel = useCallback((kind: NodeGraphEdgeKind) => t(EDGE_LABEL_KEYS[kind]), [t])

  const onFocusNode = useCallback(
    (id: string) => focusNode(focusNodeId === id ? null : id),
    [focusNode, focusNodeId]
  )
  // Selecting a node is what the inspector is for, so it comes forward.
  const onSelectNode = useCallback(
    (id: string | null) => {
      selectNode(id)
      if (id) setPanelTab('inspector')
    },
    [selectNode]
  )

  const exportPng = useCallback(async (): Promise<void> => {
    const blob = await canvasRef.current?.exportPng()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `node-graph-${Date.now().toString(36)}.png`
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const onNodeContextMenu = useCallback(
    (id: string, position: { x: number; y: number }) => {
      const node = projection.nodes.find((candidate) => candidate.id === id)
      if (node) setContextMenu({ node, x: position.x, y: position.y })
    },
    [projection.nodes]
  )

  useEffect(() => {
    if (!contextMenu) return
    if (!view.nodes.some((node) => node.id === contextMenu.node.id)) setContextMenu(null)
  }, [contextMenu, view.nodes])

  const menuConnected = useMemo(
    () => (contextMenu ? [...neighborIds(view.edges, contextMenu.node.id)] : []),
    [contextMenu, view.edges]
  )
  const menuTargets = useCallback(
    (includeConnected: boolean): string[] =>
      contextMenu
        ? includeConnected ? [contextMenu.node.id, ...menuConnected] : [contextMenu.node.id]
        : [],
    [contextMenu, menuConnected]
  )
  const assignNodesToGroup = useNodeGraphStore((state) => state.assignNodesToGroup)
  const clearNodesGroup = useNodeGraphStore((state) => state.clearNodesGroup)
  const createGroupForNodes = useNodeGraphStore((state) => state.createGroupForNodes)
  const colorNodes = useNodeGraphStore((state) => state.colorNodes)

  const loading = status === 'loading' && projection.nodes.length === 0
  const empty = status === 'ready' && projection.nodes.length === 0
  const filteredEmpty = status === 'ready' && projection.nodes.length > 0 && view.nodes.length === 0
  const stats = `${t('nodeGraphStats', { nodes: view.nodes.length, links: view.edges.length })}${
    view.hiddenCount > 0 ? ` · ${t('nodeGraphHiddenCount', { count: view.hiddenCount })}` : ''
  }`

  return (
    <div className="ds-no-drag flex h-full min-h-0 w-full flex-col bg-ds-main">
      <NodeGraphTopBar
        search={settings.search}
        onSearchChange={(value) => patchSettings({ search: value })}
        scopeLabel={scopeAll
          ? (folderMode ? t('nodeGraphScopeAllWork') : t('nodeGraphScopeAll'))
          : t('nodeGraphScopeWorkspace')}
        onCycleScope={() => setScopeAll((current) => !current)}
        scopeTitle={t('nodeGraphScope')}
        loading={status === 'loading'}
        stats={stats}
        onRefresh={() => void reload({ refresh: true })}
        onFit={() => canvasRef.current?.fitToView()}
        onExport={() => void exportPng()}
        controlsOpen={controlsOpen}
        onToggleControls={() => setControlsOpen((current) => !current)}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen((current) => !current)}
        {...(onClose ? { onClose } : {})}
        {...(embedded
          ? {}
          : { onToggleAppSidebar: onToggleLeftSidebar, appSidebarCollapsed: leftSidebarCollapsed })}
      />

      {path ? (
        <p className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted bg-accent-soft px-3 py-1 text-[11.5px] text-ds-ink">
          <Route className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="min-w-0 flex-1 truncate">
            {path.hops === null
              ? t('nodeGraphPathNone', {
                  from: nodesById.get(pathFrom ?? '')?.label ?? '',
                  to: nodesById.get(pathTo ?? '')?.label ?? ''
                })
              : t('nodeGraphPathFound', {
                  count: path.hops,
                  trail: path.nodeIds.map((id) => nodesById.get(id)?.label ?? id).join('  →  ')
                })}
          </span>
          <button
            type="button"
            onClick={clearPath}
            aria-label={t('nodeGraphPathClear')}
            className="shrink-0 rounded-control p-0.5 text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        </p>
      ) : pathFrom ? (
        <p className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted bg-ds-subtle px-3 py-1 text-[11.5px] text-ds-muted">
          <Route className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          {t('nodeGraphPathPending', { from: nodesById.get(pathFrom)?.label ?? '' })}
          <button
            type="button"
            onClick={clearPath}
            aria-label={t('nodeGraphPathClear')}
            className="ml-auto shrink-0 rounded-control p-0.5 text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        </p>
      ) : null}

      {projection.truncated ? (
        <p className="flex shrink-0 items-center gap-1.5 border-b border-ds-border-muted bg-ds-subtle px-3 py-1 text-[11.5px] text-ds-muted">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          {t('nodeGraphTruncated')}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {controlsOpen ? (
          <NodeGraphControls
            settings={settings}
            counts={projection.counts}
            focusedLabel={focusedLabel}
            folderMode={folderMode}
            onPatch={patchSettings}
            onToggleKind={toggleKind}
            onAddGroup={() => void addGroup()}
            onUpdateGroup={updateGroup}
            onRemoveGroup={removeGroup}
            onReset={resetSettings}
            onExitLocalGraph={() => focusNode(null)}
          />
        ) : null}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {status === 'error' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <TriangleAlert className="h-6 w-6 text-ds-danger" strokeWidth={1.5} />
              <p className="text-[13px] text-ds-ink">{t('nodeGraphError')}</p>
              {error ? <p className="max-w-md text-[11.5px] text-ds-faint">{error}</p> : null}
              <button
                type="button"
                onClick={() => void reload({ refresh: true })}
                className="mt-1 rounded-control border border-ds-border-muted px-2.5 py-1 text-[12px] text-ds-muted transition-colors hover:border-accent hover:text-ds-ink"
              >
                {t('nodeGraphRetry')}
              </button>
            </div>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center">
              <span className="flex items-center gap-2 rounded-pill border border-ds-border-muted bg-ds-card px-3 py-1.5 text-[12.5px] text-ds-muted">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
                {t('nodeGraphLoading')}
              </span>
            </div>
          ) : empty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <Network className="h-7 w-7 text-ds-faint" strokeWidth={1.5} />
              <p className="text-[13px] text-ds-ink">{t('nodeGraphEmpty')}</p>
              <p className="max-w-sm text-[11.5px] leading-5 text-ds-faint">
                {folderMode ? t('nodeGraphFolderEmptyHint') : t('nodeGraphEmptyHint')}
              </p>
            </div>
          ) : (
            <>
              <NodeGraphCanvas
                view={view}
                settings={settings}
                selectedNodeId={selectedNodeId}
                onSelectNode={onSelectNode}
                onFocusNode={onFocusNode}
                onNodeContextMenu={onNodeContextMenu}
                pathNodeIds={pathNodeIds}
                pathEdgeIds={pathEdgeIds}
                paused={paused}
                kindLabel={kindLabel}
                edgeLabel={edgeLabel}
                onCameraChange={setCamera}
                onViewportChange={setViewport}
                ariaLabel={t('nodeGraphCanvasLabel')}
                ref={canvasRef}
              />
              {filteredEmpty ? (
                <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-[12.5px] text-ds-faint">
                  {t('nodeGraphFilteredEmpty')}
                </p>
              ) : null}
              {settings.showMinimap ? (
                <div className="pointer-events-auto absolute bottom-3 left-3">
                  <NodeGraphMinimap
                    view={view}
                    positions={() => canvasRef.current?.positions() ?? []}
                    camera={camera}
                    viewport={viewport}
                    onNavigate={(world) => canvasRef.current?.centerOn(world)}
                  />
                </div>
              ) : null}
              <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2">
                <NodeGraphZoomBar
                  scale={camera.scale}
                  paused={paused}
                  onZoom={(factor) => canvasRef.current?.zoomBy(factor)}
                  onResetZoom={() => canvasRef.current?.setScale(1)}
                  onTogglePaused={() => setPaused((current) => !current)}
                />
              </div>
            </>
          )}
          {projection.diagnostics.length > 0 ? (
            <details className="shrink-0 border-t border-ds-border-muted bg-ds-card px-3 py-1.5">
              <summary className="cursor-pointer text-[10.5px] uppercase tracking-wide text-ds-faint">
                {t('nodeGraphDiagnostics')} ({projection.diagnostics.length})
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {projection.diagnostics.map((note) => (
                  <li key={note} className="text-[11px] leading-4 text-ds-muted">{note}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {panelOpen ? (
          <NodeGraphSidePanel
            tab={panelTab}
            onTabChange={setPanelTab}
            view={view}
            summary={summary}
            centrality={centrality}
            clusters={clusters}
            nodesById={nodesById}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onFocusNode={onFocusNode}
            onPathFrom={(id) => setPathEndpoint('from', id)}
            onApplyClusterGroups={() => applyClusterGroups(clusters.clusters)}
            {...(onOpenThread ? { onOpenThread } : {})}
          />
        ) : null}
      </div>

      {contextMenu ? (
        <NodeGraphContextMenu
          state={contextMenu}
          groups={settings.groups}
          connectedCount={menuConnected.length}
          onClose={() => setContextMenu(null)}
          onColorNode={(color, includeConnected) =>
            colorNodes(menuTargets(includeConnected), color)}
          onAssignGroup={(groupId, includeConnected) =>
            assignNodesToGroup(menuTargets(includeConnected), groupId)}
          onCreateGroup={(includeConnected) =>
            createGroupForNodes(menuTargets(includeConnected), contextMenu.node.label)}
          onClearGroup={(includeConnected) => clearNodesGroup(menuTargets(includeConnected))}
          onFocusNode={() => onFocusNode(contextMenu.node.id)}
          onPathStart={() => setPathEndpoint('from', contextMenu.node.id)}
          onPathEnd={() => setPathEndpoint('to', contextMenu.node.id)}
          pathStartActive={pathFrom === contextMenu.node.id}
          {...(onOpenThread && contextMenu.node.threadId
            ? { onOpenThread: () => onOpenThread(contextMenu.node.threadId!) }
            : {})}
        />
      ) : null}
    </div>
  )
}
