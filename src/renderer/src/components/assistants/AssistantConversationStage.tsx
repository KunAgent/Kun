import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { BellRing, MoreHorizontal, PanelLeft, RefreshCw, Trash2, X } from 'lucide-react'
import { wakeMessage } from '@kun/assistant-agent/prompts'
import type { AssistantTaskView, AssistantView } from '@shared/assistant-mailbox'
import kunCheer from '../../../../asset/img/kun_cheer.png'
import { RoomPopover } from '../rooms/RoomPopover'
import { AssistantComposer, AssistantComposerPlaceholder } from './AssistantComposer'
import { AssistantEnrollmentFlow } from './AssistantEnrollmentFlow'
import { AssistantLogo } from './AssistantLogo'
import { useAssistantHistory } from './use-assistant-history'
import { AssistantThread } from './AssistantThread'
import { assistantProductLabel } from './assistant-catalog'
import { recentlySeen, relativeTime } from './assistant-format'
import { assistantMailbox, startAssistantMailbox, useAssistantMailboxStore } from './assistant-mailbox-store'
import { closeAssistantConversation, markAssistantRead, openAssistantConversation, type AssistantSelection } from './assistant-navigation'

/** Latest thing the assistant sent, for the read mark that clears the sidebar dot. */
function latestIncoming(assistantId: string, tasks: AssistantTaskView[], notes: Array<{ assistantId: string; from: string; at: string }>): string {
  let latest = ''
  for (const task of tasks) if (task.assistantId === assistantId) for (const update of task.updates) if (update.at > latest) latest = update.at
  for (const note of notes) if (note.assistantId === assistantId && note.from === 'assistant' && note.at > latest) latest = note.at
  return latest
}

const SUGGESTIONS = ['assistantSuggestionNews', 'assistantSuggestionInbox', 'assistantSuggestionReport'] as const

function ConnectedHero({ assistant, onPick }: { assistant: AssistantView; onPick: (text: string) => void }): ReactElement {
  const { t } = useTranslation('common')
  return <article aria-labelledby="assistant-connected-title" className="mx-auto flex max-w-[560px] flex-col items-center gap-3 py-8 text-center">
    <img src={kunCheer} alt="" className="h-[96px] w-auto" />
    <h2 id="assistant-connected-title" className="text-[17px] font-semibold">{t('assistantConnectedTitle', { name: assistant.name })}</h2>
    <p className="text-[13.5px] leading-[21px] text-ds-muted">{t('assistantConnectedBody')}</p>
    <div className="flex flex-wrap justify-center gap-2 pt-1">
      {SUGGESTIONS.map((key) => <button type="button" key={key} onClick={() => onPick(t(key))}
        className="h-[32px] rounded-full border border-ds-border-muted bg-ds-card px-3.5 text-[12.5px] text-ds-ink transition hover:bg-ds-hover">{t(key)}</button>)}
    </div>
  </article>
}

