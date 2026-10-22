import { useState, type ReactElement } from 'react'
import { Bot, Hourglass, Plus, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  REMOTE_BUTTON_CLASS, RemoteGroup, RemoteIconTile, RemoteRow, RemoteRowText, RemoteSection, RemoteStatusDot
} from '../remote-panel-ui'
import { AddAssistantDialog } from './AddAssistantDialog'
import { AssistantTaskRows } from './AssistantTaskRows'
import { assistantKindKey, recentlySeen, relativeTime } from './assistant-mailbox-format'
import { useAssistantMailbox } from './useAssistantMailbox'

/**
 * Personal assistants (Cue, Grok Bot, Muse, dots) connected through the assistant mailbox.
 * Hidden while the Lab switch is off; Kun itself assigns tasks through its tools.
 */
export function AssistantMailboxSection(): ReactElement | null {
  const { t, i18n } = useTranslation('common')
  const mailbox = useAssistantMailbox()
  const { status, busy, error } = mailbox
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  if (!mailbox.api || !status || status.availability === 'disabled') return null
  const available = status.availability === 'available'
  const notice = status.availability === 'unavailable'
    ? t('assistantMailboxUnavailable')
    : status.availability === 'login_required' ? t('assistantMailboxLoginRequired') : ''
  const failure = error || status.error

  return (
    <>
      <RemoteSection
        title={t('assistantMailboxTitle')}
        aside={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void mailbox.refresh()}
              disabled={busy}
              aria-label={t('assistantMailboxRefresh')}
              title={t('assistantMailboxRefresh')}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-ds-faint transition hover:text-ds-ink disabled:opacity-50"
            >
              <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
            </button>
            {available ? (
              <button type="button" onClick={() => { mailbox.setError(''); setAdding(true) }} className={`${REMOTE_BUTTON_CLASS} h-6 px-2`}>
                <Plus size={12} />
                {t('assistantMailboxAdd')}
              </button>
            ) : null}
          </div>
        }
      >
        {failure && !adding ? (
          <div role="alert" className="rounded-xl bg-ds-danger-soft px-3 py-2 text-[12px] leading-4 text-ds-danger">
            {t('assistantMailboxError', { message: failure })}
          </div>
        ) : null}
        {notice ? <p className="px-1 text-[12px] leading-4 text-ds-muted">{notice}</p> : null}
        {available && status.assistants.length === 0 && status.enrollments.length === 0 ? (
          <p className="px-1 text-[12px] leading-4 text-ds-muted">{t('assistantMailboxIntro')}</p>
        ) : null}
        {available && (status.assistants.length > 0 || status.enrollments.length > 0) ? (
          <RemoteGroup>
            {status.assistants.map((assistant) => {
              const seen = assistant.lastSeenAt
                ? t('assistantMailboxLastSeen', { time: relativeTime(assistant.lastSeenAt, i18n.language || 'en') })
                : t('assistantMailboxNeverSeen')
              const waiting = assistant.pendingToAssistant ? ` · ${t('assistantMailboxWaiting', { n: assistant.pendingToAssistant })}` : ''
              return (
                <RemoteRow key={assistant.id}>
                  <RemoteIconTile active={recentlySeen(assistant.lastSeenAt)}><Bot size={15} /></RemoteIconTile>
                  <RemoteRowText
                    title={<span className="flex items-center gap-1.5"><RemoteStatusDot on={recentlySeen(assistant.lastSeenAt)} />{assistant.name}</span>}
                    subtitle={assistant.keyAvailable
                      ? `${t(assistantKindKey(assistant.kind))} · ${seen}${waiting}`
                      : t('assistantMailboxKeyMissing')}
                    subtitleClassName={assistant.keyAvailable ? 'text-ds-muted' : 'text-amber-600 dark:text-amber-400'}
                  />
                  {confirming === assistant.id ? (
                    <button
                      type="button"
                      disabled={busy}
                      title={t('assistantMailboxRemoveConfirm', { name: assistant.name })}
                      onClick={() => { setConfirming(null); void mailbox.revoke(assistant.id) }}
                      className={`${REMOTE_BUTTON_CLASS} border-ds-danger text-ds-danger`}
                    >
                      {t('assistantMailboxRemove')}?
                    </button>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setConfirming(assistant.id)} className="text-[12px] text-ds-muted transition hover:text-ds-danger disabled:opacity-50">
                      {t('assistantMailboxRemove')}
                    </button>
                  )}
                </RemoteRow>
              )
            })}
            {status.enrollments.map((enrollment) => (
              <RemoteRow key={enrollment.enrollmentId}>
                <RemoteIconTile active={false}><Hourglass size={14} /></RemoteIconTile>
                <RemoteRowText
                  title={enrollment.name}
                  subtitle={t('assistantMailboxPendingCode', { name: enrollment.name, time: relativeTime(enrollment.expiresAt, i18n.language || 'en') })}
                />
              </RemoteRow>
            ))}
          </RemoteGroup>
        ) : null}
      </RemoteSection>
      {available && status.assistants.length > 0 ? (
        <AssistantTaskRows tasks={status.tasks} notes={status.notes} busy={busy} onCancel={(id) => void mailbox.cancel(id)} />
      ) : null}
      {adding ? (
        <AddAssistantDialog
          busy={busy}
          error={error}
          onCreate={mailbox.createEnrollment}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  )
}
