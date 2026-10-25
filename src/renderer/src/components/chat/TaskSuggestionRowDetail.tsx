import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskSuggestionActionInput, TaskSuggestionActionName, TaskSuggestionTaskView } from '@shared/task-suggestions'
import { briefFromDraft, taskRowEditable } from './task-suggestion-card-model'

const field = 'w-full rounded-lg border border-ds-border bg-ds-card px-2.5 py-2 text-[12.5px] leading-5 text-ds-ink focus:border-accent focus:outline-none'

function Switch({ checked, disabled, label, onChange }: {
  checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void
}) {
  return <label className={`inline-flex items-center gap-2 text-[12px] text-ds-muted ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-4 w-[26px] shrink-0 rounded-full transition ${checked ? 'bg-accent' : 'bg-ds-border'}`}>
      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? 'left-3' : 'left-0.5'}`} />
    </button>
    {label}
  </label>
}

/**
 * The brief behind one row. It becomes the task session's first message, so
 * the user can read and correct it before starting; options apply per task.
 */
export function TaskSuggestionRowDetail({ task, locked, busy, act }: {
  task: TaskSuggestionTaskView
  locked: boolean
  busy: boolean
  act: (action: TaskSuggestionActionName, input?: TaskSuggestionActionInput) => Promise<unknown>
}) {
  const { t } = useTranslation('common')
  const editable = !locked && taskRowEditable(task)
  const [draft, setDraft] = useState<{ goal: string; scope: string; done: string }>()
  const update = (changes: TaskSuggestionActionInput['changes']) => act('update', { taskId: task.id, changes })
  const save = async () => {
    const brief = draft ? briefFromDraft(draft) : null
    if (!brief) return
    if (await update({ brief })) setDraft(undefined)
  }
  const section = (label: string, body: ReactNode) => <div>
    <h5 className="mb-0.5 text-[11.5px] font-semibold text-ds-muted">{label}</h5>{body}
  </div>
  return <div className="flex flex-col gap-2.5 border-t border-ds-border-muted bg-ds-subtle px-4 pb-3 pl-12 pt-2.5"
    data-task-suggestion-detail={task.id}>
    {draft ? <div className="flex flex-col gap-2">
      <label className="text-[11.5px] font-semibold text-ds-muted">{t('taskSuggestion.brief.goal')}
        <textarea rows={3} value={draft.goal} className={`${field} mt-1`}
          onChange={(event) => setDraft({ ...draft, goal: event.target.value })} />
      </label>
      <label className="text-[11.5px] font-semibold text-ds-muted">{t('taskSuggestion.brief.scope')}
        <textarea rows={3} value={draft.scope} placeholder={t('taskSuggestion.brief.listHint')} className={`${field} mt-1`}
          onChange={(event) => setDraft({ ...draft, scope: event.target.value })} />
      </label>
      <label className="text-[11.5px] font-semibold text-ds-muted">{t('taskSuggestion.brief.done')}
        <textarea rows={3} value={draft.done} placeholder={t('taskSuggestion.brief.listHint')} className={`${field} mt-1`}
          onChange={(event) => setDraft({ ...draft, done: event.target.value })} />
      </label>
    </div> : <>
      {section(t('taskSuggestion.brief.goal'), <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.6] text-ds-ink">{task.brief.goal}</p>)}
      {task.brief.scope.length ? section(t('taskSuggestion.brief.scope'), <ul className="list-disc pl-4 text-[12.5px] leading-[1.6] text-ds-ink">
        {task.brief.scope.map((entry, index) => <li key={index} className="break-words">{entry}</li>)}
      </ul>) : null}
      {task.brief.done.length ? section(t('taskSuggestion.brief.done'), <ul className="list-disc pl-4 text-[12.5px] leading-[1.6] text-ds-ink">
        {task.brief.done.map((entry, index) => <li key={index} className="break-words">{entry}</li>)}
      </ul>) : null}
    </>}
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-0.5">
      <Switch checked={task.worktree} disabled={!editable || busy} label={t('taskSuggestion.options.worktree')}
        onChange={(worktree) => void update({ worktree })} />
      <Switch checked={task.inheritContext} disabled={!editable || busy} label={t('taskSuggestion.options.inheritContext')}
        onChange={(inheritContext) => void update({ inheritContext })} />
      {editable ? <span className="ml-auto inline-flex gap-1.5">
        {draft ? <>
          <button type="button" disabled={busy} onClick={() => setDraft(undefined)}
            className="inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
            {t('taskSuggestion.brief.cancel')}</button>
          <button type="button" disabled={busy || !draft.goal.trim()} onClick={() => void save()}
            className="inline-flex h-7 items-center rounded-lg bg-accent px-2.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50">
            {t('taskSuggestion.brief.save')}</button>
        </> : <button type="button" disabled={busy} data-task-brief-edit
          onClick={() => setDraft({ goal: task.brief.goal, scope: task.brief.scope.join('\n'), done: task.brief.done.join('\n') })}
          className="inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
          {t('taskSuggestion.brief.edit')}</button>}
      </span> : null}
    </div>
  </div>
}
