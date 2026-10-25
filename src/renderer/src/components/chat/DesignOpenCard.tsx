import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ChevronRight, Loader2, Palette } from 'lucide-react'
import type { ToolBlock } from '../../agent/types'
import { readDesignOpenRequest, type DesignOpenRequestMetadata } from '../../agent/design-open-request'
import { useChatStore } from '../../store/chat-store'
import { openAgentDesignCanvas } from '../../design/agent-design-ingest'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'

export type DesignOpenCardState = 'designing' | 'ready' | 'failed' | 'legacy' | 'interrupted'

/** A call that stopped streaming without a result (stopped reply) no longer spins. */
export function designOpenCardState(
  request: DesignOpenRequestMetadata,
  requestTurnLive: boolean
): DesignOpenCardState {
  if (request.status === 'pending') return requestTurnLive ? 'designing' : 'interrupted'
  return request.status
}

/**
 * Transcript card for a Code agent's `design_open` call: the design lives on
 * the canvas, and the card is the way back to it — one click opens it beside
 * the conversation.
 */
export function DesignOpenCard({ block, threadId, requestTurnLive }: {
  block: ToolBlock
  threadId?: string
  requestTurnLive: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const request = useMemo(() => readDesignOpenRequest(block), [block])
  const thread = useChatStore((state) => threadId
    ? state.threads.find((candidate) => candidate.id === threadId)
    : undefined)
  const surfaceWorkspace = useCodeCanvasDesignSurface((state) => state.surface?.workspaceRoot ?? '')
  const [opening, setOpening] = useState(false)
  if (!request) return null

  const state = designOpenCardState(request, requestTurnLive)
  const workspaceRoot = thread?.workspace?.trim() || surfaceWorkspace
  const legacyDocument = thread?.designProfile?.documentTarget
  const canOpen = Boolean(threadId && workspaceRoot) && (
    state === 'ready' || (state === 'legacy' && Boolean(legacyDocument))
  )

  const open = (): void => {
    if (!canOpen || !threadId || opening) return
    if (state === 'legacy' && legacyDocument) {
      useCodeCanvasDesignSurface.getState().showDesignDocument(threadId, workspaceRoot, legacyDocument.documentId, {
        ...(legacyDocument.boardArtifactId ? { boardArtifactId: legacyDocument.boardArtifactId } : {})
      })
      requestCodeCanvasPanelOpen()
      return
    }
    setOpening(true)
    void openAgentDesignCanvas({ threadId, workspaceRoot, request }).finally(() => setOpening(false))
  }

  const targetLabel = request.target === 'app'
    ? t('designAgentCardTargetApp')
    : request.target === 'web' ? t('designAgentCardTargetWeb') : ''
  const screens = request.screenCount > 0 ? t('designAgentCardScreens', { count: request.screenCount }) : ''
  const meta = state === 'designing'
    ? [t('designAgentCardDesigning'), screens].filter(Boolean).join(' · ')
    : state === 'failed'
      ? t('designAgentCardFailedDetail', { error: request.error ?? '' })
      : state === 'interrupted'
        ? t('designAgentCardNotStarted')
        : state === 'legacy'
          ? t(legacyDocument ? 'designAgentCardReady' : 'designAgentCardNotStarted')
          : [screens, targetLabel].filter(Boolean).join(' · ')
  const busy = state === 'designing' || opening

  return (
    <button
      type="button"
      onClick={open}
      disabled={!canOpen}
      title={request.title}
      aria-label={t('designAgentCardOpenAria', { title: request.title })}
      data-design-open-card
      data-design-open-open
      data-design-open-state={state}
      className="ds-no-drag group my-1.5 flex w-full min-w-0 max-w-[560px] items-center gap-3 rounded-[12px] border border-ds-border bg-ds-card px-3 py-2.5 text-left transition hover:border-ds-border-strong hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40 disabled:cursor-default disabled:hover:border-ds-border disabled:hover:bg-ds-card"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
        {busy
          ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} aria-hidden />
          : state === 'failed'
            ? <AlertCircle className="h-4 w-4 text-ds-danger" strokeWidth={1.9} aria-hidden />
            : <Palette className="h-4 w-4" strokeWidth={1.9} aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ds-ink">{request.title}</span>
        {meta ? <span className="mt-0.5 block truncate text-[11.5px] text-ds-muted">{meta}</span> : null}
      </span>
      {canOpen ? (
        <ChevronRight
          className="h-4 w-4 shrink-0 text-ds-faint transition group-hover:translate-x-0.5 group-hover:text-ds-ink"
          strokeWidth={1.9}
          aria-hidden
        />
      ) : null}
    </button>
  )
}
