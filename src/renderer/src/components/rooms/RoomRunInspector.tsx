import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Lock, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RoomMessageBody } from './RoomMessageBody'
import { RoomRunItems } from './RoomRunItems'
import { buildRoomRunConversation, buildRoomRunTranscript } from './room-run-conversation'
import { useRoomRun } from './useRoomRun'
import { WorkMetaRow } from '../chat/message-timeline-cards'
import { formatDuration } from '../chat/message-timeline-tools'
import { TimelineFilePreviewWorkspaceProvider } from '../chat/timeline-file-preview-workspace'
import './rooms-runs.css'

const RUNNING_STATUSES = new Set(['queued', 'running', 'recovery_required'])

export function RoomRunInspector({
  roomId,
  runId,
  active = true
}: {
  roomId: string
  runId: string
  active?: boolean
}) {
  const { t } = useTranslation('common')
  const state = useRoomRun(roomId, runId, active)
  const [processExpanded, setProcessExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const anchor = useRef<{
    height: number
    top: number
    firstId?: string
  } | null>(null)
  const atBottom = useRef(true)
  const [away, setAway] = useState(false)

  useLayoutEffect(() => {
    if (!scroll.current) return
    if (anchor.current && anchor.current.firstId !== state.items[0]?.id) {
      scroll.current.scrollTop =
        anchor.current.top + scroll.current.scrollHeight - anchor.current.height
      anchor.current = null
    } else if (atBottom.current) {
      scroll.current.scrollTop = scroll.current.scrollHeight
    }
  }, [state.items])

  const detail = state.detail
  const run = detail?.run
  const processing = run ? RUNNING_STATUSES.has(run.status) : false
  const conversation = buildRoomRunConversation(state.items)
  const transcript = buildRoomRunTranscript(conversation, run?.input)

  const copyTranscript = async () => {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(transcript)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopyError(t('roomsRunCopyFailed'))
    }
  }

  return (
    <TimelineFilePreviewWorkspaceProvider workspaceRoot={detail?.workspaceRoot ?? ''} threadId={run?.threadId}>
    <section
      className="rooms-run-inspector"
      aria-label={t('roomsAgentSession')}
      data-run-id={runId}
    >
      <div
        ref={scroll}
        className="rooms-run-scroll"
        onScroll={(event) => {
          atBottom.current =
            event.currentTarget.scrollHeight -
              event.currentTarget.scrollTop -
              event.currentTarget.clientHeight <
            80
          setAway(!atBottom.current)
        }}
      >
        {state.loading ? (
          <p className="rooms-run-note">{t('roomsLoading')}</p>
        ) : null}
        {run && detail ? (
          <>
            <header className="rooms-run-header">
              <div className="rooms-run-header-main">
                <div className="rooms-run-title">
                  {processing ? <span className="rooms-run-status-dot is-running" /> : null}
                  <span className="rooms-run-agent">{run.memberLabel}</span>
                </div>
                <div className="rooms-run-meta">
                  <span className={processing ? 'is-running' : ''}>
                    {t(`roomsRunStatus_${run.status}`, { defaultValue: run.status })}
                  </span>
                  {run.model ? <span className="rooms-run-model">{run.model}</span> : null}
                  {run.elapsedMs !== undefined ? (
                    <span className="rooms-run-elapsed">{formatDuration(run.elapsedMs)}</span>
                  ) : null}
                </div>
              </div>
              <div className="rooms-run-actions" aria-label={t('roomsRunTranscriptActions')}>
                <button type="button" onClick={() => void copyTranscript()}>
                  {copied ? t('roomsRunCopied') : t('roomsRunCopyTranscript')}
                </button>
                <button type="button" onClick={() => setProcessExpanded(true)}>
                  {t('roomsRunExpandProcess')}
                </button>
                <button type="button" onClick={() => setProcessExpanded(false)}>
                  {t('roomsRunCollapseProcess')}
                </button>
              </div>
            </header>

            {run.error || run.reason ? (
              <p
                className={run.error ? 'rooms-run-error' : 'rooms-run-note'}
                role={run.error ? 'alert' : undefined}
              >
                {run.error || run.reason}
              </p>
            ) : null}

            {detail.availability.status !== 'available' ? (
              <p className="rooms-run-unavailable">
                {t(`roomsRunAvailability_${detail.availability.status}`)}
                {detail.availability.reason ? ` · ${detail.availability.reason}` : ''}
              </p>
            ) : null}

            {run.input ? (
              <div className="rooms-run-user-bubble">
                <RoomMessageBody body={run.input} attachmentIds={run.attachmentIds} />
              </div>
            ) : null}

            <WorkMetaRow
              processing={processing}
              durationMs={run.elapsedMs}
              expanded={processExpanded}
              onToggle={() => setProcessExpanded((value) => !value)}
            />

            {processExpanded ? (
              <div className="rooms-run-process">
                {state.hasEarlier ? (
                  <button
                    type="button"
                    className="rooms-run-secondary"
                    disabled={state.moreBusy}
                    onClick={() => {
                      if (scroll.current)
                        anchor.current = {
                          height: scroll.current.scrollHeight,
                          top: scroll.current.scrollTop,
                          firstId: state.items[0]?.id
                        }
                      void state.loadEarlier()
                    }}
                  >
                    {t(
                      state.moreBusy
                        ? 'roomsLoading'
                        : state.hasGap
                          ? 'roomsRunLoadGap'
                          : 'roomsRunEarlier'
                    )}
                  </button>
                ) : null}

                {state.itemsAvailability &&
                state.itemsAvailability.status !== 'available' &&
                state.itemsAvailability.status !== detail.availability.status ? (
                  <p className="rooms-run-unavailable">
                    {t(`roomsRunAvailability_${state.itemsAvailability.status}`)}
                    {state.itemsAvailability.reason
                      ? ` · ${state.itemsAvailability.reason}`
                      : ''}
                  </p>
                ) : null}

                <RoomRunItems roomId={roomId} runId={runId} items={state.items} runStatus={run.status} />

                {!state.items.length &&
                !state.error &&
                state.itemsAvailability?.status === 'available' ? (
                  <p className="rooms-run-note">{t('roomsRunNoItems')}</p>
                ) : null}
              </div>
            ) : null}

            {conversation.finalAnswer ? (
              <div className="rooms-run-final">
                <RoomMessageBody
                  body={conversation.finalAnswer.text ?? ''}
                  attachmentIds={conversation.finalAnswer.attachmentIds ?? []}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {state.error || state.streamError || copyError ? (
          <p role="alert" className="rooms-run-error">
            {state.error || state.streamError || copyError}
          </p>
        ) : null}
        {state.error || state.streamError ? (
          <button type="button" className="rooms-run-secondary" onClick={state.refresh}>
            <RefreshCw size={13} />
            {t('roomsRefresh')}
          </button>
        ) : null}
      </div>

      {away && state.items.length ? (
        <button
          type="button"
          className="rooms-run-latest rooms-run-secondary"
          onClick={() => {
            if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
            atBottom.current = true
            setAway(false)
          }}
        >
          <ArrowDown size={13} />
          {t('roomsRunScrollToBottom')}
        </button>
      ) : null}

      <footer className="rooms-run-readonly-footer">
        <Lock size={13} strokeWidth={1.9} />
        <span>{t('roomsRunReadOnlyFooter')}</span>
      </footer>
    </section>
    </TimelineFilePreviewWorkspaceProvider>
  )
}
