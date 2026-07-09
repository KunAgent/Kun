import { memo, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  Layers,
  Loader2,
  MessageSquare,
  PanelRightClose,
  Plus,
  Sparkles,
  StopCircle,
  Target,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { deriveThreadTitleFromPrompt } from '../../lib/thread-title'
import type { AttachmentReference, NormalizedThread, RuntimeConnectionStatus, ChatBlock } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import type { QueuedUserMessage } from '../../store/chat-store-types'
import { threadSnapshotLooksRunning } from '../../store/chat-store-runtime-helpers'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { DESIGN_ASSISTANT_THREAD_TITLE } from '../../design/design-thread-registry'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { defaultFrameSizeForDesignTarget } from '../../design/design-context'
import { cancelDesignPagesRun } from '../../design/design-pages-run'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { FloatingComposer } from '../chat/FloatingComposer'
import type { DesignComposerContext } from '../chat/FloatingComposer'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import { DesignTargetToggle } from './DesignTargetToggle'

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
  onCollapse: () => void
  className?: string
}

export function designThreadTitleLooksDefault(
  title: string | null | undefined,
  localizedDefaultTitle?: string
): boolean {
  const raw = title?.trim() ?? ''
  if (!raw) return true
  return raw === DESIGN_ASSISTANT_THREAD_TITLE || raw === localizedDefaultTitle?.trim()
}

