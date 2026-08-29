import {
  lazy,
  Suspense,
  type ComponentProps,
  type PointerEventHandler,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { FloatingComposer } from '../chat/FloatingComposer'
import { ConversationFileDropZone } from '../chat/ConversationFileDropZone'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { ThreadHydrationLoading } from '../chat/ThreadHydrationLoading'
import {
  GraphChildSessionBar,
  SubagentReturnBar,
  type GraphChildSessionContext
} from '../chat/message-timeline-empty'
import { WorkbenchTopActions } from '../chat/WorkbenchTopBar'
import { IkunCameoLayer, KunCelebrationLayer } from '../chat/AnimatedWorkLogo'
import { ActiveUiPluginStagePresentation } from '../chat/UiPluginStagePresentation'
import { DevPreviewLaunchCard } from '../DevPreviewLaunchCard'
import { SessionHeader } from '../SessionHeader'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import type { JsonValue } from '@kun/extension-api'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import { DeclarativeActionBar } from '../../extensions/ControlledContributionSurfaces'
import type { PlanBuildOrchestration } from '../../plan/plan-build'
import type { GuiPlanToolMeta } from '../../plan/plan-tool'
import { useChatStore } from '../../store/chat-store'
import { hasLivePendingUserInput } from '../../store/chat-store-runtime-helpers'
import { shouldUseEmptyTaskLayout } from './workbench-chat-layout'
import { CircleHelp, Loader2 } from 'lucide-react'

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
  graphEnabled: boolean
  devPreviewVisible: boolean
  devPreviewUrl: string | null
  devPreviewOpened: boolean
  returnParentTitle: string
  showReturnBar: boolean
  returnBarVariant?: 'explore' | 'subagent'
  graphChildContext?: GraphChildSessionContext
  composerProps: FloatingComposerProps
  conversationDropWorkspaceRoot: string
  terminalOpen: boolean
  terminalWorkspaceRoot: string
  terminalHeight: number
  rightWorkspaceExpanded: boolean
  onToggleLeftSidebar: () => void
  onRetryConnection: () => void
  onOpenSettings: () => void
  onSelectSuggestion: (text: string) => void
  onBuildPlan: (orchestration: PlanBuildOrchestration, meta?: GuiPlanToolMeta) => void
  onOpenPlan: (meta?: GuiPlanToolMeta) => void
  onOpenChanges: () => void
  onReviewChanges: () => void
  reviewChangesDisabled: boolean
  onOpenDevPreview: () => void
  onBackToParent: () => void
  onBeginTerminalResize: PointerEventHandler<HTMLDivElement>
  onToggleTerminal: () => void
  onToggleRightWorkspace: () => void
  onOpenCommandPalette?: () => void
  onOpenRequirementDraft?: () => void
  extensionTopBarActions?: readonly RegisteredContribution<'actions.topBar'>[]
  extensionComposerActions?: readonly RegisteredContribution<'actions.composer'>[]
  extensionMessageActions?: readonly RegisteredContribution<'actions.message'>[]
  extensionContextMenus?: readonly RegisteredContribution<'contextMenus'>[]
  extensionAttachmentContextMenus?: readonly RegisteredContribution<'contextMenus'>[]
  extensionCommands?: readonly RegisteredContribution<'commands'>[]
  extensionResultPreviews?: readonly RegisteredContribution<'message.resultPreviews'>[]
  messageContributionsForSurface?: (surface: 'code' | 'design') => {
    actions: readonly RegisteredContribution<'actions.message'>[]
    contextMenus: readonly RegisteredContribution<'contextMenus'>[]
    attachmentContextMenus: readonly RegisteredContribution<'contextMenus'>[]
    resultPreviews: readonly RegisteredContribution<'message.resultPreviews'>[]
  } | null
  onExtensionCommand?: (commandId: string, context: JsonValue) => void | Promise<unknown>
}

