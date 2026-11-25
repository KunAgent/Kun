import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown, ListTodo, Pin, PinOff } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import { localNoteDay, type DailyNotesApi, type DailyNotesContext } from '@shared/daily-notes'
import { dailyNotesCopy } from './copy'
import { insertDailyTask, NoteEditor } from './editor'

type Page = { day: string; initialText: string; markdown: string; pending?: Promise<void> }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function DailyNotesView({ api }: { api: DailyNotesApi }) {
  const [context, setContext] = useState<DailyNotesContext>()
  const [today, setToday] = useState(() => localNoteDay())
  const [days, setDays] = useState<string[]>([])
  const [page, setPage] = useState<Page>()
  const [busy, setBusy] = useState(true)
  const [status, setStatus] = useState<SaveState>('idle')
  const [loadFailure, setLoadFailure] = useState<string | null>(null)
  const [pinFailed, setPinFailed] = useState(false)
  const current = useRef<Page | undefined>(undefined)
  const todayRef = useRef(today)
  const closing = useRef(false)
  const navigation = useRef(0)
  const editor = useRef<EditorView | null>(null)
  const locale = context?.locale ?? navigator.language.split('-')[0]
  const copy = dailyNotesCopy(locale)

  const edit = useCallback((day: string, markdown: string) => {
    const target = current.current
    if (!target || day !== target.day) return
    target.markdown = markdown
    setStatus('saving')
    const pending = api.save(day, markdown)
    target.pending = pending
    void pending.then(() => {
      if (target.pending !== pending) return
      target.pending = undefined
      if (current.current !== target) return
      setStatus('saved')
      setDays(previous => previous.includes(day) ? previous : [...previous, day].sort().reverse())
    }, () => {
      if (target.pending === pending && current.current === target) setStatus('error')
    })
  }, [api])

  const finishEditing = useCallback(async (): Promise<boolean> => {
    // Blur commits native composition. Let the editor process the DOM change
    // before taking its final save promise.
    editor.current?.contentDOM.blur()
    await new Promise(resolve => setTimeout(resolve, 0))
    const target = current.current
    while (target?.pending) {
      const pending = target.pending
      try {
        await pending
      } catch {
        if (pending === target.pending) return false
      }
    }
    return true
  }, [])

  const openDay = useCallback(async (day: string) => {
    if (closing.current) return
    const request = ++navigation.current
    setBusy(true)
    setLoadFailure(null)
    try {
      if (!await finishEditing()) return
      const markdown = await api.read(day)
      if (request !== navigation.current || closing.current) return
      const next = { day, initialText: markdown, markdown }
      current.current = next
      setPage(next)
      setStatus(markdown ? 'saved' : 'idle')
    } catch {
      if (request === navigation.current) setLoadFailure(day)
    } finally {
      if (request === navigation.current && !closing.current) setBusy(false)
    }
  }, [api, finishEditing])

  const initialize = useCallback(async () => {
    setBusy(true)
    setLoadFailure(null)
    try {
      const [appearance, history] = await Promise.all([api.context(), api.listDays()])
      setContext(appearance)
      setDays(history)
      await openDay(localNoteDay())
    } catch {
      setLoadFailure('initial')
      setBusy(false)
    }
  }, [api, openDay])

  useEffect(() => {
    const unsubscribe = api.onCloseRequest(async () => {
      closing.current = true
      setBusy(true)
      const saved = await finishEditing()
      if (!saved) { closing.current = false; setBusy(false) }
      return saved
    })
    void initialize()
    return unsubscribe
  }, [api, initialize, finishEditing])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const checkDay = (): void => {
      clearTimeout(timer)
      const now = new Date()
      const day = localNoteDay(now)
      if (todayRef.current !== day) {
        const wasToday = current.current?.day === todayRef.current
        todayRef.current = day
        setToday(day)
        if (wasToday) void openDay(day)
      }
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer = setTimeout(checkDay, midnight.getTime() - now.getTime() + 50)
    }
    checkDay()
    window.addEventListener('focus', checkDay)
    return () => { clearTimeout(timer); window.removeEventListener('focus', checkDay) }
  }, [openDay])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dataset.theme = context?.theme ?? 'system'
    document.title = copy.title + ' · Kun'
  }, [locale, context?.theme, copy.title])

  const setPinned = async (): Promise<void> => {
    if (!context?.canPin) return
    try {
      const pinned = await api.setPinned(!context.pinned)
      setContext(previous => previous && { ...previous, pinned })
      setPinFailed(false)
    } catch { setPinFailed(true) }
  }
  const selected = page?.day ?? today
  const date = new Date(selected + 'T12:00:00')
  const options = [...new Set([today, selected, ...days])].sort().reverse()
  const pinLabel = context?.pinned ? copy.unpin : copy.pin
  const weekday = date.toLocaleDateString(locale, { weekday: 'long' })

  return (
    <div className="daily-notes">
      <header className="note-header">
        <div className="note-date">
          <span className="note-weekday"><CalendarDays size={14} aria-hidden />{selected === today ? copy.today + ' · ' : ''}{weekday}</span>
          <div className="note-date-choice">
            <h1>{date.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}</h1>
            <ChevronDown size={15} aria-hidden />
            <select aria-label={copy.chooseDate} title={copy.chooseDate} value={selected} disabled={busy || !context}
              onChange={event => void openDay(event.target.value)}>
              {options.map(day => <option key={day} value={day}>
                {day === today ? copy.today + ' · ' : ''}{new Date(day + 'T12:00:00').toLocaleDateString(locale, { dateStyle: 'long' })}
              </option>)}
            </select>
          </div>
        </div>
        <div className="note-actions">
          <button type="button" title={copy.addTask} aria-label={copy.addTask} disabled={!page || busy}
            onClick={() => { if (editor.current) insertDailyTask(editor.current) }}><ListTodo size={17} /></button>
          {context?.canPin && <button type="button" aria-pressed={context.pinned} title={pinLabel} aria-label={pinLabel}
            onClick={() => void setPinned()}>{context.pinned ? <Pin size={16} /> : <PinOff size={16} />}</button>}
        </div>
      </header>
      <main className="note-body" inert={busy} aria-busy={busy}>
        {page && <NoteEditor key={page.day} day={page.day} initialText={page.initialText} copy={copy} viewRef={editor} onEdit={edit} />}
      </main>
      <footer className="note-footer" aria-live="polite">
        {loadFailure !== null ? <>
          <span role="alert">{copy.loadFailed}</span>
          <button onClick={() => void (loadFailure === 'initial' ? initialize() : openDay(loadFailure))}>{copy.retry}</button>
        </> : status === 'error' && page ? <>
          <span role="alert">{copy.saveFailed}</span><button onClick={() => edit(page.day, page.markdown)}>{copy.retry}</button>
        </> : pinFailed ? <span role="alert">{copy.pinFailed}</span>
          : status === 'saving' ? copy.saving : status === 'saved' ? <><Check size={13} />{copy.saved}</> : null}
      </footer>
    </div>
  )
}
