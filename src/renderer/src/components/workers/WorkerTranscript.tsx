import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { ThreadDetail } from '../../agent/provider-types'
import { threadSnapshotLooksRunning } from '../../store/chat-store-runtime-helpers'
import { groupTurns, stableTurnKey } from '../chat/message-timeline-turns'
import { ConversationTurn } from '../chat/MessageTimeline'
import { TimelineFilePreviewWorkspaceProvider } from '../chat/timeline-file-preview-workspace'
import { InjectedMemoryLookupProvider } from '../chat/injected-memory-lookup'
import { workerScrollPositions } from './worker-view-store'
import { AssignmentCardCompactContext } from './AssignmentCard'

/**
 * Read-only worker conversation at panel scale. It renders the chat
 * timeline's own turns; `.ds-worker-transcript` only scales the type.
 */
export function WorkerTranscript({
  threadId,
  workspaceRoot,
  detail,
  loading,
  loadingOlder,
  error,
  onLoadOlder
}: {
  threadId: string
  workspaceRoot: string
  detail: ThreadDetail | null
  loading: boolean
  loadingOlder: boolean
  error: string | null
  onLoadOlder: () => Promise<void>
}): ReactElement {
  const { t } = useTranslation('common')
  const [visibleTurnCount, setVisibleTurnCount] = useState(3)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = workerScrollPositions.get(threadId) ?? 0
    return () => {
      if (viewport) workerScrollPositions.set(threadId, viewport.scrollTop)
    }
  }, [threadId])

  const allTurns = useMemo(() => detail ? groupTurns(detail.blocks) : [], [detail])
  const turns = allTurns.slice(-visibleTurnCount)
  const liveReasoning = detail?.liveProjection?.reasoning?.text ?? ''
  const liveAssistant = detail?.liveProjection?.assistant?.text ?? ''
  // Live text only exists while a model call streams; a worker running tools
  // or waiting on approval is still mid-turn and must keep its process open.
  const turnRunning = detail
    ? detail.activeTurn !== undefined
      ? Boolean(detail.activeTurn)
      : threadSnapshotLooksRunning(detail.blocks, detail.threadStatus, detail.latestTurnStatus)
    : false
  const processing = turnRunning || Boolean(liveReasoning || liveAssistant)
  const visibleTurns = turns.length === 0 && processing ? [{ blocks: [] }] : turns

  return (
    <div
      ref={viewportRef}
      onScroll={(event) => workerScrollPositions.set(threadId, event.currentTarget.scrollTop)}
      className="ds-worker-transcript min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3"
      data-worker-preview-timeline
      data-worker-preview-seq={detail?.latestSeq}
    >
      {loading && !detail ? (
        <div className="flex items-center gap-2 py-2 text-[12px] text-ds-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} aria-hidden />
          {t('workerTab.loadingConversation')}
        </div>
      ) : null}
      {detail && (allTurns.length > visibleTurnCount || detail.hasMoreHistory) ? (
        <button
          type="button"
          disabled={loadingOlder}
          onClick={() => {
            setVisibleTurnCount((count) => count + 10)
            if (visibleTurnCount >= allTurns.length) void onLoadOlder()
          }}
          className="mb-3 w-full rounded-lg py-1.5 text-[12px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
        >
          {loadingOlder ? t('workerTab.loadingConversation') : t('workerLoadEarlier')}
        </button>
      ) : null}
      {error ? <p role="alert" className="mb-2 text-[12px] text-ds-status-danger">{error}</p> : null}
      {detail && visibleTurns.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-ds-faint">{t('workerTab.noConversation')}</p>
      ) : null}
      {detail ? (
        <TimelineFilePreviewWorkspaceProvider workspaceRoot={workspaceRoot} threadId={threadId}>
          <InjectedMemoryLookupProvider workspaceRoot={workspaceRoot}>
            <AssignmentCardCompactContext.Provider value>
              <div className="flex flex-col gap-5">
                {visibleTurns.map((turn, index) => {
                  const last = index === visibleTurns.length - 1
                  return (
                    <ConversationTurn
                      key={stableTurnKey(turn, index)}
                      turn={turn}
                      threadId={threadId}
                      isProcessing={last && processing}
                      liveReasoning={last ? liveReasoning : ''}
                      live={last ? liveAssistant : ''}
                      liveStartedAtMs={last ? detail.latestTurnStartedAtMs : undefined}
                      filePreviewWorkspaceRoot={workspaceRoot}
                      viewportRef={viewportRef}
                      compactCards
                      allowMainThreadActions={false}
                      allowRecoveryContinue={false}
                    />
                  )
                })}
              </div>
            </AssignmentCardCompactContext.Provider>
          </InjectedMemoryLookupProvider>
        </TimelineFilePreviewWorkspaceProvider>
      ) : null}
    </div>
  )
}
