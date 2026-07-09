import type { ReactElement } from 'react'
import {
  AlertTriangle,
  FileQuestion,
  FileText,
  FlaskConical,
  Inbox,
  LayoutList,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  Network,
  PanelRightClose,
  Plus,
  Quote,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  SpellCheck,
  Users
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  SDD_ASSISTANT_FRAMEWORK_GROUPS,
  frameworksForStage,
  type SddWorkflowStage
} from '../../sdd/pm-skill-frameworks'
import type { AttachmentReference, ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { SddDraft } from '../../sdd/sdd-draft-store'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { FloatingComposer } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'

const FRAMEWORK_ICONS: Record<string, LucideIcon> = {
  clarify: Lightbulb,
  research: Search,
  'brainstorm-ideas': Users,
  'opportunity-tree': Network,
  'triage-requests': Inbox,
  structure: ListChecks,
  wwa: LayoutList,
  'job-stories': Quote,
  prd: FileText,
  polish: SpellCheck,
  assumptions: ShieldAlert,
  'prioritize-assumptions': SlidersHorizontal,
  'pre-mortem': AlertTriangle,
  experiments: FlaskConical
}

const STAGE_ACCENT: Record<Extract<SddWorkflowStage, 'discover' | 'structure' | 'risk'>, string> = {
  discover: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  structure: 'bg-violet-500/10 text-violet-600 dark:text-violet-300',
  risk: 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
}

type Props = {
  draft: SddDraft
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
  onNewConversation: () => void
  onApplyFramework: (frameworkId: string) => void
  onCollapse: () => void
  className?: string
}

export function SddAssistantPanel({
  draft,
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
  onNewConversation,
  onApplyFramework,
  onCollapse,
  className = ''
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const hasTimeline =
    blocks.length > 0 || liveReasoning.trim().length > 0 || liveAssistant.trim().length > 0
  const canCreateConversation = runtimeConnection === 'ready' && !busy

  return (
    <aside
      className={`sdd-assistant-panel ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white backdrop-blur-xl dark:bg-ds-canvas ${busy ? 'is-busy' : ''} ${className}`}
    >
      <div className="sdd-assistant-header shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          <SidebarTitlebarToggleButton
            onClick={onCollapse}
            ariaLabel={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
            className="shrink-0"
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </SidebarTitlebarToggleButton>
          <div className="sdd-assistant-title-pill flex min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-ds-surface-subtle px-3 py-1.5 dark:bg-white/8">
            <Sparkles className="sdd-assistant-sparkle h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-[13px] font-medium text-ds-ink">
              {t('sddAssistant')}
            </span>
          </div>
          <button
            type="button"
            onClick={onNewConversation}
            disabled={!canCreateConversation}
            className="ds-sidebar-toggle-button shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={t('writeAssistantNewConversation')}
            title={t('writeAssistantNewConversation')}
          >
            <Plus className="h-4 w-4" strokeWidth={2.1} />
          </button>
        </div>
        <div className="min-w-0 px-4 pb-3">
          <div className="truncate rounded-full border border-ds-border-muted bg-ds-surface-subtle px-3 py-1.5 text-[11.5px] font-medium text-ds-muted dark:bg-white/6">
            {draft.relativePath}
          </div>
        </div>
      </div>

      <div className="sdd-assistant-body min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-ds-main/45 dark:bg-transparent">
        {hasTimeline ? (
          <div className="sdd-assistant-timeline">
            <LazyMessageTimeline
              blocks={blocks}
              liveReasoning={liveReasoning}
              live={liveAssistant}
              activeThreadId={activeThreadId}
              runtimeConnection={runtimeConnection}
              onRetryConnection={onRetryConnection}
              onOpenSettings={onOpenSettings}
              onSelectSuggestion={(text) => setInput(text)}
            />
          </div>
        ) : (
          <div className="sdd-assistant-empty flex min-h-full flex-col justify-end px-5 py-5">
            <div className="sdd-assistant-empty-card mb-auto rounded-[20px] border border-ds-border bg-ds-card/95 p-4 shadow-sm">
              <div className="sdd-assistant-empty-icon flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <FileQuestion className="h-5 w-5" strokeWidth={1.9} />
              </div>
              <h3 className="mt-4 text-[18px] font-semibold text-ds-ink">
                {t('sddAssistantEmptyTitle')}
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-ds-muted">
                {t('sddAssistantEmptySub')}
              </p>
            </div>

            <div className="mt-3 space-y-4">
              {SDD_ASSISTANT_FRAMEWORK_GROUPS.map((group) => {
                const frameworks = frameworksForStage(group.stage).filter(
                  (framework) => framework.titleKey && framework.promptKey
                )
                if (frameworks.length === 0) return null
                return (
                  <div key={group.stage} className="grid gap-2">
                    <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ds-faint">
                      {t(group.titleKey)}
                    </span>
                    {frameworks.map((framework) => {
                      const Icon = FRAMEWORK_ICONS[framework.id] ?? Sparkles
                      return (
                        <button
                          key={framework.id}
                          type="button"
                          onClick={() => onApplyFramework(framework.id)}
                          className="sdd-assistant-action flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-card px-3 py-3 text-left transition hover:border-accent/25 hover:bg-ds-hover"
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${STAGE_ACCENT[group.stage]}`}
                          >
                            <Icon className="h-4 w-4" strokeWidth={1.9} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-semibold text-ds-ink">
                              {t(framework.titleKey as string)}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-ds-faint">
                              {t(framework.subtitleKey as string)}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="sdd-assistant-composer shrink-0 border-t border-ds-border-muted bg-white/92 px-4 pb-4 pt-3 dark:bg-ds-card">
        <FloatingComposer
          variant="compact"
          workspaceRootOverride={draft.workspaceRoot}
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
