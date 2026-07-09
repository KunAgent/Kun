import type { ReactElement } from 'react'
import { Code2, PanelRightClose } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AttachmentReference, RuntimeConnectionStatus, ChatBlock } from '../../agent/types'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { FloatingComposer } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'

type Props = {
  /** Title of the artifact being implemented (header chip). */
  title: string
  workspaceRoot: string
  input: string
  setInput: (value: string) => void
  mode: 'plan' | 'agent'
  setMode: (value: 'plan' | 'agent') => void
  busy: boolean
  runtimeConnection: RuntimeConnectionStatus
  activeThreadId: string | null
  blocks: ChatBlock[]
  liveReasoning: string
  liveAssistant: string
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  composerReasoningEffort: ComposerReasoningEffort
  setComposerModel: (modelId: string, providerId?: string) => void
  setComposerReasoningEffort: (effort: ComposerReasoningEffort) => void
  queuedMessages: QueuedUserMessage[]
  removeQueuedMessage: (id: string) => void
  attachments?: AttachmentReference[]
  attachmentUploadEnabled?: boolean
  attachmentUploadBusy?: boolean
  attachmentUploadError?: string | null
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onSend: () => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onRetryConnection: () => void
  onOpenSettings: () => void
  onConfigureProviders?: () => void
  /** Return to the design agent panel (the implement thread stays alive). */
  onClose: () => void
  className?: string
}

/**
 * In-page "implement in code" assistant for design mode. Mirrors the write
 * assistant panel (MessageTimeline + FloatingComposer) so the coding agent runs
 * the implement turn in a side panel on the design page instead of navigating
 * away to code mode. The conversation shown is the active (code) thread.
 */
export function DesignImplementPanel({
  title,
  workspaceRoot,
  input,
  setInput,
  mode,
  setMode,
  busy,
  runtimeConnection,
  activeThreadId,
  blocks,
  liveReasoning,
  liveAssistant,
  composerModel,
  composerProviderId,
  composerPickList,
  composerModelGroups = [],
  composerReasoningEffort,
  setComposerModel,
  setComposerReasoningEffort,
  queuedMessages,
  removeQueuedMessage,
  attachments = [],
  attachmentUploadEnabled = false,
  attachmentUploadBusy = false,
  attachmentUploadError = null,
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onSend,
  onInterrupt,
  onRetryConnection,
  onOpenSettings,
  onConfigureProviders,
  onClose,
  className = ''
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const hasTimeline =
    blocks.length > 0 || liveReasoning.trim().length > 0 || liveAssistant.trim().length > 0

  return (
    <aside
      className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white dark:bg-ds-canvas ${className}`}
    >
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={onClose}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('designImplementClose')}
            title={t('designImplementClose')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-ds-surface-subtle px-3 py-1.5 dark:bg-white/8">
            <Code2 className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">
              {t('designImplementPanelTitle')}
            </span>
          </div>
        </div>
        {title ? (
          <div className="min-w-0 px-4 pb-3">
            <div className="truncate rounded-full border border-ds-border-muted bg-ds-surface-subtle px-3 py-1.5 text-[11.5px] font-medium text-ds-muted dark:bg-white/6">
              {title}
            </div>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-ds-main/45 dark:bg-transparent">
        {hasTimeline ? (
          <LazyMessageTimeline
            blocks={blocks}
            liveReasoning={liveReasoning}
            live={liveAssistant}
            activeThreadId={activeThreadId}
            runtimeConnection={runtimeConnection}
            onRetryConnection={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={(text) => setInput(text)}
            compactCards
          />
        ) : (
          <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Code2 className="h-5 w-5" strokeWidth={1.9} />
            </div>
            <p className="mt-3 text-[13px] leading-6 text-ds-muted">{t('designImplementEmpty')}</p>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-ds-border-muted bg-white/92 px-4 pb-4 pt-3 dark:bg-ds-card">
        <FloatingComposer
          variant="compact"
          workspaceRootOverride={workspaceRoot}
          input={input}
          setInput={setInput}
          mode={mode}
          setMode={setMode}
          busy={busy}
          runtimeReady={runtimeConnection === 'ready'}
          hasActiveThread={Boolean(activeThreadId)}
          composerModel={composerModel}
          composerProviderId={composerProviderId}
          composerPickList={composerPickList}
          composerModelGroups={composerModelGroups}
          composerReasoningEffort={composerReasoningEffort}
          onComposerModelChange={setComposerModel}
          onComposerReasoningEffortChange={setComposerReasoningEffort}
          modelPickerMode="combobox"
          queuedMessages={queuedMessages}
          onRemoveQueuedMessage={removeQueuedMessage}
          attachments={attachments}
          attachmentUploadEnabled={attachmentUploadEnabled}
          attachmentUploadBusy={attachmentUploadBusy}
          attachmentUploadError={attachmentUploadError}
          onPickAttachments={onPickAttachments}
          onPasteClipboardImage={onPasteClipboardImage}
          onRemoveAttachment={onRemoveAttachment}
          onSend={onSend}
          onInterrupt={onInterrupt}
          onConfigureProviders={onConfigureProviders}
        />
      </div>
    </aside>
  )
}
