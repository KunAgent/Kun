import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  Bot, Calendar, ChevronLeft, ChevronRight, FileText,
  LayoutGrid, PanelLeft, PictureInPicture2, Pin, PinOff, Plus, X
} from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import {
  localNoteDay,
  type DailyNoteLinkSummary,
  type DailyNotesApi,
  type DailyNotesContext,
  type DailyNoteViewMode
} from '@shared/daily-notes'
import { monthCells, monthOf, noteDate, shiftDay } from './calendar'
import { CalendarView } from './calendar-view'
import { dailyNotesCopy } from './copy'
import { DatePicker } from './date-picker'
import { EarlierDayStream } from './day-stream'
import { insertDailyTask, NoteEditor } from './editor'
import { FocusTaskView } from './focus-view'
import { StartSessionDialog } from './mention-menu'
import { QuadrantView } from './quadrant-view'
import {
  appendTaskChange, applyNoteChange, countTasks, formatKunRoomUrl, formatKunThreadUrl,
  linkChange, parseTasks, summarizeDay, taskAt, type DaySummary, type NoteChange, type NoteTask
} from './tasks'
import { useNoteDraft } from './use-note-draft'

type ViewMode = DailyNoteViewMode

const THREAD_DRAG_MIME = 'application/x-kun-thread-id'

export type DailyNotesViewProps = {
  api: DailyNotesApi
  surface?: 'window' | 'docked'
  targetDay?: string | null
  targetViewMode?: ViewMode | null
  focusNonce?: number
  onPopout?: () => void
  onCloseDocked?: () => void
}

