import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Download, Loader2, Presentation } from 'lucide-react'
import type { ChatBlock, RuntimeDisclosureMetadata, UserInputAnswer } from '../../agent/types'
import type { WriteExportFormat } from '@shared/write-export'
import { ComposerContextAttachmentSchema } from '@kun/extension-api'
import { useChatStore } from '../../store/chat-store'
import {
  readWorkspaceOfficeViewPosition,
  type WorkspaceOfficeViewPosition
} from '../../lib/workspace-office-view-context'
import { answerDisplayValues, answersByQuestionId } from './user-input-panel-logic'
import { InjectedMemoryMetaChip } from './injected-memory-meta-chip'
import {
  metaInstructionSources,
  metaStringArray
} from './message-timeline-bubble-meta'

const COPY_FEEDBACK_RESET_MS = 1600
const ASSISTANT_EXPORT_FORMATS: WriteExportFormat[] = ['pdf', 'docx', 'png', 'html']

export function metaSources(meta: Record<string, unknown> | undefined): Array<{ title?: string; url?: string }> {
  const value = meta?.sources
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
      const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined
      return title || url ? { ...(title ? { title } : {}), ...(url ? { url } : {}) } : null
    })
    .filter((entry): entry is { title?: string; url?: string } => entry !== null)
}

export function metaComposerContextLabels(meta: Record<string, unknown> | undefined): string[] {
  const value = meta?.composerContexts
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const parsed = ComposerContextAttachmentSchema.safeParse(entry)
    if (parsed.success && readWorkspaceOfficeViewPosition(parsed.data)) return []
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const provenance = record.provenance && typeof record.provenance === 'object'
      ? record.provenance as Record<string, unknown>
      : undefined
    const extensionId = typeof provenance?.extensionId === 'string'
      ? provenance.extensionId.trim()
      : ''
    return title ? [`${title}${extensionId ? ` (${extensionId})` : ''}`] : []
  })
}

export function metaOfficeViewPositions(
  meta: Record<string, unknown> | undefined
): WorkspaceOfficeViewPosition[] {
  const value = meta?.composerContexts
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const parsed = ComposerContextAttachmentSchema.safeParse(entry)
    if (!parsed.success) return []
    const position = readWorkspaceOfficeViewPosition(parsed.data)
    return position ? [position] : []
  })
}

