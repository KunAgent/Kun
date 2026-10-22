import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssistantNoteView, AssistantTaskView } from '@shared/assistant-mailbox'
import { RemoteGroup, RemoteSection } from '../remote-panel-ui'
import {
  assistantStatusKey, assistantStatusTone, isOpenAssistantTask, relativeTime, taskHeadline
} from './assistant-mailbox-format'

const clamp = 'line-clamp-3 whitespace-pre-wrap break-words text-[12px] leading-4 text-ds-muted'

/** Recent tasks with their latest report, and notes the assistants sent on their own. */
export function AssistantTaskRows({
  tasks,
  notes,
  busy,
  onCancel
}: {
  tasks: AssistantTaskView[]
  notes: AssistantNoteView[]
  busy: boolean
  onCancel: (taskId: string) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  return (
    <>
      <RemoteSection title={t('assistantMailboxTasks')}>
        {tasks.length === 0 ? (
          <p className="px-1 text-[12px] text-ds-muted">{t('assistantMailboxNoTasks')}</p>
        ) : (
          <RemoteGroup>
            {tasks.slice(0, 8).map((task) => {
              const latest = task.updates[task.updates.length - 1]
              return (
                <div key={task.id} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ds-ink">{taskHeadline(task.title, task.body)}</span>
                    <span className={`shrink-0 rounded-md px-1.5 py-px text-[11px] font-medium ${assistantStatusTone(task.status)}`}>
                      {t(assistantStatusKey(task.status))}
                    </span>
                  </div>
                  <div className="text-[11px] text-ds-faint">
                    {task.assistantName} · {relativeTime(task.updatedAt, i18n.language || 'en')}
                  </div>
                  {latest?.body ? <p className={clamp}>{latest.body}</p> : null}
                  {isOpenAssistantTask(task.status) ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onCancel(task.id)}
                      className="self-start text-[11px] text-ds-muted transition hover:text-ds-danger disabled:opacity-50"
                    >
                      {t('assistantMailboxCancelTask')}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </RemoteGroup>
        )}
      </RemoteSection>
      {notes.length > 0 ? (
        <RemoteSection title={t('assistantMailboxNotes')}>
          <RemoteGroup>
            {notes.slice(0, 5).map((note) => (
              <div key={note.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="text-[11px] text-ds-faint">{note.assistantName} · {relativeTime(note.at, i18n.language || 'en')}</div>
                {note.title ? <div className="text-[13px] font-medium text-ds-ink">{note.title}</div> : null}
                {note.body ? <p className={clamp}>{note.body}</p> : null}
              </div>
            ))}
          </RemoteGroup>
        </RemoteSection>
      ) : null}
    </>
  )
}
