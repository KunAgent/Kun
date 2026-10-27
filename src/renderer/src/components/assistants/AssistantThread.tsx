import { Fragment, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Clock, Lock, TriangleAlert } from 'lucide-react'
import type { AssistantNoteView, AssistantTaskStatus, AssistantTaskUpdate, AssistantTaskView, AssistantView } from '@shared/assistant-mailbox'
import { AssistantLogo } from './AssistantLogo'
import { assistantStatusKey, assistantStatusTone, isOpenAssistantTask, taskHeadline } from './assistant-format'

type Entry =
  | { type: 'task'; at: string; task: AssistantTaskView }
  | { type: 'update'; at: string; task: AssistantTaskView; update: AssistantTaskUpdate; askReply: boolean }
  | { type: 'note'; at: string; note: AssistantNoteView; about?: string }

/** Tasks, the assistant's reports on them and free messages, oldest first. */
export function assistantTimeline(assistantId: string, tasks: AssistantTaskView[], notes: AssistantNoteView[]): Entry[] {
  const mine = tasks.filter((task) => task.assistantId === assistantId)
  const titles = new Map(mine.map((task) => [task.id, taskHeadline(task.title, task.body)]))
  const entries: Entry[] = []
  for (const task of mine) {
    entries.push({ type: 'task', at: task.createdAt, task })
    const last = task.updates[task.updates.length - 1]
    for (const update of task.updates) {
      if (!update.body.trim()) continue
      entries.push({ type: 'update', at: update.at, task, update, askReply: update === last && task.status === 'blocked' })
    }
  }
  for (const note of notes.filter((item) => item.assistantId === assistantId)) {
    entries.push({ type: 'note', at: note.at, note, ...(note.inReplyTo && titles.get(note.inReplyTo) ? { about: titles.get(note.inReplyTo) } : {}) })
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at))
}

const FINAL: AssistantTaskStatus[] = ['done', 'blocked', 'failed', 'cancelled']
const ORDER: Record<AssistantTaskStatus, number> = { queued: 0, sent: 0, received: 1, working: 2, done: 3, blocked: 3, failed: 3, cancelled: 3, cancel_requested: 2 }

function TaskProgress({ task }: { task: AssistantTaskView }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const time = (iso?: string) => iso ? new Date(iso).toLocaleTimeString(i18n.language || 'en', { hour: '2-digit', minute: '2-digit' }) : '—'
  const first = (status: AssistantTaskStatus) => task.updates.find((update) => update.status === status)?.at
  const final = FINAL.includes(task.status) ? task.status : null
  const steps: Array<{ key: string; label: string; at?: string; status: AssistantTaskStatus }> = [
    { key: 'sent', label: t(task.status === 'queued' ? 'assistantMailboxStatusQueued' : 'assistantMailboxStatusSent'), at: task.createdAt, status: task.status === 'queued' ? 'queued' : 'sent' },
    { key: 'received', label: t('assistantMailboxStatusReceived'), at: first('received') ?? task.updates[0]?.at, status: 'received' },
    { key: 'working', label: t('assistantMailboxStatusWorking'), at: first('working'), status: 'working' },
    { key: 'final', label: final ? t(assistantStatusKey(final)) : t('assistantStepFinal'), at: final ? task.updatedAt : undefined, status: final ?? 'done' }
  ]
  const reached = ORDER[task.status]
  return <ol aria-label={t('assistantProgress')} className="mt-1 grid grid-cols-4 gap-1.5 border-t border-ds-border-muted pt-2.5">
    {steps.map((step, index) => {
      const on = index <= reached
      const tone = !on ? 'text-ds-faint' : index === 3 ? assistantStatusTone(step.status) : 'text-emerald-600 dark:text-emerald-400'
      return <li key={step.key} className={`flex flex-col gap-0.5 text-[12px] font-semibold ${tone}`}>
        <span className="flex items-center gap-1">
          {index === 3 && on && step.status === 'done' ? <Check size={12} strokeWidth={3} aria-hidden="true" />
            : index === 3 && on && step.status === 'blocked' ? <TriangleAlert size={12} aria-hidden="true" />
              : <span className={`h-2 w-2 rounded-full ${on ? 'bg-current' : 'border-[1.5px] border-current'}`} aria-hidden="true" />}
          {step.label}
        </span>
        <span className="font-normal text-ds-muted">{on ? time(step.at) : '—'}</span>
      </li>
    })}
  </ol>
}

