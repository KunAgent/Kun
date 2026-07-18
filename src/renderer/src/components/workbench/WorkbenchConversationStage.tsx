import { lazy, Suspense, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { WorkbenchSideRail } from '../chat/WorkbenchTopBar'
import { WorkbenchChatStage, type WorkbenchChatStageProps } from './WorkbenchChatStage'

const SddDraftEditorView = lazy(() =>
  import('../sdd/SddDraftEditorView').then((module) => ({ default: module.SddDraftEditorView }))
)

type SddDraftEditorViewProps = ComponentProps<typeof SddDraftEditorView>

export type WorkbenchConversationStageProps = {
  route: string
  runtimeBanner: ReactNode
  activeSddDraft: boolean
  sdd: Pick<
    SddDraftEditorViewProps,
    | 'leftSidebarCollapsed'
    | 'assistantOpen'
    | 'onToggleLeftSidebar'
    | 'onToggleAssistant'
    | 'onAssistantQuote'
    | 'onPrototypeTurn'
    | 'onExploreInDesign'
    | 'onNext'
    | 'onClose'
    | 'nextDisabled'
  >
  chat: WorkbenchChatStageProps
  rightPanel: ReactNode
  sideRail: ComponentProps<typeof WorkbenchSideRail>
}

function WorkbenchPaneFallback(): ReactElement {
  return <div className="h-full min-h-0 w-full bg-ds-main" aria-hidden />
}

export function WorkbenchConversationStage({
  route,
  runtimeBanner,
  activeSddDraft,
  sdd,
  chat,
  rightPanel,
  sideRail
}: WorkbenchConversationStageProps): ReactElement {
  return (
    <>
      {runtimeBanner}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1">
          {activeSddDraft ? (
            <Suspense fallback={<WorkbenchPaneFallback />}>
              <SddDraftEditorView {...sdd} />
            </Suspense>
          ) : (
            <WorkbenchChatStage {...chat} />
          )}
        </div>

        {rightPanel}
        {route === 'chat' && !activeSddDraft ? <WorkbenchSideRail {...sideRail} /> : null}
      </div>
    </>
  )
}
