import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Square } from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { readToolPresentation } from '../../agent/tool-presentation'
import { parseBackgroundSubagentCompletionNotice } from '@shared/background-subagent-notice'
import { isBackgroundShellCommandBlock } from './message-timeline-tools'
import { isSubagentBlock } from './message-timeline-process-grouping'

export function processBlockIsAutoOpenPending(block: ChatBlock, processing: boolean): boolean {
  return (
    processing &&
    ((block.kind === 'compaction' && block.status === 'running') ||
      (block.kind === 'approval' && block.status === 'pending') ||
      (block.kind === 'approval_review' && block.status === 'in-progress') ||
      (block.kind === 'user_input' && block.status === 'pending'))
  )
}

export function processBlockIsActive(block: ChatBlock, processing: boolean): boolean {
  // Running tools stay visually quiet in the process timeline; ConversationTurn
  // owns the bottom "thinking / running" loading row.
  return (
    processBlockIsAutoOpenPending(block, processing) ||
    (processing && block.kind === 'assistant' && block.id === 'live-assistant')
  )
}

export function BackgroundSubagentRowSummary({
  block
}: {
  block: Extract<ChatBlock, { kind: 'user' }>
}): ReactElement {
  const { t } = useTranslation('common')
  const parsed = parseBackgroundSubagentCompletionNotice(block.text)
  const failed = parsed?.status === 'failed'
  const label =
    parsed?.label ||
    block.meta?.displayText?.trim() ||
    t('backgroundSubagentNotice.title', { defaultValue: 'Background subagent completed' })

  return (
    <span
      data-background-subagent-row="true"
      className="flex min-w-0 flex-1 items-center gap-2.5"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-ds-ink">{label}</span>
        <span className="block truncate text-[11.5px] text-ds-faint">
          {t('backgroundSubagentNotice.taskKind', { defaultValue: 'Background task' })}
        </span>
      </span>
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium ${
          failed
            ? 'text-orange-700 dark:text-orange-300'
            : 'text-emerald-700 dark:text-emerald-300'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${failed ? 'bg-orange-500' : 'bg-emerald-500'}`} />
        {failed
          ? t('backgroundSubagentNotice.failed', { defaultValue: 'Failed' })
          : t('backgroundSubagentNotice.completed', { defaultValue: 'Completed' })}
      </span>
    </span>
  )
}

function toolCancelCallId(block: ChatBlock): string {
  if (block.kind !== 'tool') return ''
  const callId = block.meta?.callId
  return typeof callId === 'string' ? callId.trim() : ''
}

function toolCancelRequested(block: ChatBlock): boolean {
  if (block.kind !== 'tool') return false
  return typeof block.meta?.cancelRequestedAt === 'string' && block.meta.cancelRequestedAt.trim().length > 0
}

function canCancelToolBlock(block: ChatBlock, processing: boolean): block is ToolBlock {
  if (!processing || block.kind !== 'tool' || block.status !== 'running' || !toolCancelCallId(block)) return false
  const presentation = readToolPresentation(block)
  if (!presentation.canCancel || presentation.state !== 'running') return false
  // Detached/background work owns its own lifecycle and must keep using its
  // existing control surface rather than the foreground tool cancellation API.
  if (block.meta?.detached === true || isBackgroundShellCommandBlock(block) || isSubagentBlock(block)) {
    return false
  }
  return true
}

export function ToolCancelButton({
  block,
  processing,
  onCancelToolCall
}: {
  block: ChatBlock
  processing: boolean
  onCancelToolCall?: (block: ToolBlock) => Promise<boolean>
}): ReactElement | null {
  const { t } = useTranslation('common')
  const [requested, setRequested] = useState(() => toolCancelRequested(block))
  const pendingRequest = useRef(false)
  const cancellable = canCancelToolBlock(block, processing)
  const blockStatus = block.kind === 'tool' ? block.status : undefined
  const blockCancelRequestedAt = block.kind === 'tool' && typeof block.meta?.cancelRequestedAt === 'string'
    ? block.meta.cancelRequestedAt
    : undefined
  const cancelRequested = toolCancelRequested(block)

  useEffect(() => {
    pendingRequest.current = cancelRequested
    setRequested(cancelRequested)
  }, [block.id, blockStatus, blockCancelRequestedAt, cancelRequested])

  if (!cancellable || !onCancelToolCall) return null
  const stopping = requested || toolCancelRequested(block)
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (stopping || pendingRequest.current) return
    pendingRequest.current = true
    setRequested(true)
    void onCancelToolCall(block).then((accepted) => {
      if (!accepted) { pendingRequest.current = false; setRequested(false) }
    }).catch(() => {
      pendingRequest.current = false
      setRequested(false)
    })
  }

  return (
    <button
      type="button"
      aria-label={stopping ? t('toolCancelling') : t('toolCancel')}
      title={stopping ? t('toolCancelling') : t('toolCancel')}
      aria-busy={stopping}
      disabled={stopping}
      onClick={handleClick}
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ${
        stopping ? 'cursor-wait text-accent opacity-80' : 'text-ds-faint hover:bg-ds-hover/70 hover:text-ds-ink'
      }`}
    >
      {stopping ? (
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
      ) : (
        <Square className="h-3 w-3" fill="currentColor" strokeWidth={1.9} />
      )}
    </button>
  )
}
