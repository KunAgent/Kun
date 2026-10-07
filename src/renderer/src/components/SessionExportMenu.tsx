import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, FileText, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS,
  type ConversationExportFormat
} from '@shared/conversation-export'
import type { ChatBlock } from '../agent/types'
import { buildConversationExportDocument } from '../lib/conversation-export'
import { HEADER_ICON_BUTTON_CLASS, HEADER_ICON_CLASS, HEADER_ICON_STROKE } from './workbench/header-action-button'

type Props = {
  title: string
  blocks: ChatBlock[]
  busy: boolean
  currentTurnId?: string | null
  currentTurnUserId?: string | null
}

const SUCCESS_RESET_MS = 1_800

export function SessionExportMenu({
  title,
  blocks,
  busy,
  currentTurnId,
  currentTurnUserId
}: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<ConversationExportFormat | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const labels = useMemo(() => ({
    exportedAt: t('conversationExportDocumentExportedAt'),
    user: t('conversationExportDocumentUser'),
    assistant: t('conversationExportDocumentAssistant'),
    attachments: t('conversationExportDocumentAttachments'),
    referencedFiles: t('conversationExportDocumentReferencedFiles'),
    generatedFiles: t('conversationExportDocumentGeneratedFiles'),
    sources: t('conversationExportDocumentSources'),
    attachment: t('conversationExportDocumentAttachment')
  }), [t])

  const preview = useMemo(() => buildConversationExportDocument({
    title,
    blocks,
    locale: i18n.language,
    exportedAt: new Date(),
    labels,
    busy,
    currentTurnId,
    currentTurnUserId
  }), [blocks, busy, currentTurnId, currentTurnUserId, i18n.language, labels, title])
  const disabled = preview.messageCount === 0 || exportingFormat !== null

  useEffect(() => {
    setOpen(false)
    setError('')
    setSuccess(false)
  }, [title])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setOpen(false)
      setError('')
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      setError('')
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
  }, [])

  const formatLabel = (format: ConversationExportFormat): string =>
    format === 'md' ? t('conversationExportMarkdown') : t('conversationExportPdf')

  const markSuccess = (): void => {
    setSuccess(true)
    if (successTimerRef.current) clearTimeout(successTimerRef.current)
    successTimerRef.current = setTimeout(() => {
      setSuccess(false)
      successTimerRef.current = null
    }, SUCCESS_RESET_MS)
  }

  const exportFormat = async (format: ConversationExportFormat): Promise<void> => {
    if (typeof window.kunGui?.exportConversation !== 'function') {
      setError(t('conversationExportUnavailable'))
      return
    }

    const document = buildConversationExportDocument({
      title,
      blocks,
      locale: i18n.language,
      exportedAt: new Date(),
      labels,
      busy,
      currentTurnId,
      currentTurnUserId
    })
    if (document.messageCount === 0) return
    if (document.markdown.length > CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS) {
      setError(t('conversationExportTooLarge'))
      return
    }

    setError('')
    setExportingFormat(format)
    try {
      const result = await window.kunGui.exportConversation({
        title,
        format,
        markdown: document.markdown,
        defaultFileName: document.defaultFileName
      })
      if (result.ok) {
        setOpen(false)
        markSuccess()
      } else if (!result.canceled) {
        setError(t('conversationExportFailed', { message: result.message }))
      }
    } catch (exportError) {
      setError(t('conversationExportFailed', {
        message: exportError instanceof Error ? exportError.message : String(exportError)
      }))
    } finally {
      setExportingFormat(null)
    }
  }

  const tooltip = preview.messageCount === 0
    ? t('conversationExportEmpty')
    : success
      ? t('conversationExportSuccess')
      : error || t('conversationExport')

  return (
    <div ref={rootRef} className="ds-no-drag relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value)
          setError('')
        }}
        className={HEADER_ICON_BUTTON_CLASS}
        data-tooltip={tooltip}
        aria-label={tooltip}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {exportingFormat ? (
          <Loader2 className={`${HEADER_ICON_CLASS} animate-spin`} strokeWidth={HEADER_ICON_STROKE} />
        ) : success ? (
          <Check className="h-4 w-4 text-emerald-500" strokeWidth={2} />
        ) : (
          <Download className={HEADER_ICON_CLASS} strokeWidth={HEADER_ICON_STROKE} />
        )}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={t('conversationExportMenu')}
          className="ds-no-drag ds-card-strong absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[18px] border border-ds-border py-1.5 shadow-[0_18px_52px_rgba(20,47,95,0.18)] backdrop-blur-xl dark:shadow-[0_22px_58px_rgba(0,0,0,0.38)]"
        >
          <div className="border-b border-ds-border-muted px-3 pb-2 pt-1.5 text-[11px] font-semibold text-ds-faint">
            {t('conversationExportMenu')}
          </div>
          {(['md', 'pdf'] as const).map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              disabled={exportingFormat !== null}
              onClick={() => void exportFormat(format)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-[13px] text-ds-muted transition hover:bg-ds-hover/70 hover:text-ds-ink disabled:opacity-50"
            >
              {format === 'md' ? (
                <FileText className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              ) : (
                <Download className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              )}
              <span className="min-w-0 flex-1">{formatLabel(format)}</span>
              {exportingFormat === format ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.8} />
              ) : null}
            </button>
          ))}
          {busy ? (
            <p className="border-t border-ds-border-muted px-3 py-2 text-[11px] leading-4 text-ds-faint">
              {t('conversationExportBusyHint')}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="border-t border-ds-border-muted px-3 py-2 text-[11px] leading-4 text-rose-500">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
