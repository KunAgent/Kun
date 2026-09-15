import { lazy, Suspense, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { WorkbenchSideRail } from '../chat/WorkbenchTopBar'
import { WorkbenchChatStage, type WorkbenchChatStageProps } from './WorkbenchChatStage'
import { useRemoteMobileLayout } from '../../lib/remote-mobile'

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
  const remoteMobile = useRemoteMobileLayout()
  const [mobileRailOpen, setMobileRailOpen] = useState(false)
  const showRail = route === 'chat' && !activeSddDraft
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
            <WorkbenchChatStage
              {...chat}
              onOpenMobileRail={remoteMobile && showRail ? () => setMobileRailOpen(true) : undefined}
            />
          )}
        </div>

        {rightPanel}
        {showRail ? (
          <WorkbenchSideRail
            {...sideRail}
            presentation={remoteMobile ? 'sheet' : 'rail'}
            sheetOpen={mobileRailOpen}
            onCloseSheet={() => setMobileRailOpen(false)}
          />
        ) : null}
      </div>
    </>
  )
}
