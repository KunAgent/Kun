import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, CircleAlert, CloudAlert } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import { extractDiffFilePath, extractUnifiedDiffText } from '../../lib/diff-stats'
import { boundedPlainText } from '../../extensions/safe-text'
import { RelativePathSchema, ResultPreviewSourceSchema } from '@kun/extension-api'
import type { ExtensionResultPreviewSource } from '../../extensions/ControlledContributionSurfaces'
import { isBackgroundShellNoticeBlock, splitThink, type Turn } from './message-timeline-turns'
import type { TurnRuntimeErrorBlock } from './derive-turn-sections'

const TIMELINE_JUMP_RAIL_FALLBACK_LEFT_PX = 16
const TIMELINE_JUMP_RAIL_STAGE_INSET_PX = 16
const TIMELINE_JUMP_RAIL_WIDTH_PX = 62
const TIMELINE_JUMP_RAIL_PREVIEW_OFFSET_PX = 68
const TIMELINE_JUMP_RAIL_PREVIEW_WIDTH_PX = 416
const TIMELINE_JUMP_RAIL_PREVIEW_MARGIN_PX = 16
const TIMELINE_JUMP_RAIL_PREVIEW_CONTAINER_GUTTER_PX = 88

export function timelineBottomPaddingClass(): string {
  return 'pb-10'
}

export function liveTurnProgressClass(): string {
  return 'flex w-fit max-w-full items-center gap-2 py-0.5 text-[14px] font-medium text-ds-muted'
}

export function activeTimelineTurnKey(
  positions: readonly { key: string; top: number }[],
  threshold = 96
): string | null {
  if (positions.length === 0) return null
  let active = positions[0].key
  for (const position of positions) {
    if (position.top > threshold) break
    active = position.key
  }
  return active
}

export function timelineJumpRailLeft(containerWidth: number): number {
  const stageLeft = Math.max(TIMELINE_JUMP_RAIL_FALLBACK_LEFT_PX, TIMELINE_JUMP_RAIL_STAGE_INSET_PX)
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return stageLeft
  const maxLeft = Math.max(0, containerWidth - TIMELINE_JUMP_RAIL_WIDTH_PX - TIMELINE_JUMP_RAIL_FALLBACK_LEFT_PX)
  return Math.min(stageLeft, maxLeft)
}

export function timelineJumpRailPreviewLeft(
  railLeft: number,
  containerWidth: number
): number {
  const previewWidth = Math.min(
    TIMELINE_JUMP_RAIL_PREVIEW_WIDTH_PX,
    Math.max(0, containerWidth - TIMELINE_JUMP_RAIL_PREVIEW_CONTAINER_GUTTER_PX)
  )
  const minLeft = Math.max(TIMELINE_JUMP_RAIL_FALLBACK_LEFT_PX, TIMELINE_JUMP_RAIL_PREVIEW_MARGIN_PX)
  const maxLeft = Math.max(minLeft, containerWidth - previewWidth - TIMELINE_JUMP_RAIL_PREVIEW_MARGIN_PX)
  const preferredLeft = railLeft + TIMELINE_JUMP_RAIL_PREVIEW_OFFSET_PX
  return Math.min(Math.max(preferredLeft, minLeft), maxLeft)
}

export function blockScrollStamp(block: ChatBlock | undefined): string {
  if (!block) return ''
  switch (block.kind) {
    case 'user':
    case 'assistant':
    case 'reasoning':
    case 'system':
      return `${block.id}:${block.kind}:${block.text.length}`
    case 'tool':
      return `${block.id}:${block.kind}:${block.status}:${block.summary.length}:${block.detail?.length ?? 0}`
    case 'review':
      return `${block.id}:${block.kind}:${block.status}:${block.reviewText?.length ?? 0}`
    case 'approval':
    case 'approval_review':
    case 'user_input':
    case 'compaction':
      return `${block.id}:${block.kind}:${block.status}`
    default:
      return ''
  }
}