export function RuntimeMetaChips({
  meta,
  align = 'left',
  hideAttachments = false,
  hideTurnDisclosure = false
}: {
  meta?: Record<string, unknown>
  align?: 'left' | 'right'
  hideAttachments?: boolean
  hideTurnDisclosure?: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const attachmentIds = hideTurnDisclosure || hideAttachments ? [] : metaStringArray(meta, 'attachmentIds')
  const activeSkillIds = hideTurnDisclosure ? [] : metaStringArray(meta, 'activeSkillIds')
  const injectedMemoryIds = hideTurnDisclosure ? [] : metaStringArray(meta, 'injectedMemoryIds')
  const injectedInstructionSources = hideTurnDisclosure ? [] : metaInstructionSources(meta)
  const composerContextLabels = hideTurnDisclosure ? [] : metaComposerContextLabels(meta)
  const officeViewPositions = hideTurnDisclosure ? [] : metaOfficeViewPositions(meta)
  const sources = metaSources(meta)
  const child = meta?.child && typeof meta.child === 'object' ? meta.child as Record<string, unknown> : null
  const childLabel =
    typeof child?.childLabel === 'string' && child.childLabel.trim()
      ? child.childLabel.trim()
      : typeof child?.childProfile === 'string' && child.childProfile.trim()
        ? child.childProfile.trim()
        : typeof child?.childId === 'string'
          ? child.childId
          : ''
  if (
    (hideAttachments || attachmentIds.length === 0) &&
    activeSkillIds.length === 0 &&
    injectedMemoryIds.length === 0 &&
    injectedInstructionSources.length === 0 &&
    composerContextLabels.length === 0 &&
    officeViewPositions.length === 0 &&
    sources.length === 0 &&
    !childLabel
  ) {
    return null
  }
  const chipClass = 'inline-flex max-w-full items-center gap-1 rounded-md border border-ds-border-muted bg-ds-card/75 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint'
  return (
    <div className={`mt-2 flex min-w-0 flex-wrap gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
      {!hideAttachments && attachmentIds.length > 0 ? (
        <span className={chipClass} title={attachmentIds.join(', ')}>
          {t('toolAttachments')} {attachmentIds.length}
        </span>
      ) : null}
      {activeSkillIds.length > 0 ? (
        <span className={chipClass} title={activeSkillIds.join(', ')}>
          {t('toolActiveSkills')} {activeSkillIds.length}
        </span>
      ) : null}
      {injectedMemoryIds.length > 0 ? (
        <InjectedMemoryMetaChip meta={meta} memoryIds={injectedMemoryIds} chipClass={chipClass} />
      ) : null}
      {injectedInstructionSources.length > 0 ? (
        <span className={chipClass} title={injectedInstructionSources.map((source) => `${source.scope}: ${source.path}`).join('\n')}>
          {t('toolInjectedInstructions')} {injectedInstructionSources.length}
        </span>
      ) : null}
      {composerContextLabels.length > 0 ? (
        <span className={chipClass} title={composerContextLabels.join('\n')}>
          {t('toolExtensionContexts')} {composerContextLabels.length}
        </span>
      ) : null}
      {officeViewPositions.map((position) => (
        <span
          key={`${position.sourceSha256}-${position.slide}`}
          data-office-view-position
          className={chipClass}
          title={`${position.sourceName} · ${t('writeAssistantSlidePosition', {
            slide: position.slide,
            slideCount: position.slideCount
          })}`}
        >
          <Presentation className="h-3 w-3 shrink-0 text-accent" strokeWidth={1.8} />
          <span>{t('writeAssistantCurrentView')}</span>
          <span>·</span>
          <span className="max-w-36 truncate text-ds-muted">{position.sourceName}</span>
          <span>
            · {t('writeAssistantSlidePosition', {
              slide: position.slide,
              slideCount: position.slideCount
            })}
          </span>
        </span>
      ))}
      {childLabel ? (
        <span className={chipClass} title={childLabel}>
          {t('toolChildAgent')} <span className="max-w-28 truncate font-mono text-ds-muted">{childLabel}</span>
        </span>
      ) : null}
      {sources.slice(0, 4).map((source, index) =>
        source.url ? (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={chipClass}
            title={source.url}
          >
            {t('toolSources')} {index + 1}
          </a>
        ) : (
          <span key={`${source.title}-${index}`} className={chipClass} title={source.title}>
            {t('toolSources')} {index + 1}
          </span>
        )
      )}
    </div>
  )
}

export function CopyFeedbackButton({
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
      className={`flex shrink-0 items-center transition ${
        iconOnly
          ? 'gap-0 rounded-full p-1.5 hover:bg-ds-hover'
          : 'gap-1 rounded-md px-1.5 py-0.5 hover:bg-ds-hover'
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

export function AssistantExportButton({
  text,
  createdAt
}: {
  text: string
  createdAt?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((state) => state.workspaceRoot)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const [exportingFormat, setExportingFormat] = useState<WriteExportFormat | null>(null)
  const [error, setError] = useState('')

  const handleExport = async (format: WriteExportFormat): Promise<void> => {
    if (typeof window.kunGui?.exportWriteDocument !== 'function') {
      setError(t('writeExportUnavailable'))
      return
    }

    setError('')
    setExportingFormat(format)
    try {
      const parsedDate = createdAt ? new Date(createdAt) : new Date()
      const date = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate
      const title = `Kun-answer-${date.toISOString().replace(/[:.]/g, '-')}`
      const result = await window.kunGui.exportWriteDocument({
        title,
        workspaceRoot: workspaceRoot || undefined,
        format,
        content: text
      })
      if (!result.ok && !result.canceled) {
        setError(result.message)
      } else if (result.ok) {
        detailsRef.current?.removeAttribute('open')
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError))
    } finally {
      setExportingFormat(null)
    }
  }

  return (
    <details ref={detailsRef} className="relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-muted"
        title={error ? t('exportAnswerFailed', { message: error }) : t('exportAnswer')}
        aria-label={t('exportAnswer')}
      >
        {exportingFormat ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        ) : (
          <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        <span>{exportingFormat ? t('writeExporting') : t('exportAnswer')}</span>
      </summary>
      <div className="absolute bottom-full right-0 z-30 mb-1 min-w-36 rounded-xl border border-ds-border-muted bg-ds-card p-1.5 shadow-xl">
        {ASSISTANT_EXPORT_FORMATS.map((format) => {
          const label =
            format === 'pdf'
              ? t('writeExportPdf')
              : format === 'png'
                ? t('writeExportPng')
                : format === 'html'
                  ? t('writeExportHtml')
                  : t('writeExportDocx')
          return (
            <button
              key={format}
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => void handleExport(format)}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-60"
            >
              {label}
            </button>
          )
        })}
        {error ? (
          <p className="max-w-64 px-2.5 py-1 text-[11px] leading-4 text-rose-500">
            {t('exportAnswerFailed', { message: error })}
          </p>
        ) : null}
      </div>
    </details>
  )
}

export function UserInputBubble({
  block,
  nested = false
}: {
  block: Extract<ChatBlock, { kind: 'user_input' }>
  nested?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [answers, setAnswers] = useState<Record<string, UserInputAnswer>>(() =>
    answersByQuestionId(block.answers)
  )
  // The timeline is the durable record; answering lives in the composer panel.
  // Only a live request appears active. A stale persisted `pending` block is
  // rendered as ended so reopening history never advertises a dead action.
  const pending = block.status === 'pending' && block.live === true
  const done = block.status !== 'pending'

  useEffect(() => {
    setAnswers(answersByQuestionId(block.answers))
  }, [block.id, block.answers])

  const statusLabel =
    block.status === 'submitted'
      ? t('userInputSubmitted')
      : block.status === 'cancelled'
        ? t('userInputCancelled')
        : block.status === 'timeout'
          ? t('userInputTimedOut')
          : block.status === 'error'
            ? t('userInputFailed')
            : pending
              ? t('userInputPending')
              : t('userInputCancelled')
  const tone =
    block.status === 'error'
      ? 'error'
      : block.status === 'submitted'
        ? 'success'
        : block.status === 'cancelled' || block.status === 'timeout'
          ? 'muted'
          : pending
            ? 'active'
            : 'muted'
  const questionCount = block.questions.length
  const containerClass = nested
    ? `overflow-hidden rounded-[14px] border px-3.5 py-3 text-[13px] leading-5 ${
        tone === 'error'
          ? 'border-red-300/65 bg-red-500/[0.025] dark:border-red-800/55 dark:bg-red-950/20'
          : tone === 'success'
            ? 'border-emerald-500/22 bg-emerald-500/[0.025] dark:border-emerald-600/30'
            : tone === 'muted'
              ? 'border-ds-border-muted bg-ds-card/75'
              : 'border-accent/25 bg-accent/[0.025]'
      }`
    : `overflow-hidden rounded-[16px] border px-4 py-4 text-[13px] leading-6 shadow-[0_10px_28px_rgba(20,47,95,0.04)] ${
        tone === 'error'
          ? 'border-red-300/70 bg-red-500/[0.025] dark:border-red-800/60 dark:bg-red-950/20'
          : tone === 'success'
            ? 'border-emerald-500/24 bg-emerald-500/[0.025] dark:border-emerald-600/32'
            : tone === 'muted'
              ? 'border-ds-border bg-ds-card/82'
              : 'border-accent/26 bg-ds-card text-ds-ink'
      }`
  const iconFrameClass =
    tone === 'error'
      ? 'border-red-300/60 bg-red-500/10 text-red-700 dark:border-red-800/45 dark:text-red-300'
      : tone === 'success'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : tone === 'active'
          ? 'border-accent/20 bg-accent/10 text-accent'
          : 'border-ds-border-muted bg-ds-subtle text-ds-muted'
  const statusClass =
    tone === 'error'
      ? 'text-red-700 dark:text-red-300'
      : tone === 'success'
        ? 'text-emerald-700 dark:text-emerald-300'
        : tone === 'active'
          ? 'text-accent'
          : 'text-ds-muted'
  const statusIcon =
    tone === 'active' ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
    ) : tone === 'success' ? (
      <Check className="h-3.5 w-3.5" strokeWidth={2} />
    ) : tone === 'error' ? (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none">
        !
      </span>
    ) : (
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
    )

  return (
    <div className={containerClass}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border ${iconFrameClass}`}
          >
            {statusIcon}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-ds-ink">{t('userInputTitle')}</div>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border border-current/15 px-2 py-0.5 text-[11.5px] font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      {block.status === 'pending' ? (
        <div className="mt-3 border-t border-ds-border-muted pt-3">
          {block.questions[0] ? (
            <p className="line-clamp-2 whitespace-pre-wrap break-words text-[13px] font-medium leading-5 text-ds-ink [overflow-wrap:anywhere]">
              {block.questions[0].question}
            </p>
          ) : null}
          {pending ? (
            <div className="mt-2 flex items-center justify-between gap-3 text-[11.5px] text-ds-faint">
              <span>{t('userInputCompleteAboveComposer')}</span>
              {questionCount > 1 ? (
                <span className="shrink-0 font-semibold tabular-nums">
                  {t('userInputQuestionCount', { count: questionCount })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : done && block.questions.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-[11px] border border-ds-border-muted bg-ds-card/65">
          {block.questions.map((question) => {
            const submittedValues = answerDisplayValues(answers[question.id])
            return (
              <div
                key={question.id}
                className="grid min-w-0 gap-1 border-b border-ds-border-muted px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.7fr)] sm:items-center sm:gap-4"
              >
                <span className="min-w-0 truncate text-[12px] text-ds-muted" title={question.question}>
                  {question.question}
                </span>
                <span className={`min-w-0 break-words text-[12.5px] font-semibold [overflow-wrap:anywhere] ${
                  submittedValues.length > 0 ? 'text-ds-ink' : 'text-ds-faint'
                }`}>
                  {submittedValues.length > 0 ? submittedValues.join(', ') : statusLabel}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      {block.errorMessage ? (
        <p className="mt-3 text-[12px] text-red-700 dark:text-red-300">{block.errorMessage}</p>
      ) : null}
    </div>
  )
}

export function formatMessageDateTime(input: string, locale: string): string {
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

/**
 * Memoized so settled bubbles skip re-render while streaming deltas
 * re-render only the live bubble; block references stay stable in the
 * store for unchanged blocks.
 */
