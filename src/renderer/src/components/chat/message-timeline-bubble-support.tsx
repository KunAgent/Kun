import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { captureOptionalCompletion } from '../../product-analytics/optional-completion'
import { Check, Copy, Download, Loader2, Presentation } from 'lucide-react'
import type { WriteExportFormat } from '@shared/write-export'
import { ComposerContextAttachmentSchema } from '@kun/extension-api'
import { messageQuoteFromComposerContext } from '../../lib/message-quote'
import { useChatStore } from '../../store/chat-store'
import { assistantExportMarkdown } from '../../lib/conversation-export-markdown'
import {
  readWorkspaceOfficeViewPosition,
  type WorkspaceOfficeViewPosition
} from '../../lib/workspace-office-view-context'
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
    // Reply quotes render as quotes above the message text.
    if (messageQuoteFromComposerContext(entry)) return []
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
  const injectedDirectiveIds = hideTurnDisclosure ? [] : metaStringArray(meta, 'injectedDirectiveIds')
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
    injectedDirectiveIds.length === 0 &&
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
      {injectedMemoryIds.length > 0 || injectedDirectiveIds.length > 0 ? (
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
  iconOnly = false,
  onCopied,
  onCopyStarted
}: {
  text: string
  iconOnly?: boolean
  onCopied?: () => void
  onCopyStarted?: () => (() => void)
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
    const copied = captureOptionalCompletion(onCopyStarted)
    try {
      if (!navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setStatus('success')
      onCopied?.()
      copied?.()
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
      data-assistant-action="copy"
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
  createdAt,
  renderMode,
  onExportStarted
}: {
  text: string
  createdAt?: string
  renderMode?: 'plain-text' | 'safe-markdown'
  onExportStarted?: () => (() => void)
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((state) => state.workspaceRoot)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const [exportingFormat, setExportingFormat] = useState<WriteExportFormat | null>(null)
  const [error, setError] = useState('')

  const handleExport = async (format: WriteExportFormat): Promise<void> => {
    const exported = captureOptionalCompletion(onExportStarted)
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
        content: assistantExportMarkdown(text, renderMode)
      })
      if (!result.ok && !result.canceled) {
        setError(result.message)
      } else if (result.ok) {
        detailsRef.current?.removeAttribute('open')
        exported?.()
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError))
    } finally {
      setExportingFormat(null)
    }
  }

  return (
    <details ref={detailsRef} className="relative" data-assistant-action="export">
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
