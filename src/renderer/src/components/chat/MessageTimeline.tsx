import type { ReactElement, RefObject } from 'react'
import { Fragment, lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileEdit,
  FolderOpen,
  GitFork,
  Lightbulb,
  Loader2,
  MessageSquareQuote,
  Minimize2,
  Palette,
  PencilLine,
  Terminal,
  Wrench
} from 'lucide-react'
import type { ClawImChannelV1 } from '@shared/app-settings'
import type {
  ChatBlock,
  RuntimeConnectionStatus,
  ToolBlock,
  UserInputAnswer,
  UserInputQuestion
} from '../../agent/types'
import {
  countDiffStats,
  extractDiffFilePath,
  formatFilePathForDisplay,
  looksLikeUnifiedDiff,
  sumDiffStats
} from '../../lib/diff-stats'
import { useDeferredRender } from '../../hooks/use-deferred-render'
import { useChatStore } from '../../store/chat-store'
import {
  parseWritePromptForDisplay,
  type WritePromptDisplay,
  type WritePromptDisplayQuote
} from '../../write/quoted-selection'
import { DiffView } from '../DiffView'

const LazyStreamdownAssistant = lazy(() =>
  import('./StreamdownAssistant').then((module) => ({ default: module.StreamdownAssistant }))
)

type Props = {
  blocks: ChatBlock[]
  liveReasoning: string
  live: string
  activeThreadId: string | null
  runtimeConnection: RuntimeConnectionStatus
  onRetryConnection: () => void
  onOpenSettings: () => void
  onOpenDiagnostics: () => void
  onSelectSuggestion?: (prompt: string) => void
  devPreviewCard?: ReactElement | null
}

type Turn = {
  user?: Extract<ChatBlock, { kind: 'user' }>
  blocks: ChatBlock[]
}

const COPY_FEEDBACK_RESET_MS = 1600
const TURN_PAGE_SIZE = 18
const AUTO_COLLAPSE_THRESHOLD = 24
const TOP_LOAD_TRIGGER_PX = 120

type AssistantMarkdownProps = {
  text: string
  streaming: boolean
  className?: string
}

function AssistantMarkdown({
  text,
  streaming,
  className
}: AssistantMarkdownProps): ReactElement {
  return (
    <Suspense
      fallback={
        <div className={className}>
          {text}
        </div>
      }
    >
      <LazyStreamdownAssistant text={text} streaming={streaming} className={className} />
    </Suspense>
  )
}

function ThreadForkBanner({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-[18px] border border-accent/16 bg-accent/7 px-4 py-3 text-ds-muted shadow-[0_14px_36px_rgba(0,136,255,0.05)]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-accent/12 text-accent">
          <GitFork className="h-4 w-4" strokeWidth={1.85} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold text-ds-ink">
            {t('threadForkBannerTitle')}
          </span>
          <span className="mt-1 block text-[12.5px] leading-5 text-ds-muted">
            {parentTitle
              ? t('threadForkBannerSub', { title: parentTitle })
              : t('threadForkBannerSubUnknown')}
          </span>
        </span>
      </div>
    </div>
  )
}

function ThreadForkPoint({ parentTitle }: { parentTitle: string }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-3 py-1 text-[12px] font-medium text-ds-faint">
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
      <span
        className="inline-flex max-w-[min(100%,420px)] items-center gap-1.5 rounded-full border border-accent/16 bg-ds-card/78 px-3 py-1.5 text-accent shadow-sm"
        title={parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
      >
        <GitFork className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="truncate">
          {parentTitle ? t('threadForkPointFrom', { title: parentTitle }) : t('threadForkPoint')}
        </span>
      </span>
      <span className="h-px min-w-6 flex-1 bg-ds-border-muted" />
    </div>
  )
}

export function MessageTimeline({
  blocks,
  liveReasoning,
  live,
  activeThreadId,
  runtimeConnection,
  onRetryConnection,
  onOpenSettings,
  onOpenDiagnostics,
  onSelectSuggestion,
  devPreviewCard
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const route = useChatStore((s) => s.route)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const clawChannels = useChatStore((s) => s.clawChannels)
  const activeClawChannelId = useChatStore((s) => s.activeClawChannelId)
  const busy = useChatStore((s) => s.busy)
  const currentTurnUserId = useChatStore((s) => s.currentTurnUserId)
  const turnStartedAtByUserId = useChatStore((s) => s.turnStartedAtByUserId)
  const turnDurationByUserId = useChatStore((s) => s.turnDurationByUserId)
  const turnReasoningFirstAtByUserId = useChatStore((s) => s.turnReasoningFirstAtByUserId)
  const turnReasoningLastAtByUserId = useChatStore((s) => s.turnReasoningLastAtByUserId)
  const activeThread = useChatStore((s) =>
    activeThreadId ? s.threads.find((thread) => thread.id === activeThreadId) ?? null : null
  )
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )
  const heroRoute: 'chat' | 'claw' = route === 'claw' ? 'claw' : 'chat'
  const hasContent = blocks.length > 0 || live || liveReasoning
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const historyExpansionRequestedRef = useRef(false)
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const prependInFlightRef = useRef(false)
  const scrollFrameRef = useRef<number | null>(null)
  const turns = useMemo(() => groupTurns(blocks), [blocks])
  const shouldCollapseHistory = turns.length > AUTO_COLLAPSE_THRESHOLD
  const [visibleTurnCount, setVisibleTurnCount] = useState(() =>
    shouldCollapseHistory ? TURN_PAGE_SIZE : turns.length
  )
  const hiddenTurnCount = Math.max(0, turns.length - visibleTurnCount)
  const visibleTurns = useMemo(
    () => (hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns),
    [hiddenTurnCount, turns]
  )
  const forkedFromTitle = activeThread?.forkedFromTitle?.trim() ?? ''
  const forkBoundaryTurnCount =
    typeof activeThread?.forkedFromTurnCount === 'number'
      ? Math.max(0, activeThread.forkedFromTurnCount)
      : undefined

  const loadEarlierTurns = useCallback((options?: { userInitiated?: boolean }): void => {
    if (hiddenTurnCount === 0 || prependInFlightRef.current) return
    if (options?.userInitiated) {
      historyExpansionRequestedRef.current = true
    }
    const el = containerRef.current
    if (el) {
      pendingPrependRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop
      }
    }
    prependInFlightRef.current = true
    setVisibleTurnCount((count) => Math.min(turns.length, count + TURN_PAGE_SIZE))
  }, [hiddenTurnCount, turns.length])

  // Tick a clock while a turn is running so the live "Worked for Xs" updates.
  const [tickNow, setTickNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy || !currentTurnUserId) return
    setTickNow(Date.now())
    const id = window.setInterval(() => setTickNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy, currentTurnUserId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottomRef.current = distanceToBottom < 96
      if (hiddenTurnCount > 0 && el.scrollTop <= TOP_LOAD_TRIGGER_PX) {
        loadEarlierTurns({ userInitiated: true })
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [hiddenTurnCount, loadEarlierTurns])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null
      endRef.current?.scrollIntoView({
        behavior: live || liveReasoning ? 'auto' : 'smooth',
        block: 'end'
      })
    })
  }, [blocks, live, liveReasoning])

  useEffect(() => {
    stickToBottomRef.current = true
    historyExpansionRequestedRef.current = false
    pendingPrependRef.current = null
    prependInFlightRef.current = false
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [activeThreadId])

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    []
  )

  useEffect(() => {
    setVisibleTurnCount(shouldCollapseHistory ? TURN_PAGE_SIZE : turns.length)
  }, [activeThreadId, shouldCollapseHistory, turns.length])

  useEffect(() => {
    if (!busy) return
    setVisibleTurnCount((count) => Math.max(count, turns.length))
  }, [busy, turns.length])

  useEffect(() => {
    const snapshot = pendingPrependRef.current
    const el = containerRef.current
    if (!snapshot || !el) return

    pendingPrependRef.current = null
    prependInFlightRef.current = false

    requestAnimationFrame(() => {
      const addedHeight = el.scrollHeight - snapshot.scrollHeight
      el.scrollTop = snapshot.scrollTop + Math.max(0, addedHeight)
    })
  }, [visibleTurnCount])

  useEffect(() => {
    const el = containerRef.current
    if (!el || hiddenTurnCount === 0 || prependInFlightRef.current) return
    if (!historyExpansionRequestedRef.current) return
    if (el.scrollHeight <= el.clientHeight + TOP_LOAD_TRIGGER_PX) {
      loadEarlierTurns()
    }
  }, [hiddenTurnCount, loadEarlierTurns, visibleTurnCount])

  return (
    <div ref={containerRef} className="ds-no-drag flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      <div className="ds-chat-column-inset mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-8 pb-10 pt-8">
        {!activeThreadId && (
          <EmptyHero
            route={heroRoute}
            ready={runtimeConnection === 'ready'}
            hasWorkspace={!!workspaceRoot}
            activeClawChannel={activeClawChannel}
            onPickWorkspace={() => void chooseWorkspace()}
            onRetry={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onOpenDiagnostics={onOpenDiagnostics}
            onSelectSuggestion={onSelectSuggestion}
          />
        )}

        {activeThreadId && !hasContent && (
          <EmptyHero
            route={heroRoute}
            ready={runtimeConnection === 'ready'}
            hasWorkspace={!!workspaceRoot}
            activeClawChannel={activeClawChannel}
            onPickWorkspace={() => void chooseWorkspace()}
            onRetry={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onOpenDiagnostics={onOpenDiagnostics}
            onSelectSuggestion={onSelectSuggestion}
          />
        )}

        {activeThread?.forkedFromThreadId ? (
          <ThreadForkBanner parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount > 0 ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => loadEarlierTurns({ userInitiated: true })}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            >
              {t('timelineShowEarlierTurns', { count: Math.min(hiddenTurnCount, TURN_PAGE_SIZE) })}
            </button>
          </div>
        ) : null}

        {visibleTurns.map((turn, index) => {
          const absoluteTurnIndex = hiddenTurnCount + index
          const userId = turn.user?.id
          const isLive = !!(userId && currentTurnUserId === userId)
          const startedAt = userId ? turnStartedAtByUserId[userId] : undefined
          const recordedDuration = userId ? turnDurationByUserId[userId] : undefined
          const durationMs =
            recordedDuration ??
            (isLive && typeof startedAt === 'number'
              ? Math.max(0, tickNow - startedAt)
              : undefined)
          const reasoningFirst = userId ? turnReasoningFirstAtByUserId[userId] : undefined
          const reasoningLast = userId ? turnReasoningLastAtByUserId[userId] : undefined
          const reasoningDurationMs =
            typeof reasoningFirst === 'number' && typeof reasoningLast === 'number'
              ? Math.max(0, reasoningLast - reasoningFirst)
              : undefined
          const turnPending = turnHasPendingRuntimeWork(turn)
          const isLatestTurn = index === visibleTurns.length - 1
          const hasLiveStream = isLatestTurn && !!(liveReasoning.trim() || live.trim())
          const showForkPoint =
            forkBoundaryTurnCount !== undefined && absoluteTurnIndex === forkBoundaryTurnCount
          return (
            <Fragment key={userId ?? `turn-${index}`}>
              {showForkPoint ? <ThreadForkPoint parentTitle={forkedFromTitle} /> : null}
              <MemoMessageTurn
                turn={turn}
                isProcessing={(busy && isLatestTurn) || turnPending || hasLiveStream}
                liveReasoning={isLatestTurn ? liveReasoning : ''}
                live={isLatestTurn ? live : ''}
                durationMs={durationMs}
                reasoningDurationMs={reasoningDurationMs}
                devPreviewCard={isLatestTurn ? devPreviewCard : null}
                viewportRef={containerRef}
              />
            </Fragment>
          )
        })}

        {forkBoundaryTurnCount !== undefined &&
        forkBoundaryTurnCount === turns.length &&
        hasContent ? (
          <ThreadForkPoint parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount === 0 && shouldCollapseHistory && turns.length > TURN_PAGE_SIZE && !busy ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                historyExpansionRequestedRef.current = false
                setVisibleTurnCount(TURN_PAGE_SIZE)
              }}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('timelineCollapseEarlierTurns')}
            </button>
          </div>
        ) : null}

        {blocks.length === 0 && (live || liveReasoning) ? (
          <MemoMessageTurn
            turn={{ blocks: [] }}
            isProcessing={busy}
            liveReasoning={liveReasoning}
            live={live}
            devPreviewCard={devPreviewCard}
            viewportRef={containerRef}
            durationMs={
              currentTurnUserId && typeof turnStartedAtByUserId[currentTurnUserId] === 'number'
                ? Math.max(0, tickNow - turnStartedAtByUserId[currentTurnUserId])
                : undefined
            }
            reasoningDurationMs={(() => {
              if (!currentTurnUserId) return undefined
              const first = turnReasoningFirstAtByUserId[currentTurnUserId]
              const last = turnReasoningLastAtByUserId[currentTurnUserId]
              if (typeof first !== 'number' || typeof last !== 'number') return undefined
              return Math.max(0, last - first)
            })()}
          />
        ) : null}
        <div ref={endRef} aria-hidden className="h-px w-full shrink-0" />
      </div>
    </div>
  )
}

