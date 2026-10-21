import type { ReactElement } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AssistantJoinRequestView } from '@shared/assistant-mailbox'
import { REMOTE_BUTTON_CLASS, REMOTE_PRIMARY_BUTTON_CLASS } from '../remote-panel-ui'
import { relativeTime } from './assistant-mailbox-format'

/**
 * One assistant asking to join. The user compares the code with the one the assistant reported
 * in its own chat; a different code means the request was not made by that assistant.
 */
export function JoinRequestCard({
  name,
  request,
  busy,
  onApprove,
  onReject
}: {
  name: string
  request: AssistantJoinRequestView
  busy: boolean
  onApprove: () => void
  onReject: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
        <ShieldCheck size={15} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t('assistantMailboxRequestTitle', { name })}</span>
        <span className="shrink-0 text-[11px] font-normal text-ds-faint">{relativeTime(request.createdAt, i18n.language || 'en')}</span>
      </div>
      {request.verificationCode ? (
        <>
          <div className="text-[11px] text-ds-muted">{t('assistantMailboxVerificationCode')}</div>
          <div className="select-all font-mono text-[20px] font-semibold tracking-[0.12em] text-ds-ink" data-testid="assistant-verification-code">
            {request.verificationCode}
          </div>
          <p className="text-[11.5px] leading-4 text-ds-muted">{t('assistantMailboxRequestHint')}</p>
        </>
      ) : (
        <p className="text-[11.5px] leading-4 text-amber-600 dark:text-amber-400">{t('assistantMailboxNoKeyForRequest')}</p>
      )}
      <div className="text-[11px] text-ds-faint">{request.platform} · kun-agent {request.agentVersion}</div>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onReject} className={REMOTE_BUTTON_CLASS}>
          {t('assistantMailboxReject')}
        </button>
        <button type="button" disabled={busy || !request.verificationCode} onClick={onApprove} className={REMOTE_PRIMARY_BUTTON_CLASS}>
          {t('assistantMailboxApprove')}
        </button>
      </div>
    </div>
  )
}
