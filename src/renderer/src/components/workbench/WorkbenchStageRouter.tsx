import { lazy, Suspense, useMemo, type ReactElement, type ReactNode } from 'react'
import { WorkbenchConversationStage, type WorkbenchConversationStageProps } from './WorkbenchConversationStage'
import { normalizeWorkbenchRoute } from './workbench-route'
import { PaperNoticeToast } from '../paper/PaperNoticeToast'
import { WriteSideRail } from '../write/WriteSideRail'
import { useRemoteMobileLayout } from '../../lib/remote-mobile'
import { useWorkAssistantSwapped, useWorkConversationStage, WorkStageChromeContext } from '../../write/work-conversation-stage'
import { useAgentChatPicker } from '../rooms/agent-chat-picker'
import { closeAddAssistantDialog, openAssistantConversation, useAssistantNavigationStore } from '../assistants/assistant-navigation'
import { closeWardrobePage } from '../wardrobe/wardrobe-route'

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
const WorkPaperHost = lazy(() =>
  import('../write/WorkPaperHost').then((module) => ({ default: module.WorkPaperHost }))
)
const AgentChatStage = lazy(() =>
  import('../rooms/AgentChatStage').then((module) => ({ default: module.AgentChatStage }))
)
const AgentChatPickerHost = lazy(() =>
  import('../rooms/AgentChatPickerHost').then((module) => ({ default: module.AgentChatPickerHost }))
)
const AddAssistantDialog = lazy(() =>
  import('../assistants/AddAssistantDialog').then((module) => ({ default: module.AddAssistantDialog }))
)
const WardrobePageView = lazy(() =>
  import('../wardrobe/WardrobePageView').then((module) => ({ default: module.WardrobePageView }))
)
const ArtifactsPage = lazy(() =>
  import('../../artifacts/ArtifactsPage').then((module) => ({ default: module.ArtifactsPage }))
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
  /** Attach a base64 image to the composer (paper reader region capture). */
  onAttachImage?: (input: { dataBase64: string; name: string }) => Promise<boolean>
  onOpenAgentSettings?: () => void
  rightPanel: ReactNode
}

export type WorkbenchStageRouterProps = {
  route: string
  adeDraftOpen: boolean
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenThread: (threadId: string, turnId?: string) => Promise<void> | void
  onConnectWeixin?: () => void
  onOpenPlugins?: () => void
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

/**
 * Work stage: one space, one set of tabs. Documents, whiteboards, the paper
 * library, discover pages and readers all open in the editor groups; with
 * nothing open the assistant fills the center instead.
 */
function WriteStage({ write }: { write: WriteStageProps }): ReactElement {
  // The Work rail sits right of the panel; phone-sized remote layouts keep the
  // tab-bar assistant toggle instead.
  const remoteMobile = useRemoteMobileLayout()
  const rightPanel = <>{write.rightPanel}{remoteMobile ? null : <WriteSideRail />}</>
  const conversationStage = useWorkConversationStage()
  const swapped = useWorkAssistantSwapped()
  const chrome = useMemo(() => ({
    leftSidebarCollapsed: write.leftSidebarCollapsed,
    onToggleLeftSidebar: write.onToggleLeftSidebar
  }), [write.leftSidebarCollapsed, write.onToggleLeftSidebar])
  return (
    <WorkStageChromeContext.Provider value={chrome}>
      <WorkPaperHost
        leftSidebarCollapsed={write.leftSidebarCollapsed}
        onToggleLeftSidebar={write.onToggleLeftSidebar}
        input={write.input}
        setInput={write.setInput}
        onSubmitPrompt={write.onSubmitPrompt}
        onAttachImage={write.onAttachImage}
        conversationStage={conversationStage}
        swapped={swapped}
        rightPanel={rightPanel}
      >
        {(submitPrompt) => (
          <WriteWorkspaceView
            leftSidebarCollapsed={write.leftSidebarCollapsed}
            onToggleLeftSidebar={write.onToggleLeftSidebar}
            input={write.input}
            setInput={write.setInput}
            onSubmitPrompt={submitPrompt}
            onOpenAgentSettings={write.onOpenAgentSettings}
          />
        )}
      </WorkPaperHost>
    </WorkStageChromeContext.Provider>
  )
}

export function WorkbenchStageRouter({
  route,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenThread,
  onConnectWeixin = () => undefined,
  onOpenPlugins = () => undefined,
  write,
  conversation,
  imageAnnotationHost,
  planOverlay,
  extensions
}: WorkbenchStageRouterProps): ReactElement {
  const normalizedRoute = normalizeWorkbenchRoute(route)
  const agentChatDialogOpen = useAgentChatPicker((state) => state.dialog !== null)
  const addingAssistant = useAssistantNavigationStore((state) => state.connecting)
  return (
    <main
      className={`ds-drag ds-stage-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
        normalizedRoute === 'plugins' ? 'px-0' : ''
      }`}
    >
      <div className="ds-stage-route-host relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {normalizedRoute === 'agent-chat' ? (
          <Suspense fallback={<WorkbenchPaneFallback />}>
            <AgentChatStage onOpenThread={onOpenThread} onOpenPlugins={onOpenPlugins}
              onToggleLeftSidebar={onToggleLeftSidebar} />
          </Suspense>
        ) : normalizedRoute === 'extensions' ? (
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
        ) : normalizedRoute === 'wardrobe' ? (
          <Suspense fallback={<WorkbenchPaneFallback />}>
            <WardrobePageView leftSidebarCollapsed={leftSidebarCollapsed} onToggleLeftSidebar={onToggleLeftSidebar} onClose={closeWardrobePage} />
          </Suspense>
        ) : normalizedRoute === 'artifacts' ? (
          <Suspense fallback={<WorkbenchPaneFallback />}>
            <ArtifactsPage leftSidebarCollapsed={leftSidebarCollapsed} onToggleLeftSidebar={onToggleLeftSidebar} chat={conversation.chat} />
          </Suspense>
        ) : normalizedRoute === 'write' ? (
          <Suspense fallback={<WorkbenchPaneFallback />}>
            {write.runtimeBanner}
            <WriteStage write={write} />
            <PaperNoticeToast />
          </Suspense>
        ) : (
          <WorkbenchConversationStage {...conversation} route={normalizedRoute} />
        )}
      </div>
      {imageAnnotationHost}
      {planOverlay}
      {agentChatDialogOpen ? <Suspense fallback={null}><AgentChatPickerHost /></Suspense> : null}
      {addingAssistant ? <Suspense fallback={null}><AddAssistantDialog onClose={closeAddAssistantDialog}
        onCreated={(enrollmentId) => {
          closeAddAssistantDialog()
          openAssistantConversation({ kind: 'enrollment', id: enrollmentId })
        }} /></Suspense> : null}
      {normalizedRoute === 'chat' ? (
        <Suspense fallback={null}>
          <WorkflowRunPanel enabled />
        </Suspense>
      ) : null}
    </main>
  )
}