export function AssistantThread({ assistant, tasks, notes, busy, onReply, onCancel }: {
  assistant: AssistantView
  tasks: AssistantTaskView[]
  notes: AssistantNoteView[]
  busy: boolean
  onReply: (task: AssistantTaskView) => void
  onCancel: (task: AssistantTaskView) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language || 'en'
  const entries = assistantTimeline(assistant.id, tasks, notes)
  const day = (iso: string) => new Date(iso).toLocaleDateString(language, { month: 'long', day: 'numeric', weekday: 'short' })
  const time = (iso: string) => new Date(iso).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
  const bubble = 'whitespace-pre-wrap break-words rounded-[4px_14px_14px_14px] border bg-ds-card px-3.5 py-2.5 text-[13.5px] leading-[21px] text-ds-ink'
  return <div className="flex w-full max-w-[760px] flex-col gap-4">
    <p className="mx-auto flex max-w-[520px] items-center gap-1.5 text-center text-[12px] leading-[18px] text-ds-muted">
      <Lock size={13} className="shrink-0" aria-hidden="true" />{t('assistantThreadIntro', { name: assistant.name })}
    </p>
    {entries.map((entry, index) => {
      const divider = index === 0 || day(entries[index - 1].at) !== day(entry.at)
      return <Fragment key={`${entry.type}:${entry.type === 'note' ? entry.note.id : entry.type === 'task' ? entry.task.id : entry.update.at + entry.task.id}`}>
        {divider ? <div className="flex items-center gap-2.5 text-[11.5px] text-ds-muted"><span className="h-px flex-1 bg-ds-border-muted" />{day(entry.at)}<span className="h-px flex-1 bg-ds-border-muted" /></div> : null}
        {entry.type === 'task' ? <article aria-label={taskHeadline(entry.task.title, entry.task.body)} className="flex w-full max-w-[520px] flex-col gap-1.5 self-end">
          <span className="self-end text-[12px] text-ds-muted">{t('roomsSidebarYou')} · {time(entry.task.createdAt)}</span>
          <div className="flex flex-col gap-2 rounded-[14px] border border-ds-border-muted bg-ds-card px-4 py-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-accent">{t('assistantTaskLabel')}</span>
              {entry.task.deadline ? <span className="ml-auto flex items-center gap-1 text-[12px] text-ds-muted"><Clock size={12} aria-hidden="true" />
                {t('assistantDeadline', { time: new Date(entry.task.deadline).toLocaleString(language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</span> : null}
            </div>
            {entry.task.title ? <h3 className="text-[15px] font-semibold">{entry.task.title}</h3> : null}
            <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[21px] text-ds-ink">{entry.task.body}</p>
            <TaskProgress task={entry.task} />
            {entry.task.delivery?.receivedAt ? <p className="text-[12px] text-ds-muted">{t(entry.task.delivery.consumedAt ? 'assistantDeliveryConsumed' : 'assistantDeliveryDownloaded')}</p> : null}
            {entry.task.status === 'cancel_requested' ? <p role="status" className="text-[12px] text-amber-600">{t('assistantMailboxStatusCancelRequested')}</p> : null}
            {entry.task.cancellationError ? <p role="alert" className="text-[12px] text-ds-danger">{t('assistantCancellationNeedsAttention')}</p> : null}
            {isOpenAssistantTask(entry.task.status) && entry.task.status !== 'cancel_requested' ? <button type="button" disabled={busy} onClick={() => onCancel(entry.task)}
              className="self-start text-[11.5px] text-ds-muted transition hover:text-ds-danger disabled:opacity-50">{t('assistantMailboxCancelTask')}</button> : null}
          </div>
        </article> : entry.type === 'update' ? <article className="flex max-w-[600px] gap-2.5">
          <AssistantLogo kind={assistant.kind} name={assistant.name} icon={assistant.icon} size={30} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[12px]"><strong className="text-[12.5px]">{assistant.name}</strong>
              <span className={`font-semibold ${assistantStatusTone(entry.update.status)}`}>{t(assistantStatusKey(entry.update.status))}</span>
              <span className="text-ds-muted">{time(entry.at)} · {t('assistantReplyTo', { title: taskHeadline(entry.task.title, entry.task.body) })}</span></div>
            <div className={`${bubble} ${entry.update.status === 'blocked' ? 'border-amber-300/70' : 'border-ds-border-muted'}`}>{entry.update.body}</div>
            {entry.askReply ? <div className="flex gap-2">
              <button type="button" onClick={() => onReply(entry.task)} className="h-[30px] rounded-lg border border-accent-tint/40 bg-ds-card px-3 text-[12.5px] font-medium text-accent">{t('assistantReplyAction')}</button>
              <button type="button" disabled={busy} onClick={() => onCancel(entry.task)} className="h-[30px] rounded-lg border border-ds-border-muted bg-ds-card px-3 text-[12.5px] text-ds-muted">{t('assistantCancelThisTask')}</button>
            </div> : null}
          </div>
        </article> : entry.note.from === 'you' ? <article className="flex max-w-[520px] flex-col gap-1 self-end">
          <span className="self-end text-[12px] text-ds-muted">{t('roomsSidebarYou')} · {time(entry.at)}{entry.about ? ` · ${t('assistantReplyTo', { title: entry.about })}` : ''}</span>
          <div className="whitespace-pre-wrap break-words rounded-[16px_16px_6px_16px] border border-ds-border bg-ds-userbubble text-ds-userbubbleFg px-3.5 py-2.5 text-[13.5px] leading-[21px]">{entry.note.body}</div>
          {entry.note.delivery ? <span className="text-[11.5px] text-ds-muted">{t(`assistantNoteDelivery_${entry.note.delivery}`)}</span> : null}
        </article> : <article className="flex max-w-[600px] gap-2.5">
          <AssistantLogo kind={assistant.kind} name={assistant.name} icon={assistant.icon} size={30} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[12px]"><strong className="text-[12.5px]">{assistant.name}</strong>
              <span className="text-ds-muted">{time(entry.at)}{entry.about ? ` · ${t('assistantAbout', { title: entry.about })}` : ''}</span></div>
            {entry.note.title ? <strong className="text-[13.5px]">{entry.note.title}</strong> : null}
            {entry.note.body ? <div className={`${bubble} border-ds-border-muted`}>{entry.note.body}</div> : null}
          </div>
        </article>}
      </Fragment>
    })}
  </div>
}