/** The Code stage for one personal assistant: its task conversation, or the steps to connect it. */
export function AssistantConversationStage({ selection, onToggleLeftSidebar }: {
  selection: AssistantSelection
  onToggleLeftSidebar: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language || 'en'
  const { status, busy, error } = useAssistantMailboxStore()
  const allowed = status?.availability === 'available'
  const membershipMessage = t(status?.availability === 'upgrade_required' ? 'assistantVipRequired' : 'assistantVipUnavailable')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<AssistantTaskView | null>(null)
  const [focusSignal, setFocusSignal] = useState(0)
  useEffect(() => { startAssistantMailbox() }, [])
  useEffect(() => { setDraft(''); setReplyTo(null) }, [selection.kind, selection.id])

  const enrollment = selection.kind === 'enrollment' ? status?.enrollments.find((item) => item.enrollmentId === selection.id) : undefined
  const assistant = selection.kind === 'assistant'
    ? status?.assistants.find((item) => item.id === selection.id)
    : enrollment ? undefined : status?.assistants.find((item) => item.enrollmentId === selection.id)
  const history = useAssistantHistory(assistant?.id, status)
  // Approving turns the enrollment into an assistant; follow it into its conversation.
  useEffect(() => {
    if (selection.kind === 'enrollment' && assistant) openAssistantConversation({ kind: 'assistant', id: assistant.id })
  }, [selection.kind, assistant])

  const incoming = useMemo(() => assistant && status ? latestIncoming(assistant.id, status.tasks, status.notes) : '', [assistant, status])
  // Like other chats, open at the newest message and follow new ones unless the user scrolled up.
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const activity = assistant && status ? [...status.tasks.filter((task) => task.assistantId === assistant.id).map((task) => task.updatedAt),
    ...status.notes.filter((note) => note.assistantId === assistant.id).map((note) => note.at)].sort().at(-1) ?? '' : ''
  const loaded = Boolean(assistant ?? enrollment)
  useLayoutEffect(() => { stick.current = true }, [selection.kind, selection.id])
  useLayoutEffect(() => {
    const node = scroller.current
    if (node && stick.current) node.scrollTop = node.scrollHeight
  }, [selection.kind, selection.id, activity, loaded])
  useEffect(() => {
    if (!assistant || !incoming) return
    const mark = () => { if (document.visibilityState === 'visible') markAssistantRead(assistant.id, incoming) }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [assistant, incoming])

  const subject = assistant ?? enrollment
  const product = subject ? assistantProductLabel(subject.kind, subject.product) : ''
  const expired = enrollment ? Date.parse(enrollment.expiresAt) <= Date.now() : false
  const tag = !allowed ? t('assistantVipPaused') : assistant ? t('assistantTag') : enrollment?.requests.length ? t('assistantTagApprove') : t('assistantTagEnrolling')
  const subtitle = assistant
    ? [product, assistant.lastSeenAt ? t('assistantMailboxLastSeen', { time: relativeTime(assistant.lastSeenAt, language) }) : t('assistantMailboxNeverSeen'), t('assistantE2E'), t(assistant.reportedVersion ? 'assistantProgramVersion' : 'assistantProgramLegacy', { version: assistant.reportedVersion ?? assistant.agentVersion }), assistant.updateError ? t(assistant.updateError === 'update_available' ? 'assistantProgramUpdateAvailable' : 'assistantProgramUpdateFailed') : '']
    : enrollment ? [product, expired ? t('assistantCodeExpiredShort') : t('assistantCodeExpires', { time: relativeTime(enrollment.expiresAt, language) })] : []

  const remove = (): void => {
    if (assistant && window.confirm(t('assistantMailboxRemoveConfirm', { name: assistant.name }))) {
      void assistantMailbox.revoke(assistant.id).then((result) => { if (result) closeAssistantConversation() })
    }
  }
  const cancelEnrollment = (): void => {
    if (enrollment) void assistantMailbox.cancelEnrollment(enrollment.enrollmentId).then((result) => { if (result) closeAssistantConversation() })
  }
  const send = async ({ body, deadline }: { body: string; deadline?: string }): Promise<boolean> => {
    if (!assistant || !allowed) return false
    const done = replyTo ? await assistantMailbox.reply(replyTo.id, body) : await assistantMailbox.assign({ assistantId: assistant.id, body, ...(deadline ? { deadline } : {}) })
    if (!done) return false
    setDraft('')
    setReplyTo(null)
    return true
  }
  const reply = (task: AssistantTaskView): void => { setReplyTo(task); setFocusSignal((value) => value + 1) }
  const cancelTask = (task: AssistantTaskView): void => {
    if (window.confirm(t('assistantCancelTaskConfirm', { title: task.title || task.body.slice(0, 40) }))) void assistantMailbox.cancelTask(task.id)
  }

  const mine = Boolean(history.tasks.length || history.notes.length)
  const missing = !status ? t('assistantLoading')
    : status.availability === 'unavailable' ? t('assistantMailboxUnavailable')
      : status.availability === 'login_required' ? t('assistantMailboxLoginRequired')
        : !subject ? (selection.kind === 'enrollment' ? t('assistantMailboxCodeExpired') : t('assistantRemoved')) : ''

  return <section className="ds-no-drag flex h-full min-h-0 min-w-0 flex-1 flex-col bg-ds-main" data-assistant-stage={selection.kind}>
    <header className="flex min-h-[56px] shrink-0 items-center gap-2.5 border-b border-ds-border px-4 py-2">
      <button type="button" className="rooms-icon-button" aria-label={t('sidebarToggle')} onClick={onToggleLeftSidebar}><PanelLeft size={16} strokeWidth={1.75} /></button>
      {subject ? <>
        <AssistantLogo kind={subject.kind} name={subject.name} icon={subject.icon} size={36} badge />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5" style={{ WebkitAppRegion: 'drag' } as CSSProperties}>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-[4.5rem] truncate text-[15px] font-semibold text-ds-ink">{subject.name}</h1>
            <span className={`min-w-0 truncate rounded-full px-2 py-px text-[11px] font-medium ${assistant ? 'bg-ds-subtle text-ds-muted' : 'bg-accent-tint/10 text-accent'}`}>{tag}</span>
          </div>
          <p className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-ds-muted">
            {assistant ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${recentlySeen(assistant.lastSeenAt) ? 'bg-emerald-500' : 'bg-ds-faint'}`} /> : null}
            <span className="truncate">{subtitle.filter(Boolean).join(' · ')}</span>
          </p>
        </div>
      </> : <div className="flex-1" />}
      {assistant ? <>
        <button type="button" className="rooms-icon-button" aria-label={t('assistantMailboxRefresh')} title={t('assistantMailboxRefresh')} disabled={busy}
          onClick={() => void assistantMailbox.refresh()}><RefreshCw size={16} strokeWidth={1.75} className={busy ? 'animate-spin' : ''} /></button>
        <RoomPopover label={t('roomsMoreActions')} trigger={<MoreHorizontal size={18} />} align="end" width={232} className="rooms-icon-button">
          {(close) => <div className="rooms-menu-list conversation-menu">
            <button type="button" onClick={() => { close(); void navigator.clipboard.writeText(wakeMessage({ kind: assistant.kind, locale: language.startsWith('zh') ? 'zh' : 'en' })) }}>
              <BellRing size={15} aria-hidden="true" /><span>{t('assistantCopyWake')}</span></button>
            <button type="button" disabled={busy} onClick={() => { close(); void assistantMailbox.updatePrompt(assistant.id, language.startsWith('zh') ? 'zh' : 'en').then((result) => { if (result) void navigator.clipboard.writeText(result.prompt) }) }}>
              <span>{t('assistantCopyUpdate')}</span></button>
            <hr />
            <button type="button" className="is-danger" onClick={() => { close(); remove() }}><Trash2 size={15} aria-hidden="true" /><span>{t('assistantRemove')}</span></button>
          </div>}
        </RoomPopover>
      </> : enrollment ? <button type="button" disabled={busy} onClick={cancelEnrollment}
        className="h-8 rounded-lg border border-ds-border-muted bg-ds-card px-3 text-[12.5px] text-ds-muted transition hover:text-ds-danger">{t('assistantCancelEnrollment')}</button> : null}
    </header>
    {status?.error ? <div role="status" className="border-b border-ds-border px-4 py-2 text-[12.5px] text-ds-muted">{status.error.includes('assistant_history_expired') ? t('assistantHistoryExpired') : t('assistantMailboxError', { message: status.error })}
      {assistant && status.error.includes('assistant_history_expired') ? <button type="button" className="ml-3 text-accent" onClick={() => { if (window.confirm(t('assistantRecoverHistoryConfirm'))) void assistantMailbox.recoverHistory(assistant.id) }}>{t('assistantRecoverHistory')}</button> : null}
    </div> : null}
    {error ? <div role="alert" className="flex items-center gap-2 border-b border-ds-border px-4 py-2 text-[12.5px] text-ds-danger">
      <span className="min-w-0 flex-1 break-words">{error.includes('vip_personal_assistant_required') ? t('assistantVipRequired') : t('assistantMailboxError', { message: error })}</span>
      <button type="button" aria-label={t('assistantMailboxClose')} onClick={assistantMailbox.clearError} className="text-ds-muted hover:text-ds-ink"><X size={14} /></button>
    </div> : null}
    <div ref={scroller} aria-label={t('assistantMessages')} className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-2 pt-6"
      onScroll={(event) => { const node = event.currentTarget; stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80 }}>
      {assistant && history.hasMore ? <button type="button" disabled={history.busy} onClick={() => void history.load()} className="mb-4 text-[12px] text-accent">{t(history.busy ? 'assistantLoading' : 'assistantLoadHistory')}</button> : null}
      {history.error ? <p role="alert" className="text-ds-danger">{t('assistantMailboxError', { message: history.error })}</p> : null}
      {missing ? <div className="m-auto flex flex-col items-center gap-3 text-center text-[13px] text-ds-muted">
        <p role="status">{missing}</p>
        {status && !subject ? <button type="button" onClick={closeAssistantConversation} className="h-8 rounded-lg border border-ds-border-muted bg-ds-card px-3 text-[12.5px] text-ds-ink">{t('assistantMailboxClose')}</button> : null}
      </div> : enrollment && !allowed ? <div className="m-auto flex flex-col items-center gap-3 text-center text-[13px] text-ds-muted">
        <p role="status">{membershipMessage}</p>
        <button type="button" disabled={busy} onClick={() => void assistantMailbox.refresh()} className="text-accent">{t('assistantMailboxRefresh')}</button>
      </div> : enrollment ? expired ? <div className="m-auto flex flex-col items-center gap-3 text-center text-[13px] text-ds-muted">
        <p role="status">{t('assistantMailboxCodeExpired')}</p>
        <button type="button" onClick={cancelEnrollment} className="h-8 rounded-lg border border-ds-border-muted bg-ds-card px-3 text-[12.5px] text-ds-ink">{t('assistantCancelEnrollment')}</button>
      </div> : <AssistantEnrollmentFlow enrollment={enrollment} busy={busy} />
        : assistant ? mine ? <AssistantThread assistant={assistant} tasks={history.tasks} notes={history.notes} busy={busy || !allowed} onReply={reply} onCancel={cancelTask} />
          : <ConnectedHero assistant={assistant} onPick={(text) => { setDraft(text); setFocusSignal((value) => value + 1) }} /> : null}
    </div>
    <footer className="flex shrink-0 justify-center px-5 pb-4 pt-2">
      {assistant && assistant.keyAvailable && allowed ? <AssistantComposer assistant={assistant} draft={draft} onDraft={setDraft} replyTo={replyTo}
        onClearReply={() => setReplyTo(null)} busy={busy} onSend={send} focusSignal={focusSignal} />
        : <AssistantComposerPlaceholder text={!allowed ? membershipMessage : assistant ? t('assistantMailboxKeyMissing') : enrollment?.requests.length ? t('assistantComposerAfterApprove') : t('assistantComposerAfterConnect')} />}
    </footer>
  </section>
}
