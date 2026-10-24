import { useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircleMore } from 'lucide-react'
import type { SideConversation } from '../../store/chat-store-types'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { ConversationTurn } from './MessageTimeline'
import { activeTimelineTurnIndex, groupTurns, stableTurnKey } from './message-timeline-turns'
import { InjectedMemoryLookupProvider } from './injected-memory-lookup'
import { TimelineFilePreviewWorkspaceProvider } from './timeline-file-preview-workspace'
import { MessageSelectionToolbar } from './MessageSelectionToolbar'

type SideConversationTimelineProps = {
  side: SideConversation
  workspaceRoot: string
}

export const EMPTY_QUEUED_MESSAGES: [] = []
export const noop = (): void => undefined

export function formatInheritedTime(value: string, locale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(date)
}

export function overlayStyle(rightOffset = 24): CSSProperties {
  const offset = Math.max(12, Math.round(rightOffset))
  return {
    right: `min(${offset}px, calc(12px + max(0px, 100vw - 760px)))`
  }
}

export function activeSideConversationOrdinal(
  sides: readonly SideConversation[],
  activeSideId: string | null
): number {
  const index = activeSideId
    ? sides.findIndex((side) => side.threadId === activeSideId)
    : -1
  return index >= 0 ? index + 1 : sides.length + 1
}

export function SideConversationTimeline({
  side,
  workspaceRoot
}: SideConversationTimelineProps): ReactElement {
  const { t } = useTranslation('common')
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const turns = useMemo(() => groupTurns(side.blocks), [side.blocks])
  const activeTurnIndex = useMemo(
    () => activeTimelineTurnIndex(
      turns,
      side.liveReasoningTurnId ?? side.liveAssistantTurnId ?? side.turnId,
      side.userItemId
    ),
    [side.liveAssistantTurnId, side.liveReasoningTurnId, side.turnId, side.userItemId, turns]
  )
  const scrollKey = [
    side.blocks.length,
    side.liveReasoning.length,
    side.liveAssistant.length,
    side.busy ? 'busy' : 'idle'
  ].join(':')

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [scrollKey])

  const hasContent =
    side.blocks.length > 0 || Boolean(side.liveReasoning.trim() || side.liveAssistant.trim())

  return (
    <TimelineFilePreviewWorkspaceProvider
      workspaceRoot={workspaceRoot}
      threadId={side.threadId}
    >
      <InjectedMemoryLookupProvider workspaceRoot={workspaceRoot}>
        <div
          ref={viewportRef}
          className="ds-sidebar-surface-body ds-no-drag min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          data-testid="side-conversation-timeline"
        >
          <div className="mx-auto flex w-full min-w-0 flex-col gap-8 px-5 pb-10 pt-6 sm:px-6">
            {!hasContent ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center text-[12.5px] leading-5 text-ds-faint">
                <MessageCircleMore className="h-5 w-5 opacity-65" strokeWidth={1.7} />
                <p>{t('sidePanelEmpty')}</p>
              </div>
            ) : null}

            {turns.map((turn, index) => {
              const isActive = index === activeTurnIndex
              const turnPending = threadHasPendingRuntimeWork(turn.blocks)
              const hasLiveStream =
                isActive && Boolean(side.liveReasoning.trim() || side.liveAssistant.trim())
              const isProcessing = (side.busy && isActive) || turnPending || hasLiveStream
              return (
                <ConversationTurn
                  key={stableTurnKey(turn, index)}
                  turn={turn}
                  isProcessing={isProcessing}
                  liveReasoning={isActive ? side.liveReasoning : ''}
                  live={isActive ? side.liveAssistant : ''}
                  filePreviewWorkspaceRoot={workspaceRoot}
                  viewportRef={viewportRef}
                  compactCards
                  allowMainThreadActions={false}
                />
              )
            })}

            {turns.length === 0 && (side.liveReasoning || side.liveAssistant) ? (
              <ConversationTurn
                turn={{ blocks: [] }}
                isProcessing={side.busy}
                liveReasoning={side.liveReasoning}
                live={side.liveAssistant}
                filePreviewWorkspaceRoot={workspaceRoot}
                viewportRef={viewportRef}
                compactCards
                allowMainThreadActions={false}
              />
            ) : null}

            {side.error ? (
              <div
                role="alert"
                className="rounded-[12px] border border-red-300/70 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200"
              >
                {side.error}
              </div>
            ) : null}
            <div ref={endRef} aria-hidden className="h-px w-full shrink-0" />
          </div>
        </div>
        <MessageSelectionToolbar containerRef={viewportRef} surface="side" sideId={side.threadId} />
      </InjectedMemoryLookupProvider>
    </TimelineFilePreviewWorkspaceProvider>
  )
}
