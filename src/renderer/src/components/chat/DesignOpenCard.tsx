import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ChevronRight, Clock3, Loader2, Palette, Play, RotateCcw } from 'lucide-react'
import type { ToolBlock } from '../../agent/types'
import { readDesignOpenRequest } from '../../agent/design-open-request'
import { useChatStore } from '../../store/chat-store'
import {
  deriveDesignOpenCardState,
  useAgentDesignRequestStore,
  type DesignOpenCardState
} from '../../design/agent-design-requests'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { useCodeCanvasDesignSurface } from '../../design/code-canvas-design-surface'
import { requestCodeCanvasPanelOpen } from '../../lib/code-canvas-panel-event'

const BUSY_STATES: ReadonlySet<DesignOpenCardState> = new Set(['pending', 'starting', 'designing'])

function statusLabelKey(state: DesignOpenCardState): string {
  switch (state) {
    case 'pending': return 'designAgentCardPending'
    case 'queued': return 'designAgentCardQueued'
    case 'starting': return 'designAgentCardStarting'
    case 'designing': return 'designAgentCardDesigning'
    case 'ready': return 'designAgentCardReady'
    case 'not-started': return 'designAgentCardNotStarted'
    case 'start-failed': return 'designAgentCardStartFailed'
    case 'superseded': return 'designAgentCardSuperseded'
    case 'failed': return 'designAgentCardFailed'
  }
}

function StatusIcon({ state }: { state: DesignOpenCardState }): ReactElement | null {
  if (BUSY_STATES.has(state)) return <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
  if (state === 'queued') return <Clock3 className="h-3 w-3 shrink-0" aria-hidden />
  if (state === 'failed' || state === 'start-failed') return <AlertCircle className="h-3 w-3 shrink-0 text-red-500" aria-hidden />
  return null
}

/**
 * Transcript card for a Code-agent `design_open` request. It mirrors the
 * request's dispatch state and opens the bound Design canvas beside the
 * conversation; a request that never started offers a manual start.
 */
export function DesignOpenCard({ block, threadId, requestTurnLive }: {
  block: ToolBlock
  threadId?: string
  requestTurnLive: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const request = useMemo(() => readDesignOpenRequest(block), [block])
  const requestId = request?.requestId ?? ''
  const record = useAgentDesignRequestStore((state) => requestId ? state.records[requestId] : undefined)
  const requestStart = useAgentDesignRequestStore((state) => state.requestStart)
  const threadBusy = useChatStore((state) => state.busy)
  const thread = useChatStore((state) => threadId
    ? state.threads.find((candidate) => candidate.id === threadId)
    : undefined)
  const documentTarget = thread?.designProfile?.documentTarget
  const document = useDesignWorkspaceStore((state) => documentTarget
    ? state.documents.find((candidate) => candidate.id === documentTarget.documentId)
    : undefined)
  const surface = useCodeCanvasDesignSurface((state) => state.surface)
  const provisionalDocumentId = surface?.threadId === threadId && (surface?.surfaceKind ?? 'kun-design') === 'kun-design'
    ? surface?.documentId
    : undefined
  if (!request) return null

  const documentId = documentTarget?.documentId ?? provisionalDocumentId
  const state = deriveDesignOpenCardState({
    request,
    record,
    requestTurnLive,
    threadBusy,
    threadHasDesign: Boolean(documentId)
  })
  const screenCount = document?.artifacts.filter((artifact) => artifact.kind === 'html').length ?? 0
  const canOpen = Boolean(documentId && threadId) && state !== 'failed' && state !== 'pending'
  const canStart = Boolean(requestId) && (state === 'not-started' || state === 'start-failed')
  const workspaceRoot = thread?.workspace?.trim() || surface?.workspaceRoot || ''

  const openCanvas = (): void => {
    if (!canOpen || !threadId || !documentId) return
    if (workspaceRoot) {
      useCodeCanvasDesignSurface.getState().showDesignDocument(threadId, workspaceRoot, documentId, {
        ...(documentTarget?.boardArtifactId ? { boardArtifactId: documentTarget.boardArtifactId } : {})
      })
    }
    requestCodeCanvasPanelOpen()
  }

  const status = state === 'start-failed' && record?.error
    ? t('designAgentCardStartFailedDetail', { error: record.error })
    : state === 'failed' && request.error
      ? t('designAgentCardFailedDetail', { error: request.error })
      : t(statusLabelKey(state))
  const screens = screenCount > 0 && (state === 'designing' || state === 'ready')
    ? t('designAgentCardScreens', { count: screenCount })
    : ''
  const targetLabel = request.target === 'app'
    ? t('designAgentCardTargetApp')
    : request.target === 'web'
      ? t('designAgentCardTargetWeb')
      : ''
  const meta = [status, screens, targetLabel].filter(Boolean).join(' · ')
  const title = document?.title?.trim() || request.title

  return (
    <section
      data-design-open-card
      data-design-open-state={state}
      className="mx-auto my-1 flex w-full min-w-0 max-w-[620px] items-center gap-3 rounded-[12px] border border-ds-border bg-ds-card px-3 py-2.5 shadow-[0_5px_18px_rgba(36,68,112,0.06)]"
    >
      <button
        type="button"
        onClick={openCanvas}
        disabled={!canOpen}
        title={request.brief || request.title}
        aria-label={t('designAgentCardOpenAria', { title })}
        className="ds-no-drag flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-default"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-violet-50 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300">
          <Palette className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ds-ink">{title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ds-muted">
            <StatusIcon state={state} />
            <span className="truncate">{meta}</span>
          </span>
        </span>
      </button>
      {canStart ? (
        <button
          type="button"
          data-design-open-start
          onClick={() => requestStart(requestId)}
          className="ds-no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border px-2.5 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          {state === 'start-failed'
            ? <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            : <Play className="h-3.5 w-3.5" aria-hidden />}
          {t(state === 'start-failed' ? 'designAgentCardRetry' : 'designAgentCardStart')}
        </button>
      ) : canOpen ? (
        <button
          type="button"
          data-design-open-open
          onClick={openCanvas}
          className="ds-no-drag inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        >
          {t('designAgentCardOpen')}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </section>
  )
}