export function turnPreview(turn: Turn, fallback: string): string {
  if (turn.user && isBackgroundShellNoticeBlock(turn.user)) {
    const display = turn.user.meta?.displayText?.trim()
    if (display) {
      return display.length > 48 ? `${display.slice(0, 47).trimEnd()}...` : display
    }
  }
  const text = turn.user?.text.trim() ?? ''
  if (!text) return fallback
  const oneLine = text.replace(/\s+/g, ' ')
  return oneLine.length > 48 ? `${oneLine.slice(0, 47).trimEnd()}...` : oneLine
}

export function turnResponsePreview(turn: Turn, fallback: string): string {
  for (let index = turn.blocks.length - 1; index >= 0; index -= 1) {
    const block = turn.blocks[index]
    if (block.kind !== 'assistant') continue
    const content = splitThink(block.text).content.trim()
    if (content) return content.replace(/\s+/g, ' ')
  }
  return fallback
}

export type TimelineJumpPreviewMetadata = {
  fileLabels: string[]
  hasCommit: boolean
}

function timelineJumpPreviewFileLabel(filePath: string): string {
  const normalized = filePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').at(-1) ?? normalized
}

export function timelineJumpPreviewMetadata(turn: Turn): TimelineJumpPreviewMetadata {
  const fileLabels: string[] = []
  const seenFileLabels = new Set<string>()
  let hasCommit = false

  for (const block of turn.blocks) {
    if (block.kind !== 'tool' || block.status !== 'success') continue

    if (block.toolKind === 'file_change') {
      const filePath = extractDiffFilePath(extractUnifiedDiffText(block.detail), block.filePath)
      if (filePath) {
        const label = timelineJumpPreviewFileLabel(filePath)
        const key = label.toLocaleLowerCase()
        if (label && !seenFileLabels.has(key)) {
          seenFileLabels.add(key)
          fileLabels.push(label)
        }
      }
    }

    const command = typeof block.meta?.command === 'string' ? block.meta.command : ''
    if (/\bgit(?:\s+-C\s+(?:"[^"]*"|'[^']*'|\S+))?\s+commit\b/i.test(command)) {
      hasCommit = true
    }
  }

  return { fileLabels: fileLabels.slice(0, 32), hasCommit }
}

export function timelineJumpPreviewTop(
  buttonTop: number,
  buttonHeight: number,
  railAnchorTop: number
): number {
  return buttonTop + buttonHeight / 2 - railAnchorTop
}

export function timelineJumpWaveDistance(index: number, hoveredIndex: number): number | null {
  if (hoveredIndex < 0) return null
  return Math.min(Math.abs(index - hoveredIndex), 3)
}

export function TimelineJumpPreviewTitle({
  index,
  title
}: {
  index: number
  title: string
}): ReactElement {
  return (
    <div className="timeline-jump-rail-preview-title">
      <span className="timeline-jump-rail-preview-turn-index" aria-hidden="true">
        {index}
      </span>
      <span className="timeline-jump-rail-preview-title-text">{title}</span>
    </div>
  )
}

export function resultPreviewSourcesForTurn(turn: Turn): ExtensionResultPreviewSource[] {
  const sources: ExtensionResultPreviewSource[] = []
  const seen = new Set<string>()
  for (const block of turn.blocks) {
    if (block.kind !== 'tool' || block.status !== 'success' || !block.meta) continue
    const generatedFiles = block.meta.generatedFiles
    if (!Array.isArray(generatedFiles)) continue
    generatedFiles.slice(0, 32).forEach((input, index) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return
      const file = input as Record<string, unknown>
      const mimeType = typeof file.mimeType === 'string'
        ? file.mimeType.trim().toLowerCase().split(';', 1)[0].slice(0, 128)
        : ''
      if (!mimeType) return
      const artifactId = typeof file.artifactId === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(file.artifactId)
        ? file.artifactId
        : undefined
      const mediaHandleId = typeof file.mediaHandleId === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(file.mediaHandleId)
        ? file.mediaHandleId
        : undefined
      const availability = file.availability === 'available' || file.availability === 'unavailable'
        ? file.availability
        : undefined
      const attachmentId = !artifactId && typeof file.id === 'string' && /^[A-Za-z0-9._:-]+$/.test(file.id)
        ? file.id.slice(0, 256)
        : undefined
      const relativePathResult = RelativePathSchema.safeParse(file.relativePath)
      const relativePath = relativePathResult.success ? relativePathResult.data : undefined
      const boundedName = typeof file.name === 'string' ? boundedPlainText(file.name, 256).trim() : ''
      const name = boundedName || undefined
      const sourceId = `${block.id}:${artifactId || attachmentId || relativePath || name || index}`
        .replace(/[^A-Za-z0-9._:/+-]/g, '_')
        .slice(0, 512)
      if (seen.has(sourceId)) return
      const source = ResultPreviewSourceSchema.safeParse({
        sourceId,
        mimeType,
        ...(name ? { name } : {}),
        ...(attachmentId ? { attachmentId } : {}),
        ...(artifactId ? { artifactId } : {}),
        ...(mediaHandleId ? { mediaHandleId } : {}),
        ...(availability ? { availability } : {}),
        ...(relativePath ? { relativePath } : {}),
        ...(typeof file.byteSize === 'number' && Number.isFinite(file.byteSize)
          ? { byteSize: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(file.byteSize))) }
          : {}),
        ...(typeof file.width === 'number' && Number.isFinite(file.width)
          ? { width: Math.min(1_000_000, Math.max(0, Math.trunc(file.width))) }
          : {}),
        ...(typeof file.height === 'number' && Number.isFinite(file.height)
          ? { height: Math.min(1_000_000, Math.max(0, Math.trunc(file.height))) }
          : {})
      })
      if (!source.success) return
      seen.add(sourceId)
      sources.push(source.data)
    })
  }
  return sources
}

