import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, File, Layers3, MessageSquareQuote, PencilLine, Sparkles } from 'lucide-react'
import type { ChatBlock, RuntimeDisclosureMetadata } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { parseWritePromptForDisplay } from '../../write/quoted-selection'
import { parseClawUserPromptForDisplay, type ClawUserPromptDisplay } from '@shared/app-settings'
import { parseBackgroundShellCompletionNotice } from '@shared/background-shell-notice'
import { parseBackgroundSubagentCompletionNotice } from '@shared/background-subagent-notice'
import { AssistantMarkdown } from './AssistantMarkdown'
import { ModelMetaTag, WritePromptMetaDisclosure } from './message-timeline-cards'
import { UserAttachmentPreviews } from './message-timeline-media-views'
import { CopyFeedbackButton, RuntimeMetaChips } from './message-timeline-bubble-support'
import { metaUserFileReferences } from './message-timeline-bubble-meta'

export function BackgroundShellNoticeBubble({
  block,
  nested = false
}: {
  block: Extract<ChatBlock, { kind: 'user' }>
  nested?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [outputExpanded, setOutputExpanded] = useState(false)
  const parsed = useMemo(() => parseBackgroundShellCompletionNotice(block.text), [block.text])
  const title =
    block.meta?.displayText?.trim() ||
    t('backgroundShellNotice.title', { defaultValue: 'Background shell completed' })
  const outputPreview = parsed?.outputPreview ?? ''
  const canExpandOutput = outputPreview.length > 180
  const exitCodeTone =
    parsed && parsed.exitCode === 0
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : 'border-orange-400/30 bg-orange-500/10 text-orange-800 dark:text-orange-200'

  return (
    <div className={nested ? 'min-w-0' : 'flex w-full justify-start'}>
      <div className="w-full max-w-[min(640px,calc(100vw-3rem))] rounded-[18px] border border-accent/25 bg-[linear-gradient(180deg,rgba(79,124,255,0.06),rgba(79,124,255,0.1))] px-3.5 py-3 text-ds-muted shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
            {t('backgroundShellNotice.kindLabel', { defaultValue: 'Background callback' })}
          </span>
          {parsed ? (
            <>
              <span
                className="inline-flex items-center gap-1 rounded-full border border-ds-border/80 bg-ds-card/70 px-2 py-0.5 font-mono text-[11px] text-ds-ink"
                title={parsed.sessionId}
              >
                <span className="font-sans font-medium text-ds-muted">
                  {t('backgroundShellNotice.sessionId', { defaultValue: 'Session' })}
                </span>
                <span>{parsed.sessionId}</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${exitCodeTone}`}
              >
                <span className="font-sans font-medium opacity-80">
                  {t('backgroundShellNotice.exitCode', { defaultValue: 'Exit code' })}
                </span>
                <span>{parsed.exitCode}</span>
              </span>
            </>
          ) : null}
        </div>
        <div className="min-w-0">
            <p className="text-[13px] font-medium text-ds-ink">{title}</p>
            {parsed ? (
              <dl className="mt-2 space-y-1.5 text-[12.5px] leading-5">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-ds-muted">
                    {t('backgroundShellNotice.command', { defaultValue: 'Command' })}
                  </dt>
                  <dd className="min-w-0 break-all font-mono text-ds-ink">{parsed.command}</dd>
                </div>
              </dl>
            ) : null}
            {outputPreview ? (
              <div className="mt-2.5">
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 text-left text-[12px] font-medium text-ds-muted ${
                    canExpandOutput ? 'hover:text-ds-ink' : 'cursor-default'
                  }`}
                  onClick={() => {
                    if (canExpandOutput) setOutputExpanded((value) => !value)
                  }}
                  disabled={!canExpandOutput}
                >
                  <span>{t('backgroundShellNotice.outputPreview', { defaultValue: 'Output preview' })}</span>
                  {canExpandOutput ? (
                    outputExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )
                  ) : null}
                </button>
                <pre
                  className={`mt-1 overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-ds-border/70 bg-ds-card/70 px-2.5 py-2 font-mono text-[11.5px] leading-5 text-ds-ink ${
                    canExpandOutput && !outputExpanded ? 'max-h-24' : 'max-h-72'
                  }`}
                >
                  {outputPreview}
                </pre>
              </div>
            ) : null}
            {parsed?.outputFile ? (
              <p className="mt-2 truncate font-mono text-[11px] text-ds-muted" title={parsed.outputFile}>
                {t('backgroundShellNotice.outputFile', { defaultValue: 'Full output file' })}: {parsed.outputFile}
              </p>
            ) : null}
        </div>
      </div>
    </div>
  )
}

