import type { ReactElement } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LazyMessageTimeline } from '../../chat/LazyMessageTimeline'
import { FloatingComposer } from '../../chat/FloatingComposer'
import { PaperToolPoolContext } from '../../chat/paper-tool-process'
import type { WriteAssistantStageProps } from '../../write/WriteAssistantStageContext'
import { useChildThreadViewer } from '../../write/useChildThreadViewer'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { useWorkComposerReferenceProps } from '../../write/use-work-composer-references'

/**
 * Center-stage research conversation: the Work assistant's own thread,
 * rendered like a Code conversation (full cards, wide timeline, standard
 * composer). A delegated literature child opens in place with a back bar.
 */
export function PaperResearchStage({
  assistant,
  newCountByBlock
}: {
  assistant: WriteAssistantStageProps
  newCountByBlock: Record<string, number>
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const child = useChildThreadViewer(assistant.activeThreadId ?? '')
  const referenceProps = useWorkComposerReferenceProps(workspaceRoot)
  const timeline = child.viewingChildThread ? (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted px-4 py-2 text-[12.5px]">
        <button
          type="button"
          onClick={child.closeChildThread}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('paperResearchBackToSession')}
        </button>
        <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">{t('subagentSessionBannerTitle')}</span>
        <span className="shrink-0 text-[11px] text-ds-faint">
          {child.childLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : child.childStatus}
        </span>
      </div>
      {child.childError ? (
        <p className="mx-4 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {child.childError}
        </p>
      ) : null}
      <LazyMessageTimeline
        blocks={child.childBlocks}
        liveReasoning=""
        live=""
        activeThreadId={child.childThreadId}
        runtimeConnection={assistant.runtimeConnection}
        onRetryConnection={assistant.onRetryConnection}
        onOpenSettings={assistant.onOpenSettings}
        onOpenChildThread={child.openChildThread}
      />
    </>
  ) : (
    <LazyMessageTimeline
      blocks={assistant.blocks}
      liveReasoning={assistant.liveReasoning}
      live={assistant.liveAssistant}
      activeThreadId={assistant.activeThreadId}
      runtimeConnection={assistant.runtimeConnection}
      onRetryConnection={assistant.onRetryConnection}
      onOpenSettings={assistant.onOpenSettings}
      onSelectSuggestion={(text) => assistant.setInput(text)}
      onOpenChildThread={child.openChildThread}
    />
  )
  return (
    <PaperToolPoolContext.Provider value={newCountByBlock}>
      <div className="paper-research-stage flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="paper-research-timeline flex min-h-0 flex-1 flex-col overflow-hidden">{timeline}</div>
        <div className="shrink-0 px-4 pb-4 pt-2">
          <div className="mx-auto w-full max-w-[760px]">
            <FloatingComposer
              agentSwitcher
              {...referenceProps}
              workspaceRootOverride={workspaceRoot}
              input={assistant.input}
              setInput={assistant.setInput}
              mode={assistant.mode}
              setMode={assistant.setMode}
              busy={assistant.busy}
              runtimeReady={assistant.runtimeConnection === 'ready'}
              hasActiveThread={Boolean(assistant.activeThreadId)}
              composerModel={assistant.composerModel}
              composerProviderId={assistant.composerProviderId}
              composerPickList={assistant.composerPickList}
              composerModelGroups={assistant.composerModelGroups}
              skillCommands={assistant.skillCommands}
              disabledSkillIds={assistant.disabledSkillIds}
              composerReasoningEffort={assistant.composerReasoningEffort}
              composerFastMode={assistant.composerFastMode}
              onComposerModelChange={assistant.setComposerModel}
              onComposerReasoningEffortChange={assistant.setComposerReasoningEffort}
              onComposerFastModeChange={assistant.setComposerFastMode}
              modelPickerMode="combobox"
              modelControlVariant="split"
              showProviderInModelLabel
              executionSettings={assistant.executionSettings}
              executionSettingsApplying={assistant.executionSettingsApplying}
              onExecutionSettingsChange={assistant.onExecutionSettingsChange}
              queuedMessages={assistant.queuedMessages}
              onRemoveQueuedMessage={assistant.removeQueuedMessage}
              onGuideQueuedMessage={assistant.guideQueuedMessage}
              attachments={assistant.attachments}
              attachmentUploadEnabled={assistant.attachmentUploadEnabled}
              attachmentUploadBusy={assistant.attachmentUploadBusy}
              attachmentUploadError={assistant.attachmentUploadError}
              onPickAttachments={assistant.onPickAttachments}
              onPasteClipboardImage={assistant.onPasteClipboardImage}
              onRemoveAttachment={assistant.onRemoveAttachment}
              onSend={assistant.onSend}
              onInterrupt={assistant.onInterrupt}
              onConfigureProviders={assistant.onConfigureProviders}
            />
          </div>
        </div>
      </div>
    </PaperToolPoolContext.Provider>
  )
}
