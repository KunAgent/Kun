import { useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { DailyNoteLinkSummary } from '@shared/daily-notes'
import { lunarInfo, monthCells, monthLabel, monthOf, noteDate, shiftMonth, weekdayLabels } from './calendar'
import type { DailyNotesCopy } from './copy'
import { TaskLinkControls } from './link-pill'
import {
  appendTaskChange, linkChange, parseTasks, QUADRANT_NUMERALS, toggleChange,
  type DaySummary, type NoteChange, type NoteTask
} from './tasks'

type Props = {
  locale: string
  copy: DailyNotesCopy
  month: string
  selected: string
  today: string
  dayTitle: string
  noteDays: ReadonlySet<string>
  summaries: Readonly<Record<string, DaySummary>>
  linkSummaries: Readonly<Record<string, DailyNoteLinkSummary>>
  canSend: boolean
  canStartSession?: boolean
  markdown: string
  disabled: boolean
  onChangeMonth: (month: string) => void
  onPickDay: (day: string) => void
  onOpenPage: (day: string, focusLine?: number) => void
  onChange: (change: NoteChange) => void
  onSendTask: (task: NoteTask, draftOnly: boolean) => void
  onStartSession?: (task: NoteTask) => void
  onOpenLink: (url: string) => void
}

function dayBars(summary: DaySummary | undefined, existsOnDisk: boolean): boolean[] {
  if (summary && summary.total > 0) {
    const count = Math.min(3, summary.total)
    const filled = summary.done === 0 ? 0
      : summary.done === summary.total ? count
      : Math.min(count - 1, Math.max(1, Math.round((summary.done / summary.total) * count)))
    return Array.from({ length: count }, (_, index) => index < filled)
  }
  if (summary ? summary.hasContent : existsOnDisk) return [false]
  return []
}

export function CalendarView({
  locale, copy, month, selected, today, dayTitle, noteDays, summaries,
  linkSummaries, canSend, canStartSession = false, markdown, disabled, onChangeMonth, onPickDay,
  onOpenPage, onChange, onSendTask, onStartSession, onOpenLink
}: Props) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const draftRef = useRef('')
  const tasks = parseTasks(markdown)
  const prose = tasks.length === 0 ? markdown.trim() : ''

  const updateDraft = (value: string): void => {
    draftRef.current = value
    setDraft(value)
  }

  const commitDraft = (keepOpen: boolean): void => {
    const trimmed = draftRef.current.trim()
    draftRef.current = ''
    setDraft('')
    if (trimmed) onChange(appendTaskChange(markdown, trimmed, null))
    if (!keepOpen) setAdding(false)
  }

  return (
    <main className="note-calendar" inert={disabled} aria-busy={disabled}>
      <div className="note-month-head">
        <h2>{monthLabel(locale, month)}</h2>
        <button type="button" className="note-icon-button" disabled={disabled}
          aria-label={copy.previousMonth} title={copy.previousMonth}
          onClick={() => onChangeMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
        <button type="button" className="note-month-today" disabled={disabled}
          onClick={() => { onChangeMonth(monthOf(today)); onPickDay(today) }}>{copy.today}</button>
        <button type="button" className="note-icon-button" disabled={disabled}
          aria-label={copy.nextMonth} title={copy.nextMonth}
          onClick={() => onChangeMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
      </div>

      <div className="note-month-grid">
        {weekdayLabels(locale).map((label, index) => (
          <span key={index} className="note-weekday-label" aria-hidden>{label}</span>
        ))}
        {monthCells(month).map(({ day, inMonth }) => {
          const lunar = lunarInfo(locale, day)
          const bars = dayBars(summaries[day], noteDays.has(day))
          return (
            <button key={day} type="button" data-calendar-day={day}
              className={'note-month-cell' + (inMonth ? '' : ' is-outside') + (day === today ? ' is-today' : '') + (day === selected ? ' is-selected' : '')}
              aria-label={noteDate(day).toLocaleDateString(locale, { dateStyle: 'full' })}
              aria-current={day === today ? 'date' : undefined}
              aria-pressed={day === selected}
              onClick={() => onPickDay(day)}
              onDoubleClick={() => onOpenPage(day)}>
              <span className="note-month-num">{Number(day.slice(8))}</span>
              {lunar && <small className={lunar.isMonthStart ? 'is-lunar-month' : undefined}>{lunar.text}</small>}
              {bars.length > 0 && (
                <span className="note-day-bars" aria-hidden>
                  {bars.map((done, index) => <i key={index} className={done ? 'is-done' : undefined} />)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <section className="note-day-pane" aria-label={dayTitle}>
        <header className="note-day-pane-head">
          <strong>{dayTitle}</strong>
          {selected === today && <span className="note-chip">{copy.today}</span>}
          <button type="button" className="note-open-page" disabled={disabled}
            onClick={() => onOpenPage(selected)}>
            <span>{copy.openPage}</span><ArrowRight size={13} aria-hidden />
          </button>
        </header>

        {tasks.length > 0 ? (
          <div className="note-day-tasks">
            {tasks.map(task => {
              const label = task.text || copy.task
              return (
                <div key={task.line} className="note-day-task">
                  <input type="checkbox" className="note-checkbox" checked={task.done} disabled={disabled}
                    aria-label={label} onChange={() => onChange(toggleChange(task))} />
                  <span className={'note-task-body' + (task.done ? ' note-completed' : '')}>{label}</span>
                  {task.subLineCount > 0 && (
                    <button
                      type="button"
                      className="note-subnote-badge"
                      disabled={disabled}
                      title={copy.subnoteCount.replace('{{count}}', String(task.subLineCount))}
                      aria-label={`${label}: ${copy.zoomIn}`}
                      onClick={() => onOpenPage(selected, task.line)}
                    >
                      {task.subLineCount}
                    </button>
                  )}
                  <TaskLinkControls task={task} summary={task.link ? linkSummaries[task.link.url] : undefined}
                    copy={copy} disabled={disabled} canSend={canSend} canStartSession={canStartSession}
                    onSendToKun={onSendTask} onStartSession={onStartSession} onOpenLink={onOpenLink}
                    onMarkDone={(target, done = true) => onChange(toggleChange(target, done))}
                    onUnlink={target => onChange(linkChange(target, null))} />
                  {task.quadrant && (
                    <span className={`note-quadrant note-q${task.quadrant}`}>{QUADRANT_NUMERALS[task.quadrant]}</span>
                  )}
                </div>
              )
            })}
          </div>
        ) : prose ? (
          <p className="note-prose-preview">{prose}</p>
        ) : (
          <p className="note-empty-day">{copy.noTasks}</p>
        )}

        {adding ? (
          <input type="text" className="note-inline-input" autoFocus value={draft}
            placeholder={copy.newTaskPlaceholder} aria-label={copy.addTask}
            onChange={event => updateDraft(event.target.value)}
            onBlur={() => commitDraft(false)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                commitDraft(Boolean(draftRef.current.trim()))
              } else if (event.key === 'Escape') {
                event.preventDefault()
                updateDraft('')
                setAdding(false)
              }
            }} />
        ) : (
          <button type="button" className="note-add note-day-add" disabled={disabled}
            onClick={() => setAdding(true)}><Plus size={15} aria-hidden />{copy.addTask}</button>
        )}
      </section>
    </main>
  )
}
