import type { ReactElement } from 'react'
import { Layers, Palette } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AttachmentReference,
  RuntimeConnectionStatus
} from '../../agent/types'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { interruptDesignPagesRun } from '../../design/design-pages-run'
import { FloatingComposer, type DesignComposerContext } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { DesignTargetToggle } from './DesignTargetToggle'

export type DesignDrawingStartProps = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  workspaceRoot: string
  input: string
  setInput: (value: string) => void
  mode: 'plan' | 'agent' | 'auto'
  setMode: (value: 'plan' | 'agent' | 'auto') => void
  busy: boolean
  runtimeConnection: RuntimeConnectionStatus
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  composerReasoningEffort: ComposerReasoningEffort
  composerFastMode: boolean
  setComposerModel: (modelId: string, providerId?: string) => void
  setComposerReasoningEffort: (effort: ComposerReasoningEffort) => void
  setComposerFastMode: (enabled: boolean) => void
  queuedMessages: QueuedUserMessage[]
  removeQueuedMessage: (id: string) => void
  guideQueuedMessage: (id: string) => void | Promise<unknown>
  attachments?: AttachmentReference[]
  attachmentUploadEnabled?: boolean
  attachmentUploadBusy?: boolean
  attachmentUploadError?: string | null
  contextChips?: DesignComposerContext[]
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onRemoveContextChip?: (id: string) => void
  onSend: () => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onConfigureProviders?: () => void
}

export function DesignDrawingStart({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  workspaceRoot,
  input,
  setInput,
  mode,
  setMode,
  busy,
  runtimeConnection,
  composerModel,
  composerProviderId,
  composerPickList,
  composerModelGroups = [],
  composerReasoningEffort,
  composerFastMode,
  setComposerModel,
  setComposerReasoningEffort,
  setComposerFastMode,
  queuedMessages,
  removeQueuedMessage,
  guideQueuedMessage,
  attachments = [],
  attachmentUploadEnabled = false,
  attachmentUploadBusy = false,
  attachmentUploadError = null,
  contextChips = [],
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onRemoveContextChip,
  onSend,
  onInterrupt,
  onConfigureProviders
}: DesignDrawingStartProps): ReactElement {
  const { t } = useTranslation('common')
  const designTarget = useDesignWorkspaceStore((state) => state.designContext.designTarget ?? 'web')
  const setDesignTarget = useDesignWorkspaceStore((state) => state.setDesignTarget)
  const multiPageMode = useDesignWorkspaceStore((state) => state.multiPageMode)
  const setMultiPageMode = useDesignWorkspaceStore((state) => state.setMultiPageMode)
  const drawingCreationSubmitting = useDesignWorkspaceStore((state) => state.drawingCreationSubmitting)
  const interactionBusy = busy || drawingCreationSubmitting

  return (
    <section className="ds-drag relative flex min-h-0 min-w-0 flex-1 flex-col bg-ds-main">
      <div
        className={`absolute left-3 top-3 z-20 ${
          leftSidebarCollapsed ? 'ds-window-controls-collapsed-titlebar-inset' : ''
        }`}
      >
        <SidebarTitlebarToggleButton
          onClick={onToggleLeftSidebar}
          title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
          ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
        />
      </div>
      <div className="ds-no-drag flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-16">
        <div className="w-full max-w-[760px]">
          <div className="mb-7 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] border border-ds-border-muted bg-ds-card text-accent shadow-sm">
              <Palette className="h-6 w-6" strokeWidth={1.65} />
            </div>
            <h1 className="mt-4 text-[25px] font-semibold tracking-[-0.02em] text-ds-ink">
              {t('designDrawingStartTitle')}
            </h1>
            <p className="mx-auto mt-2 max-w-[560px] text-[14px] leading-6 text-ds-muted">
              {t('designDrawingStartDescription')}
            </p>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
            <DesignTargetToggle
              designTarget={designTarget}
              disabled={interactionBusy}
              disabledReason={interactionBusy ? t('designTargetLockedHint') : undefined}
              onChange={setDesignTarget}
            />
            <button
              type="button"
              onClick={() => setMultiPageMode(!multiPageMode)}
              disabled={interactionBusy}
              aria-pressed={multiPageMode}
              title={t('designPagesToggleHint')}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-semibold transition disabled:opacity-45 ${
                multiPageMode
                  ? 'border-accent bg-accent text-white'
                  : 'border-ds-border bg-ds-surface-subtle text-ds-muted hover:text-ds-ink dark:bg-white/6'
              }`}
            >
              <Layers className="h-3.5 w-3.5" strokeWidth={1.9} />
              {t('designPagesToggle')}
            </button>
          </div>

          <div data-design-start-composer>
            <FloatingComposer
              disabled={interactionBusy}
              workspaceRootOverride={workspaceRoot}
              input={input}
              setInput={setInput}
              mode={mode}
              setMode={setMode}
              busy={busy}
              runtimeReady={runtimeConnection === 'ready'}
              hasActiveThread={false}
              activeThreadIdOverride={null}
              userInputBlocksOverride={[]}
              composerModel={composerModel}
              composerProviderId={composerProviderId}
              composerPickList={composerPickList}
              composerModelGroups={composerModelGroups}
              composerReasoningEffort={composerReasoningEffort}
              composerFastMode={composerFastMode}
              onComposerModelChange={setComposerModel}
              onComposerReasoningEffortChange={setComposerReasoningEffort}
              onComposerFastModeChange={setComposerFastMode}
              modelPickerMode="combobox"
              modelControlVariant="split"
              showProviderInModelLabel
              queuedMessages={queuedMessages}
              onRemoveQueuedMessage={removeQueuedMessage}
              onGuideQueuedMessage={guideQueuedMessage}
              attachments={attachments}
              attachmentUploadEnabled={attachmentUploadEnabled}
              attachmentUploadBusy={attachmentUploadBusy}
              attachmentUploadError={attachmentUploadError}
              contextChips={contextChips}
              onPickAttachments={onPickAttachments}
              onPasteClipboardImage={onPasteClipboardImage}
              onRemoveAttachment={onRemoveAttachment}
              onRemoveContextChip={onRemoveContextChip}
              onSend={onSend}
              onInterrupt={(options) => interruptDesignPagesRun(onInterrupt, options)}
              onConfigureProviders={onConfigureProviders}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