export function deriveDesignThreadTitleFromBlocks(blocks: readonly ChatBlock[]): string {
  const firstUser = blocks.find((block) => block.kind === 'user')
  if (!firstUser || firstUser.kind !== 'user') return ''
  const text = (firstUser.meta?.displayText ?? firstUser.text).trim()
  if (!text) return ''
  return deriveThreadTitleFromPrompt(text)
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
  onSwitchThread,
  onCollapse,
  className = ''
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const designIntentMode = useDesignWorkspaceStore((s) => s.designIntentMode)
  const designTarget = useDesignWorkspaceStore((s) => s.designContext.designTarget ?? 'web')
  const setDesignTarget = useDesignWorkspaceStore((s) => s.setDesignTarget)
  const multiPageMode = useDesignWorkspaceStore((s) => s.multiPageMode)
  const setMultiPageMode = useDesignWorkspaceStore((s) => s.setMultiPageMode)
  const pagesRun = useDesignWorkspaceStore((s) => s.pagesRun)
  const [threadListOpen, setThreadListOpen] = useState(false)
  const threadListRef = useRef<HTMLDivElement | null>(null)
  const threadPillRef = useRef<HTMLButtonElement | null>(null)
  const [childThreadId, setChildThreadId] = useState<string | null>(null)
  const [childBlocks, setChildBlocks] = useState<ChatBlock[]>([])
  const [childStatus, setChildStatus] = useState<string | undefined>(undefined)
  const [childLoading, setChildLoading] = useState(false)
  const [childError, setChildError] = useState<string | null>(null)
  const [threadTitleOverrides, setThreadTitleOverrides] = useState<Record<string, string>>({})

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

  useEffect(() => {
    const missing = designThreads.filter(
      (thread) =>
        designThreadTitleLooksDefault(thread.title, t('designRailTitle')) &&
        !threadTitleOverrides[thread.id]
    )
    if (missing.length === 0) return
    let cancelled = false
    for (const thread of missing) {
      void getProvider()
        .getThreadDetail(thread.id)
        .then((detail) => {
          if (cancelled) return
          const title = deriveDesignThreadTitleFromBlocks(detail.blocks)
          if (!title || designThreadTitleLooksDefault(title, t('designRailTitle'))) return
          setThreadTitleOverrides((current) =>
            current[thread.id] ? current : { ...current, [thread.id]: title }
          )
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [designThreads, t, threadTitleOverrides])

  useEffect(() => {
    setChildThreadId(null)
    setChildBlocks([])
    setChildStatus(undefined)
    setChildError(null)
  }, [activeThreadId])

  useEffect(() => {
    if (!childThreadId) {
      setChildBlocks([])
      setChildStatus(undefined)
      setChildError(null)
      setChildLoading(false)
      return
    }
    let cancelled = false
    let pollTimer: number | null = null
    setChildLoading(true)
    setChildError(null)
    const load = async (): Promise<void> => {
      try {
        const detail = await getProvider().getThreadDetail(childThreadId)
        if (cancelled) return
        setChildBlocks(detail.blocks)
        setChildStatus(detail.threadStatus)
        setChildError(null)
        const shouldPoll = threadSnapshotLooksRunning(detail.blocks, detail.threadStatus)
        if (shouldPoll) {
          pollTimer = window.setTimeout(load, 1500)
        }
      } catch (error) {
        if (!cancelled) {
          setChildError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) setChildLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }, [childThreadId])


  const activeThread = designThreads.find((th) => th.id === activeThreadId) ?? null
  const showingDocumentThread = Boolean(activeThread)
  const viewingChildThread = Boolean(childThreadId)

  const timelineBlocks = viewingChildThread ? childBlocks : showingDocumentThread ? blocks : []
  const timelineThreadId = viewingChildThread ? childThreadId : showingDocumentThread ? activeThreadId : null
  const timelineLiveReasoning = viewingChildThread ? '' : showingDocumentThread ? liveReasoning : ''
  const timelineLiveAssistant = viewingChildThread ? '' : showingDocumentThread ? liveAssistant : ''
  const hasTimeline = viewingChildThread
    ? childBlocks.length > 0
    : showingDocumentThread && (
      blocks.length > 0 || liveReasoning.trim().length > 0 || liveAssistant.trim().length > 0
    )
  const runActive = Boolean(pagesRun)
  const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null
  const designTargetContextChip = contextChips.find((chip) => chip.kind === 'design-target') ?? null
  const targetSize = defaultFrameSizeForDesignTarget(designTarget)
  const appTarget = designTarget === 'app'
  const targetChipMatchesSelection = designTargetContextChip?.id === `design-target:${designTarget}`
  const designTargetLabel = t(appTarget ? 'designTargetApp' : 'designTargetWeb')
  const designTargetDetail =
    (targetChipMatchesSelection ? designTargetContextChip?.detail : undefined) ??
    t(appTarget ? 'designTargetContextApp' : 'designTargetContextWeb', {
      width: targetSize.width,
      height: targetSize.height
    })
  const designTargetStatusTitle = `${t('designTargetContextStatus')}: ${designTargetLabel} - ${designTargetDetail}`
  const primaryContextChip = contextChips.find((chip) => chip.kind !== 'design-target') ?? null
  // Keep the composer + new-conversation locked across the whole multi-page run,
  // even during the brief idle gaps between page turns.
  const effectiveBusy = (showingDocumentThread && busy) || runActive
  const canCreateConversation = runtimeConnection === 'ready' && !effectiveBusy && !viewingChildThread
  const showMultiPageToggle =
    designIntentMode === 'generate' && !runActive && activeArtifact?.kind !== 'canvas'
  const contextLabel = primaryContextChip
    ? `${designIntentMode === 'preview' ? t('designProjectPreview') : t('designProjectModify')} · ${primaryContextChip.label}`
    : ''
  const showContextControls =
    !viewingChildThread && (runActive || Boolean(primaryContextChip) || showMultiPageToggle)
  const titleForDesignThread = (thread: NormalizedThread, index: number): string => {
    const localizedDefault = t('designRailTitle')
    if (!designThreadTitleLooksDefault(thread.title, localizedDefault)) return thread.title
    const fromActiveBlocks =
      thread.id === activeThreadId && !viewingChildThread
        ? deriveDesignThreadTitleFromBlocks(blocks)
        : ''
    return (
      fromActiveBlocks ||
      threadTitleOverrides[thread.id] ||
      t('designRailDrawingFallback', { number: index + 1 })
    )
  }
  const activeThreadIndex = activeThread
    ? Math.max(0, designThreads.findIndex((thread) => thread.id === activeThread.id))
    : 0
  const activeThreadTitle = activeThread ? titleForDesignThread(activeThread, activeThreadIndex) : ''
  const headerTitle = viewingChildThread
    ? t('subagentSessionBannerTitle')
    : activeThreadTitle || t('designRailTitle')

  const openChildThread = (threadId: string): void => {
    setThreadListOpen(false)
    setChildThreadId(threadId)
  }

  const closeChildThread = (): void => {
    setChildThreadId(null)
    setChildBlocks([])
    setChildStatus(undefined)
    setChildError(null)
  }

  return (
    <aside
      className={`design-ai-panel ds-no-drag relative flex min-h-0 flex-col overflow-hidden border-l border-ds-border-muted bg-white text-ds-ink backdrop-blur-xl dark:bg-ds-canvas ${className}`}
    >
        <div className="shrink-0 border-b border-ds-border-muted bg-white/92 px-3 py-3 dark:bg-ds-card">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={onCollapse}
              className="ds-sidebar-toggle-button shrink-0"
              title={t('designRailCollapse')}
              aria-label={t('designRailCollapse')}
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
            </button>
            <button
              ref={threadPillRef}
              type="button"
              onClick={() => {
                if (viewingChildThread) return
                setThreadListOpen((v) => !v)
              }}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-ds-subtle px-3 py-2 transition hover:bg-ds-hover dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
              title={viewingChildThread ? t('subagentSessionBannerTitle') : t('designRailSwitchThread')}
              aria-label={viewingChildThread ? t('subagentSessionBannerTitle') : t('designRailSwitchThread')}
            >
              <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
              <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink">
                {headerTitle}
              </span>
              {!viewingChildThread ? (
                <ChevronDown
                  className="ml-auto h-3 w-3 shrink-0 text-ds-faint transition-transform"
                  style={threadListOpen ? { transform: 'rotate(180deg)' } : undefined}
                  strokeWidth={2}
                />
              ) : null}
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

        {threadListOpen && !viewingChildThread ? (
          <div
            ref={threadListRef}
            className="absolute left-2 right-2 top-[58px] z-[60] max-h-[280px] overflow-y-auto rounded-2xl border border-ds-border bg-white p-1.5 shadow-[0_14px_34px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            {designThreads.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-[12.5px] text-ds-faint">
                {t('designRailEmpty')}
              </p>
            ) : (
              designThreads.map((thread, index) => (
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
                  <span className="min-w-0 flex-1 truncate text-[13px]">{titleForDesignThread(thread, index)}</span>
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
          {viewingChildThread ? (
            <div className="sticky top-0 z-20 border-b border-ds-border-muted/80 bg-white/88 px-4 py-3 backdrop-blur-xl dark:bg-ds-card/88">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeChildThread}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-ds-border bg-white px-2.5 text-[12px] font-semibold text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink dark:bg-white/8"
                >
                  <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {t('designRailChildBack', '返回设计主会话')}
                </button>
                <div className="min-w-0 flex-1 text-right">
                  <div className="truncate text-[12.5px] font-semibold text-ds-ink">
                    {t('subagentSessionBannerTitle')}
                  </div>
                  <div className="truncate text-[10.5px] text-ds-faint">
                    {childLoading ? t('designRailChildLoading', '加载子代理输出中…') : childStatus || childThreadId}
                  </div>
                </div>
              </div>
              {childError ? (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50/80 px-2.5 py-2 text-[12px] leading-5 text-red-700">
                  {t('designRailChildError', '子代理会话加载失败')}: {childError}
                </div>
              ) : null}
            </div>
          ) : null}
          {viewingChildThread && childLoading && childBlocks.length === 0 ? (
            <div className="flex h-40 items-center justify-center gap-2 text-[12.5px] font-medium text-ds-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={2} />
              {t('designRailChildLoading')}
            </div>
          ) : hasTimeline ? (
            <LazyMessageTimeline
              blocks={timelineBlocks}
              liveReasoning={timelineLiveReasoning}
              live={timelineLiveAssistant}
              activeThreadId={timelineThreadId}
              runtimeConnection={runtimeConnection}
              onRetryConnection={onRetryConnection}
              onOpenSettings={() => onOpenSettings('agents')}
              onSelectSuggestion={(text) => setInput(text)}
              onOpenChildThread={openChildThread}
              compactCards
            />
          ) : !viewingChildThread ? (
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
          ) : null}
        </div>

      <div
        data-design-rail-composer
        className="shrink-0 border-t border-ds-border-muted bg-white/92 px-4 pb-4 pt-3 dark:bg-ds-card"
      >
        {!viewingChildThread ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <DesignTargetToggle
              designTarget={designTarget}
              disabled={effectiveBusy}
              disabledReason={effectiveBusy ? t('designTargetLockedHint') : undefined}
              onChange={setDesignTarget}
            />
            <div
              className="flex max-w-full items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-2 text-[12.5px] font-semibold text-ds-muted"
              title={designTargetStatusTitle}
              aria-label={designTargetStatusTitle}
            >
              <Target className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.8} />
              <span className="shrink-0 text-ds-ink">{t('designTargetContextStatus')}</span>
              <span className="text-ds-faint">·</span>
              <span className="shrink-0 text-ds-ink">{designTargetLabel}</span>
              <span className="hidden min-w-0 truncate text-ds-faint sm:inline">{designTargetDetail}</span>
            </div>
            {showContextControls ? (
              <>
            {pagesRun ? (
              <div className="flex max-w-full items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-2 text-[12.5px] font-semibold text-accent">
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
                  <div className="flex max-w-full items-center gap-2 rounded-full border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-muted dark:bg-white/6">
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
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-semibold transition ${
                      multiPageMode
                        ? 'border-accent bg-accent text-white'
                        : 'border-ds-border bg-ds-surface-subtle text-ds-muted hover:text-ds-ink dark:bg-white/6'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                    {t('designPagesToggle')}
                  </button>
                ) : null}
              </>
            )}
              </>
            ) : null}
          </div>
        ) : null}
        {viewingChildThread ? (
          <div className="flex w-fit max-w-full items-center gap-2 rounded-full border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-muted dark:bg-white/6">
            <span>{t('subagentSessionBannerTitle')}</span>
            <button
              type="button"
              onClick={closeChildThread}
              className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11.5px] text-accent transition hover:bg-accent/10"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.9} />
              {t('designRailChildBack', '返回设计主会话')}
            </button>
          </div>
        ) : (
          <FloatingComposer
            variant="compact"
            workspaceRootOverride={workspaceRoot}
            input={input}
            setInput={setInput}
            mode={mode}
            setMode={setMode}
            busy={effectiveBusy}
            runtimeReady={runtimeConnection === 'ready'}
            hasActiveThread={showingDocumentThread}
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
            onSend={onSend}
            onInterrupt={onInterrupt}
            onConfigureProviders={onConfigureProviders}
          />
        )}
      </div>
    </aside>
  )
}

export const DesignAIRail = memo(DesignAIRailInner)
