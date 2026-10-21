import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Info, Loader2, Lock } from 'lucide-react'
import type { AssistantEnrollmentView, AssistantPromptLocale } from '@shared/assistant-mailbox'
import kunSit from '../../../../asset/img/kun_sit.png'
import { assistantProductLabel } from './assistant-catalog'
import { assistantMailbox } from './assistant-mailbox-store'
import { AssistantSteps } from './AssistantSteps'
import { JoinRequestCard } from './JoinRequestCard'
import { useCopyFeedback } from './useCopyFeedback'

type PromptState = { locale: AssistantPromptLocale; text: string | null; loading: boolean }

/**
 * Steps 2 and 3 of connecting an assistant, inside its conversation: the prompt to paste into the
 * assistant, then each join request with its verification code to compare before allowing it.
 */
export function AssistantEnrollmentFlow({ enrollment, busy }: { enrollment: AssistantEnrollmentView; busy: boolean }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const product = assistantProductLabel(enrollment.kind, enrollment.product) || enrollment.name
  const requests = enrollment.requests
  const [prompt, setPrompt] = useState<PromptState>({ locale: (i18n.language ?? '').startsWith('zh') ? 'zh' : 'en', text: null, loading: true })
  const [showPrompt, setShowPrompt] = useState(false)
  const { copied, copy } = useCopyFeedback()

  useEffect(() => {
    let live = true
    setPrompt((current) => ({ ...current, loading: true }))
    void assistantMailbox.promptFor(enrollment.enrollmentId, prompt.locale).then((result) => {
      if (live) setPrompt((current) => ({ ...current, text: result?.prompt ?? null, loading: false }))
    })
    return () => { live = false }
  }, [enrollment.enrollmentId, prompt.locale])

  const promptOpen = requests.length === 0 || showPrompt
  const other: AssistantPromptLocale = prompt.locale === 'zh' ? 'en' : 'zh'
  const button = 'inline-flex h-[34px] items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-medium transition disabled:opacity-50'

  return <div className="flex w-full max-w-[720px] flex-col gap-5">
    <AssistantSteps current={requests.length ? 3 : 2} />
    {promptOpen ? <article aria-labelledby="assistant-prompt-title" className="flex flex-col gap-3 rounded-[18px] border border-ds-border-muted bg-ds-card p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="assistant-prompt-title" className="text-[15px] font-semibold">{t('assistantPromptTitle', { product })}</h2>
        <span className="text-[12.5px] text-ds-muted">{t('assistantPromptSubtitle')}</span>
      </div>
      {prompt.loading && !prompt.text ? <div className="flex h-24 items-center justify-center text-ds-muted"><Loader2 size={16} className="animate-spin" /></div>
        : prompt.text ? <pre data-testid="assistant-prompt" className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ds-subtle p-3.5 font-mono text-[12px] leading-[19px] text-ds-ink">{prompt.text}</pre>
          : <p role="alert" className="text-[12.5px] text-amber-700 dark:text-amber-400">{t('assistantPromptUnavailable')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={!prompt.text} onClick={() => { if (prompt.text) void copy('prompt', prompt.text) }}
          className={`${button} bg-accent text-white hover:opacity-90`}>
          {copied === 'prompt' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied === 'prompt' ? t('assistantMailboxCopied') : t('assistantMailboxCopyPrompt')}
        </button>
        <button type="button" onClick={() => setPrompt((current) => ({ ...current, locale: other }))}
          className={`${button} border border-ds-border-muted bg-ds-card text-ds-ink hover:bg-ds-hover`}>
          {t(other === 'zh' ? 'assistantPromptToChinese' : 'assistantPromptToEnglish')}
        </button>
        <span className="flex min-w-[220px] flex-1 items-center gap-1.5 text-[12px] text-ds-muted">
          <Lock size={13} className="shrink-0" aria-hidden="true" />{t('assistantNoSecretHint')}</span>
      </div>
    </article> : <div className="flex items-center gap-2 text-[12.5px] text-ds-muted">
      <Check size={14} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />{t('assistantPromptSent')}
      <button type="button" onClick={() => setShowPrompt(true)} className="font-medium text-accent hover:underline">{t('assistantPromptShow')}</button>
    </div>}

    {requests.length === 0 ? <article aria-labelledby="assistant-wait-title" className="flex items-start gap-4 rounded-[18px] border border-dashed border-ds-border bg-ds-card/60 p-5">
      <img src={kunSit} alt="" className="h-[72px] w-auto shrink-0" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 id="assistant-wait-title" className="text-[14.5px] font-semibold">{t('assistantWaitTitle', { product })}</h2>
        <p className="text-[13px] leading-5 text-ds-muted">{t('assistantWaitBody')}</p>
        <span role="status" className="flex items-center gap-1.5 text-[12px] text-ds-muted"><Loader2 size={13} className="animate-spin" aria-hidden="true" />{t('assistantWaitPolling')}</span>
      </div>
    </article> : <>
      {requests.map((request) => <JoinRequestCard key={request.requestId} name={product} request={request} busy={busy}
        onApprove={() => void assistantMailbox.approve(enrollment.enrollmentId, request.requestId)}
        onReject={() => void assistantMailbox.reject(enrollment.enrollmentId, request.requestId)} />)}
      <p className="flex items-start gap-2 text-[12.5px] leading-5 text-ds-muted">
        <Info size={14} className="mt-[3px] shrink-0" aria-hidden="true" />{t('assistantApproveInfo', { product })}</p>
    </>}
  </div>
}
