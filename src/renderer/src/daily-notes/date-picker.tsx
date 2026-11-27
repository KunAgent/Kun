import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { lunarLabel, monthCells, monthLabel, monthOf, noteDate, shiftDay, shiftMonth, weekdayLabels } from './calendar'
import type { DailyNotesCopy } from './copy'
import type { DaySummary } from './tasks'

type Props = {
  locale: string
  copy: DailyNotesCopy
  title: string
  selected: string
  today: string
  days: readonly string[]
  noteDays: ReadonlySet<string>
  summaries: Readonly<Record<string, DaySummary>>
  disabled: boolean
  onInspectMonth: (month: string) => void
  onPick: (day: string) => void
}

/** Page title that opens a Notion-style month popover for choosing the note day. */
export function DatePicker({
  locale, copy, title, selected, today, days, noteDays, summaries, disabled, onInspectMonth, onPick
}: Props) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => monthOf(selected))
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const yesterday = shiftDay(today, -1)

  useEffect(() => {
    if (open) onInspectMonth(month)
  }, [open, month, onInspectMonth])

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const pick = (day: string): void => {
    setOpen(false)
    if (day !== selected) onPick(day)
  }
  const toggle = (): void => {
    if (!open) setMonth(monthOf(selected))
    setOpen(!open)
  }

  const recentSaved = days.filter(day => day !== today && day !== yesterday).slice(0, 2)
  const shortDay = (day: string): string => {
    const sameYear = day.slice(0, 4) === today.slice(0, 4)
    return noteDate(day).toLocaleDateString(locale, sameYear ? { month: 'short', day: 'numeric' } : { dateStyle: 'short' })
  }

  return (
    <div className="note-date-picker" ref={root}>
      <h1>
        <button type="button" ref={trigger} className="note-title-button" disabled={disabled}
          aria-haspopup="dialog" aria-expanded={open} aria-label={copy.chooseDate + ': ' + title}
          data-selected-day={selected} onClick={toggle}>
          <span>{title}</span><ChevronDown size={20} aria-hidden />
        </button>
      </h1>
      {open && <div className="note-popover" role="dialog" aria-label={copy.chooseDate} data-month={month}>
        <div className="note-popover-head">
          <span>{monthLabel(locale, month)}</span>
          <button type="button" className="note-icon-button" aria-label={copy.previousMonth} title={copy.previousMonth}
            onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
          <button type="button" className="note-icon-button" aria-label={copy.nextMonth} title={copy.nextMonth}
            onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="note-mini-grid">
          {weekdayLabels(locale).map((label, index) => <span key={index} className="note-weekday-label" aria-hidden>{label}</span>)}
          {monthCells(month).map(({ day, inMonth }) => {
            const lunar = lunarLabel(locale, day)
            const summary = summaries[day]
            const hasNote = summary ? summary.hasContent : noteDays.has(day)
            const allDone = Boolean(summary && summary.total > 0 && summary.done === summary.total)
            return <button key={day} type="button" data-day={day}
              className={'note-mini-day' + (inMonth ? '' : ' is-outside') + (day === today ? ' is-today' : '') + (day === selected ? ' is-selected' : '')}
              aria-label={noteDate(day).toLocaleDateString(locale, { dateStyle: 'full' })}
              aria-current={day === today ? 'date' : undefined} aria-pressed={day === selected}
              title={lunar || undefined} onClick={() => pick(day)}>
              <span className="note-mini-num">{Number(day.slice(8))}</span>
              {hasNote && <i className={allDone ? 'is-done' : undefined} aria-hidden />}
            </button>
          })}
        </div>
        <div className="note-popover-foot">
          <button type="button" data-quick-day={today} className={selected === today ? 'is-active' : undefined}
            onClick={() => pick(today)}>{copy.today}</button>
          <button type="button" data-quick-day={yesterday} className={selected === yesterday ? 'is-active' : undefined}
            onClick={() => pick(yesterday)}>{copy.yesterday}</button>
          {recentSaved.map(day => <button key={day} type="button" data-quick-day={day}
            className={selected === day ? 'is-active' : undefined}
            onClick={() => pick(day)}>{shortDay(day)}</button>)}
        </div>
      </div>}
    </div>
  )
}
