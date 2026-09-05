import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  PROJECT_BOARD_CATEGORIES,
  type ProjectBoardCard,
  type ProjectBoardCategory,
  type ProjectBoardPriority,
  type ProjectBoardStatus
} from '../../project-board/project-board-types'

export type ProjectBoardCardDraft = {
  title: string
  description: string
  status: ProjectBoardStatus
  category: ProjectBoardCategory | null
  priority: ProjectBoardPriority
}

type Props = {
  card?: ProjectBoardCard | null
  initialStatus: ProjectBoardStatus
  busy: boolean
  onClose: () => void
  onSubmit: (draft: ProjectBoardCardDraft) => Promise<void>
}

export function ProjectBoardCardDialog(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const [draft, setDraft] = useState<ProjectBoardCardDraft>(() => draftFor(props.card, props.initialStatus))
  const [error, setError] = useState('')
  useEffect(() => setDraft(draftFor(props.card, props.initialStatus)), [props.card, props.initialStatus])
  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault()
    if (!draft.title.trim() && props.card?.kind !== 'thread_todo') {
      setError(t('projectBoardTitleRequired'))
      return
    }
    setError('')
    await props.onSubmit({ ...draft, title: draft.title.trim() })
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') props.onClose()
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submit()
    }
  }
  const isPlan = props.card?.kind === 'thread_todo'
  return (
    <div className="ds-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" onKeyDown={onKeyDown}>
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl border border-ds-border-muted bg-ds-card p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ds-ink">
            {t(props.card ? 'projectBoardEditTask' : 'projectBoardNewTask')}
          </h2>
          <button type="button" onClick={props.onClose} aria-label={t('close')} className="rounded-lg p-1.5 text-ds-muted hover:bg-ds-main">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="mt-4 block text-xs font-medium text-ds-muted">
          {t('projectBoardTaskTitle')}
          <input
            autoFocus={!isPlan}
            disabled={isPlan}
            value={draft.title}
            maxLength={300}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            className="mt-1.5 h-10 w-full rounded-xl border border-ds-border-muted bg-ds-main px-3 text-sm text-ds-ink outline-none focus:border-accent disabled:opacity-60"
          />
          {isPlan ? <span className="mt-1 block font-normal text-ds-faint">{t('projectBoardPlanTitleReadOnly')}</span> : null}
        </label>
        <label className="mt-3 block text-xs font-medium text-ds-muted">
          {t('projectBoardDescription')}
          <textarea
            value={draft.description}
            maxLength={2000}
            rows={4}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            className="mt-1.5 w-full resize-none rounded-xl border border-ds-border-muted bg-ds-main px-3 py-2 text-sm text-ds-ink outline-none focus:border-accent"
          />
        </label>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label={t('projectBoardStatus')} value={draft.status} disabled={isPlan} onChange={(value) => setDraft({ ...draft, status: value as ProjectBoardStatus })}>
            <option value="pending">{t('projectBoardPending')}</option>
            <option value="in_progress">{t('projectBoardInProgress')}</option>
            <option value="completed">{t('projectBoardCompleted')}</option>
          </Select>
          <Select label={t('projectBoardCategory')} value={draft.category ?? ''} onChange={(value) => setDraft({ ...draft, category: value ? value as ProjectBoardCategory : null })}>
            <option value="">{isPlan ? t('projectBoardPlan') : t('projectBoardNone')}</option>
            {PROJECT_BOARD_CATEGORIES.map((category) => <option key={category} value={category}>{t(`projectBoardCategory_${category}`)}</option>)}
          </Select>
          <Select label={t('projectBoardPriority')} value={draft.priority ?? ''} onChange={(value) => setDraft({ ...draft, priority: value ? value as ProjectBoardPriority : null })}>
            <option value="">{t('projectBoardNone')}</option>
            <option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option>
          </Select>
        </div>
        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="rounded-xl border border-ds-border-muted px-4 py-2 text-sm text-ds-muted hover:bg-ds-main">
            {t('projectBoardCancel')}
          </button>
          <button type="submit" disabled={props.busy} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {props.busy ? t('projectBoardSaving') : t('projectBoardSave')}
          </button>
        </div>
      </form>
    </div>
  )
}

function Select(props: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  children: ReactNode
}): ReactElement {
  return (
    <label className="text-xs font-medium text-ds-muted">
      {props.label}
      <select disabled={props.disabled} value={props.value} onChange={(event) => props.onChange(event.target.value)} className="mt-1.5 h-9 w-full rounded-xl border border-ds-border-muted bg-ds-main px-2 text-xs text-ds-ink outline-none focus:border-accent disabled:opacity-60">
        {props.children}
      </select>
    </label>
  )
}

function draftFor(card: ProjectBoardCard | null | undefined, status: ProjectBoardStatus): ProjectBoardCardDraft {
  return card ? {
    title: card.title,
    description: card.description,
    status: card.status,
    category: card.category === 'plan' ? null : card.category,
    priority: card.priority
  } : { title: '', description: '', status, category: 'other', priority: null }
}
