import { lazy, Suspense, type ReactElement, type ReactNode } from 'react'
import { WorkbenchConversationStage, type WorkbenchConversationStageProps } from './WorkbenchConversationStage'
import { normalizeWorkbenchRoute } from './workbench-route'

const PluginMarketplaceView = lazy(() =>
  import('../PluginMarketplaceView').then((module) => ({ default: module.PluginMarketplaceView }))
)
const ScheduleTasksView = lazy(() =>
  import('../schedule/ScheduleTasksView').then((module) => ({ default: module.ScheduleTasksView }))
)
const ProjectBoardView = lazy(() =>
  import('../project-board/ProjectBoardView').then((module) => ({ default: module.ProjectBoardView }))
)
const WorkflowView = lazy(() =>
  import('../workflow/WorkflowView').then((module) => ({ default: module.WorkflowView }))
)
const WorkflowRunPanel = lazy(() =>
  import('../workflow/WorkflowRunPanel').then((module) => ({ default: module.WorkflowRunPanel }))
)
const WriteWorkspaceView = lazy(() =>
  import('../write/WriteWorkspaceView').then((module) => ({ default: module.WriteWorkspaceView }))
)
const ExtensionManagementCenter = lazy(() =>
  import('../../extensions/ExtensionManagementCenter').then((module) => ({
    default: module.ExtensionManagementCenter
  }))
)

type WriteStageProps = {
  runtimeBanner: ReactNode
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  onOpenAgentSettings?: () => void
  rightPanel: ReactNode
}

export type WorkbenchStageRouterProps = {
  route: string
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenThread: (threadId: string) => void
  onConnectWeixin?: () => void
  write: WriteStageProps
  conversation: WorkbenchConversationStageProps
  imageAnnotationHost: ReactNode
  planOverlay: ReactNode
  extensions: {
    workspaceRoot: string
    onOpenIntegrations: () => void
    onOpenView: (contributionId: string) => Promise<void>
  }
}

function WorkbenchPaneFallback(): ReactElement {
  return <div className="h-full min-h-0 w-full bg-ds-main" aria-hidden />
}

export function WorkbenchStageRouter({
  route,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenThread,
  onConnectWeixin = () => undefined,
  write,
  conversation,
  imageAnnotationHost,
  planOverlay,
  extensions
}: WorkbenchStageRouterProps): ReactElement {
  const normalizedRoute = normalizeWorkbenchRoute(route)
  return (
    <main
      className={`ds-drag ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
        normalizedRoute === 'plugins' ? 'px-0' : ''
      }`}
    >
      <div className="ds-stage-route-host relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {normalizedRoute === 'extensions' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <ExtensionManagementCenter
              key={extensions.workspaceRoot || '__global__'}
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
              workspaceRoot={extensions.workspaceRoot}
              onOpenIntegrations={extensions.onOpenIntegrations}
              onOpenView={extensions.onOpenView}
            />
          </Suspense>
        ) : normalizedRoute === 'plugins' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <PluginMarketplaceView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
            />
          </Suspense>
        ) : normalizedRoute === 'schedule' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <ScheduleTasksView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
              onOpenThread={onOpenThread}
              onConnectWeixin={onConnectWeixin}
            />
          </Suspense>
        ) : normalizedRoute === 'board' ? (
          <Suspense fallback={<WorkbenchPaneFallback />}>
            <ProjectBoardView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
            />
          </Suspense>
        ) : normalizedRoute === 'workflow' ? (
          <Suspense fallback={<div className="h-full bg-ds-main" />}>
            <WorkflowView
              leftSidebarCollapsed={leftSidebarCollapsed}
              onToggleLeftSidebar={onToggleLeftSidebar}
              onOpenThread={onOpenThread}
            />
          </Suspense>
        ) : normalizedRoute === 'write' ? (
          <Suspense fallback={<WorkbenchPaneFallback />}>
            {write.runtimeBanner}
            <div className="flex min-h-0 flex-1">
              <WriteWorkspaceView
                leftSidebarCollapsed={write.leftSidebarCollapsed}
                onToggleLeftSidebar={write.onToggleLeftSidebar}
                input={write.input}
                setInput={write.setInput}
                onSubmitPrompt={write.onSubmitPrompt}
                onOpenAgentSettings={write.onOpenAgentSettings}
              />
              {write.rightPanel}
            </div>
          </Suspense>
        ) : (
          <WorkbenchConversationStage {...conversation} route={normalizedRoute} />
        )}
      </div>
      {imageAnnotationHost}
      {planOverlay}
      {normalizedRoute === 'chat' ? (
        <Suspense fallback={null}>
          <WorkflowRunPanel enabled />
        </Suspense>
      ) : null}
    </main>
  )
}
