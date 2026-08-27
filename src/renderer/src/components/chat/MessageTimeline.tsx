import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCommitHorizontal, Hash } from 'lucide-react'
import type { ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { useTimelineStores } from './use-timeline-stores'
import { useTimelineScroll } from './use-timeline-scroll'
import { MessageTimelineEmptyHero, ThreadForkBanner, ThreadForkPoint } from './message-timeline-empty'
import {
  activeTimelineTurnIndex,
  groupTurns,
  stableTurnKey,
  turnTaskSurface,
  type Turn
} from './message-timeline-turns'
import { InjectedMemoryLookupProvider } from './injected-memory-lookup'
import {
  TimelineFilePreviewWorkspaceProvider,
  timelineFilePreviewWorkspaceRoot
} from './timeline-file-preview-workspace'
import {
  DeclarativeActionBar,
  canOpenHostContextMenuForTarget,
  DeclarativeContextMenuOverlay,
  DeclarativeResultPreviews
} from '../../extensions/ControlledContributionSurfaces'
import { resolveActiveExtensionWorkspaceRoot } from '../../extensions/active-extension-workspace'
import type { JsonValue } from '@kun/extension-api'
import { selectGraphPlanningCorrectionDraft, useGraphStore } from '../../graph/graph-store'
import {
  TimelineJumpPreviewTitle,
  activeTimelineTurnKey,
  blockScrollStamp,
  resultPreviewSourcesForTurn,
  timelineBottomPaddingClass,
  timelineJumpPreviewMetadata,
  timelineJumpPreviewTop,
  timelineJumpRailLeft,
  timelineJumpRailPreviewLeft,
  timelineJumpWaveDistance,
  turnPreview,
  turnResponsePreview
} from './message-timeline-jump-preview'
import { MemoMessageTurn } from './message-timeline-conversation-turn'
import type { MessageTimelineProps } from './message-timeline-props'
import { useTurnUsageState } from '../../hooks/use-turn-usage'

export {
  TimelineJumpPreviewTitle,
  TimelineRuntimeError,
  activeTimelineTurnKey,
  liveTurnProgressClass,
  resultPreviewSourcesForTurn,
  timelineBottomPaddingClass,
  timelineJumpPreviewMetadata,
  timelineJumpPreviewTop,
  timelineJumpRailLeft,
  timelineJumpRailPreviewLeft,
  timelineJumpWaveDistance
} from './message-timeline-jump-preview'
export type { TimelineJumpPreviewMetadata } from './message-timeline-jump-preview'
export { ConversationTurn } from './message-timeline-conversation-turn'
export type { ConversationTurnProps } from './message-timeline-conversation-turn'

export { summarizeToolBlock } from './message-timeline-process'

export function timelineTurnIsProcessing(input: {
  busy: boolean
  busyUnconfirmed?: boolean
  isLatestTurn: boolean
  isActiveTurn?: boolean
  turnPending: boolean
  hasLiveStream: boolean
  turnId?: string
  graphPlanningCorrectionTurnId?: string | null
}): boolean {
  if (
    input.graphPlanningCorrectionTurnId &&
    input.turnId === input.graphPlanningCorrectionTurnId
  ) {
    return false
  }
  // An unconfirmed busy flag comes from a persisted snapshot that claims a
  // running turn; until live events confirm it, render the history settled
  // instead of replaying live-progress UI over a finished conversation.
  if (input.busyUnconfirmed && input.busy) return input.turnPending || input.hasLiveStream
  return (input.busy && (input.isActiveTurn ?? input.isLatestTurn)) ||
    input.turnPending ||
    input.hasLiveStream
}

const TURN_PAGE_SIZE = 18
export function MessageTimeline({
  blocks,
  liveReasoning,
  live,
  activeThreadId,
  runtimeConnection,
  runtimeError,
  onRetryConnection,
  onOpenSettings,
  onSelectSuggestion,
  taskSurfaceControl,
  focusModeEnabled = false,
  devPreviewCard,
  planActionsBusy,
  graphEnabled = false,
  onBuildPlan,
  onOpenPlan,
  onOpenChanges,
  onReviewChanges,
  reviewChangesDisabled = false,
  compactCards = false,
  onOpenChildThread,
  onComponentPrototypePrompt,
  extensionMessageActions = [],
  extensionContextMenus = [],
  extensionAttachmentContextMenus = [],
  extensionCommands = [],
  extensionResultPreviews = [],
  messageContributionsForSurface,
  onExtensionCommand
}: MessageTimelineProps): ReactElement {
  const { t } = useTranslation('common')
  const threadLoadingId = useChatStore((state) => state.threadLoadingId)
  const usageRefreshKey = useChatStore((state) => state.usageRefreshKey)
  const cancelToolCall = useChatStore((state) => state.cancelToolCall)
  const turnUsage = useTurnUsageState(threadLoadingId === activeThreadId ? null : activeThreadId, usageRefreshKey)
  const handleCancelToolCall = useCallback(async (block: ToolBlock): Promise<boolean> => {
    if (!activeThreadId || !block.turnId) return false
    const callId = typeof block.meta?.callId === 'string' ? block.meta.callId : ''
    if (!callId) return false
    return cancelToolCall(activeThreadId, block.turnId, callId)
  }, [activeThreadId, cancelToolCall])
  const {
    route,
    workspaceRoot,
    chooseWorkspace,
    activeClawChannel,
    busy,
    busyUnconfirmed,
    threadHasMoreHistory,
    threadHistoryLoading,
    loadEarlierThreadHistory,
    currentTurnId,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId,
    activeThread
  } = useTimelineStores(activeThreadId)
  const graphPlanningCorrectionTurnId = useGraphStore((state) =>
    selectGraphPlanningCorrectionDraft(state.drafts, activeThreadId)?.draft.sourceTurnId ?? null
  )
  const extensionWorkspaceRoot = resolveActiveExtensionWorkspaceRoot(
    activeThreadId,
    activeThread ? [activeThread] : [],
    workspaceRoot
  )
  const heroRoute: 'chat' | 'claw' = route === 'claw' ? 'claw' : 'chat'
  const hasContent = blocks.length > 0 || live || liveReasoning
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const turnRefMap = useRef(new Map<string, HTMLDivElement>())
  const [activeTurnKey, setActiveTurnKey] = useState<string | null>(null)
  const [jumpRailLayout, setJumpRailLayout] = useState<{
    railLeft: number
    previewLeft: number
  } | null>(null)
  const [jumpRailPreview, setJumpRailPreview] = useState<{
    key: string
    index: number
    title: string
    prompt: string
    fileLabels: string[]
    hasCommit: boolean
    top: number
  } | null>(null)
  const [messageContextMenu, setMessageContextMenu] = useState<{
    position: { x: number; y: number }
    context: JsonValue
  } | null>(null)
  const turns = useMemo(() => groupTurns(blocks), [blocks])
  const latestBlock = blocks[blocks.length - 1]
  const scrollContentKey = [
    activeThreadId ?? '',
    turns.length,
    blocks.length,
    blockScrollStamp(latestBlock),
    live.length,
    liveReasoning.length
  ].join(':')
  const {
    hiddenTurnCount,
    hasEarlierTurns,
    loadEarlierTurns,
    collapseEarlierTurns
  } = useTimelineScroll({
    containerRef,
    endRef,
    activeThreadId,
    pageSize: TURN_PAGE_SIZE,
    totalTurns: turns.length,
    busy,
    hasRemoteHistory: threadHasMoreHistory,
    remoteHistoryLoading: threadHistoryLoading,
    loadRemoteHistory: loadEarlierThreadHistory,
    scrollDeps: {
      contentKey: scrollContentKey,
      streaming: Boolean(live.trim() || liveReasoning.trim()),
      userTurnKey: currentTurnUserId ?? ''
    }
  })
  const visibleTurns = useMemo(
    () => (hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns),
    [hiddenTurnCount, turns]
  )
  const activeTurnIndex = useMemo(
    () => activeTimelineTurnIndex(visibleTurns, currentTurnId, currentTurnUserId),
    [currentTurnId, currentTurnUserId, visibleTurns]
  )
  const graphPlanningPaused = Boolean(
    graphPlanningCorrectionTurnId &&
    turns.some((turn) =>
      turn.turnId === graphPlanningCorrectionTurnId &&
      turn.user?.id === currentTurnUserId)
  )
  const visibleTurnAnchors = useMemo(
    () => {
      const anchors: Array<{
        key: string
        index: number
        title: string
        prompt: string
        fileLabels: string[]
        hasCommit: boolean
      }> = []
      let questionIndex = turns
        .slice(0, hiddenTurnCount)
        .filter((turn) => turn.user)
        .length

      visibleTurns.forEach((turn, index) => {
        if (!turn.user) return
        questionIndex += 1
        const absoluteTurnIndex = hiddenTurnCount + index
        const key = stableTurnKey(turn, absoluteTurnIndex)
        const metadata = timelineJumpPreviewMetadata(turn)
        anchors.push({
          key,
          index: questionIndex,
          title: turnPreview(turn, t('timelineJumpTurn', { index: questionIndex })),
          prompt: turnResponsePreview(turn, t('timelineJumpTurn', { index: questionIndex })),
          ...metadata
        })
      })
      return anchors
    },
    [hiddenTurnCount, t, turns, visibleTurns]
  )
  const forkedFromTitle = activeThread?.forkedFromTitle?.trim() ?? ''
  const forkBoundaryTurnCount =
    typeof activeThread?.forkedFromTurnCount === 'number'
      ? Math.max(0, activeThread.forkedFromTurnCount)
      : undefined
  const filePreviewWorkspaceRoot = timelineFilePreviewWorkspaceRoot(activeThread, workspaceRoot)

  useEffect(() => {
    const container = containerRef.current
    if (!container || visibleTurnAnchors.length === 0) {
      setActiveTurnKey(null)
      return
    }
    let frame: number | null = null
    const update = (): void => {
      frame = null
      if (container.scrollHeight - container.scrollTop - container.clientHeight <= 2) {
        setActiveTurnKey(visibleTurnAnchors.at(-1)?.key ?? null)
        return
      }
      const containerTop = container.getBoundingClientRect().top
      const positions = visibleTurnAnchors.flatMap((anchor) => {
        const node = turnRefMap.current.get(anchor.key)
        return node ? [{ key: anchor.key, top: node.getBoundingClientRect().top - containerTop }] : []
      })
      setActiveTurnKey(activeTimelineTurnKey(positions))
    }
    const schedule = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(update)
    }
    container.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      container.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [visibleTurnAnchors])

  useEffect(() => {
    const container = containerRef.current
    if (!container || visibleTurnAnchors.length <= 2) {
      setJumpRailLayout(null)
      return
    }
    const update = (): void => {
      const rect = container.getBoundingClientRect()
      const railLeft = timelineJumpRailLeft(rect.width)
      setJumpRailLayout({
        railLeft,
        previewLeft: timelineJumpRailPreviewLeft(railLeft, rect.width)
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [visibleTurnAnchors.length])

  // Tick a clock while a turn is running so the live "Worked for Xs" updates.
  const [tickNow, setTickNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy || !currentTurnUserId || graphPlanningPaused) return
    setTickNow(Date.now())
    const id = window.setInterval(() => setTickNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy, currentTurnUserId, graphPlanningPaused])

  const jumpToTurn = (key: string): void => {
    const target = turnRefMap.current.get(key)
    if (!target) return
    setActiveTurnKey(key)
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const showJumpRailPreview = (
    anchor: {
      key: string
      index: number
      title: string
      prompt: string
      fileLabels: string[]
      hasCommit: boolean
    },
    node: HTMLButtonElement
  ): void => {
    const nodeRect = node.getBoundingClientRect()
    const railAnchor = node.closest<HTMLElement>('.timeline-jump-rail-anchor')
    const railAnchorTop = railAnchor?.getBoundingClientRect().top ?? nodeRect.top
    setJumpRailPreview({
      key: anchor.key,
      index: anchor.index,
      title: anchor.title,
      prompt: anchor.prompt || anchor.title,
      fileLabels: anchor.fileLabels,
      hasCommit: anchor.hasCommit,
      top: timelineJumpPreviewTop(nodeRect.top, nodeRect.height, railAnchorTop)
    })
  }

  const jumpRailHoveredIndex = jumpRailPreview
    ? visibleTurnAnchors.findIndex((item) => item.key === jumpRailPreview.key)
    : -1
  return (
    <TimelineFilePreviewWorkspaceProvider
      workspaceRoot={filePreviewWorkspaceRoot}
      threadId={activeThreadId}
    >
    <InjectedMemoryLookupProvider workspaceRoot={workspaceRoot} enabled={!activeThreadId || threadLoadingId !== activeThreadId}>
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div ref={containerRef} className="ds-no-drag relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {visibleTurnAnchors.length > 2 && jumpRailLayout ? (
        <div className="timeline-jump-rail-anchor">
          <nav
            aria-label={t('timelineJumpRailLabel')}
            className="timeline-jump-rail"
            style={{
              left: `${jumpRailLayout.railLeft}px`
            }}
            onMouseLeave={() => setJumpRailPreview(null)}
          >
            {visibleTurnAnchors.map((anchor, index) => {
              const waveDistance = timelineJumpWaveDistance(index, jumpRailHoveredIndex)
              return (
                <button
                  key={anchor.key}
                  type="button"
                  className={`timeline-jump-rail-button${activeTurnKey === anchor.key ? ' is-active' : ''}`}
                  data-wave-distance={waveDistance ?? undefined}
                  aria-label={`${t('timelineJumpTurn', { index: anchor.index })}: ${anchor.title}`}
                  aria-current={activeTurnKey === anchor.key ? 'true' : undefined}
                  onMouseEnter={(event) => showJumpRailPreview(anchor, event.currentTarget)}
                  onFocus={(event) => showJumpRailPreview(anchor, event.currentTarget)}
                  onBlur={() => setJumpRailPreview(null)}
                  onClick={() => jumpToTurn(anchor.key)}
                />
              )
            })}
          </nav>
          {jumpRailPreview ? (
            <div
              className="timeline-jump-rail-preview"
              style={{
                left: `${jumpRailLayout.previewLeft}px`,
                top: `${jumpRailPreview.top}px`
              }}
              role="tooltip"
            >
              <TimelineJumpPreviewTitle
                index={jumpRailPreview.index}
                title={jumpRailPreview.title}
              />
              <div className="timeline-jump-rail-preview-text">{jumpRailPreview.prompt}</div>
              {jumpRailPreview.fileLabels.length > 0 || jumpRailPreview.hasCommit ? (
                <div className="timeline-jump-rail-preview-meta" aria-hidden="true">
                  {jumpRailPreview.fileLabels.slice(0, 2).map((fileLabel) => (
                    <span key={fileLabel} className="timeline-jump-rail-preview-meta-item">
                      <Hash />
                      <span className="timeline-jump-rail-preview-file-label">{fileLabel}</span>
                    </span>
                  ))}
                  {jumpRailPreview.fileLabels.length > 2 ? (
                    <span className="timeline-jump-rail-preview-meta-count">
                      +{jumpRailPreview.fileLabels.length - 2}
                    </span>
                  ) : null}
                  {jumpRailPreview.hasCommit ? (
                    <span className="timeline-jump-rail-preview-meta-item">
                      <GitCommitHorizontal />
                      {t('userInputSubmit')}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={`ds-message-timeline-content ds-chat-column-inset ds-chat-content-max-width mx-auto flex w-full min-w-0 flex-col ${compactCards ? 'gap-5' : 'gap-8'} pt-8 ${
        timelineBottomPaddingClass()
      }`}>
        {!hasContent || !activeThreadId ? (
          <MessageTimelineEmptyHero
            route={heroRoute}
            ready={runtimeConnection === 'ready'}
            hasWorkspace={!!workspaceRoot}
            runtimeError={runtimeError}
            activeClawChannel={activeClawChannel}
            onPickWorkspace={() => void chooseWorkspace()}
            onRetry={onRetryConnection}
            onOpenSettings={onOpenSettings}
            onSelectSuggestion={onSelectSuggestion}
            taskSurfaceControl={taskSurfaceControl}
            focusModeEnabled={focusModeEnabled}
          />
        ) : null}

        {activeThread?.forkedFromThreadId ? (
          <ThreadForkBanner parentTitle={forkedFromTitle} />
        ) : null}

        {hasEarlierTurns ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              disabled={threadHistoryLoading}
              onClick={() => loadEarlierTurns({ userInitiated: true })}
              className="ds-chip rounded-full px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:text-ds-ink"
            >
              {t('timelineShowEarlierTurns', {
                count: Math.min(hiddenTurnCount || TURN_PAGE_SIZE, TURN_PAGE_SIZE)
              })}
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
          const turnPending = threadHasPendingRuntimeWork(turn.blocks)
          const turnContributions = messageContributionsForSurface?.(turnTaskSurface(turn))
          const turnMessageActions = turnContributions?.actions ?? extensionMessageActions
          const turnContextMenus = turnContributions?.contextMenus ?? extensionContextMenus
          const turnAttachmentMenus = turnContributions?.attachmentContextMenus ?? extensionAttachmentContextMenus
          const turnResultPreviews = turnContributions?.resultPreviews ?? extensionResultPreviews
          const isLatestTurn = index === visibleTurns.length - 1
          const isActiveTurn = index === activeTurnIndex
          const hasLiveStream = isActiveTurn && !!(liveReasoning.trim() || live.trim())
          const turnIsProcessing = timelineTurnIsProcessing({
            busy,
            busyUnconfirmed,
            isLatestTurn,
            isActiveTurn,
            turnPending,
            hasLiveStream,
            turnId: turn.turnId,
            graphPlanningCorrectionTurnId
          })
          const showForkPoint =
            forkBoundaryTurnCount !== undefined && absoluteTurnIndex === forkBoundaryTurnCount
          const turnKey = stableTurnKey(turn, absoluteTurnIndex)
          return (
            <div
              key={turnKey}
              ref={(node) => {
                if (node) {
                  turnRefMap.current.set(turnKey, node)
                } else {
                  turnRefMap.current.delete(turnKey)
                }
              }}
              className="scroll-mt-6"
              data-extension-message-context
              onContextMenu={(event) => {
                const attachmentItem = event.target instanceof Element
                  ? event.target.closest<HTMLElement>('[data-extension-attachment-item]')
                  : null
                const attachment = Boolean(attachmentItem) || (event.target instanceof Element &&
                  event.target.closest('[data-extension-attachment-context]') !== null)
                if (
                  !onExtensionCommand ||
                  (!attachment && !canOpenHostContextMenuForTarget(event.target))
                ) return
                const contributions = attachment
                  ? turnAttachmentMenus
                  : turnContextMenus
                if (contributions.length === 0) return
                event.preventDefault()
                event.stopPropagation()
                setMessageContextMenu({
                  position: { x: event.clientX, y: event.clientY },
                  context: {
                    surface: attachment ? 'attachment' : 'message',
                    taskSurface: turnTaskSurface(turn),
                    threadId: activeThreadId,
                    turnId: turn.user?.turnId ?? null,
                    messageId: turn.user?.id ?? null,
                    attachmentId: attachmentItem?.dataset.extensionAttachmentId || null,
                    mimeType: attachmentItem?.dataset.extensionAttachmentMime || null
                  }
                })
              }}
            >
              {showForkPoint ? <ThreadForkPoint parentTitle={forkedFromTitle} /> : null}
              <MemoMessageTurn
                turn={turn}
                isProcessing={turnIsProcessing}
                liveReasoning={isActiveTurn ? liveReasoning : ''}
                live={isActiveTurn ? live : ''}
                durationMs={durationMs}
                reasoningDurationMs={reasoningDurationMs}
                devPreviewCard={isLatestTurn ? devPreviewCard : null}
                planActionsBusy={planActionsBusy}
                graphEnabled={graphEnabled}
                onBuildPlan={onBuildPlan}
                onOpenPlan={onOpenPlan}
                onOpenChanges={onOpenChanges}
                onReviewChanges={onReviewChanges}
                reviewChangesDisabled={reviewChangesDisabled}
                onOpenChildThread={onOpenChildThread}
                onCancelToolCall={activeThreadId ? handleCancelToolCall : undefined}
                onComponentPrototypePrompt={onComponentPrototypePrompt}
                filePreviewWorkspaceRoot={filePreviewWorkspaceRoot}
                viewportRef={containerRef}
                compactCards={compactCards}
                turnUsage={turn.turnId ? turnUsage.byTurnId.get(turn.turnId) : undefined}
                turnUsageStale={turnUsage.stale}
              />
              {!turnIsProcessing && turnMessageActions.length && onExtensionCommand ? (
                <div className="mt-1 flex justify-end">
                  <DeclarativeActionBar
                    contributions={turnMessageActions}
                    context={{
                      surface: 'message',
                      threadId: activeThreadId,
                      turnId: turn.user?.turnId ?? null,
                      messageId: turn.user?.id ?? null
                    }}
                    onCommand={onExtensionCommand}
                    compact
                  />
                </div>
              ) : null}
              {!turnIsProcessing && turnResultPreviews.length ? (
                <DeclarativeResultPreviews
                  contributions={turnResultPreviews}
                  sources={resultPreviewSourcesForTurn(turn)}
                  threadId={activeThreadId}
                  turnId={turn.user?.turnId}
                  workspaceRoot={extensionWorkspaceRoot}
                />
              ) : null}
            </div>
          )
        })}

        {forkBoundaryTurnCount !== undefined &&
        forkBoundaryTurnCount === turns.length &&
        hasContent ? (
          <ThreadForkPoint parentTitle={forkedFromTitle} />
        ) : null}

        {hiddenTurnCount === 0 && turns.length > TURN_PAGE_SIZE && !busy ? (
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                collapseEarlierTurns()
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
            filePreviewWorkspaceRoot={filePreviewWorkspaceRoot}
            viewportRef={containerRef}
            onOpenChildThread={onOpenChildThread}
            onCancelToolCall={undefined}
            onComponentPrototypePrompt={onComponentPrototypePrompt}
            compactCards={compactCards}
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
      {onExtensionCommand ? (
        <DeclarativeContextMenuOverlay
          contributions={messageContextMenu?.context &&
            typeof messageContextMenu.context === 'object' &&
            !Array.isArray(messageContextMenu.context) &&
            messageContextMenu.context.surface === 'attachment'
            ? messageContributionsForSurface?.(
                messageContextMenu.context.taskSurface === 'design' ? 'design' : 'code'
              )?.attachmentContextMenus ?? extensionAttachmentContextMenus
            : messageContextMenu?.context && typeof messageContextMenu.context === 'object' &&
                !Array.isArray(messageContextMenu.context)
              ? messageContributionsForSurface?.(
                  messageContextMenu.context.taskSurface === 'design' ? 'design' : 'code'
                )?.contextMenus ?? extensionContextMenus
              : extensionContextMenus}
          commands={extensionCommands}
          context={messageContextMenu?.context ?? null}
          position={messageContextMenu?.position ?? null}
          onCommand={onExtensionCommand}
          onClose={() => setMessageContextMenu(null)}
        />
      ) : null}
      </div>
    </div>
    </InjectedMemoryLookupProvider>
    </TimelineFilePreviewWorkspaceProvider>
  )
}