/** Non-interactive runtime error rendered directly in the conversation flow. */
export function TimelineRuntimeError({
  block,
  onContinue
}: {
  block: TurnRuntimeErrorBlock
  /** Optional "continue the interrupted task" action shown for restart interrupts. */
  onContinue?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const code = block.code?.trim() ?? ''
  const detail = block.detail?.trim() ?? ''
  const requestFailure = block.modelRequestFailure
  const providerResponded = requestFailure?.requestState === 'provider_responded'
  const sentNoResponse = requestFailure?.requestState === 'sent_no_response'
  const requestNotSent = requestFailure?.requestState === 'not_sent'
  // Restart interrupts get friendly localized copy; the raw runtime message
  // stays available in the collapsible detail.
  const localizedMessage =
    code === 'orphaned_after_restart'
      ? t('turnInterruptedByRestart')
      : code === 'owner_lease_expired'
        ? t('turnInterruptedByRuntimeOwnership')
      : code === 'interrupted_turn_auto_resume'
        ? t('autoResumingInterruptedTask')
        : code === 'memory_pressure_critical'
          ? t('runtimeRestartingForMemoryPressure', {
              defaultValue: 'Agent Runtime is restarting because memory usage reached a critical level. The current task will be recovered after restart.'
            })
          : code === 'memory_pressure_warning'
            ? t('runtimeMemoryPressureWarning', {
                defaultValue: 'Agent Runtime memory usage is high. New subagents are temporarily limited while memory is reclaimed.'
              })
            : ''
  const providerSummary = requestFailure?.category === 'rate_limit'
    ? t('modelErrorProviderSummaryRateLimited')
    : requestFailure?.category === 'unavailable'
      ? t('modelErrorProviderSummaryUnavailable')
      : requestFailure?.category === 'authentication' || requestFailure?.category === 'quota' ||
          requestFailure?.category === 'model_not_found' || requestFailure?.category === 'request'
        ? t('modelErrorProviderSummaryRejected')
        : t('modelErrorProviderSummaryGeneric')
  const sourceSummary = providerResponded
    ? providerSummary
    : sentNoResponse
      ? t('modelErrorNoResponseSummary')
      : requestNotSent
        ? t('modelErrorNotSentSummary')
        : ''
  const message = (localizedMessage || sourceSummary || block.text.trim() || block.detail?.trim() || block.code?.trim() || '')
  const showCode = Boolean(code && !message.toLowerCase().includes(code.toLowerCase()))
  const providerIdentity = [requestFailure?.providerId, requestFailure?.model].filter(Boolean).join(' · ')
  const providerCode = requestFailure?.providerCode?.trim() || (providerResponded ? code : '')
  const metadata = [
    requestFailure?.httpStatus ? `HTTP ${requestFailure.httpStatus}` : '',
    providerCode
  ].filter(Boolean)

  return (
    <div
      role="alert"
      data-testid="timeline-runtime-error"
      className={`flex min-w-0 items-start gap-3 border-l-2 py-1 pl-4 ${
        providerResponded
          ? 'border-red-400/90 dark:border-red-700/80'
          : 'border-orange-300/80 dark:border-orange-700/70'
      }`}
    >
      {providerResponded ? <CloudAlert
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-red-600 dark:text-red-300"
        strokeWidth={1.9}
      /> : <CircleAlert
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300"
        strokeWidth={1.9}
      />}
      <div className="min-w-0 flex-1">
        {requestFailure ? (
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${
              providerResponded
                ? 'border-red-300/70 bg-red-100/70 text-red-800 dark:border-red-800/70 dark:bg-red-950/45 dark:text-red-200'
                : 'border-orange-300/70 bg-orange-100/70 text-orange-800 dark:border-orange-800/70 dark:bg-orange-950/45 dark:text-orange-200'
            }`}>
              {providerResponded
                ? t('modelErrorSourceProvider')
                : sentNoResponse
                  ? t('modelErrorSourceNoResponse')
                  : t('modelErrorSourceNotSent')}
            </span>
            {providerIdentity ? (
              <span className="break-all font-mono text-[11.5px] text-ds-muted">{providerIdentity}</span>
            ) : null}
          </div>
        ) : null}
        <p className={`whitespace-pre-wrap break-words text-[13.5px] font-medium leading-6 ${
          providerResponded
            ? 'text-red-900 dark:text-red-100'
            : 'text-orange-900 dark:text-orange-100'
        }`}>
          {message}
        </p>
        {requestFailure && block.text.trim() ? (
          <div className={`mt-2 max-h-40 overflow-auto rounded-lg border px-3 py-2 ${
            providerResponded
              ? 'border-red-300/50 bg-red-50/60 dark:border-red-800/50 dark:bg-red-950/25'
              : 'border-orange-300/50 bg-orange-50/60 dark:border-orange-800/50 dark:bg-orange-950/25'
          }`}>
            <p className="mb-1 text-[11.5px] font-medium opacity-70">
              {providerResponded ? t('modelErrorProviderOriginalMessage') : t('modelErrorFailureMessage')}
            </p>
            <p className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5">{block.text.trim()}</p>
          </div>
        ) : null}
        {metadata.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {metadata.map((value) => (
              <code key={value} className="rounded border border-current/15 bg-black/[0.03] px-1.5 py-0.5 text-[11px] opacity-75 dark:bg-white/[0.04]">
                {value}
              </code>
            ))}
          </div>
        ) : showCode ? (
          <p className="mt-1 font-mono text-[11.5px] leading-5 text-orange-700/75 dark:text-orange-300/75">
            {code}
          </p>
        ) : null}
        {detail ? (
          <details className="group/error-detail mt-2">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-orange-700/80 hover:text-orange-900 dark:text-orange-300/80 dark:hover:text-orange-100">
              <ChevronDown
                aria-hidden="true"
                className="h-3.5 w-3.5 -rotate-90 transition-transform group-open/error-detail:rotate-0"
                strokeWidth={1.9}
              />
              {t('runtimeErrorDetails')}
            </summary>
            <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-orange-300/50 bg-orange-50/70 px-3 py-2 font-mono text-[11.5px] leading-5 text-orange-950 dark:border-orange-800/50 dark:bg-orange-950/30 dark:text-orange-100">
              {detail}
            </pre>
          </details>
        ) : null}
        {onContinue && (
          code === 'orphaned_after_restart' || code === 'owner_lease_expired'
        ) ? (
          <button
            type="button"
            data-testid="timeline-runtime-error-continue"
            onClick={onContinue}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-orange-300/60 bg-orange-100/60 px-2.5 py-1 text-[12.5px] font-medium text-orange-900 transition-colors hover:bg-orange-200/70 dark:border-orange-700/60 dark:bg-orange-900/40 dark:text-orange-100 dark:hover:bg-orange-800/50"
          >
            {t('continueInterruptedTask')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
