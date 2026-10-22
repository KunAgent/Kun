import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Bot, Check, Copy, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  ASSISTANT_KINDS, ASSISTANT_NAME_MAX,
  type AssistantEnrollmentRequest, type AssistantEnrollmentResult, type AssistantKind, type AssistantPromptLocale
} from '@shared/assistant-mailbox'
import { REMOTE_BUTTON_CLASS, REMOTE_INPUT_CLASS, REMOTE_PRIMARY_BUTTON_CLASS } from '../remote-panel-ui'
import { assistantKindKey, assistantKindShortName, relativeTime } from './assistant-mailbox-format'

type Props = {
  busy: boolean
  error: string
  onCreate: (request: AssistantEnrollmentRequest) => Promise<AssistantEnrollmentResult | undefined>
  onClose: () => void
}

/**
 * Two steps: choose the assistant, then copy the generated prompt. The prompt carries a
 * one-time code with the enrollment secret, so it is shown once and never stored here.
 */
export function AddAssistantDialog({ busy, error, onCreate, onClose }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [kind, setKind] = useState<AssistantKind>('cue')
  const [name, setName] = useState('')
  const [locale, setLocale] = useState<AssistantPromptLocale>((i18n.language ?? '').startsWith('zh') ? 'zh' : 'en')
  const [result, setResult] = useState<AssistantEnrollmentResult | null>(null)
  const [copied, setCopied] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const defaultName = t('assistantMailboxDefaultName', { kind: assistantKindShortName(kind) })
  const finalName = (name.trim() || defaultName).slice(0, ASSISTANT_NAME_MAX)

  useEffect(() => { nameInput.current?.focus() }, [])

  const copy = (): void => {
    if (!result) return
    void navigator.clipboard.writeText(result.prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* best-effort */ })
  }

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-4"
      onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-dialog-title"
        className="flex max-h-full w-[520px] max-w-full flex-col gap-3 overflow-y-auto rounded-[20px] border border-ds-border bg-ds-card p-5 text-ds-ink shadow-[0_24px_64px_rgba(16,24,40,0.28)]"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Bot size={20} aria-hidden="true" />
          </span>
          <h2 id="assistant-dialog-title" className="text-[16px] font-semibold leading-6">
            {t('assistantMailboxDialogTitle')}
          </h2>
        </div>
        {!result ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void onCreate({ name: finalName, kind, locale }).then((created) => { if (created) setResult(created) })
            }}
          >
            <p className="text-[13px] leading-[19px] text-ds-muted">{t('assistantMailboxDialogHint')}</p>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ds-muted">
              {t('assistantMailboxKind')}
              <select value={kind} onChange={(event) => setKind(event.target.value as AssistantKind)} className={REMOTE_INPUT_CLASS}>
                {ASSISTANT_KINDS.map((value) => <option key={value} value={value}>{t(assistantKindKey(value))}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ds-muted">
              {t('assistantMailboxName')}
              <input
                ref={nameInput}
                value={name}
                maxLength={ASSISTANT_NAME_MAX}
                placeholder={defaultName}
                onChange={(event) => setName(event.target.value)}
                className={REMOTE_INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ds-muted">
              {t('assistantMailboxPromptLanguage')}
              <select value={locale} onChange={(event) => setLocale(event.target.value as AssistantPromptLocale)} className={REMOTE_INPUT_CLASS}>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            {error ? <p role="alert" className="text-[12px] text-ds-danger">{t('assistantMailboxError', { message: error })}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={REMOTE_BUTTON_CLASS}>{t('assistantMailboxCancel')}</button>
              <button type="submit" disabled={busy} className={REMOTE_PRIMARY_BUTTON_CLASS}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                {t('assistantMailboxCreate')}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-[19px] text-ds-muted">
              {t('assistantMailboxPromptReady', { name: finalName, time: relativeTime(result.expiresAt, i18n.language || 'en') })}
            </p>
            <textarea
              readOnly
              value={result.prompt}
              aria-label={t('assistantMailboxCopyPrompt')}
              onFocus={(event) => event.currentTarget.select()}
              className="h-64 w-full resize-none rounded-lg border border-ds-border-muted bg-ds-subtle p-2.5 font-mono text-[11.5px] leading-[17px] text-ds-ink outline-none"
            />
            <p className="text-[11px] leading-4 text-amber-600 dark:text-amber-400">{t('assistantMailboxSecretWarning')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={REMOTE_BUTTON_CLASS}>{t('assistantMailboxClose')}</button>
              <button type="button" onClick={copy} className={REMOTE_PRIMARY_BUTTON_CLASS}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {t(copied ? 'assistantMailboxCopied' : 'assistantMailboxCopyPrompt')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
