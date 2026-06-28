import { memo, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  ChevronDown,
  Layers,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
  StopCircle,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '../../lib/format-relative-time'
import type { AttachmentReference, NormalizedThread, RuntimeConnectionStatus, ChatBlock } from '../../agent/types'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { cancelDesignPagesRun } from '../../design/design-pages-run'
import { MessageTimeline } from '../chat/MessageTimeline'
import { FloatingComposer } from '../chat/FloatingComposer'
import type { DesignComposerContext } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'

type Props = {
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
  contextChips?: DesignComposerContext[]
  onPickAttachments?: (files: File[]) => void
  onPasteClipboardImage?: (options?: { silentNoImage?: boolean }) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onRemoveContextChip?: (id: string) => void
  onSend: () => void
  onInterrupt: (options?: { discard?: boolean }) => void
  onRetryConnection: () => void
  onOpenSettings: (section?: string) => void
  onConfigureProviders?: () => void
  onNewConversation: () => void
  designThreads: NormalizedThread[]
  onSwitchThread: (threadId: string) => void
}

function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
}

function DesignAIRailInner({
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
  contextChips = [],
  onPickAttachments,
  onPasteClipboardImage,
  onRemoveAttachment,
  onRemoveContextChip,
  onSend,
  onInterrupt,
  onRetryConnection,
  onOpenSettings,
  onConfigureProviders,
  onNewConversation,
  designThreads,
  onSwitchThread
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const assistantOpen = useDesignWorkspaceStore((s) => s.canvasAssistantOpen)
  const setAssistantOpen = useDesignWorkspaceStore((s) => s.setCanvasAssistantOpen)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const designIntentMode = useDesignWorkspaceStore((s) => s.designIntentMode)
  const multiPageMode = useDesignWorkspaceStore((s) => s.multiPageMode)
  const setMultiPageMode = useDesignWorkspaceStore((s) => s.setMultiPageMode)
  const pagesRun = useDesignWorkspaceStore((s) => s.pagesRun)
  const [narrowPanelOpen, setNarrowPanelOpen] = useState(false)
  const [threadListOpen, setThreadListOpen] = useState(false)
  const threadListRef = useRef<HTMLDivElement | null>(null)
  const threadPillRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!threadListOpen) return
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (threadListRef.current?.contains(target)) return
      if (threadPillRef.current?.contains(target)) return
      setThreadListOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setThreadListOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [threadListOpen])


  const activeThread = designThreads.find((th) => th.id === activeThreadId) ?? null
  const headerTitle = activeThread?.title || t('designRailTitle')

  const hasTimeline =
    blocks.length > 0 || liveReasoning.trim().length > 0 || liveAssistant.trim().length > 0
  const runActive = Boolean(pagesRun)
  const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null
  const primaryContextChip = contextChips[0] ?? null
  // Keep the composer + new-conversation locked across the whole multi-page run,
  // even during the brief idle gaps between page turns.
  const effectiveBusy = busy || runActive
  const canCreateConversation = runtimeConnection === 'ready' && !busy && !runActive
  const showMultiPageToggle =
    designIntentMode === 'generate' && !runActive && activeArtifact?.kind !== 'canvas'
  const contextLabel = primaryContextChip
    ? `${designIntentMode === 'preview' ? t('designProjectPreview') : t('designProjectModify')} · ${primaryContextChip.label}`
    : ''
  const showContextControls = runActive || Boolean(primaryContextChip) || showMultiPageToggle

  const openAssistant = (): void => {
    if (isNarrowViewport()) {
      setNarrowPanelOpen(true)
      return
    }
    setAssistantOpen(true)
  }

  const closeAssistant = (): void => {
    if (isNarrowViewport()) {
      setNarrowPanelOpen(false)
      return
    }
    setAssistantOpen(false)
  }

  const panelVisibility = `${narrowPanelOpen ? 'flex' : 'hidden'} ${
    assistantOpen ? 'lg:flex' : 'lg:hidden'
  }`
  const launcherVisibility = `${narrowPanelOpen ? 'hidden' : 'flex'} ${
    assistantOpen ? 'lg:hidden' : 'lg:flex'
  }`

  return (
    <div className="ds-no-drag pointer-events-none absolute inset-0 z-50 overflow-hidden">
      <div
        className={`${launcherVisibility} pointer-events-auto absolute left-3 top-[72px] z-50 items-center gap-2 rounded-full border border-ds-border-muted bg-white/82 px-2.5 py-2 text-ds-muted shadow-[0_14px_42px_rgba(20,47,95,0.12)] backdrop-blur-xl transition hover:bg-white hover:text-ds-ink dark:bg-ds-card/86`}
      >
        <button
          type="button"
          onClick={openAssistant}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ds-card text-accent shadow-sm transition hover:bg-accent-soft"
          title={t('designRailExpand')}
          aria-label={t('designRailExpand')}
        >
          <PanelLeftOpen className="h-4 w-4" strokeWidth={1.9} />
        </button>
        <span className="hidden pr-1 text-[12.5px] font-semibold text-ds-muted sm:block">
          {t('designRailTitle')}
        </span>
      </div>

      <aside
        className={`${panelVisibility} pointer-events-auto absolute bottom-[128px] left-3 top-[72px] z-50 w-[min(390px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-[28px] border border-ds-border bg-white/78 text-ds-ink shadow-[0_26px_72px_rgba(20,47,95,0.16)] backdrop-blur-2xl dark:bg-ds-canvas/90 max-lg:bottom-[116px] max-lg:max-h-[calc(100%-188px)] lg:w-[clamp(360px,24vw,400px)]`}
      >
        <div className="shrink-0 border-b border-ds-border-muted/80 bg-white/68 px-3 py-3 dark:bg-ds-card/72">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={closeAssistant}
              className="ds-sidebar-toggle-button shrink-0"
              title={t('designRailCollapse')}
              aria-label={t('designRailCollapse')}
            >
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.85} />
            </button>
            <button
              ref={threadPillRef}
              type="button"
              onClick={() => setThreadListOpen((v) => !v)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-ds-subtle px-3 py-2 transition hover:bg-ds-hover dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
              title={t('designRailSwitchThread')}
              aria-label={t('designRailSwitchThread')}
            >
              <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
              <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink">
                {headerTitle}
              </span>
              <ChevronDown
                className="ml-auto h-3 w-3 shrink-0 text-ds-faint transition-transform"
                style={threadListOpen ? { transform: 'rotate(180deg)' } : undefined}
                strokeWidth={2}
              />
            </button>
            <button
              type="button"
              onClick={onNewConversation}
              disabled={!canCreateConversation}
              className="ds-sidebar-toggle-button shrink-0 disabled:cursor-not-allowed disabled:opacity-45"
              title={t('designRailNewConversation')}
              aria-label={t('designRailNewConversation')}
            >
              <Plus className="h-4 w-4" strokeWidth={2.1} />
            </button>
          </div>
        </div>

        {threadListOpen ? (
          <div
            ref={threadListRef}
            className="absolute left-2 right-2 top-[58px] z-[60] max-h-[280px] overflow-y-auto rounded-2xl border border-ds-border bg-white p-1.5 shadow-[0_14px_34px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            {designThreads.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-[12.5px] text-ds-faint">
                {t('designRailEmpty')}
              </p>
            ) : (
              designThreads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => {
                    onSwitchThread(thread.id)
                    setThreadListOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                    thread.id === activeThreadId
                      ? 'bg-accent/10 text-accent'
                      : 'text-ds-ink hover:bg-ds-hover'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{thread.title}</span>
                  <span className="shrink-0 text-[11px] text-ds-faint tabular-nums">
                    {formatRelativeTime(thread.updatedAt, i18n.language)}
                  </span>
                </button>
              ))
            )}
            <div className="mt-0.5 border-t border-ds-border-muted/60 pt-1">
              <button
                type="button"
                onClick={() => {
                  onNewConversation()
                  setThreadListOpen(false)
                }}
                disabled={!canCreateConversation}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ds-muted transition hover:bg-ds-hover disabled:opacity-45"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                <span>{t('designRailNewConversation')}</span>
              </button>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white/36 dark:bg-transparent">
          {hasTimeline ? (
            <MessageTimeline
              blocks={blocks}
              liveReasoning={liveReasoning}
              live={liveAssistant}
              activeThreadId={activeThreadId}
              runtimeConnection={runtimeConnection}
              onRetryConnection={onRetryConnection}
              onOpenSettings={() => onOpenSettings('agents')}
              onSelectSuggestion={(text) => setInput(text)}
              compactCards
            />
          ) : (
            <div className="flex h-full items-center justify-center px-7 text-center">
              <div className="max-w-[260px]">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[18px] border border-ds-border-muted bg-white/70 text-accent shadow-sm dark:bg-white/8">
                  <MessageSquare className="h-5 w-5" strokeWidth={1.55} />
                </div>
                <p className="mt-3 text-[13px] leading-6 text-ds-muted">
                  {t('designRailEmpty')}
                </p>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div
        data-design-rail-composer
        className="pointer-events-auto absolute bottom-4 left-1/2 z-[60] w-[min(760px,calc(100%-2rem))] -translate-x-1/2 max-sm:bottom-3 max-sm:w-[calc(100%-1rem)]"
      >
        {showContextControls ? (
          <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
            {pagesRun ? (
              <div className="flex max-w-full items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-2 text-[12.5px] font-semibold text-accent shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-xl">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2} />
                <span className="min-w-0 truncate">
                  {pagesRun.phase === 'generating'
                    ? t('designPagesGenerating', {
                        done: Math.min(pagesRun.done + 1, pagesRun.total),
                        total: pagesRun.total,
                        title: pagesRun.title
                      })
                    : pagesRun.phase === 'foundation'
                      ? t('designPagesFoundation', { title: pagesRun.title })
                      : t('designPagesPlanning')}
                </span>
                <button
                  type="button"
                  onClick={() => cancelDesignPagesRun()}
                  className="flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] transition hover:bg-accent/15"
                  title={t('designPagesStop')}
                  aria-label={t('designPagesStop')}
                >
                  <StopCircle className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {t('designPagesStop')}
                </button>
              </div>
            ) : (
              <>
                {primaryContextChip ? (
                  <div className="flex max-w-full items-center gap-2 rounded-full border border-ds-border bg-white/84 px-3 py-2 text-[12.5px] font-semibold text-ds-muted shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-xl dark:bg-ds-card/88">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.8} />
                    <span className="min-w-0 truncate">{contextLabel}</span>
                    {primaryContextChip.removable !== false && onRemoveContextChip ? (
                      <button
                        type="button"
                        onClick={() => onRemoveContextChip(primaryContextChip.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                        title={t('designProjectClearContext')}
                        aria-label={t('designProjectClearContext')}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {showMultiPageToggle ? (
                  <button
                    type="button"
                    onClick={() => setMultiPageMode(!multiPageMode)}
                    aria-pressed={multiPageMode}
                    title={t('designPagesToggleHint')}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-semibold shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-xl transition ${
                      multiPageMode
                        ? 'border-accent bg-accent text-white'
                        : 'border-ds-border bg-white/84 text-ds-muted hover:text-ds-ink dark:bg-ds-card/88'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    {t('designPagesToggle')}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <DesignQuickSuggestions input={input} setInput={setInput} />

        <FloatingComposer
          variant="compact"
          input={input}
          setInput={setInput}
          mode={mode}
          setMode={setMode}
          busy={effectiveBusy}
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
          contextChips={contextChips}
          onPickAttachments={onPickAttachments}
          onPasteClipboardImage={onPasteClipboardImage}
          onRemoveAttachment={onRemoveAttachment}
          onRemoveContextChip={onRemoveContextChip}
          onSend={() => { openAssistant(); onSend() }}
          onInterrupt={onInterrupt}
          onConfigureProviders={onConfigureProviders}
        />
      </div>
    </div>
  )
}

export const DesignAIRail = memo(DesignAIRailInner)

const DESIGN_QUICK_SUGGESTIONS: { key: string; fallback: string }[] = [
  { key: 'designQuickSuggestMobile', fallback: '适配手机端看看效果' },
  { key: 'designQuickSuggestSection', fallback: '增加一个功能介绍板块' },
  { key: 'designQuickSuggestTheme', fallback: '换一个主题色试试' }
]

/**
 * Numbered quick-action chips above the composer. Hotkeys 1/2/3 pre-fill the
 * input when no text field is focused, matching Stitch's preset chip row.
 */
function DesignQuickSuggestions({
  input,
  setInput
}: {
  input: string
  setInput: (value: string) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  useEffect(() => {
    if (input.trim().length > 0) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Skip when focus is in any editable surface.
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      const idx = Number(event.key) - 1
      if (idx < 0 || idx >= DESIGN_QUICK_SUGGESTIONS.length) return
      event.preventDefault()
      setInput(t(DESIGN_QUICK_SUGGESTIONS[idx].key, DESIGN_QUICK_SUGGESTIONS[idx].fallback))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [input, setInput, t])

  return (
    <div className="mb-2 flex flex-wrap justify-center gap-1.5">
      {DESIGN_QUICK_SUGGESTIONS.map((suggestion, idx) => {
        const label = t(suggestion.key, suggestion.fallback)
        return (
          <button
            key={suggestion.key}
            type="button"
            onClick={() => setInput(label)}
            title={`${label} · ${idx + 1}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-white/80 px-2.5 py-1 text-[11.5px] font-medium text-ds-muted shadow-[0_8px_22px_rgba(20,47,95,0.08)] backdrop-blur-xl transition hover:bg-white hover:text-ds-ink dark:bg-ds-card/82"
          >
            <span className="min-w-0 truncate">{label}</span>
            <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded bg-ds-hover px-1 text-[10px] font-semibold text-ds-faint">
              {idx + 1}
            </span>
          </button>
        )
      })}
    </div>
  )
}