export function BackgroundSubagentNoticeBubble({
  block,
  nested = false
}: {
  block: Extract<ChatBlock, { kind: 'user' }>
  nested?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const parsed = useMemo(() => parseBackgroundSubagentCompletionNotice(block.text), [block.text])
  const isFailed = parsed?.status === 'failed'
  const title =
    parsed?.label ||
    block.meta?.displayText?.trim() ||
    t('backgroundSubagentNotice.title', { defaultValue: 'Background subagent completed' })
  const statusLabel = isFailed
    ? t('backgroundSubagentNotice.failed', { defaultValue: 'Failed' })
    : t('backgroundSubagentNotice.completed', { defaultValue: 'Completed' })
  const summary = parsed?.summary ?? ''
  const canExpandSummary = summary.length > 900 || summary.split('\n').length > 14
  const statusTone = isFailed
    ? 'border-orange-400/35 bg-orange-500/8 text-orange-800 dark:text-orange-200'
    : 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300'
  const StatusIcon = isFailed ? CircleAlert : CheckCircle2

  return (
    <div className={nested ? 'min-w-0' : 'flex w-full justify-start'}>
      <div
        data-background-subagent-card="true"
        className="relative w-full max-w-[min(760px,calc(100vw-3rem))] overflow-hidden rounded-[16px] border border-ds-border bg-ds-card text-ds-muted shadow-[0_8px_24px_rgba(42,52,72,0.06)]"
      >
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-[3px] ${isFailed ? 'bg-orange-500/80' : 'bg-accent/90'}`}
        />
        <div className="flex min-w-0 items-center gap-3 px-4 py-3.5 pl-[18px]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-accent/15 bg-accent/[0.07] text-accent">
            <Sparkles className="h-[17px] w-[17px]" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-[14px] font-semibold leading-5 text-ds-ink">{title}</h3>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone}`}>
                <StatusIcon className="h-3 w-3" strokeWidth={2} />
                {statusLabel}
              </span>
            </div>
            {parsed?.childId ? (
              <p className="mt-0.5 truncate font-mono text-[11.5px] leading-4 text-ds-faint" title={parsed.childId}>
                {parsed.childId}
              </p>
            ) : null}
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 text-[11.5px] text-ds-faint sm:inline-flex">
            <Layers3 className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('backgroundSubagentNotice.taskKind', { defaultValue: 'Background task' })}
          </span>
        </div>
        {summary || parsed?.error ? (
          <div className="border-t border-ds-border/80 px-4 pb-3.5 pl-[18px] pt-3">
            {summary ? (
              <div data-background-subagent-result="true">
                <p className="mb-2 text-[12px] font-semibold tracking-[0.01em] text-ds-muted">
                  {t('backgroundSubagentNotice.resultTitle', { defaultValue: 'Execution result' })}
                </p>
                <div className="relative">
                  <div
                    className={`ds-markdown text-[13.5px] leading-[1.68] text-ds-ink ${
                      canExpandSummary && !summaryExpanded ? 'max-h-[360px] overflow-hidden' : ''
                    }`}
                  >
                    <AssistantMarkdown text={summary} streaming={false} />
                  </div>
                  {canExpandSummary && !summaryExpanded ? (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-ds-card"
                    />
                  ) : null}
                </div>
                {canExpandSummary ? (
                  <button
                    type="button"
                    onClick={() => setSummaryExpanded((value) => !value)}
                    aria-expanded={summaryExpanded}
                    className="mt-2.5 flex w-full items-center justify-between gap-3 border-t border-ds-border/70 pt-2.5 text-left text-[12px] font-medium text-ds-muted transition hover:text-ds-ink"
                  >
                    <span>
                      {summaryExpanded
                        ? t('backgroundSubagentNotice.collapseOutput', { defaultValue: 'Collapse output' })
                        : t('backgroundSubagentNotice.showFullOutput', { defaultValue: 'View full output' })}
                    </span>
                    {summaryExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.9} />
                    )}
                  </button>
                ) : null}
              </div>
            ) : null}
            {parsed?.error ? (
              <div
                className={`${summary ? 'mt-3' : ''} overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-orange-400/30 bg-orange-500/[0.07] px-3 py-2.5 font-mono text-[11.5px] leading-5 text-orange-900 dark:text-orange-100`}
              >
                {parsed.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * User message bubble with hover affordance to rewind/edit. Click the rewind
 * pill, the bubble flips into a textarea, and Resend submits an edited
 * version of the message — locally truncating subsequent turns and starting
 * a fresh turn on the same thread (see chat-store `rewindAndResend`).
 */
export function UserMessageBubble({
  block,
  allowThreadActions = true
}: {
  block: Extract<ChatBlock, { kind: 'user' }>
  allowThreadActions?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const busy = useChatStore((s) => s.busy)
  const route = useChatStore((s) => s.route)
  const rewindAndResend = useChatStore((s) => s.rewindAndResend)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(block.text)
  const [writeMetaOpen, setWriteMetaOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const parsedWritePrompt = useMemo(() => {
    if (route !== 'write') return null
    const parsed = parseWritePromptForDisplay(block.text)
    return parsed?.userInput.trim() ? parsed : null
  }, [block.text, route])
  const parsedClawPrompt = useMemo(() => {
    const parsed = parseClawUserPromptForDisplay(block.text)
    if (!parsed.managed && !parsed.inbound && block.managedBy !== 'claw' && route !== 'claw') return null
    return parsed
  }, [block.managedBy, block.text, route])
  const metaDisplayText =
    typeof block.meta?.displayText === 'string' && block.meta.displayText.trim()
      ? block.meta.displayText.trim()
      : null
  const displayText = metaDisplayText ?? parsedWritePrompt?.userInput ?? parsedClawPrompt?.text ?? block.text
  const canEdit = allowThreadActions && (route === 'chat' || !metaDisplayText)
  const showClawInboundCard = route === 'claw' && parsedClawPrompt?.inbound === true

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
    // Auto-size to content
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`
  }, [editing])

  useEffect(() => {
    setWriteMetaOpen(false)
  }, [block.id])

  const startEdit = (): void => {
    if (busy || !canEdit) return
    setDraft(displayText)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setDraft(block.text)
    setEditing(false)
  }

  const submit = async (): Promise<void> => {
    const trimmed = draft.trim()
    if (!trimmed || busy) return
    setEditing(false)
    await rewindAndResend(block.id, trimmed)
  }

  if (editing) {
    return (
      <div className="ds-user-message">
        <UserAttachmentPreviews meta={block.meta} />
        <div className="ds-user-message-bubble min-w-0 border border-accent/35 ring-1 ring-accent/15">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 360)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancelEdit()
              } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={2}
            className="block w-full min-w-0 resize-none break-words bg-transparent text-[15px] font-medium leading-[1.58] text-ds-ink outline-none [overflow-wrap:anywhere]"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[12px] text-ds-faint">{t('rewindHint')}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md px-3 py-1 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('rewindCancel')}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!draft.trim() || busy}
                className="rounded-md bg-accent px-3 py-1 text-[13px] font-medium text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('rewindResend')}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
          {block.meta?.workspaceCheckpointId ? (
            <span className="min-w-0 flex-1 text-left text-[12px] font-medium leading-5 text-ds-faint">
              {t('rewindFileRollbackNotice')}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <ModelMetaTag label={block.modelLabel} />
        </div>
      </div>
    )
  }

  return (
    <div className="ds-user-message group relative">
      <UserAttachmentPreviews meta={block.meta} />
      <div className={showClawInboundCard ? 'contents' : 'ds-user-message-bubble min-w-0'}>
        {showClawInboundCard && parsedClawPrompt ? (
          <ClawInboundMessageCard display={parsedClawPrompt} text={displayText} />
        ) : (
          <>
          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left">
            {displayText}
          </div>
          {parsedWritePrompt ? (
            <WritePromptMetaDisclosure
              display={parsedWritePrompt}
              expanded={writeMetaOpen}
              onToggle={() => setWriteMetaOpen((value) => !value)}
            />
          ) : null}
          <UserFileReferenceChips meta={block.meta} />
          <RuntimeMetaChips meta={block.meta} align="right" hideAttachments />
          </>
        )}
        <div
          data-user-message-actions="inline"
          className={`${showClawInboundCard ? 'mt-2' : 'ds-user-message-footer mt-2 border-t border-black/5 pt-1.5 dark:border-white/10'} flex min-w-0 items-center justify-between gap-3 text-ds-faint opacity-70 transition group-hover:opacity-100 group-focus-within:opacity-100`}
        >
          <div className="min-w-0 flex-1">
            <ModelMetaTag label={block.modelLabel} className="justify-start text-left" />
          </div>
          <div className="flex items-center justify-end gap-1">
          <CopyFeedbackButton text={displayText} iconOnly />
          {canEdit ? (
            <button
              type="button"
              onClick={startEdit}
              disabled={busy}
              title={t('rewindEditMessage')}
              aria-label={t('rewindEditMessage')}
              className="rounded-md p-1 transition hover:bg-ds-hover hover:text-ds-muted disabled:cursor-not-allowed disabled:hover:text-ds-faint"
            >
              <PencilLine className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ClawInboundMessageCard({
  display,
  text
}: {
  display: ClawUserPromptDisplay
  text: string
}): ReactElement {
  const { t } = useTranslation('common')
  const meta = [
    display.sender ? t('clawTimelineSender', { sender: display.sender }) : '',
    display.chatType ? t('clawTimelineChatType', { chatType: display.chatType }) : '',
    display.messageType ? t('clawTimelineMessageType', { messageType: display.messageType }) : '',
    display.mentions ? t('clawTimelineMentions', { mentions: display.mentions }) : ''
  ].filter(Boolean)

  return (
    <div className="w-full max-w-[min(560px,calc(100vw-3rem))] rounded-[18px] border border-ds-border bg-ds-card px-4 py-3 text-left shadow-[0_14px_34px_rgba(86,103,136,0.08)]">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-ds-muted">
        <MessageSquareQuote className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>{t('clawTimelineInbound', { source: display.sourceLabel ?? t('claw') })}</span>
      </div>
      <div className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-6 text-ds-ink [overflow-wrap:anywhere]">
        {text}
      </div>
      {meta.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {meta.map((item) => (
            <span
              key={item}
              className="rounded-md border border-ds-border-muted bg-ds-subtle px-2 py-0.5 text-[11px] text-ds-muted"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}


export function UserFileReferenceChips({
  meta
}: {
  meta?: RuntimeDisclosureMetadata
}): ReactElement | null {
  const { t } = useTranslation('common')
  const references = useMemo(() => metaUserFileReferences(meta), [meta])
  if (references.length === 0) return null

  return (
    <div className="mt-3 min-w-0 border-t border-white/10 pt-2">
      <div className="mb-1.5 text-[11px] font-medium text-ds-faint">
        {t('messageFileReferences', { count: references.length })}
      </div>
      <div
        role="region"
        tabIndex={0}
        aria-label={t('messageFileReferences', { count: references.length })}
        className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-black/20 dark:[&::-webkit-scrollbar-thumb]:bg-white/20"
      >
        <div className="flex w-max min-w-full justify-end gap-1.5">
          {references.map((reference) => {
            const isDirectory = reference.kind === 'directory'
            const label = isDirectory
              ? `${reference.relativePath.replace(/\/+$/g, '')}/`
              : reference.relativePath
            return (
              <span
                key={`${reference.kind ?? 'file'}:${reference.path}`}
                title={reference.path}
                className="inline-flex max-w-[260px] shrink-0 items-center gap-1.5 rounded-md border border-white/10 bg-white/8 px-2 py-1 text-[11.5px] font-medium text-ds-muted"
              >
                <File className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                <span className="truncate">{label}</span>
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
