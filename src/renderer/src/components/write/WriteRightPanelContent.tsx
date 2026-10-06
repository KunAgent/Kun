import { lazy, Suspense, useEffect, useState, type ComponentProps, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import type { WriteRightPanelId } from '../../write/write-right-panel-state'
import { WriteRightPanelHeader } from './WriteRightPanelHeader'

const WriteAssistantPanel = lazy(() =>
  import('./WriteAssistantPanel').then((module) => ({ default: module.WriteAssistantPanel }))
)
const WriteOutlinePanel = lazy(() =>
  import('./WriteOutlinePanel').then((module) => ({ default: module.WriteOutlinePanel }))
)
const WriteReviewPanel = lazy(() =>
  import('./WriteReviewPanel').then((module) => ({ default: module.WriteReviewPanel }))
)
const WriteReferencesPanel = lazy(() =>
  import('./WriteReferencesPanel').then((module) => ({ default: module.WriteReferencesPanel }))
)
const WriteHistoryPanel = lazy(() =>
  import('./WriteHistoryPanel').then((module) => ({ default: module.WriteHistoryPanel }))
)
const SubagentDetailPanel = lazy(() =>
  import('../subagents/SubagentDetailPanel').then((module) => ({ default: module.SubagentDetailPanel }))
)
const McpSkillsPanel = lazy(() =>
  import('../workbench/McpSkillsPanel').then((module) => ({ default: module.McpSkillsPanel }))
)
const UsageQuotaPanel = lazy(() =>
  import('../workbench/UsageQuotaPanel').then((module) => ({ default: module.UsageQuotaPanel }))
)

type WriteAssistantPanelProps = Omit<ComponentProps<typeof WriteAssistantPanel>, 'className'>

export type WriteRightPanelContentProps = {
  write: WriteAssistantPanelProps
  onOpenAgentSettings: () => void
  onCollapse: () => void
}

/**
 * Switches the Work right panel by the active rail tool. Visited panels stay
 * mounted (hidden) so the assistant keeps its scroll position and drafts.
 */
export function WriteRightPanelContent({
  write,
  onOpenAgentSettings,
  onCollapse
}: WriteRightPanelContentProps): ReactElement {
  const { activeId, workspaceRoot } = useWriteWorkspaceStore(useShallow((state) => ({
    activeId: state.writeRightPanel.activeId,
    workspaceRoot: state.workspaceRoot
  })))
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const [visited, setVisited] = useState<Set<WriteRightPanelId>>(() => new Set([activeId]))

  useEffect(() => {
    setVisited((current) => current.has(activeId) ? current : new Set([...current, activeId]))
  }, [activeId])

  const renderPanel = (id: WriteRightPanelId): ReactElement => {
    switch (id) {
      case 'assistant':
        return <WriteAssistantPanel {...write} className="h-full max-h-full w-full" />
      case 'outline':
        return <WriteOutlinePanel onCollapse={onCollapse} />
      case 'review':
        return <WriteReviewPanel onCollapse={onCollapse} />
      case 'references':
        return <WriteReferencesPanel onCollapse={onCollapse} />
      case 'history':
        return (
          <WriteHistoryPanel busy={write.busy} onNewConversation={write.onNewConversation} onCollapse={onCollapse} />
        )
      case 'subagents':
        return <SubagentDetailPanel className="h-full max-h-full w-full" onCollapse={onCollapse} />
      case 'mcpSkills':
        return (
          <div className="flex h-full min-h-0 flex-col">
            <WriteRightPanelHeader id="mcpSkills" onCollapse={onCollapse} />
            <div className="relative min-h-0 flex-1">
              <McpSkillsPanel workspaceRoot={workspaceRoot} onOpenSettings={onOpenAgentSettings} />
            </div>
          </div>
        )
      case 'usage':
        return (
          <div className="flex h-full min-h-0 flex-col">
            <WriteRightPanelHeader id="usage" onCollapse={onCollapse} />
            <div className="relative min-h-0 flex-1">
              <UsageQuotaPanel activeThreadId={activeThreadId} active={activeId === 'usage'} />
            </div>
          </div>
        )
    }
  }

  return (
    <div className="write-right-panel relative h-full min-h-0 w-full">
      <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
        {[...visited].map((id) => (
          <div key={id} hidden={id !== activeId} className="absolute inset-0 min-h-0 overflow-hidden"
            data-write-right-panel={id}>
            {renderPanel(id)}
          </div>
        ))}
      </Suspense>
    </div>
  )
}
