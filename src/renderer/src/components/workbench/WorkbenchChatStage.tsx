import {
  lazy,
  Suspense,
  type ComponentProps,
  type PointerEventHandler,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import { FloatingComposer } from '../chat/FloatingComposer'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { SubagentReturnBar } from '../chat/message-timeline-empty'
import { WorkbenchTopActions } from '../chat/WorkbenchTopBar'
import { IkunCameoLayer, KunCelebrationLayer } from '../chat/AnimatedWorkLogo'
import { DevPreviewLaunchCard } from '../DevPreviewLaunchCard'
import { SessionHeader } from '../SessionHeader'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

const TerminalPanel = lazy(() =>
  import('../terminal/TerminalPanel').then((module) => ({ default: module.TerminalPanel }))
)

type FloatingComposerProps = ComponentProps<typeof FloatingComposer>

export type WorkbenchChatStageProps = {
  stageInsetClass: string
  leftSidebarCollapsed: boolean
  busy: boolean
  focusModeEnabled: boolean
  uiModeCameosEnabled: boolean
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  runtimeError?: string | null
  planActionsBusy: boolean
  devPreviewVisible: boolean
  devPreviewUrl: string | null
  devPreviewOpened: boolean
  returnParentTitle: string
  showReturnBar: boolean
  composerProps: FloatingComposerProps
  terminalOpen: boolean
  terminalWorkspaceRoot: string
  terminalHeight: number
  onToggleLeftSidebar: () => void
  onRetryConnection: () => void
  onOpenSettings: () => void
  onSelectSuggestion: (text: string) => void
  onBuildPlan: () => void
  onOpenPlan: () => void
  onOpenDevPreview: () => void
  onBackToParent: () => void
  onBeginTerminalResize: PointerEventHandler<HTMLDivElement>
  onToggleTerminal: () => void
}

function WorkbenchPaneFallback(): ReactElement {
  return <div className="h-full min-h-0 w-full bg-ds-main" aria-hidden />
}

export function WorkbenchChatStage({
  stageInsetClass,
  leftSidebarCollapsed,
  busy,
  focusModeEnabled,
  uiModeCameosEnabled,
  blocks,
  liveReasoning,
  liveAssistant,
  activeThreadId,
  runtimeConnection,
  runtimeError,
  planActionsBusy,
  devPreviewVisible,
  devPreviewUrl,
  devPreviewOpened,
  returnParentTitle,
  showReturnBar,
  composerProps,
  terminalOpen,
  terminalWorkspaceRoot,
  terminalHeight,
  onToggleLeftSidebar,
  onRetryConnection,
  onOpenSettings,
  onSelectSuggestion,
  onBuildPlan,
  onOpenPlan,
  onOpenDevPreview,
  onBackToParent,
  onBeginTerminalResize,
  onToggleTerminal
}: WorkbenchChatStageProps): ReactElement {
  const { t } = useTranslation('common')
  return (
    <section className="ds-chat-stage ds-drag flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={`${stageInsetClass} flex min-h-0 min-w-0 flex-1 flex-col`}>
        <header className="chat-topbar ds-topbar-surface relative z-10 flex w-full shrink-0 items-stretch overflow-visible">
          <div className="chat-topbar-grid grid w-full min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4 md:pl-5 md:pr-2">
            <div
              className={`chat-topbar-session flex min-w-0 items-center gap-2.5 ${
                leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
              }`}
            >
              <SidebarTitlebarToggleButton
                onClick={onToggleLeftSidebar}
                title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
                ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
              />
              <SessionHeader compact className="min-w-0 flex-1" />
            </div>
            <div className="chat-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-2 self-center">
              <WorkbenchTopActions
                terminalOpen={terminalOpen}
                onToggleTerminal={onToggleTerminal}
              />
              {busy ? (
                <span className="inline-flex shrink-0 rounded-full bg-amber-500/16 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 dark:text-amber-100">
                  {t('running')}
                </span>
              ) : null}
            </div>
          </div>
        </header>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <LazyMessageTimeline
            fallback={<WorkbenchPaneFallback />}
            blocks={blocks}
            liveReasoning={liveReasoning}
            live={liveAssistant}
            activeThreadId={activeThreadId}
            runtimeConnection={runtimeConnection}
            runtimeError={runtimeError}
            onRetryConnection={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={onSelectSuggestion}
            focusModeEnabled={focusModeEnabled}
            planActionsBusy={planActionsBusy}
            onBuildPlan={onBuildPlan}
            onOpenPlan={onOpenPlan}
            devPreviewCard={
              devPreviewVisible && devPreviewUrl ? (
                <DevPreviewLaunchCard
                  url={devPreviewUrl}
                  opened={devPreviewOpened}
                  onOpen={onOpenDevPreview}
                />
              ) : null
            }
          />
          {uiModeCameosEnabled && !focusModeEnabled ? <IkunCameoLayer /> : null}
          {!focusModeEnabled ? <KunCelebrationLayer active={busy} suppressed={Boolean(runtimeError)} /> : null}
        </div>
        <div className="ds-no-drag relative flex shrink-0 justify-center px-2 pb-3 pt-0 sm:px-4 md:px-6 lg:px-8">
          {showReturnBar ? (
            <SubagentReturnBar
              parentTitle={returnParentTitle}
              onBack={onBackToParent}
            />
          ) : (
            <FloatingComposer {...composerProps} />
          )}
        </div>
      </div>
      {terminalOpen ? (
        <div className="ds-no-drag flex w-full shrink-0 flex-col px-0 pb-0">
          <div
            role="separator"
            aria-orientation="horizontal"
            className="relative z-20 h-1 shrink-0 cursor-row-resize bg-transparent transition hover:bg-ds-border-muted"
            onPointerDown={onBeginTerminalResize}
          />
          <Suspense fallback={<div className="ds-surface-strong h-full w-full" />}>
            <TerminalPanel
              workspaceRoot={terminalWorkspaceRoot}
              height={terminalHeight}
              className="w-full"
              onCollapse={onToggleTerminal}
            />
          </Suspense>
        </div>
      ) : null}
    </section>
  )
}
