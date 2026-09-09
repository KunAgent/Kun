import { lazy, Suspense, useMemo, type ReactElement } from 'react'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'

const NodeGraphView = lazy(() =>
  import('../node-graph/NodeGraphView').then((module) => ({ default: module.NodeGraphView }))
)

type Props = {
  workspaceRoot: string
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onClose: () => void
}

/**
 * The Work tab's graph surface. Renders the same Node Graph canvas as the Code
 * route but sourced from this Write workspace's directory tree, so the nodes
 * are the markdown files themselves, nested by folder and joined by their
 * `[[wikilinks]]`.
 *
 * Lazily imported: the canvas, force simulation, and analysis code should not
 * load with the editor for users who never open the graph.
 */
export function WriteNodeGraphSurface({
  workspaceRoot,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onClose
}: Props): ReactElement {
  const workspaceRoots = useWriteWorkspaceStore((state) => state.workspaceRoots)
  // Every Work workspace is offered as the wider scope, so the header toggle can
  // span them all and links between workspaces resolve into edges.
  const allRoots = useMemo(
    () => [...new Set([workspaceRoot, ...workspaceRoots].filter(Boolean))],
    [workspaceRoot, workspaceRoots]
  )
  return (
    <Suspense fallback={<div className="h-full w-full bg-ds-main" aria-hidden />}>
      <NodeGraphView
        key={workspaceRoot}
        workspaceRoot={workspaceRoot}
        source={{ kind: 'folder', roots: [workspaceRoot], allRoots }}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        onClose={onClose}
      />
    </Suspense>
  )
}
