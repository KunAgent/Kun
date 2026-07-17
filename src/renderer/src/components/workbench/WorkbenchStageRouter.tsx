import { lazy, Suspense, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { WorkbenchDesignStage } from './WorkbenchDesignStage'
import { WorkbenchConversationStage, type WorkbenchConversationStageProps } from './WorkbenchConversationStage'
import { CollaborationStage } from '../../collaboration/CollaborationStage'

const PluginMarketplaceView = lazy(() =>
  import('../PluginMarketplaceView').then((module) => ({ default: module.PluginMarketplaceView }))
)
const ScheduleTasksView = lazy(() =>
  import('../schedule/ScheduleTasksView').then((module) => ({ default: module.ScheduleTasksView }))
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
const ExtensionFeaturesView = lazy(() =>
  import('../../seam/ExtensionFeaturesView').then((module) => ({
    default: module.ExtensionFeaturesView
  }))
)

type DesignStageProps = ComponentProps<typeof WorkbenchDesignStage>

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
  design: DesignStageProps
  write: WriteStageProps
  conversation: WorkbenchConversationStageProps
  imageAnnotationHost: ReactNode
  planOverlay: ReactNode
  extensions: {
    workspaceRoot: string
    onOpenIntegrations: () => void
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
  design,
  write,
  conversation,
  imageAnnotationHost,
  planOverlay,
  extensions
}: WorkbenchStageRouterProps): ReactElement {
  return (
    <main
      className={`ds-drag ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
        route === 'plugins' ? 'px-0' : ''
      }`}
    >
      {route === 'collaboration' ? (
        <CollaborationStage />
      ) : route === 'capabilities' ? (
        <Suspense fallback={<div className="h-full bg-ds-main" />}>
          <ExtensionFeaturesView />
        </Suspense>
      ) : route === 'extensions' ? (
        <Suspense fallback={<div className="h-full bg-ds-main" />}>
          <ExtensionManagementCenter
            leftSidebarCollapsed={leftSidebarCollapsed}
            onToggleLeftSidebar={onToggleLeftSidebar}
            workspaceRoot={extensions.workspaceRoot}
            onOpenIntegrations={extensions.onOpenIntegrations}
          />
        </Suspense>
      ) : route === 'plugins' ? (
        <Suspense fallback={<div className="h-full bg-ds-main" />}>
          <PluginMarketplaceView
            leftSidebarCollapsed={leftSidebarCollapsed}
            onToggleLeftSidebar={onToggleLeftSidebar}
          />
        </Suspense>
      ) : route === 'schedule' ? (
        <Suspense fallback={<div className="h-full bg-ds-main" />}>
          <ScheduleTasksView
            leftSidebarCollapsed={leftSidebarCollapsed}
            onToggleLeftSidebar={onToggleLeftSidebar}
            onOpenThread={onOpenThread}
          />
        </Suspense>
      ) : route === 'workflow' ? (
        <Suspense fallback={<div className="h-full bg-ds-main" />}>
          <WorkflowView
            leftSidebarCollapsed={leftSidebarCollapsed}
            onToggleLeftSidebar={onToggleLeftSidebar}
            onOpenThread={onOpenThread}
          />
        </Suspense>
      ) : route === 'design' ? (
        <WorkbenchDesignStage {...design} />
      ) : route === 'write' ? (
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
        <WorkbenchConversationStage {...conversation} />
      )}
      {imageAnnotationHost}
      {planOverlay}
      {route === 'chat' ? (
        <Suspense fallback={null}>
          <WorkflowRunPanel enabled />
        </Suspense>
      ) : null}
    </main>
  )
}