type SuggestionTone = 'blue' | 'emerald' | 'violet' | 'orange'

const SUGGESTION_TONE: Record<SuggestionTone, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-ds-skill-soft dark:text-ds-skill',
  orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300'
}

function EmptyHero({
  route,
  ready,
  hasWorkspace,
  activeClawChannel,
  onPickWorkspace,
  onRetry,
  onOpenSettings,
  onOpenDiagnostics,
  onSelectSuggestion
}: {
  route: 'chat' | 'claw'
  ready: boolean
  hasWorkspace: boolean
  activeClawChannel: ClawImChannelV1 | null
  onPickWorkspace: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onOpenDiagnostics: () => void
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')

  if (!ready) {
    return (
      <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
        <div className="ds-card-soft mb-5 rounded-[20px] px-5 py-4">
          <Bot className="mx-auto h-7 w-7 text-accent opacity-90" strokeWidth={1.4} />
        </div>
        <p className="max-w-sm text-[24px] font-semibold tracking-[-0.03em] text-ds-ink">
          {t('runtimeOfflineHeroTitle')}
        </p>
        <p className="mt-3 max-w-[560px] text-[15.5px] leading-7 text-ds-muted">
          {t('runtimeOfflineHeroSub')}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="ds-chip rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-ink transition hover:text-ds-ink"
            onClick={onRetry}
          >
            {t('retryConnection')}
          </button>
          <button
            type="button"
            className="ds-chip-muted rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            onClick={onOpenDiagnostics}
          >
            {t('runtimeDiagnosticsButton')}
          </button>
          <button
            type="button"
            className="ds-chip-muted rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            onClick={onOpenSettings}
          >
            {t('openSettings')}
          </button>
        </div>
      </div>
    )
  }

  if (!hasWorkspace) {
    return (
      <div className="ds-no-drag flex flex-col items-center justify-center px-6 py-24 text-center">
        <FolderOpen className="mb-4 h-8 w-8 text-ds-muted" strokeWidth={1.6} />
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-ds-ink">
          {t('selectWorkspace')}
        </h1>
        <p className="mt-2 max-w-sm text-[14.5px] leading-6 text-ds-muted">
          {t('emptyHeroSubNoWorkspace')}
        </p>
        <button
          type="button"
          className="ds-chip mt-5 rounded-full px-5 py-2.5 text-[13px] font-medium text-ds-ink transition hover:text-ds-ink"
          onClick={onPickWorkspace}
        >
          {t('selectWorkspace')}
        </button>
      </div>
    )
  }

  if (route === 'claw') {
    return (
      <ClawEmptyHero
        channel={activeClawChannel}
        onSelectSuggestion={onSelectSuggestion}
      />
    )
  }

  const suggestions: Array<{
    icon: ReactElement
    tone: SuggestionTone
    titleKey: string
    subKey: string
    promptKey: string
  }> = [
    {
      icon: <FolderOpen className="h-4 w-4" strokeWidth={1.8} />,
      tone: 'blue',
      titleKey: 'promptStructureTitle',
      subKey: 'promptStructureSub',
      promptKey: 'promptStructurePrompt'
    },
    {
      icon: <Bug className="h-4 w-4" strokeWidth={1.8} />,
      tone: 'emerald',
      titleKey: 'promptBugTitle',
      subKey: 'promptBugSub',
      promptKey: 'promptBugPrompt'
    },
    {
      icon: <Lightbulb className="h-4 w-4" strokeWidth={1.8} />,
      tone: 'violet',
      titleKey: 'promptPlanTitle',
      subKey: 'promptPlanSub',
      promptKey: 'promptPlanPrompt'
    },
    {
      icon: <Palette className="h-4 w-4" strokeWidth={1.8} />,
      tone: 'orange',
      titleKey: 'promptDesignTitle',
      subKey: 'promptDesignSub',
      promptKey: 'promptDesignPrompt'
    }
  ]

  return (
    <div className="ds-empty-hero ds-no-drag flex flex-col items-center justify-center px-4 pb-4 pt-20 text-center">
      <h1 className="ds-empty-hero-title text-[40px] font-semibold tracking-[-0.045em] text-ds-ink">
        {t('emptyHeroTitle')}
      </h1>
      <p className="ds-empty-hero-sub mt-5 text-[17px] leading-8 text-ds-muted">
        {t('emptyHeroSub')}
      </p>

      <div className="ds-empty-hero-grid mt-12 grid w-full max-w-[980px] gap-5">
        {suggestions.map((s) => (
          <button
            key={s.titleKey}
            type="button"
            onClick={() => onSelectSuggestion?.(t(s.promptKey))}
            className="ds-empty-hero-card group flex min-h-[118px] items-center gap-4 rounded-[24px] border border-[rgba(15,23,42,0.1)] bg-[rgba(255,255,255,0.92)] px-6 py-5 text-left shadow-[0_18px_48px_rgba(86,103,136,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-[rgba(0,136,255,0.18)] hover:shadow-[0_24px_56px_rgba(86,103,136,0.14)] dark:border-white/10 dark:bg-[rgba(24,24,24,0.9)] dark:shadow-[0_20px_52px_rgba(0,0,0,0.24)]"
          >
            <span
              className={`ds-empty-hero-card-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] ${SUGGESTION_TONE[s.tone]}`}
            >
              {s.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="ds-empty-hero-card-title block truncate text-[18px] font-semibold tracking-[-0.02em] text-ds-ink">
                {t(s.titleKey)}
              </span>
              <span className="ds-empty-hero-card-sub mt-1 block text-[15px] leading-6 text-ds-faint">
                {t(s.subKey)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

type ClawPromptSuggestion = {
  icon: ReactElement
  tone: SuggestionTone
  titleKey: string
  subKey: string
  promptKey: string
}

function clawChannelDisplayName(
  channel: ClawImChannelV1 | null,
  fallback: string
): string {
  if (!channel) return fallback
  return (
    channel.agentProfile.name.trim()
    || channel.label.trim()
    || channel.agentProfile.description.trim()
    || fallback
  )
}

function clawChannelSummary(
  channel: ClawImChannelV1 | null,
  fallback: string
): string {
  if (!channel) return fallback
  return (
    channel.agentProfile.description.trim()
    || channel.agentProfile.identity.trim()
    || channel.agentProfile.personality.trim()
    || fallback
  )
}

function ClawEmptyHero({
  channel,
  onSelectSuggestion
}: {
  channel: ClawImChannelV1 | null
  onSelectSuggestion?: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const agentName = clawChannelDisplayName(channel, t('clawEmptyHeroFallbackName'))
  void onSelectSuggestion
  const hasInboundConversation = Boolean(
    channel?.conversations.length || channel?.remoteSession?.chatId?.trim()
  )

  return (
    <div className="ds-no-drag flex justify-center px-4 pb-6 pt-12 md:px-8 md:pt-16">
      <div className="w-full max-w-[980px] rounded-[32px] border border-ds-border-muted bg-ds-card/78 px-8 py-10 text-left shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur md:px-12 md:py-14">
        <div className="max-w-[720px]">
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] border border-ds-border-muted bg-ds-main/55 text-accent">
            <Bot className="h-6 w-6" strokeWidth={1.9} />
          </div>

          <h1 className="mt-6 text-[34px] font-semibold tracking-[-0.055em] text-ds-ink md:text-[48px]">
            {t('clawEmptyHeroTitle', { name: agentName })}
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-ds-muted md:text-[16px]">
            {hasInboundConversation ? t('clawEmptyHeroSub') : t('clawEmptyHeroNeedsInbound')}
          </p>
        </div>
      </div>
    </div>
  )
}

function groupTurns(blocks: ChatBlock[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const block of blocks) {
    if (block.kind === 'user') {
      if (current) turns.push(current)
      current = { user: block, blocks: [] }
      continue
    }
    if (!current) current = { blocks: [] }
    current.blocks.push(block)
  }

  if (current) turns.push(current)
  return turns
}

function splitThink(text: string): { think: string; content: string } {
  const match = text.match(/<think>([\s\S]*?)(?:<\/think>|$)/)
  if (!match) return { think: '', content: text }
  return {
    think: match[1].trim(),
    content: text.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim()
  }
}

function blockHasPendingRuntimeWork(block: ChatBlock): boolean {
  if (block.kind === 'tool') return block.status === 'running'
  if (block.kind === 'compaction') return block.status === 'running'
  if (block.kind === 'approval') return block.status === 'pending'
  if (block.kind === 'user_input') return block.status === 'pending'
  return false
}

function isProcessBlock(block: ChatBlock): boolean {
  return (
    block.kind === 'reasoning' ||
    block.kind === 'tool' ||
    block.kind === 'compaction' ||
    block.kind === 'approval' ||
    block.kind === 'user_input' ||
    block.kind === 'system'
  )
}

function turnHasPendingRuntimeWork(turn: Turn): boolean {
  return turn.blocks.some(blockHasPendingRuntimeWork)
}

function findTrailingAssistantContentStart(blocks: ChatBlock[]): number {
  let start = blocks.length

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.kind !== 'assistant') break

    const split = splitThink(block.text)
    if (!split.content.trim()) break
    start = index
  }

  return start
}

type ProcessSection = {
  id: string
  kind: 'reasoning' | 'execution' | 'output'
  blocks: ChatBlock[]
}

function groupProcessSections(blocks: ChatBlock[]): ProcessSection[] {
  const sections: ProcessSection[] = []

  for (const block of blocks) {
    const kind =
      block.kind === 'reasoning'
        ? 'reasoning'
        : block.kind === 'assistant'
          ? 'output'
          : 'execution'
    const last = sections[sections.length - 1]
    if (last && last.kind === kind) {
      last.blocks.push(block)
      continue
    }
    sections.push({
      id: `${kind}-${block.id}`,
      kind,
      blocks: [block]
    })
  }

  return sections
}

function getReasoningSectionText(section: ProcessSection): string {
  if (section.kind !== 'reasoning') return ''
  return section.blocks
    .filter(
      (block): block is Extract<ChatBlock, { kind: 'reasoning' }> => block.kind === 'reasoning'
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function sectionHasDetails(
  section: ProcessSection,
  t: (key: string, opts?: Record<string, unknown>) => string
): boolean {
  if (section.kind === 'reasoning') {
    return getReasoningSectionText(section).length > 0
  }
  if (section.kind === 'output') {
    return section.blocks.some(
      (block) => getProcessDetail(block, describeProcessBlock(block, t)).kind === 'assistant'
    )
  }
  if (section.blocks.length > 1) return true
  const [block] = section.blocks
  return block ? getProcessDetail(block, describeProcessBlock(block, t)).kind !== 'none' : false
}

function isProcessSectionActive(section: ProcessSection, processing: boolean): boolean {
  if (!processing) return false
  if (section.kind === 'reasoning') {
    return section.blocks.some((block) => block.id === 'live-reasoning')
  }
  if (section.kind === 'output') {
    return section.blocks.some((block) => block.id === 'live-assistant')
  }
  return section.blocks.some(
    (block) => block.id === 'live-assistant' || blockHasPendingRuntimeWork(block)
  )
}

function MessageTurn({
  turn,
  isProcessing,
  liveReasoning,
  live,
  durationMs,
  reasoningDurationMs,
  devPreviewCard,
  viewportRef
}: {
  turn: Turn
  isProcessing: boolean
  liveReasoning: string
  live: string
  durationMs?: number
  reasoningDurationMs?: number
  devPreviewCard?: ReactElement | null
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const { think: liveThink, content: liveContent } = splitThink(live)
  const liveProcessText = [liveReasoning, liveThink].filter(Boolean).join('\n\n')
  const [workExpanded, setWorkExpanded] = useState(isProcessing)

  useEffect(() => {
    setWorkExpanded(isProcessing)
  }, [isProcessing])

  const { processBlocks, assistantContentBlocks, turnFileChanges } = useMemo(() => {
    const nextProcessBlocks: ChatBlock[] = []
    const nextAssistantContentBlocks: Array<Extract<ChatBlock, { kind: 'assistant' }>> = []
    const trailingAssistantContentStart = isProcessing
      ? turn.blocks.length
      : findTrailingAssistantContentStart(turn.blocks)

    for (const [index, block] of turn.blocks.entries()) {
      if (block.kind === 'assistant') {
        const split = splitThink(block.text)
        if (split.think) {
          nextProcessBlocks.push({ kind: 'reasoning', id: `${block.id}-think`, text: split.think })
        }
        if (split.content.trim()) {
          const contentBlock = { ...block, text: split.content }
          if (!isProcessing && index >= trailingAssistantContentStart) {
            nextAssistantContentBlocks.push(contentBlock)
          } else {
            nextProcessBlocks.push(contentBlock)
          }
        }
        continue
      }
      if (isProcessBlock(block)) {
        nextProcessBlocks.push(block)
      }
    }

    if (liveProcessText.trim()) {
      nextProcessBlocks.push({ kind: 'reasoning', id: 'live-reasoning', text: liveProcessText })
    }
    if (isProcessing && liveContent.trim()) {
      nextProcessBlocks.push({ kind: 'assistant', id: 'live-assistant', text: liveContent })
    }

    const nextTurnFileChanges = !isProcessing
      ? turn.blocks.flatMap((block): ToolBlock[] => {
          if (
            !(block.kind === 'tool' && block.toolKind === 'file_change' && block.status === 'success')
          ) {
            return []
          }

          const detailText = block.detail?.trim() ?? ''
          if (!looksLikeUnifiedDiff(detailText)) return []

          const resolvedFilePath = formatFilePathForDisplay(
            extractDiffFilePath(detailText, block.filePath),
            workspaceRoot
          )
          if (!resolvedFilePath) return []

          return [{ ...block, filePath: resolvedFilePath }]
        })
      : []

    return {
      processBlocks: nextProcessBlocks,
      assistantContentBlocks: nextAssistantContentBlocks,
      turnFileChanges: nextTurnFileChanges
    }
  }, [turn.blocks, isProcessing, liveProcessText, liveContent, workspaceRoot])

  const processSections = useMemo(
    () => (workExpanded || isProcessing ? groupProcessSections(processBlocks) : []),
    [processBlocks, workExpanded, isProcessing]
  )
  const reasoningSectionCount = useMemo(
    () => processSections.filter((section) => section.kind === 'reasoning').length,
    [processSections]
  )
  const hasAssistantContent = assistantContentBlocks.length > 0
  const showLiveAssistant = !isProcessing && !!liveContent.trim()

  // The work process keeps the full chronological trace, including assistant
  // text output. The final assistant answer is also rendered below as the
  // normal message body, but we keep it in the timeline so reopening
  // "processed" still shows the real sequence.

  const hasProcess = isProcessing || processBlocks.length > 0

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {turn.user ? <MessageBubble block={turn.user} /> : null}

      {hasProcess ? (
        <div className="flex flex-col gap-1 pb-2">
          <WorkMetaRow
            processing={isProcessing}
            stepCount={processBlocks.length}
            durationMs={durationMs}
            reasoningDurationMs={reasoningDurationMs}
            expanded={workExpanded}
            onToggle={() => setWorkExpanded((value) => !value)}
          />
          {workExpanded && processSections.length > 0 ? (
            <div className="flex flex-col gap-1">
              {processSections.map((section) => (
                <ProcessSectionRow
                  key={section.id}
                  section={section}
                  processing={isProcessing}
                  hasAssistantContent={hasAssistantContent}
                  reasoningDurationMs={reasoningDurationMs}
                  singleReasoningSection={reasoningSectionCount === 1}
                  viewportRef={viewportRef}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {assistantContentBlocks.map((block) => (
        <MessageBubble key={block.id} block={block} />
      ))}

      {showLiveAssistant ? (
        <MessageBubble block={{ kind: 'assistant', id: 'live-assistant', text: liveContent }} />
      ) : null}

      {!isProcessing && devPreviewCard ? devPreviewCard : null}

      {!isProcessing && turnFileChanges.length > 0 ? (
        <TurnChangeSummary changes={turnFileChanges} viewportRef={viewportRef} />
      ) : null}
    </div>
  )
}

const MemoMessageTurn = memo(MessageTurn, (prev, next) => (
  prev.turn === next.turn &&
  prev.isProcessing === next.isProcessing &&
  prev.liveReasoning === next.liveReasoning &&
  prev.live === next.live &&
  prev.durationMs === next.durationMs &&
  prev.reasoningDurationMs === next.reasoningDurationMs &&
  prev.devPreviewCard === next.devPreviewCard &&
  prev.viewportRef === next.viewportRef
))

function TurnChangeSummary({
  changes,
  viewportRef
}: {
  changes: ToolBlock[]
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(
    () => changes.find((change) => change.detail?.trim())?.id ?? changes[0]?.id ?? null
  )

  useEffect(() => {
    if (changes.length === 0) {
      setActiveId(null)
      return
    }
    setActiveId((current) => {
      if (current && changes.some((change) => change.id === current)) return current
      return changes.find((change) => change.detail?.trim())?.id ?? changes[0]?.id ?? null
    })
  }, [changes])

  const totals = useMemo(() => sumDiffStats(changes.map((change) => change.detail)), [changes])
  const title = useMemo(
    () =>
      changes.length === 1
        ? t('turnChangeFilesOne')
        : t('turnChangeFilesMany', { count: changes.length }),
    [changes.length, t]
  )
  const { ref: deferredBodyRef, shouldRender: shouldRenderBody } = useDeferredRender<HTMLDivElement>({
    enabled: expanded,
    root: viewportRef
  })

  return (
    <section className="ds-card-strong overflow-hidden rounded-[24px] border border-ds-border shadow-[0_16px_40px_rgba(86,103,136,0.08)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-ds-hover/40"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-ds-card-muted text-ds-muted">
          <FileEdit className="h-5 w-5" strokeWidth={1.85} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[18px] font-semibold tracking-[-0.02em] text-ds-ink">
            {title}
          </span>
          {totals ? (
            <span className="mt-1 block font-mono text-[12px]">
              <span className="text-ds-diff-added">+{totals.added}</span>
              <span className="mx-1.5 text-ds-faint">·</span>
              <span className="text-ds-diff-removed">-{totals.removed}</span>
            </span>
          ) : null}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
        )}
      </button>

      {expanded ? (
        <div
          ref={deferredBodyRef}
          className="border-t border-ds-border-muted/70"
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 280px' }}
        >
          {shouldRenderBody
            ? changes.map((change) => {
            const stats = countDiffStats(change.detail)
            const open = activeId === change.id
            const primary = change.filePath ?? t('toolActionFile')

            return (
              <div key={change.id} className="border-b border-ds-border-muted/60 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setActiveId(open ? null : change.id)}
                  aria-expanded={open}
                  className={`flex w-full items-start gap-3 px-5 py-3 text-left transition ${
                    open ? 'bg-ds-hover/45' : 'hover:bg-ds-hover/35'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-all text-[14px] font-medium text-ds-ink">
                      {primary}
                    </span>
                  </span>
                  {stats ? (
                    <span className="shrink-0 font-mono text-[12px] tabular-nums">
                      <span className="text-ds-diff-added">+{stats.added}</span>
                      <span className="ml-1.5 text-ds-diff-removed">-{stats.removed}</span>
                    </span>
                  ) : null}
                  {open ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  )}
                </button>

                {open && change.detail ? (
                  <div className="bg-ds-card-muted/45 px-4 pb-4 pt-1">
                    <DiffView
                      patch={change.detail}
                      filePath={change.filePath}
                      maxHeight={440}
                      className="border border-ds-border-muted/70"
                    />
                  </div>
                ) : null}
              </div>
            )
          })
            : null}
        </div>
      ) : null}
    </section>
  )
}

/** Turn-level work-process summary. It auto-collapses when the turn finishes. */
function WorkMetaRow({
  processing,
  stepCount,
  durationMs,
  reasoningDurationMs,
  expanded,
  onToggle
}: {
  processing: boolean
  stepCount: number
  durationMs?: number
  reasoningDurationMs?: number
  expanded: boolean
  onToggle: () => void
}): ReactElement {
  const { t } = useTranslation('common')

  const mainLabel = processing
    ? typeof durationMs === 'number'
      ? `${t('processing')} ${formatDuration(durationMs)}`
      : t('processing')
    : typeof durationMs === 'number'
      ? `${t('processed')} ${formatDuration(durationMs)}`
      : t('processSteps', { count: stepCount })

  const showThoughtSuffix =
    !processing &&
    typeof reasoningDurationMs === 'number' &&
    reasoningDurationMs >= 1000

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="group flex w-fit max-w-full items-center gap-1.5 rounded-md py-1 text-left text-[15px] font-medium text-ds-muted transition hover:opacity-85"
    >
      {processing ? (
        <span className="mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          <Bot className="h-4 w-4 text-ds-faint ds-work-logo-pulse" strokeWidth={1.75} />
        </span>
      ) : null}
      <span className={`tabular-nums ${processing ? 'ds-shiny-text' : ''}`}>{mainLabel}</span>
      {showThoughtSuffix ? (
        <span className="text-ds-faint">
          · {t('thoughtFor', { duration: formatDuration(reasoningDurationMs!) })}
        </span>
      ) : null}
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
      ) : (
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 opacity-40 transition group-hover:opacity-65"
          strokeWidth={1.8}
        />
      )}
    </button>
  )
}

function ProcessSectionRow({
  section,
  processing,
  hasAssistantContent,
  reasoningDurationMs,
  singleReasoningSection,
  viewportRef
}: {
  section: ProcessSection
  processing: boolean
  hasAssistantContent: boolean
  reasoningDurationMs?: number
  singleReasoningSection: boolean
  viewportRef: RefObject<HTMLDivElement | null>
}): ReactElement {
  const { t } = useTranslation('common')
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const assistantBlocks =
    section.kind === 'output'
      ? section.blocks.filter(
          (block): block is Extract<ChatBlock, { kind: 'assistant' }> => block.kind === 'assistant'
        )
      : []
  const hasDetails = sectionHasDetails(section, t)
  const active = isProcessSectionActive(section, processing)
  const hasError = section.blocks.some(
    (block) =>
      (block.kind === 'tool' && block.status === 'error') ||
      (block.kind === 'approval' && block.status === 'error') ||
      (block.kind === 'user_input' && block.status === 'error')
  )
  const defaultExpanded = section.kind === 'reasoning' ? active : active || !hasAssistantContent
  const expanded = hasDetails && (userExpanded ?? defaultExpanded)
  const title = describeProcessSection(section, t, {
    processing,
    reasoningDurationMs,
    singleReasoningSection
  })
  const reasoningText = section.kind === 'reasoning' ? getReasoningSectionText(section) : ''
  const canToggleSection = hasDetails
  const { ref: deferredDetailRef, shouldRender: shouldRenderDetail } = useDeferredRender<HTMLDivElement>({
    enabled: expanded,
    immediate: active,
    root: viewportRef
  })

  if (section.kind === 'execution' && section.blocks.length === 1) {
    const [block] = section.blocks
    if (block) {
      return <ProcessEntryRow block={block} processing={processing} />
    }
  }

  if (section.kind === 'output') {
    return hasDetails ? (
      <div className="min-w-0">
        <div className="flex flex-col gap-2">
          {assistantBlocks.map((block) => (
            <ProcessEntryDetail
              key={block.id}
              block={block}
              detail={getProcessDetail(block)}
              processing={processing}
            />
          ))}
        </div>
      </div>
    ) : (
      <></>
    )
  }

  return (
    <div className="flex flex-col">
      {canToggleSection ? (
        <button
          type="button"
          onClick={() => setUserExpanded(!(userExpanded ?? defaultExpanded))}
          className={`group flex w-fit max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[14px] font-medium transition hover:opacity-85 ${
            hasError ? 'text-red-600 dark:text-red-300' : 'text-ds-muted'
          }`}
        >
          {active ? (
            <span className="mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              <Bot
                className={`h-3.5 w-3.5 ${
                  hasError ? 'text-red-500 dark:text-red-300' : 'text-ds-faint ds-work-logo-pulse'
                }`}
                strokeWidth={1.8}
              />
            </span>
          ) : null}
          <span className={active && !hasError ? 'ds-shiny-text' : ''}>{title}</span>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-55" strokeWidth={1.8} />
          )}
        </button>
      ) : (
        <div
          className={`flex w-fit max-w-full items-center gap-1.5 py-0.5 text-[14px] font-medium ${
            hasError ? 'text-red-600 dark:text-red-300' : 'text-ds-muted'
          }`}
        >
          {active ? (
            <span className="mr-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
              <Bot
                className={`h-3.5 w-3.5 ${
                  hasError ? 'text-red-500 dark:text-red-300' : 'text-ds-faint ds-work-logo-pulse'
                }`}
                strokeWidth={1.8}
              />
            </span>
          ) : null}
          <span className={active && !hasError ? 'ds-shiny-text' : ''}>{title}</span>
        </div>
      )}

      {expanded ? (
        <div
          ref={deferredDetailRef}
          className="mt-1 border-l-2 border-ds-border-muted/35 pl-3"
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
        >
          {shouldRenderDetail ? (
            section.kind === 'reasoning' ? (
            <div className="ds-markdown text-[13.5px] leading-6 text-ds-muted">
              <AssistantMarkdown text={reasoningText} streaming={active && processing} />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {section.blocks.map((block) => (
                <ProcessEntryRow key={block.id} block={block} processing={processing} />
              ))}
            </div>
          )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** One line inside an execution section. */
function ProcessEntryRow({
  block,
  processing
}: {
  block: ChatBlock
  processing: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [userOpen, setUserOpen] = useState(false)
  const summary = describeProcessBlock(block, t)
  const detail = getProcessDetail(block, summary)
  const canExpand = detail.kind !== 'none'
  const isAssistantProcessText = block.kind === 'assistant'
  const isRunningToolOrPending =
    processing &&
    ((block.kind === 'tool' && block.status === 'running') ||
      (block.kind === 'compaction' && block.status === 'running') ||
      (block.kind === 'approval' && block.status === 'pending') ||
      (block.kind === 'user_input' && block.status === 'pending'))
  const isStreamingAssistant = processing && block.kind === 'assistant' && block.id === 'live-assistant'
  const isError =
    (block.kind === 'tool' && block.status === 'error') ||
    (block.kind === 'compaction' && block.status === 'error') ||
    (block.kind === 'approval' && block.status === 'error') ||
    (block.kind === 'user_input' && block.status === 'error')
  const open =
    canExpand && (isAssistantProcessText || isRunningToolOrPending || isStreamingAssistant || userOpen)

  const { verb, rest } = splitVerb(summary)
  const rowActive = isRunningToolOrPending || isStreamingAssistant
  const wrapSummary = (block.kind === 'system' && !canExpand) || isAssistantProcessText

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={canExpand && !isRunningToolOrPending ? () => setUserOpen((v) => !v) : undefined}
        disabled={!canExpand}
        className={`group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[13.5px] leading-[1.55] transition ${
          isError
            ? 'text-red-600 dark:text-red-300'
            : 'text-ds-faint hover:text-ds-ink'
        } ${
          canExpand && !isRunningToolOrPending && !isAssistantProcessText
            ? 'cursor-pointer hover:bg-ds-hover/70'
            : 'cursor-default'
        }`}
      >
        {isRunningToolOrPending ? (
          <Loader2 className="mt-1 h-3 w-3 shrink-0 animate-spin opacity-75" strokeWidth={2} />
        ) : block.kind === 'compaction' ? (
          <Minimize2 className="mt-1 h-3 w-3 shrink-0 opacity-70" strokeWidth={2} />
        ) : null}
        <span
          className={`min-w-0 flex-1 ${wrapSummary ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
        >
          <span
            className={`font-medium ${isError ? '' : rowActive ? 'ds-shiny-text' : 'text-ds-muted'}`}
          >
            {verb}
          </span>
          {rest ? (
            <span className={`ml-1.5 font-mono text-[13px] ${rowActive ? 'ds-shiny-text' : ''}`}>
              {rest}
            </span>
          ) : null}
        </span>
        {canExpand ? (
          open ? (
            <ChevronDown className="mt-1 h-3 w-3 shrink-0 opacity-40" strokeWidth={2} />
          ) : (
            <ChevronRight className="mt-1 h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-45" strokeWidth={2} />
          )
        ) : null}
      </button>
      {canExpand && open ? (
        detail.kind === 'assistant' ? (
          <div className="mt-1">
            <ProcessEntryDetail block={block} detail={detail} processing={processing} />
          </div>
        ) : (
          <div className="ds-work-timeline-detail">
            <ProcessEntryDetail block={block} detail={detail} processing={processing} />
          </div>
        )
      ) : null}
    </div>
  )
}

function describeProcessSection(
  section: ProcessSection,
  t: (key: string, opts?: Record<string, unknown>) => string,
  opts: {
    processing: boolean
    reasoningDurationMs?: number
    singleReasoningSection: boolean
  }
): string {
  if (section.kind === 'reasoning') {
    if (opts.processing && isProcessSectionActive(section, true)) {
      return t('thinkingNow')
    }
    if (
      opts.singleReasoningSection &&
      typeof opts.reasoningDurationMs === 'number' &&
      opts.reasoningDurationMs >= 1000
    ) {
      return t('thoughtFor', { duration: formatDuration(opts.reasoningDurationMs) })
    }
    return section.blocks.length > 1
      ? t('thoughtSteps', { count: section.blocks.length })
      : t('thinkingLabel')
  }

  if (section.kind === 'output') {
    return t('processTextLabel')
  }

  if (section.blocks.length === 1) {
    return describeProcessBlock(section.blocks[0], t)
  }

  return summarizeExecutionSection(section.blocks, t)
}

function summarizeExecutionSection(
  blocks: ChatBlock[],
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  let fileCount = 0
  let commandCount = 0
  let toolCount = 0
  let approvalCount = 0

  for (const block of blocks) {
    if (block.kind === 'approval') {
      approvalCount += 1
      continue
    }
    if (block.kind !== 'tool') continue
    if (block.toolKind === 'file_change') {
      fileCount += 1
    } else if (block.toolKind === 'command_execution') {
      commandCount += 1
    } else {
      toolCount += 1
    }
  }

  const parts: string[] = []
  if (fileCount > 0) {
    parts.push(
      fileCount === 1 ? t('groupEditedFile') : t('groupEditedFiles', { count: fileCount })
    )
  }
  if (commandCount > 0) {
    parts.push(
      commandCount === 1
        ? t('groupRanCommand')
        : t('groupRanCommands', { count: commandCount })
    )
  }
  if (toolCount > 0) {
    parts.push(toolCount === 1 ? t('groupUsedTool') : t('groupUsedTools', { count: toolCount }))
  }
  if (approvalCount > 0) {
    parts.push(
      approvalCount === 1 ? t('groupApproval') : t('groupApprovals', { count: approvalCount })
    )
  }

  if (parts.length > 0) return parts.join(' · ')
  return t('processSteps', { count: blocks.length })
}

function splitVerb(summary: string): { verb: string; rest: string } {
  const trimmed = summary.trim()
  if (!trimmed) return { verb: '', rest: '' }
  const space = trimmed.search(/\s/)
  if (space < 0) return { verb: trimmed, rest: '' }
  return { verb: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() }
}

type ProcessDetail =
  | { kind: 'none' }
  | { kind: 'reasoning'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; text: string; isPatch: boolean; isError: boolean; filePath?: string }
  | { kind: 'approval' }
  | { kind: 'user_input' }
  | { kind: 'text'; text: string }

function summarizeProcessText(text: string, max = 96): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1).trimEnd()}…`
}

function humanizeToolName(name: string): string {
  const trimmed = name.trim().replace(/[_-]+/g, ' ')
  if (!trimmed) return ''
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function extractToolName(summary: string): string {
  const match = summary.trim().match(/^([a-z0-9_-]+)\s*:/i)
  return match?.[1] ?? ''
}

function extractQuotedField(text: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const attr = new RegExp(`${escaped}="([^"]+)"`, 'i').exec(text)
  if (attr?.[1]) return attr[1]
  const json = new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, 'i').exec(text)
  if (json?.[1]) return json[1]
  return undefined
}

function readMetaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!meta) return undefined
  const value = meta[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function summarizeToolBlock(
  block: ToolBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const rawSummary = block.summary?.trim() ?? ''
  const toolName = extractToolName(rawSummary)
  const label = humanizeToolName(toolName) || formatToolTitle(block, t)
  const sourceText = [rawSummary, block.detail ?? ''].filter(Boolean).join('\n')
  const filePath =
    block.filePath ||
    extractQuotedField(sourceText, 'path') ||
    extractQuotedField(sourceText, 'file_path') ||
    extractQuotedField(sourceText, 'file')
  const pattern =
    extractQuotedField(sourceText, 'pattern') ||
    extractQuotedField(sourceText, 'query') ||
    readMetaString(block.meta, 'pattern')
  const command = readMetaString(block.meta, 'command')

  if (toolName === 'read_file' && filePath) {
    return `${label} ${filePath}`
  }
  if ((toolName === 'grep_files' || toolName === 'search_files') && pattern) {
    return filePath ? `${label} ${pattern} · ${filePath}` : `${label} ${pattern}`
  }
  if (command && block.toolKind === 'command_execution') {
    return `${formatToolTitle(block, t)} ${summarizeProcessText(command, 72)}`
  }
  if (filePath) {
    return `${label} ${filePath}`
  }
  if (pattern) {
    return `${label} ${pattern}`
  }
  if (rawSummary) {
    const compact = toolName ? rawSummary.replace(/^([a-z0-9_-]+)\s*:\s*/i, '') : rawSummary
    const summary = summarizeProcessText(compact, 72)
    return summary ? `${label} ${summary}` : label
  }
  return label
}

function normalizeProcessText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function getProcessDetail(block: ChatBlock, summaryText?: string): ProcessDetail {
  if (block.kind === 'reasoning') {
    return block.text.trim() ? { kind: 'reasoning', text: block.text } : { kind: 'none' }
  }
  if (block.kind === 'assistant') {
    const split = splitThink(block.text)
    const text = split.content || split.think
    return text.trim() ? { kind: 'assistant', text } : { kind: 'none' }
  }
  if (block.kind === 'tool') {
    const detailText = block.detail?.trim() ?? ''
    if (!detailText) return { kind: 'none' }
    if (summaryText && normalizeProcessText(detailText) === normalizeProcessText(summaryText)) {
      return { kind: 'none' }
    }
    const isError = block.status === 'error'
    const isPatch =
      block.toolKind === 'file_change' && !isError && looksLikeUnifiedDiff(detailText)
    return {
      kind: 'tool',
      text: block.detail!,
      isPatch,
      isError,
      filePath: block.filePath
    }
  }
  if (block.kind === 'compaction') {
    const detailText = block.detail?.trim() ?? ''
    if (!detailText) return { kind: 'none' }
    if (summaryText && normalizeProcessText(detailText) === normalizeProcessText(summaryText)) {
      return { kind: 'none' }
    }
    return { kind: 'text', text: detailText }
  }
  if (block.kind === 'approval') return { kind: 'approval' }
  if (block.kind === 'user_input') return { kind: 'user_input' }
  if (block.kind === 'system' && block.text.trim()) {
    // Short system messages already fit in the summary line — skip the
    // expand affordance so we don't duplicate the same string.
    if (block.text.length <= 140) return { kind: 'none' }
    return { kind: 'text', text: block.text }
  }
  return { kind: 'none' }
}

function ProcessEntryDetail({
  block,
  detail,
  processing
}: {
  block: ChatBlock
  detail: ProcessDetail
  processing: boolean
}): ReactElement | null {
  if (detail.kind === 'reasoning') {
    const streamReason = block.id === 'live-reasoning' && processing
    return (
      <div className="ds-markdown text-[13.5px] leading-6 text-ds-muted">
        <AssistantMarkdown text={detail.text} streaming={streamReason} />
      </div>
    )
  }
  if (detail.kind === 'assistant') {
    return (
      <div className="ds-markdown text-[13.5px] leading-6 text-ds-ink">
        <AssistantMarkdown
          text={detail.text}
          streaming={processing && block.kind === 'assistant' && block.id === 'live-assistant'}
        />
      </div>
    )
  }
  if (detail.kind === 'tool') {
    if (detail.isPatch) {
      return <DiffView patch={detail.text} filePath={detail.filePath} />
    }
    if (detail.isError) {
      return (
        <div className="overflow-hidden rounded-[10px] border border-red-200/80 bg-red-50/80 dark:border-red-800/40 dark:bg-red-500/10">
          {detail.filePath ? (
            <div className="border-b border-red-200/70 bg-red-100/50 px-3 py-1.5 font-mono text-[12px] text-red-700 dark:border-red-800/40 dark:bg-red-500/15 dark:text-red-300">
              {detail.filePath}
            </div>
          ) : null}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[12px] leading-6 text-red-800 dark:text-red-200">
            {detail.text}
          </pre>
        </div>
      )
    }
    return (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">
        {detail.text}
      </pre>
    )
  }
  if (detail.kind === 'text') {
    return <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-ds-muted">{detail.text}</p>
  }
  if (detail.kind === 'approval' && block.kind === 'approval') {
    return <MessageBubble block={block} nested />
  }
  if (detail.kind === 'user_input' && block.kind === 'user_input') {
    return <MessageBubble block={block} nested />
  }
  return null
}

function describeProcessBlock(
  block: ChatBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (block.kind === 'reasoning') {
    return t('thinkingLabel')
  }
  if (block.kind === 'assistant') {
    return t('processTextLabel')
  }
  if (block.kind === 'tool') {
    return summarizeToolBlock(block, t)
  }
  if (block.kind === 'compaction') {
    if (block.status === 'running') return t('compactionRunning')
    if (block.status === 'error') return block.summary || t('compactionFailed')
    if (typeof block.messagesBefore === 'number' && typeof block.messagesAfter === 'number') {
      return t('compactionCompletedWithCounts', {
        before: block.messagesBefore,
        after: block.messagesAfter
      })
    }
    return block.auto === true ? t('compactionAutoCompleted') : t('compactionManualCompleted')
  }
  if (block.kind === 'approval') {
    return block.summary || t('approvalTitle')
  }
  if (block.kind === 'user_input') {
    return t('userInputTitle')
  }
  if (block.kind === 'system') {
    return block.text
  }
  return 'text' in block ? block.text : t('processed')
}

/**
 * Tiny mono "via <model>" tag rendered above the user message body. Subtle by
 * design — no pill, no ring, just faint monospaced text right-aligned at the
 * top of the bubble. Hidden when there's no model selection to surface.
 */
function ModelMetaTag({
  label,
  className = ''
}: {
  label?: string
  className?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (!label) return null
  return (
    <div
      className={`flex min-w-0 text-right ${className}`.trim()}
      title={t('turnModelBadgeTitle', { model: label })}
    >
      <span className="truncate font-mono text-[12px] tracking-tight text-ds-faint/85">
        {label}
      </span>
    </div>
  )
}

function writePromptMetaSummary(
  display: WritePromptDisplay,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const parts: string[] = []
  if (display.quotes.length > 0) {
    parts.push(t('writePromptReferencesCount', { count: display.quotes.length }))
  }
  if (display.context) {
    parts.push(t('writePromptContextShort'))
  }
  return parts.join(' · ')
}

function WritePromptMetaDisclosure({
  display,
  expanded,
  onToggle
}: {
  display: WritePromptDisplay
  expanded: boolean
  onToggle: () => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const summary = writePromptMetaSummary(display, t)
  if (!summary) return null

  return (
    <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group flex w-full min-w-0 items-center gap-1.5 rounded-lg py-0.5 text-left text-[12px] font-medium text-ds-muted transition hover:text-ds-ink"
      >
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.85} />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-55" strokeWidth={1.85} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-45 transition group-hover:opacity-70" strokeWidth={1.85} />
        )}
      </button>

      {expanded ? (
        <div className="mt-2 flex flex-col gap-2">
          {display.context ? (
            <div className="rounded-xl border border-black/5 bg-white/55 px-3 py-2 text-[12px] font-normal leading-5 text-ds-muted shadow-sm dark:border-white/10 dark:bg-white/6">
              <div className="font-medium text-ds-ink">{t('writePromptContextLabel')}</div>
              {display.context.activeFile ? (
                <div className="mt-1 truncate">
                  <span className="text-ds-faint">{t('writePromptActiveFile')} </span>
                  <span className="font-mono text-ds-muted">{display.context.activeFile}</span>
                </div>
              ) : null}
              {display.context.workspaceRoot ? (
                <div className="mt-0.5 truncate" title={display.context.workspaceRoot}>
                  <span className="text-ds-faint">{t('writePromptWorkspace')} </span>
                  <span className="font-mono text-ds-muted">{display.context.workspaceRoot}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {display.quotes.map((quote, index) => (
            <WritePromptQuoteCard key={`${quote.sourceTitle}-${index}`} quote={quote} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function WritePromptQuoteCard({ quote }: { quote: WritePromptDisplayQuote }): ReactElement {
  const { t } = useTranslation('common')
  const lineLabel =
    quote.lineStart != null && quote.lineEnd != null
      ? t('writePromptReferenceLines', { start: quote.lineStart, end: quote.lineEnd })
      : null

  return (
    <figure className="rounded-xl border border-accent/15 bg-accent/[0.055] px-3 py-2.5 text-left shadow-sm">
      <figcaption className="flex min-w-0 items-center gap-2 text-[12px] leading-5">
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">
          {quote.sourceTitle || t('writePromptReference')}
        </span>
        {lineLabel ? (
          <span className="shrink-0 rounded-full bg-white/65 px-2 py-0.5 font-mono text-[11px] text-ds-faint dark:bg-white/8">
            {lineLabel}
          </span>
        ) : null}
      </figcaption>
      <blockquote className="mt-2 max-h-36 overflow-auto border-l-2 border-accent/35 pl-3 text-[12.5px] font-normal leading-6 text-ds-muted">
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {quote.text}
        </div>
      </blockquote>
      {quote.sourceFilePath ? (
        <div className="mt-2 truncate font-mono text-[11px] font-normal text-ds-faint" title={quote.sourceFilePath}>
          {quote.sourceFilePath}
        </div>
      ) : null}
    </figure>
  )
}

/**
 * User message bubble with hover affordance to rewind/edit. Click the rewind
 * pill, the bubble flips into a textarea, and Resend submits an edited
 * version of the message — locally truncating subsequent turns and starting
 * a fresh turn on the same thread (see chat-store `rewindAndResend`).
 */
function UserMessageBubble({
  block
}: {
  block: Extract<ChatBlock, { kind: 'user' }>
}): ReactElement {
  const { t } = useTranslation('common')
  const busy = useChatStore((s) => s.busy)
  const route = useChatStore((s) => s.route)
  const rewindAndResend = useChatStore((s) => s.rewindAndResend)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(block.text)
  const [writeMetaOpen, setWriteMetaOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const parsedWritePrompt = useMemo(() => {
    if (route !== 'write') return null
    const parsed = parseWritePromptForDisplay(block.text)
    return parsed?.userInput.trim() ? parsed : null
  }, [block.text, route])
  const displayText = parsedWritePrompt?.userInput ?? block.text

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
    // Auto-size to content
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`
  }, [editing])

  useEffect(() => {
    setWriteMetaOpen(false)
  }, [block.id])

  const startEdit = (): void => {
    if (busy) return
    setDraft(block.text)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setDraft(block.text)
    setEditing(false)
  }

  const submit = async (): Promise<void> => {
    const trimmed = draft.trim()
    if (!trimmed || busy) return
    setEditing(false)
    await rewindAndResend(block.id, trimmed)
  }

  if (editing) {
    return (
      <div className="ds-user-message">
        <div className="ds-user-message-bubble min-w-0 border border-accent/35 ring-1 ring-accent/15">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 360)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelEdit()
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={2}
            className="block w-full min-w-0 resize-none break-words bg-transparent text-[15px] font-medium leading-[1.58] text-ds-ink outline-none [overflow-wrap:anywhere]"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[12px] text-ds-faint">{t('rewindHint')}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md px-3 py-1 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('rewindCancel')}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!draft.trim() || busy}
                className="rounded-md bg-accent px-3 py-1 text-[13px] font-medium text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('rewindResend')}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-end">
          <ModelMetaTag label={block.modelLabel} />
        </div>
      </div>
    )
  }

  return (
    <div className="ds-user-message group relative">
      <div className="ds-user-message-bubble min-w-0">
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left">
          {displayText}
        </div>
        {parsedWritePrompt ? (
          <WritePromptMetaDisclosure
            display={parsedWritePrompt}
            expanded={writeMetaOpen}
            onToggle={() => setWriteMetaOpen((value) => !value)}
          />
        ) : null}
      </div>
      <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-ds-faint opacity-90 transition group-hover:opacity-100">
        <ModelMetaTag label={block.modelLabel} className="flex-1 justify-start text-left" />
        <div className="flex items-center justify-end gap-3">
          <CopyFeedbackButton text={displayText} iconOnly />
          <button
            type="button"
            onClick={startEdit}
            disabled={busy}
            title={t('rewindEditMessage')}
            aria-label={t('rewindEditMessage')}
            className="rounded-md p-1 transition hover:bg-ds-hover hover:text-ds-muted disabled:cursor-not-allowed disabled:hover:text-ds-faint"
          >
            <PencilLine className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  )
}

const USER_INPUT_OTHER_LABEL = 'Other'

function CopyFeedbackButton({
  text,
  iconOnly = false
}: {
  text: string
  iconOnly?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const resetRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current)
    },
    []
  )

  const scheduleReset = (): void => {
    if (resetRef.current !== null) window.clearTimeout(resetRef.current)
    resetRef.current = window.setTimeout(() => {
      setStatus('idle')
      resetRef.current = null
    }, COPY_FEEDBACK_RESET_MS)
  }

  const handleCopy = async (): Promise<void> => {
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setStatus('success')
    } catch {
      setStatus('error')
    }
    scheduleReset()
  }

  const success = status === 'success'
  const error = status === 'error'
  const label = success ? t('copySuccess') : error ? t('copyFailed') : t('copyMessage')
  const iconClassName = iconOnly ? 'h-4 w-4' : 'h-3.5 w-3.5'

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={label}
      aria-label={label}
      className={`flex shrink-0 items-center rounded-md transition ${
        iconOnly
          ? 'gap-0 p-1 hover:bg-ds-hover'
          : 'gap-1 px-1.5 py-0.5 hover:bg-ds-hover'
      } ${
        success
          ? 'text-emerald-500'
          : error
            ? 'text-rose-400'
            : 'text-ds-faint hover:text-ds-muted'
      }`}
    >
      {success ? (
        <Check className={iconClassName} strokeWidth={2} />
      ) : (
        <Copy className={iconClassName} strokeWidth={1.8} />
      )}
      {!iconOnly ? <span>{label}</span> : null}
    </button>
  )
}

function UserInputBubble({
  block
}: {
  block: Extract<ChatBlock, { kind: 'user_input' }>
}): ReactElement {
  const { t } = useTranslation('common')
  const resolveUserInput = useChatStore((s) => s.resolveUserInput)
  const [answers, setAnswers] = useState<Record<string, UserInputAnswer>>(() =>
    answersByQuestionId(block.answers)
  )
  const pending = block.status === 'pending'
  const done = block.status !== 'pending'

  useEffect(() => {
    setAnswers(answersByQuestionId(block.answers))
  }, [block.id, block.answers])

  const chooseOption = (question: UserInputQuestion, label: string, value = label): void => {
    setAnswers((prev) => ({
      ...prev,
      [question.id]: { id: question.id, label, value }
    }))
  }

  const canSubmit = block.questions.every((question) => {
    const answer = answers[question.id]
    if (!answer) return false
    if (answer.label === USER_INPUT_OTHER_LABEL) return answer.value.trim().length > 0
    return true
  })

  const submit = (): void => {
    if (!canSubmit || !pending) return
    const ordered = block.questions.map((question) => answers[question.id]).filter(Boolean)
    void resolveUserInput(block.id, { kind: 'submit', answers: ordered })
  }

  const cancel = (): void => {
    if (!pending) return
    void resolveUserInput(block.id, { kind: 'cancel' })
  }

  const statusLabel =
    block.status === 'submitted'
      ? t('userInputSubmitted')
      : block.status === 'cancelled'
        ? t('userInputCancelled')
        : block.status === 'error'
          ? t('userInputFailed')
          : t('userInputPending')

  return (
    <div
      className={`rounded-[22px] border px-4 py-4 text-[13px] leading-6 shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${
        block.status === 'error'
          ? 'border-red-300/80 bg-red-500/10 dark:border-red-800/60 dark:bg-red-950/35'
          : 'border-accent/35 bg-[linear-gradient(180deg,rgba(79,124,255,0.07),rgba(79,124,255,0.11))] text-ds-ink'
      }`}
    >
      <div className="font-semibold text-accent">{t('userInputTitle')}</div>
      <p className="mt-1 text-[12px] text-ds-muted">{statusLabel}</p>

      <div className="mt-3 flex flex-col gap-4">
        {block.questions.map((question, index) => {
          const answer = answers[question.id]
          const otherSelected = answer?.label === USER_INPUT_OTHER_LABEL
          return (
            <div key={question.id} className="rounded-xl border border-ds-border bg-ds-card/60 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ds-muted">
                  {question.header}
                </div>
                <div className="text-[12px] text-ds-faint">
                  {t('userInputQuestionProgress', {
                    current: index + 1,
                    total: block.questions.length
                  })}
                </div>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[14px] font-medium text-ds-ink">
                {question.question}
              </p>
              <div className="mt-3 grid gap-2">
                {question.options.map((option) => {
                  const selected = answer?.label === option.label && answer.value === option.label
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={done}
                      onClick={() => chooseOption(question, option.label)}
                      className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-default ${
                        selected
                          ? 'border-accent/60 bg-accent/10 text-ds-ink'
                          : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                    >
                      <span className="block text-[13px] font-semibold">{option.label}</span>
                      <span className="mt-0.5 block text-[12px] leading-5 text-ds-faint">
                        {option.description}
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  disabled={done}
                  onClick={() =>
                    chooseOption(
                      question,
                      USER_INPUT_OTHER_LABEL,
                      answer?.label === USER_INPUT_OTHER_LABEL ? answer.value : ''
                    )
                  }
                  className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-default ${
                    otherSelected
                      ? 'border-accent/60 bg-accent/10 text-ds-ink'
                      : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  <span className="block text-[13px] font-semibold">{t('userInputOther')}</span>
                  <span className="mt-0.5 block text-[12px] leading-5 text-ds-faint">
                    {t('userInputOtherDescription')}
                  </span>
                </button>
                {otherSelected ? (
                  <textarea
                    rows={2}
                    disabled={done}
                    value={answer?.value ?? ''}
                    onChange={(e) =>
                      chooseOption(question, USER_INPUT_OTHER_LABEL, e.target.value)
                    }
                    placeholder={t('userInputCustomPlaceholder')}
                    className="min-h-20 resize-y rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/60 disabled:cursor-default disabled:opacity-80"
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {block.errorMessage ? (
        <p className="mt-3 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
      ) : null}

      {block.answers && block.answers.length > 0 && block.status === 'submitted' ? (
        <div className="mt-3 rounded-lg bg-ds-card px-3 py-2 text-[12px] text-ds-muted">
          {block.answers.map((answer) => (
            <div key={answer.id} className="flex gap-2">
              <span className="font-mono text-ds-faint">{answer.id}</span>
              <span className="min-w-0 flex-1 break-words">{answer.value || answer.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {pending ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={submit}
          >
            {t('userInputSubmit')}
          </button>
          <button
            type="button"
            className="rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink hover:bg-ds-hover"
            onClick={cancel}
          >
            {t('userInputCancel')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function answersByQuestionId(
  answers: UserInputAnswer[] | undefined
): Record<string, UserInputAnswer> {
  const out: Record<string, UserInputAnswer> = {}
  for (const answer of answers ?? []) {
    out[answer.id] = answer
  }
  return out
}

function formatMessageDateTime(input: string, locale: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function MessageBubble({ block, nested = false }: { block: ChatBlock; nested?: boolean }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const resolveApproval = useChatStore((s) => s.resolveApproval)
  if (block.kind === 'user') {
    return <UserMessageBubble block={block} />
  }
  if (block.kind === 'assistant') {
    const streaming = block.id === 'live-assistant'
    const createdAtLabel = block.createdAt
      ? formatMessageDateTime(block.createdAt, i18n.language)
      : null
    return (
      <div className="group/message flex min-w-0 max-w-full flex-col">
        <div className="ds-markdown ds-chat-answer min-w-0 max-w-full text-ds-ink">
          <AssistantMarkdown text={block.text} streaming={streaming} />
        </div>
        {!streaming ? (
          <div className="mt-1 flex min-h-5 min-w-0 items-center justify-between gap-3 text-[11.5px] text-ds-faint opacity-0 transition duration-150 group-hover/message:opacity-100">
            <span className="min-w-0 truncate">{createdAtLabel ?? ''}</span>
            <CopyFeedbackButton text={block.text} />
          </div>
        ) : null}
      </div>
    )
  }
  if (block.kind === 'reasoning') {
    return (
      <div className="ds-card-soft rounded-[20px] px-4 py-3 text-[13.5px] leading-6 text-ds-muted">
        <div className="ds-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        </div>
      </div>
    )
  }
  if (block.kind === 'tool') {
    return <ToolEntry block={block} nested={nested} />
  }
  if (block.kind === 'user_input') {
    return <UserInputBubble block={block} />
  }
  if (block.kind === 'approval') {
    const done = block.status !== 'pending'
    const statusLabel =
      block.status === 'allowed'
        ? t('approvalAllowed')
        : block.status === 'denied'
          ? t('approvalDenied')
          : block.status === 'error'
            ? t('approvalFailed')
            : t('approvalPending')
    return (
      <div
        className={`rounded-[22px] border px-4 py-4 text-[13px] leading-6 shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${
          block.status === 'error'
            ? 'border-red-300/80 bg-red-500/10 dark:border-red-800/60 dark:bg-red-950/35'
            : 'border-accent/35 bg-[linear-gradient(180deg,rgba(79,124,255,0.08),rgba(79,124,255,0.12))] text-ds-ink'
        }`}
      >
        <div className="font-semibold text-accent">{t('approvalTitle')}</div>
        {block.toolName ? (
          <div className="mt-1 text-[12px] text-ds-muted">
            {t('approvalTool', { name: block.toolName })}
          </div>
        ) : null}
        <p className="mt-2 whitespace-pre-wrap text-[14px] text-ds-ink">{block.summary}</p>
        {block.errorMessage ? (
          <p className="mt-2 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
        ) : null}
        {!done ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-emerald-700"
              onClick={() => void resolveApproval(block.id, 'allow')}
            >
              {t('approvalAllow')}
            </button>
            <button
              type="button"
              className="rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink hover:bg-ds-hover"
              onClick={() => void resolveApproval(block.id, 'deny')}
            >
              {t('approvalDeny')}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[12px] font-medium text-ds-muted">{statusLabel}</p>
        )}
      </div>
    )
  }
  if (block.kind === 'compaction') {
    return (
      <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
        {block.detail || block.summary}
      </div>
    )
  }
  return (
    <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
      {block.text}
    </div>
  )
}

function ToolEntry({ block, nested = false }: { block: ToolBlock; nested?: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(() => block.status === 'error' || block.status === 'running')

  useEffect(() => {
    if (block.status === 'running') {
      setOpen(true)
    }
  }, [block.status, block.id])

  const effectiveOpen = block.status === 'running' ? true : open

  const tone =
    block.status === 'error'
      ? 'border-red-300/80 bg-red-500/10 text-red-950 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-100'
      : block.status === 'running'
        ? 'border-amber-300/80 bg-amber-500/10 text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100'
        : 'border-ds-border bg-ds-subtle text-ds-ink'

  const Icon = block.toolKind === 'file_change' ? FileEdit : block.toolKind === 'command_execution' ? Terminal : Wrench
  const kindLabel =
    block.toolKind === 'file_change'
      ? t('toolKindFile')
      : block.toolKind === 'command_execution'
        ? t('toolKindCommand')
        : t('toolKindTool')

  const exitCode = readNumber(block.meta, 'exit_code')
  const durationMs = readNumber(block.meta, 'duration_ms')

  const hasDetail = !!(block.detail && block.detail.trim().length > 0)
  const isPatch = block.toolKind === 'file_change' && hasDetail
  const canExpand = hasDetail || block.status === 'running'

  return (
    <div className={`rounded-[22px] border shadow-[0_12px_30px_rgba(86,103,136,0.04)] ${tone}`}>
      <button
        type="button"
        onClick={() => {
          if (!canExpand || block.status === 'running') return
          setOpen((v) => !v)
        }}
        className={`flex w-full items-start gap-2 px-4 py-3 text-left text-[13.5px] leading-6 ${
          canExpand && block.status !== 'running' ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-[0.12em] text-[11px] opacity-75">
              {kindLabel}
            </span>
            {block.status === 'running' ? (
              <span className="rounded-full bg-amber-200/40 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-700/30 dark:text-amber-100">
                {t('inspectorStatusRunning')}
              </span>
            ) : null}
            {typeof exitCode === 'number' ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-mono ${
                  exitCode === 0
                    ? 'bg-ds-success-soft text-ds-success'
                    : 'bg-ds-danger-soft text-ds-danger'
                }`}
              >
                exit {exitCode}
              </span>
            ) : null}
            {typeof durationMs === 'number' ? (
              <span className="rounded-full bg-ds-card px-2 py-0.5 text-[11px] font-mono text-ds-muted">
                {formatDuration(durationMs)}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 break-words">
            {block.filePath ? (
              <span className="font-mono text-[12px] opacity-90">{block.filePath} — </span>
            ) : null}
            <span>{block.summary}</span>
          </div>
        </div>
        {canExpand ? (
          effectiveOpen ? (
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} />
          )
        ) : null}
      </button>
      {effectiveOpen && hasDetail ? (
        <div className="ds-panel-strip min-w-0 border-t border-ds-border-muted/60 px-4 py-3">
          {isPatch ? (
            <DiffView patch={block.detail!} filePath={block.filePath} />
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">
              {block.detail}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  )
}

function readNumber(meta: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!meta) return undefined
  const v = meta[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function formatToolTitle(block: ToolBlock, t: (key: string) => string): string {
  if (block.toolKind === 'file_change') return t('toolActionFile')
  if (block.toolKind === 'command_execution') return t('toolActionCommand')
  return t('toolActionTool')
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  if (ms < 3_600_000) {
    const totalSeconds = Math.round(ms / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}m ${s}s`
  }
  if (ms < 86_400_000) {
    const totalMinutes = Math.round(ms / 60_000)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${h}h ${m}m`
  }
  const totalHours = Math.round(ms / 3_600_000)
  const d = Math.floor(totalHours / 24)
  const h = totalHours % 24
  return `${d}d ${h}h`
}
