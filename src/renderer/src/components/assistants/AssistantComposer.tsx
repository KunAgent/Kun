import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, BellRing, Check, Clock, Loader2, X } from 'lucide-react'
import { wakeMessage } from '@kun/assistant-agent/prompts'
import type { AssistantTaskView, AssistantView } from '@shared/assistant-mailbox'
import { taskHeadline } from './assistant-format'
import { useCopyFeedback } from './useCopyFeedback'

const FORM = 'flex w-full max-w-[760px] flex-col gap-2 rounded-[22px] border border-ds-border bg-ds-card px-4 pb-2.5 pt-3 shadow-composer'
const CHIP = 'inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50'

/** Composer shown before an assistant can take tasks (while connecting, or keyed on another computer). */
export function AssistantComposerPlaceholder({ text }: { text: string }): ReactElement {
  const { t } = useTranslation('common')
  return <div className="flex w-full max-w-[760px] items-center gap-3 rounded-[22px] border border-ds-border bg-ds-card py-3 pl-4 pr-3 opacity-70 shadow-composer" aria-disabled="true">
    <span className="flex-1 text-[14px] text-ds-faint">{text}</span>
    <span aria-label={t('assistantSend')} className="grid h-[34px] w-[34px] place-items-center rounded-full bg-ds-subtle text-ds-faint"><ArrowUp size={16} /></span>
  </div>
}

/**
 * Everything typed here goes to the assistant: a new task, or, while a blocked task is being
 * answered, a reply about that task. Enter sends; Shift+Enter starts a new line.
 */
export function AssistantComposer({ assistant, draft, onDraft, replyTo, onClearReply, busy, onSend, focusSignal }: {
  assistant: AssistantView
  draft: string
  onDraft: (value: string) => void
  replyTo: AssistantTaskView | null
  onClearReply: () => void
  busy: boolean
  onSend: (input: { body: string; deadline?: string }) => Promise<boolean>
  focusSignal: number
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [deadlineOpen, setDeadlineOpen] = useState(false)
  const [deadline, setDeadline] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  const { copied, copy } = useCopyFeedback()
  useEffect(() => { if (focusSignal) field.current?.focus() }, [focusSignal])
  const body = draft.trim()
  const ready = body.length > 0 && !busy

  const submit = async (): Promise<void> => {
    if (!ready) return
    const due = !replyTo && deadline ? new Date(deadline) : null
    const sent = await onSend({ body, ...(due && !Number.isNaN(due.getTime()) ? { deadline: due.toISOString() } : {}) })
    if (sent) { setDeadline(''); setDeadlineOpen(false) }
  }
  const nudge = (): void => {
    void copy('wake', wakeMessage({ kind: assistant.kind, locale: (i18n.language ?? '').startsWith('zh') ? 'zh' : 'en' }))
  }

  return <form aria-label={t('assistantComposerLabel', { name: assistant.name })} className={FORM}
    onSubmit={(event) => { event.preventDefault(); void submit() }}>
    {replyTo ? <div className="flex items-center gap-2 self-start rounded-lg bg-ds-subtle px-2.5 py-1 text-[12px] text-ds-muted">
      <span className="min-w-0 truncate">{t('assistantReplyingTo', { title: taskHeadline(replyTo.title, replyTo.body) })}</span>
      <button type="button" onClick={onClearReply} aria-label={t('assistantReplyCancel')} className="text-ds-faint hover:text-ds-ink"><X size={13} /></button>
    </div> : null}
    <label className="flex">
      <span className="sr-only">{t('assistantComposerField')}</span>
      <textarea ref={field} rows={2} value={draft} maxLength={8000}
        placeholder={replyTo ? t('assistantReplyPlaceholder', { name: assistant.name }) : t('assistantComposerPlaceholder', { name: assistant.name })}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
          event.preventDefault()
          void submit()
        }}
        className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent text-[14px] leading-[22px] text-ds-ink outline-none placeholder:text-ds-faint" />
    </label>
    <div className="flex flex-wrap items-center gap-1">
      {replyTo ? null : <button type="button" aria-pressed={deadlineOpen} onClick={() => setDeadlineOpen((open) => !open)} className={CHIP}>
        <Clock size={14} aria-hidden="true" />{t('assistantDeadlineButton')}</button>}
      {deadlineOpen && !replyTo ? <label className="flex items-center">
        <span className="sr-only">{t('assistantDeadlineButton')}</span>
        <input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)}
          className="h-[30px] rounded-lg border border-ds-border-muted bg-ds-card px-2 text-[12.5px] text-ds-ink outline-none" />
      </label> : null}
      <button type="button" onClick={nudge} title={t('assistantNudgeHint')} className={CHIP}>
        {copied === 'wake' ? <Check size={14} className="text-emerald-600" aria-hidden="true" /> : <BellRing size={14} aria-hidden="true" />}
        {copied === 'wake' ? t('assistantNudgeCopied') : t('assistantNudge')}
      </button>
      <span className="ml-auto hidden text-[11.5px] text-ds-faint sm:inline">{t('assistantComposerHint')}</span>
      <button type="submit" disabled={!ready} aria-label={t('assistantSend')}
        className="ml-2 grid h-[34px] w-[34px] place-items-center rounded-full bg-accent text-white transition hover:opacity-90 disabled:bg-ds-subtle disabled:text-ds-faint">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.4} />}
      </button>
    </div>
  </form>
}