function WorkbenchPaneFallback(): ReactElement {
  return <div className="h-full min-h-0 w-full bg-white dark:bg-ds-main" aria-hidden />
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
  graphEnabled,
  devPreviewVisible,
  devPreviewUrl,
  devPreviewOpened,
  returnParentTitle,
  showReturnBar,
  returnBarVariant = 'subagent',
  graphChildContext,
  composerProps,
  conversationDropWorkspaceRoot,
  terminalOpen,
  terminalWorkspaceRoot,
  terminalHeight,
  rightWorkspaceExpanded,
  onToggleLeftSidebar,
  onRetryConnection,
  onOpenSettings,
  onSelectSuggestion,
  onBuildPlan,
  onOpenPlan,
  onOpenChanges,
  onReviewChanges,
  reviewChangesDisabled,
  onOpenDevPreview,
  onBackToParent,
  onBeginTerminalResize,
  onToggleTerminal,
  onToggleRightWorkspace,
  onOpenCommandPalette,
  onOpenRequirementDraft,
  extensionTopBarActions = [],
  extensionComposerActions = [],
  extensionMessageActions = [],
  extensionContextMenus = [],
  extensionAttachmentContextMenus = [],
  extensionCommands = [],
  extensionResultPreviews = [],
  messageContributionsForSurface,
  onExtensionCommand
}: WorkbenchChatStageProps): ReactElement {
  const { t } = useTranslation('common')
  const threadLoadingId = useChatStore((state) => state.threadLoadingId)
  const threadRefreshingId = useChatStore((state) => state.threadRefreshingId)
  const effectiveConversationDropWorkspaceRoot = normalizeWorkspaceRoot(conversationDropWorkspaceRoot)
  const canComposeForConversationDrop =
    composerProps.fileReferenceEnabled === true &&
    composerProps.runtimeReady &&
    (composerProps.hasActiveThread || Boolean(effectiveConversationDropWorkspaceRoot))
  const hasConversationContent = Boolean(blocks.length || liveAssistant || liveReasoning)
  const emptyTaskLayout = shouldUseEmptyTaskLayout({
    activeThreadId,
    threadLoadingId,
    hasConversationContent,
    runtimeReady: runtimeConnection === 'ready',
    hasWorkspace: Boolean(effectiveConversationDropWorkspaceRoot)
  })
  const conversationFileDropOptions = {
    canPickAttachment:
      canComposeForConversationDrop &&
      composerProps.attachmentUploadEnabled === true &&
      composerProps.attachmentUploadBusy !== true,
    canPickLocalFileReference:
      canComposeForConversationDrop &&
      Boolean(composerProps.onPickFileReferences),
    canAddFileReference:
      canComposeForConversationDrop &&
      Boolean(effectiveConversationDropWorkspaceRoot) &&
      Boolean(composerProps.onAddFileReference),
    workspaceRoot: effectiveConversationDropWorkspaceRoot,
    onPickAttachments: composerProps.onPickAttachments,
    onAddFileReference: composerProps.onAddFileReference,
    getPathForFile: (file: File) => window.kunGui.getPathForFile(file)
  }

  return (
    <section
      className="ds-chat-stage ds-drag relative isolate flex min-h-0 min-w-0 flex-1 flex-col"
      data-terminal-open={terminalOpen ? 'true' : 'false'}
      data-empty-task-layout={emptyTaskLayout ? 'true' : 'false'}
    >
      <ActiveUiPluginStagePresentation />
      <div
        className={`${stageInsetClass} ds-ui-plugin-stage-content relative z-[3] flex min-h-0 min-w-0 flex-1 flex-col`}
      >
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
              <SessionHeader
                compact
                className="min-w-0 flex-1"
                onOpenRequirementDraft={onOpenRequirementDraft}
              />
            </div>
            <div className="chat-topbar-actions flex min-w-0 flex-wrap items-center justify-end gap-2 self-center">
              {extensionTopBarActions.length && onExtensionCommand ? (
                <DeclarativeActionBar
                  contributions={extensionTopBarActions}
                  context={{ surface: 'topBar', threadId: activeThreadId }}
                  onCommand={onExtensionCommand}
                  compact
                />
              ) : null}
              {threadRefreshingId === activeThreadId ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground"
                  role="status"
                  aria-label={t('threadRefreshing')}
                >
                  <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
                  {t('threadRefreshing')}
                </span>
              ) : null}
              {busy ? (
                hasLivePendingUserInput(blocks) ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-500/25 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 motion-safe:animate-pulse dark:text-amber-100">
                    <CircleHelp className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
                    {t('awaitingYourInput')}
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 rounded-full bg-amber-500/16 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950 dark:text-amber-100">
                    {t('running')}
                  </span>
                )
              ) : null}
              <WorkbenchTopActions
                terminalOpen={terminalOpen}
                onToggleTerminal={onToggleTerminal}
                rightWorkspaceExpanded={rightWorkspaceExpanded}
                onToggleRightWorkspace={onToggleRightWorkspace}
                onOpenCommandPalette={onOpenCommandPalette}
              />
            </div>
          </div>
        </header>
        {graphChildContext ? (
          <GraphChildSessionBar context={graphChildContext} onBack={onBackToParent} />
        ) : null}
        <div
          className={`ds-chat-main-stack relative flex min-h-0 min-w-0 flex-1 flex-col ${
            emptyTaskLayout
              ? 'justify-center overflow-y-auto pb-[clamp(4rem,12vh,8rem)]'
              : ''
          }`}
        >
          <ConversationFileDropZone
            className={`flex min-h-0 min-w-0 flex-col ${emptyTaskLayout ? 'flex-none' : 'flex-1'}`}
            options={conversationFileDropOptions}
          >
            <LazyMessageTimeline
              fallback={activeThreadId ? <ThreadHydrationLoading /> : <WorkbenchPaneFallback />}
              blocks={blocks}
              liveReasoning={liveReasoning}
              live={liveAssistant}
              activeThreadId={activeThreadId}
              runtimeConnection={runtimeConnection}
              runtimeError={runtimeError}
              onRetryConnection={onRetryConnection}
              onOpenSettings={onOpenSettings}
              onSelectSuggestion={onSelectSuggestion}
              taskSurfaceControl={composerProps.taskSurface ? {
                surface: composerProps.taskSurface,
                locked: composerProps.taskSurfaceLocked,
                onChange: composerProps.onTaskSurfaceChange
              } : undefined}
              focusModeEnabled={focusModeEnabled}
              planActionsBusy={planActionsBusy}
              graphEnabled={graphEnabled}
              onBuildPlan={onBuildPlan}
              onOpenPlan={onOpenPlan}
              onOpenChanges={onOpenChanges}
              onReviewChanges={onReviewChanges}
              reviewChangesDisabled={reviewChangesDisabled}
              onComponentPrototypePrompt={composerProps.setInput}
              devPreviewCard={
                devPreviewVisible && devPreviewUrl ? (
                  <DevPreviewLaunchCard
                    url={devPreviewUrl}
                    opened={devPreviewOpened}
                    onOpen={onOpenDevPreview}
                  />
                ) : null
              }
              extensionMessageActions={extensionMessageActions}
              extensionContextMenus={extensionContextMenus}
              extensionAttachmentContextMenus={extensionAttachmentContextMenus}
              extensionCommands={extensionCommands}
              extensionResultPreviews={extensionResultPreviews}
              messageContributionsForSurface={messageContributionsForSurface}
              onExtensionCommand={onExtensionCommand}
            />
            {uiModeCameosEnabled && !focusModeEnabled && !emptyTaskLayout ? <IkunCameoLayer /> : null}
            {!focusModeEnabled ? <KunCelebrationLayer active={busy} suppressed={Boolean(runtimeError)} /> : null}
          </ConversationFileDropZone>
          <div
            className={`ds-composer-dock ds-no-drag relative flex shrink-0 justify-center px-2 pt-0 sm:px-4 md:px-6 lg:px-8 ${
              emptyTaskLayout ? 'pb-0' : 'pb-3'
            }`}
            data-primary-floating-composer
            data-usage-history-boundary
          >
            {showReturnBar ? (
              <SubagentReturnBar
                parentTitle={returnParentTitle}
                onBack={onBackToParent}
                variant={returnBarVariant}
              />
            ) : (
              <div className="flex w-full min-w-0 flex-col items-center gap-1">
                {extensionComposerActions.length && onExtensionCommand ? (
                  <DeclarativeActionBar
                    contributions={extensionComposerActions}
                    context={{ surface: 'composer', threadId: activeThreadId }}
                    onCommand={onExtensionCommand}
                  />
                ) : null}
                <FloatingComposer
                  {...composerProps}
                  emptyTaskLayout={emptyTaskLayout}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {terminalOpen ? (
        <div className="ds-no-drag relative z-[3] flex w-full shrink-0 flex-col px-0 pb-0">
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