export function DailyNotesView({
  api,
  surface = 'window',
  targetDay = null,
  targetViewMode = null,
  focusNonce = 0,
  onPopout,
  onCloseDocked
}: DailyNotesViewProps) {
  const [context, setContext] = useState<DailyNotesContext>()
  const [today, setToday] = useState(() => localNoteDay())
  const [days, setDays] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>(() => targetViewMode ?? 'page')
  const [focusedLine, setFocusedLine] = useState<number | null>(null)
  const [startingTask, setStartingTask] = useState<NoteTask | null>(null)
  const [threadDropActive, setThreadDropActive] = useState(false)
  const [externalTick, setExternalTick] = useState(0)
  const [calendarMonth, setCalendarMonth] = useState(() => monthOf(localNoteDay()))
  const [summaries, setSummaries] = useState<Record<string, DaySummary>>({})
  const [linkSummaries, setLinkSummaries] = useState<Record<string, DailyNoteLinkSummary>>({})
  const [busy, setBusy] = useState(true)
  const [loadFailure, setLoadFailure] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pinFailed, setPinFailed] = useState(false)
  const todayRef = useRef(today)
  const closing = useRef(false)
  const navigation = useRef(0)
  const editor = useRef<EditorView | null>(null)
  const summariesRef = useRef<Record<string, DaySummary>>({})
  const loadingDays = useRef(new Set<string>())
  const noteDays = useMemo(() => new Set(days), [days])
  const noteDaysRef = useRef(noteDays)
  noteDaysRef.current = noteDays

  const locale = context?.locale ?? navigator.language.split('-')[0]
  const copy = dailyNotesCopy(locale)
  const canSend = typeof api.sendToKun === 'function'
  const canStartSession = typeof api.startThread === 'function'

  const recordSummary = useCallback((day: string, markdown: string) => {
    const summary = summarizeDay(markdown)
    summariesRef.current[day] = summary
    setSummaries(previous => ({ ...previous, [day]: summary }))
  }, [])

  const onSaved = useCallback((day: string) => {
    setDays(previous => previous.includes(day) ? previous : [...previous, day].sort().reverse())
  }, [])
  const { current, page, replace, edit, finish, refresh, retry, copyDraftAndReload } =
    useNoteDraft(api, surface, recordSummary, onSaved)
  const text = page?.markdown ?? ''
  const status = page?.status ?? 'idle'

  const ensureDaySummary = useCallback((day: string) => {
    if (!noteDaysRef.current.has(day) || summariesRef.current[day] || loadingDays.current.has(day)) return
    loadingDays.current.add(day)
    void api.read(day).then(({ markdown }) => {
      loadingDays.current.delete(day)
      if (current.current?.day === day || summariesRef.current[day]) return
      recordSummary(day, markdown)
    }, () => {
      loadingDays.current.delete(day)
    })
  }, [api, current, recordSummary])

  const inspectMonth = useCallback((month: string) => {
    for (const { day } of monthCells(month)) ensureDaySummary(day)
  }, [ensureDaySummary])

  const applyChange = useCallback((change: NoteChange) => {
    const target = current.current
    if (!target) return
    edit(target.day, applyNoteChange(target.markdown, change))
  }, [current, edit])

  const finishEditing = useCallback(async (): Promise<boolean> => {
    editor.current?.contentDOM.blur()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await new Promise(resolve => setTimeout(resolve, 0))
    return finish()
  }, [finish])

  const openDay = useCallback(async (day: string, focusTaskLine?: number) => {
    if (closing.current) return
    const request = ++navigation.current
    setBusy(true)
    setLoadFailure(null)
    setActionError(null)
    try {
      if (!await finishEditing()) return
      const note = await api.read(day)
      if (request !== navigation.current || closing.current) return
      replace(day, note)
      setFocusedLine(focusTaskLine ?? null)
      setCalendarMonth(monthOf(day))
    } catch {
      if (request === navigation.current) setLoadFailure(day)
    } finally {
      if (request === navigation.current && !closing.current) setBusy(false)
    }
  }, [api, finishEditing, replace])

  const initialize = useCallback(async () => {
    setBusy(true)
    setLoadFailure(null)
    try {
      const [appearance, history] = await Promise.all([api.context(), api.listDays()])
      setContext(appearance)
      setDays(history)
      await openDay(targetDay || localNoteDay())
    } catch {
      setLoadFailure('initial')
      setBusy(false)
    }
  }, [api, openDay, targetDay])

  useEffect(() => {
    const unsubscribeClose = api.onCloseRequest(async () => {
      closing.current = true
      setBusy(true)
      const saved = await finishEditing()
      if (!saved) { closing.current = false; setBusy(false) }
      return saved
    })
    const unsubscribeExternal = api.onExternalChange?.(event => {
      setDays(event.days)
      setExternalTick(tick => tick + 1)
      if (current.current?.day === event.day) {
        void refresh(event.day).catch(() => undefined)
      } else {
        void api.read(event.day).then(({ markdown }) => {
          if (current.current?.day !== event.day) recordSummary(event.day, markdown)
        }).catch(() => undefined)
      }
    })
    const unsubscribeSummaries = api.onLinkSummaries?.(incoming => {
      setLinkSummaries(previous => ({ ...previous, ...incoming }))
    })
    void initialize()
    return () => {
      unsubscribeClose()
      unsubscribeExternal?.()
      unsubscribeSummaries?.()
    }
  }, [api, current, initialize, finishEditing, recordSummary, refresh])

  useEffect(() => {
    if (!focusNonce) return
    if (targetViewMode) setViewMode(targetViewMode)
    if (targetDay && targetDay !== current.current?.day) {
      void openDay(targetDay)
    } else {
      editor.current?.focus()
    }
  }, [current, focusNonce, openDay, targetDay, targetViewMode])

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
  }, [current, openDay])

  useEffect(() => {
    if (viewMode === 'calendar') inspectMonth(calendarMonth)
  }, [viewMode, calendarMonth, days, inspectMonth])

  const parsedTasks = useMemo(() => parseTasks(text), [text])
  const watchedUrlKey = useMemo(
    () => [...new Set(parsedTasks.map(task => task.link?.url).filter((u): u is string => Boolean(u)))].join('\n'),
    [parsedTasks]
  )

  useEffect(() => {
    if (!api.watchLinks) return
    const urls = watchedUrlKey ? watchedUrlKey.split('\n') : []
    void api.watchLinks(urls).then(incoming => {
      if (Object.keys(incoming).length > 0) {
        setLinkSummaries(previous => ({ ...previous, ...incoming }))
      }
    }).catch(() => undefined)
  }, [api, watchedUrlKey])

  const previousNoteDay = useMemo(() => days.find(day => day < today) ?? null, [days, today])
  useEffect(() => {
    if (previousNoteDay) ensureDaySummary(previousNoteDay)
  }, [previousNoteDay, ensureDaySummary])

  useEffect(() => {
    if (surface !== 'window') return
    document.documentElement.lang = locale
    document.documentElement.dataset.theme = context?.theme ?? 'system'
    document.title = copy.title + ' · Kun'
  }, [locale, context?.theme, copy.title, surface])

  const setPinned = async (): Promise<void> => {
    if (!context?.canPin) return
    try {
      const pinned = await api.setPinned(!context.pinned)
      setContext(previous => previous && { ...previous, pinned })
      setPinFailed(false)
    } catch { setPinFailed(true) }
  }

  const switchView = (next: ViewMode): void => {
    if (next === viewMode && focusedLine === null) return
    editor.current?.contentDOM.blur()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    if (next === 'calendar') setCalendarMonth(monthOf(selected))
    setFocusedLine(null)
    setViewMode(next)
  }

  const selected = page?.day ?? today

  const handleDockToWorkbench = async (): Promise<void> => {
    if (!api.dockToWorkbench) return
    if (!await finishEditing()) return
    await api.dockToWorkbench({ day: selected, viewMode })
  }

  const recoverConflict = async (): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await copyDraftAndReload()
      setFocusedLine(null)
    } catch {
      setActionError(copy.conflictRecoveryFailed)
    } finally {
      setBusy(false)
    }
  }

  const sendTasksToKun = useCallback(async (items: NoteTask[], draftOnly: boolean) => {
    if (!api.sendToKun || items.length === 0) return
    setActionError(null)
    // Kun can bind a dispatch link as soon as the task is handed off.
    if (!await finishEditing()) return
    const ordered = [...items].sort((a, b) => (a.quadrant ?? 9) - (b.quadrant ?? 9) || a.line - b.line)
    const response = await api.sendToKun({
      mode: draftOnly ? 'draft' : 'send',
      items: ordered.map(task => ({
        day: selected,
        line: task.line,
        text: task.text,
        quadrant: task.quadrant,
        notes: task.notes
      }))
    })
    if (!response.ok || !response.roomId) {
      setActionError(response.error || copy.sendFailed)
      return
    }
    const target = current.current
    if (!target || target.day !== selected) return
    const url = formatKunRoomUrl(response.roomId, response.messageId)
    const label = response.agentLabel || copy.kunBadge
    let nextMarkdown = target.markdown
    for (const item of [...items].sort((a, b) => b.line - a.line)) {
      const fresh = taskAt(nextMarkdown, item.line)
      if (fresh && !fresh.link) {
        nextMarkdown = applyNoteChange(nextMarkdown, linkChange(fresh, { label, url }))
      }
    }
    if (nextMarkdown !== target.markdown) edit(target.day, nextMarkdown)
  }, [api, copy.kunBadge, copy.sendFailed, current, edit, finishEditing, selected])

  const sendLineToKun = useCallback((line: number, draftOnly: boolean) => {
    const target = current.current
    if (!target) return
    const found = taskAt(target.markdown, line)
    if (found && found.text) void sendTasksToKun([found], draftOnly)
  }, [current, sendTasksToKun])

  const openStartSessionLine = useCallback((line: number) => {
    const target = current.current
    if (!target) return
    const found = taskAt(target.markdown, line)
    if (found && found.text) setStartingTask(found)
  }, [current])

  const handleSessionStarted = useCallback((task: NoteTask, result: { threadId: string; label: string }) => {
    setStartingTask(null)
    const target = current.current
    if (!target || target.day !== selected) return
    const fresh = taskAt(target.markdown, task.line)
    if (!fresh) return
    const nextMarkdown = applyNoteChange(target.markdown, linkChange(fresh, {
      label: result.label.slice(0, 24) || copy.threadBadge,
      url: formatKunThreadUrl(result.threadId)
    }))
    if (nextMarkdown !== target.markdown) edit(target.day, nextMarkdown)
  }, [copy.threadBadge, current, edit, selected])

  const openTaskLink = useCallback((url: string) => {
    if (!api.openLink) return
    setActionError(null)
    void api.openLink(url).then(ok => {
      if (!ok) setActionError(copy.sendFailed)
    }).catch(() => setActionError(copy.sendFailed))
  }, [api, copy.sendFailed])

  const handleRollover = useCallback(async (fromDay: string) => {
    if (!api.rollover) return
    setActionError(null)
    setBusy(true)
    try {
      if (!await finishEditing()) return
      const result = await api.rollover(fromDay, today)
      recordSummary(fromDay, result.fromMarkdown)
      if (current.current?.day !== today) recordSummary(today, result.toMarkdown)
      setExternalTick(tick => tick + 1)
      await refresh(today)
      if (result.movedCount > 0) onSaved(today)
    } catch {
      setActionError(copy.saveFailed)
    } finally {
      setBusy(false)
    }
  }, [api, copy.saveFailed, current, finishEditing, onSaved, recordSummary, refresh, today])

  const hasDraggedThread = (event: DragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types).includes(THREAD_DRAG_MIME)

  const handleDropThread = async (event: DragEvent<HTMLElement>): Promise<void> => {
    if (!hasDraggedThread(event)) return
    event.preventDefault()
    setThreadDropActive(false)
    const threadId = event.dataTransfer.getData(THREAD_DRAG_MIME).trim()
    const target = current.current
    if (!threadId || !target) return
    const snapshot = await api.listTargets?.().catch(() => null)
    const matched = snapshot?.threads.find(item => item.id === threadId)
    const title = matched?.title.trim() || copy.task
    const label = (matched?.title.trim() || copy.threadBadge).slice(0, 24)
    const nextMarkdown = applyNoteChange(
      target.markdown,
      appendTaskChange(target.markdown, title, null, { label, url: formatKunThreadUrl(threadId) })
    )
    edit(target.day, nextMarkdown)
  }

  const date = noteDate(selected)
  const pinLabel = context?.pinned ? copy.unpin : copy.pin
  const sameYear = selected.slice(0, 4) === today.slice(0, 4)
  const label = date.toLocaleDateString(locale, sameYear ? { month: 'long', day: 'numeric' } : { dateStyle: 'medium' })
  const weekday = date.toLocaleDateString(locale, { weekday: 'short' })
  const title = `${label} ${weekday}`
  const dateSubtitle = selected === today ? `${label} · ${copy.today}` : title
  const tasks = countTasks(text)
  const unlinkedOpen = parsedTasks.filter(task => !task.done && !task.link && task.text.length > 0)
  const disabled = busy || !context

  const prevSummary = previousNoteDay ? summaries[previousNoteDay] : undefined
  const prevUnfinished = prevSummary ? prevSummary.total - prevSummary.done : 0
  const rolloverBanner = selected === today && previousNoteDay && prevUnfinished > 0 && api.rollover ? {
    text: copy.rolloverBanner
      .replace('{{day}}', noteDate(previousNoteDay).toLocaleDateString(
        locale,
        previousNoteDay.slice(0, 4) === today.slice(0, 4) ? { month: 'short', day: 'numeric' } : { dateStyle: 'short' }
      ))
      .replace('{{count}}', String(prevUnfinished)),
    action: copy.rolloverAction,
    onRollover: () => void handleRollover(previousNoteDay)
  } : null

  const focusEnd = (event: MouseEvent<HTMLElement>): void => {
    const view = editor.current
    if (event.target !== event.currentTarget || !view) return
    event.preventDefault()
    view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })
    view.focus()
  }

  return (
    <div
      className={'daily-notes' + (surface === 'docked' ? ' is-docked' : '') + (threadDropActive ? ' is-thread-drop' : '')}
      data-selected-day={selected}
      data-view={viewMode}
      data-surface={surface}
      onDragOver={event => {
        if (!hasDraggedThread(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        if (!threadDropActive) setThreadDropActive(true)
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setThreadDropActive(false)
      }}
      onDrop={event => void handleDropThread(event)}
    >
      <header className="note-header">
        <button type="button" className="note-icon-button" title={copy.previousDay} aria-label={copy.previousDay}
          disabled={disabled} onClick={() => void openDay(shiftDay(selected, -1))}><ChevronLeft size={17} /></button>
        <button type="button" className="note-icon-button" title={copy.nextDay} aria-label={copy.nextDay}
          disabled={disabled} onClick={() => void openDay(shiftDay(selected, 1))}><ChevronRight size={17} /></button>
        {selected !== today && viewMode !== 'calendar' && (
          <button type="button" className="note-text-button" title={copy.backToToday}
            aria-label={copy.backToToday} disabled={disabled} onClick={() => void openDay(today)}>{copy.today}</button>
        )}
        <div className="note-status" aria-live="polite">
          {status === 'saving' ? copy.saving : status === 'saved' ? copy.saved : null}
        </div>
        <div className="note-views" role="group" aria-label={copy.title}>
          <button type="button" aria-pressed={viewMode === 'page'} title={copy.viewPage} aria-label={copy.viewPage}
            disabled={disabled} onClick={() => switchView('page')}><FileText size={14} /></button>
          <button type="button" aria-pressed={viewMode === 'quadrants'} title={copy.viewQuadrants} aria-label={copy.viewQuadrants}
            disabled={disabled} onClick={() => switchView('quadrants')}><LayoutGrid size={14} /></button>
          <button type="button" aria-pressed={viewMode === 'calendar'} title={copy.viewCalendar} aria-label={copy.viewCalendar}
            disabled={disabled} onClick={() => switchView('calendar')}><Calendar size={14} /></button>
        </div>
        {surface === 'window' ? (
          <>
            {typeof api.dockToWorkbench === 'function' && (
              <button type="button" className="note-icon-button" title={copy.dockToWorkbench}
                aria-label={copy.dockToWorkbench} disabled={disabled} onClick={() => void handleDockToWorkbench()}>
                <PanelLeft size={14} />
              </button>
            )}
            {context?.canPin && (
              <button type="button" className="note-icon-button note-pin" aria-pressed={context.pinned}
                title={pinLabel} aria-label={pinLabel} onClick={() => void setPinned()}>
                {context.pinned ? <Pin size={15} /> : <PinOff size={15} />}
              </button>
            )}
          </>
        ) : (
          <>
            {onPopout && (
              <button type="button" className="note-icon-button" title={copy.popoutWindow}
                aria-label={copy.popoutWindow} onClick={() => void finishEditing().then(saved => { if (saved) onPopout() })}>
                <PictureInPicture2 size={14} />
              </button>
            )}
            {onCloseDocked && (
              <button type="button" className="note-icon-button" title={copy.closeDocked}
                aria-label={copy.closeDocked} onClick={() => void finishEditing().then(saved => { if (saved) onCloseDocked() })}>
                <X size={15} />
              </button>
            )}
          </>
        )}
      </header>

      {viewMode === 'page' ? (
        focusedLine !== null && page ? (
          <FocusTaskView
            day={page.day}
            dayTitle={title}
            markdown={text}
            focusedLine={focusedLine}
            copy={copy}
            summaries={linkSummaries}
            canSend={canSend}
            canStartSession={canStartSession}
            disabled={disabled}
            api={api}
            onChange={applyChange}
            onEditFull={edit}
            onFocusLine={setFocusedLine}
            onSendTask={(task, draftOnly) => void sendTasksToKun([task], draftOnly)}
            onStartSession={task => setStartingTask(task)}
            onOpenLink={openTaskLink}
          />
        ) : (
          <main className="note-page" inert={busy} aria-busy={busy} onMouseDown={focusEnd}>
            <div className="note-hero">
              <div className="note-hero-bar">
                <DatePicker locale={locale} copy={copy} title={title} selected={selected} today={today}
                  days={days} noteDays={noteDays} summaries={summaries} disabled={disabled}
                  onInspectMonth={inspectMonth} onPick={day => void openDay(day)} />
                {selected === today && <span className="note-chip">{copy.today}</span>}
                <div className="note-hero-actions">
                  {tasks.total > 0 && (
                    <span className="note-inline-progress" title={progressLabel(copy.progress, tasks)}>
                      <span className="note-track" aria-hidden>
                        <i style={{ width: `${(tasks.done / tasks.total) * 100}%` }} />
                      </span>
                      <span aria-hidden>{tasks.done}/{tasks.total}</span>
                      <span className="note-sr">{progressLabel(copy.progress, tasks)}</span>
                    </span>
                  )}
                  {canSend && unlinkedOpen.length > 0 && (
                    <button type="button" className="note-plan-kun" disabled={disabled}
                      onClick={event => void sendTasksToKun(unlinkedOpen, event.altKey)}>
                      <Bot size={13} aria-hidden />{copy.planWithKun}
                    </button>
                  )}
                </div>
              </div>
              {rolloverBanner && (
                <div className="note-rollover-banner">
                  <span>{rolloverBanner.text}</span>
                  <button type="button" disabled={disabled} onClick={rolloverBanner.onRollover}>{rolloverBanner.action}</button>
                </div>
              )}
            </div>
            {page && (
              <NoteEditor
                key={page.day}
                day={page.day}
                value={text}
                copy={copy}
                summaries={linkSummaries}
                canSend={canSend}
                canStartSession={canStartSession}
                canZoom
                api={api}
                viewRef={editor}
                onEdit={edit}
                onSendLine={sendLineToKun}
                onStartSessionLine={openStartSessionLine}
                onZoomLine={line => setFocusedLine(line)}
                onOpenLink={openTaskLink}
              />
            )}
            <button type="button" className="note-add" disabled={!page || busy}
              onClick={() => { if (editor.current) insertDailyTask(editor.current) }}><Plus size={16} />{copy.addTask}</button>

            <EarlierDayStream
              api={api}
              locale={locale}
              today={today}
              selected={selected}
              days={days}
              summaries={linkSummaries}
              copy={copy}
              disabled={disabled}
              externalTick={externalTick}
              onOpenDay={(day, focusTask) => void openDay(day, focusTask)}
              onOpenLink={openTaskLink}
            />
          </main>
        )
      ) : viewMode === 'quadrants' ? (
        <QuadrantView key={selected} dateSubtitle={dateSubtitle} markdown={text} copy={copy}
          summaries={linkSummaries} canSend={canSend} canStartSession={canStartSession}
          rolloverBanner={rolloverBanner}
          disabled={disabled || !page} onChange={applyChange}
          onSendTask={(task, draftOnly) => void sendTasksToKun([task], draftOnly)}
          onStartSession={task => setStartingTask(task)}
          onFocusTask={line => { setViewMode('page'); setFocusedLine(line) }}
          onPlanAll={(items, draftOnly) => void sendTasksToKun(items, draftOnly)}
          onOpenLink={openTaskLink} />
      ) : (
        <CalendarView key={selected} locale={locale} copy={copy} month={calendarMonth}
          selected={selected} today={today} dayTitle={title} noteDays={noteDays} summaries={summaries}
          linkSummaries={linkSummaries} canSend={canSend} canStartSession={canStartSession}
          markdown={text} disabled={disabled || !page} onChangeMonth={setCalendarMonth}
          onPickDay={day => { if (day !== selected) void openDay(day) }}
          onOpenPage={(day, focusTask) => {
            if (day !== selected) {
              void openDay(day, focusTask)
            } else {
              setFocusedLine(focusTask ?? null)
            }
            setViewMode('page')
          }}
          onChange={applyChange}
          onSendTask={(task, draftOnly) => void sendTasksToKun([task], draftOnly)}
          onStartSession={task => setStartingTask(task)}
          onOpenLink={openTaskLink} />
      )}

      {startingTask && canStartSession && (
        <StartSessionDialog
          api={api}
          copy={copy}
          markdown={text}
          task={startingTask}
          onStarted={handleSessionStarted}
          onClose={() => setStartingTask(null)}
        />
      )}

      {(loadFailure !== null || status === 'error' || status === 'conflict' || pinFailed || actionError !== null) && <div className="note-alert">
        {status === 'conflict' ? <>
          <span role="alert">{actionError ?? copy.saveConflict}</span>
          <button type="button" disabled={busy} onClick={() => void recoverConflict()}>{copy.copyDraftAndReload}</button>
        </> : loadFailure !== null ? <>
          <span role="alert">{copy.loadFailed}</span>
          <button type="button" onClick={() => void (loadFailure === 'initial' ? initialize() : openDay(loadFailure))}>{copy.retry}</button>
        </> : status === 'error' ? <>
          <span role="alert">{copy.saveFailed}</span>
          <button type="button" onClick={retry}>{copy.retry}</button>
        </> : actionError !== null ? <>
          <span role="alert">{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}>×</button>
        </> : <span role="alert">{copy.pinFailed}</span>}
      </div>}
    </div>
  )
}

function progressLabel(template: string, { done, total }: { done: number; total: number }): string {
  return template.replace('{{done}}', String(done)).replace('{{total}}', String(total))
}
