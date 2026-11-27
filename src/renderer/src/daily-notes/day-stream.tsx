import { useEffect, useState } from 'react'
import type { DailyNoteLinkSummary, DailyNotesApi } from '@shared/daily-notes'
import { noteDate, shiftDay } from './calendar'
import type { DailyNotesCopy } from './copy'
import {
  applyNoteChange, parseTasks, QUADRANT_NUMERALS, toggleChange, type NoteTask
} from './tasks'

type Props = {
  api: DailyNotesApi
  locale: string
  today: string
  selected: string
  days: readonly string[]
  summaries: Readonly<Record<string, DailyNoteLinkSummary>>
  copy: DailyNotesCopy
  disabled: boolean
  externalTick: number
  onOpenDay: (day: string, focusTaskLine?: number) => void
  onOpenLink: (url: string) => void
}

const INITIAL_LIMIT = 4

export function EarlierDayStream({
  api,
  locale,
  today,
  selected,
  days,
  summaries,
  copy,
  disabled,
  externalTick,
  onOpenDay,
  onOpenLink
}: Props) {
  const [limit, setLimit] = useState(INITIAL_LIMIT)
  const [contents, setContents] = useState<Record<string, string>>({})

  const candidateDays = days.filter(day => day < selected)
  const visibleCandidates = candidateDays.slice(0, limit)
  const candidatesKey = visibleCandidates.join(',')

  useEffect(() => {
    setLimit(INITIAL_LIMIT)
  }, [selected])

  useEffect(() => {
    if (!candidatesKey) return
    let cancelled = false
    const list = candidatesKey.split(',')
    void Promise.all(list.map(async day => [day, await api.read(day).catch(() => '')] as const)).then(entries => {
      if (cancelled) return
      setContents(prev => {
        const next = { ...prev }
        for (const [day, text] of entries) next[day] = text
        return next
      })
    })
    return () => { cancelled = true }
  }, [api, candidatesKey, externalTick])

  const yesterday = shiftDay(today, -1)
  const nonEmptyDays = visibleCandidates.filter(day => (contents[day] ?? '').trim().length > 0)
  if (nonEmptyDays.length === 0 && candidateDays.length <= limit) return null

  const formatDayHeader = (day: string): { main: string; tag?: string } => {
    const d = noteDate(day)
    const sameYear = day.slice(0, 4) === today.slice(0, 4)
    const datePart = d.toLocaleDateString(locale, sameYear ? { month: 'long', day: 'numeric' } : { dateStyle: 'medium' })
    const weekday = d.toLocaleDateString(locale, { weekday: 'short' })
    return {
      main: `${datePart} ${weekday}`,
      tag: day === yesterday ? copy.yesterday : undefined
    }
  }

  const toggleStreamTask = async (day: string, task: NoteTask): Promise<void> => {
    const current = contents[day]
    if (typeof current !== 'string' || disabled) return
    const next = applyNoteChange(current, toggleChange(task))
    setContents(prev => ({ ...prev, [day]: next }))
    await api.save(day, next).catch(() => {
      setContents(prev => ({ ...prev, [day]: current }))
    })
  }

  return (
    <section className="note-day-stream" aria-label={copy.loadMoreDays}>
      {nonEmptyDays.map(day => {
        const markdown = contents[day] ?? ''
        const tasks = parseTasks(markdown)
        const header = formatDayHeader(day)
        const proseLines = tasks.length === 0
          ? markdown.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 4)
          : []

        return (
          <article key={day} className="note-stream-day" data-stream-day={day}>
            <header className="note-stream-head">
              <button
                type="button"
                className="note-stream-date-btn"
                disabled={disabled}
                onClick={() => onOpenDay(day)}
              >
                <strong>{header.main}</strong>
                {header.tag && <span className="note-stream-tag">{header.tag}</span>}
              </button>
            </header>

            {tasks.length > 0 ? (
              <div className="note-stream-tasks">
                {tasks.map(task => {
                  const linkSummary = task.link ? summaries[task.link.url] : undefined
                  const linkText = task.link ? (linkSummary?.statusText || task.link.label) : ''
                  const linkTone = linkSummary?.tone ?? 'idle'
                  return (
                    <div
                      key={task.line}
                      className="note-stream-row"
                      style={task.indent > 0 ? { paddingLeft: `${Math.min(task.indent, 8) * 8}px` } : undefined}
                    >
                      <button
                        type="button"
                        className={'note-bullet-dot' + (task.subLineCount > 0 ? ' is-ringed' : '')}
                        disabled={disabled}
                        title={copy.zoomIn}
                        aria-label={`${day} ${task.text || copy.task}: ${copy.zoomIn}`}
                        onClick={() => onOpenDay(day, task.line)}
                      >
                        <i aria-hidden />
                      </button>
                      <button
                        type="button"
                        className={'note-stream-check' + (task.done ? ' is-checked' : '')}
                        disabled={disabled}
                        aria-pressed={task.done}
                        aria-label={`${day}: ${task.text || copy.task}`}
                        onClick={() => void toggleStreamTask(day, task)}
                      />
                      <button
                        type="button"
                        className={'note-stream-task-text' + (task.done ? ' note-completed' : '')}
                        disabled={disabled}
                        onClick={() => onOpenDay(day, task.subLineCount > 0 ? task.line : undefined)}
                      >
                        {task.text || copy.task}
                      </button>
                      {task.subLineCount > 0 && (
                        <button
                          type="button"
                          className="note-subnote-badge"
                          disabled={disabled}
                          title={copy.subnoteCount.replace('{{count}}', String(task.subLineCount))}
                          onClick={() => onOpenDay(day, task.line)}
                        >
                          {task.subLineCount}
                        </button>
                      )}
                      {task.link && (
                        <button
                          type="button"
                          className={`note-link-pill is-${linkTone}`}
                          disabled={disabled}
                          onClick={() => onOpenLink(task.link!.url)}
                        >
                          <i aria-hidden />
                          <span>{linkText}</span>
                        </button>
                      )}
                      {task.quadrant && (
                        <span className={`note-quadrant note-q${task.quadrant}`} aria-hidden>
                          {QUADRANT_NUMERALS[task.quadrant]}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="note-stream-prose" onClick={() => { if (!disabled) onOpenDay(day) }}>
                {proseLines.map((line, idx) => <p key={idx}>{line}</p>)}
              </div>
            )}
          </article>
        )
      })}

      {candidateDays.length > limit && (
        <button
          type="button"
          className="note-stream-more"
          disabled={disabled}
          onClick={() => setLimit(current => current + 6)}
        >
          {copy.loadMoreDays}
        </button>
      )}
    </section>
  )
}
