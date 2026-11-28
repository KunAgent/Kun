import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { ChevronRight, CornerLeftUp, Plus } from 'lucide-react'
import type { EditorView } from '@codemirror/view'
import type { DailyNoteLinkSummary, DailyNotesApi } from '@shared/daily-notes'
import type { DailyNotesCopy } from './copy'
import { insertDailyTask, NoteEditor } from './editor'
import { TaskLinkControls } from './link-pill'
import {
  applyNoteChange, extractDailyNoteTaskSubtree, linkChange, parseTasks,
  quadrantChange, QUADRANT_NUMERALS, replaceDailyNoteTaskSubtreeChange,
  setDailyNoteTaskTitleChange, toggleChange,
  type NoteChange, type NoteTask, type Quadrant
} from './tasks'

type Props = {
  day: string
  dayTitle: string
  markdown: string
  focusedLine: number
  copy: DailyNotesCopy
  summaries: Readonly<Record<string, DailyNoteLinkSummary>>
  canSend: boolean
  canStartSession: boolean
  disabled: boolean
  api: DailyNotesApi
  onChange: (change: NoteChange) => void
  onEditFull: (day: string, nextMarkdown: string) => void
  onFocusLine: (line: number | null) => void
  onSendTask: (task: NoteTask, draftOnly: boolean) => void
  onStartSession: (task: NoteTask) => void
  onOpenLink: (url: string) => void
}

export function FocusTaskView({
  day,
  dayTitle,
  markdown,
  focusedLine,
  copy,
  summaries,
  canSend,
  canStartSession,
  disabled,
  api,
  onChange,
  onEditFull,
  onFocusLine,
  onSendTask,
  onStartSession,
  onOpenLink
}: Props) {
  const allTasks = useMemo(() => parseTasks(markdown), [markdown])
  const tasksByLine = useMemo(() => new Map(allTasks.map(item => [item.line, item])), [allTasks])
  const task = tasksByLine.get(focusedLine)
  const subEditorRef = useRef<EditorView | null>(null)
  const [titleDraft, setTitleDraft] = useState(task?.text ?? '')

  const taskLine = task?.line
  const taskText = task?.text
  useLayoutEffect(() => {
    if (taskText !== undefined) setTitleDraft(taskText)
  }, [taskLine, taskText])

  // If the focused task was deleted externally, step back to day view cleanly.
  useEffect(() => {
    if (!task) onFocusLine(null)
  }, [onFocusLine, task])

  const ancestors = useMemo(() => {
    if (!task) return []
    const chain: NoteTask[] = []
    let cursor = task.parentLine
    while (cursor !== null) {
      const parent = tasksByLine.get(cursor)
      if (!parent) break
      chain.unshift(parent)
      cursor = parent.parentLine
    }
    return chain
  }, [task, tasksByLine])

  const subtreeText = useMemo(
    () => (task ? extractDailyNoteTaskSubtree(markdown, task) : ''),
    [markdown, task]
  )

  const handleSubtreeEdit = useCallback((_dayKey: string, nextSubtree: string) => {
    const latestTasks = parseTasks(markdown)
    const current = latestTasks.find(item => item.line === focusedLine)
    if (!current) return
    const nextMarkdown = applyNoteChange(markdown, replaceDailyNoteTaskSubtreeChange(markdown, current, nextSubtree))
    if (nextMarkdown !== markdown) onEditFull(day, nextMarkdown)
  }, [day, focusedLine, markdown, onEditFull])

  const commitTitle = useCallback((nextTitle: string) => {
    if (!task) return
    const trimmed = nextTitle.trim()
    if (trimmed === task.text) return
    onChange(setDailyNoteTaskTitleChange(task, trimmed))
  }, [onChange, task])

  const cycleQuadrant = (): void => {
    if (!task || disabled) return
    const next: Quadrant | null = task.quadrant === null
      ? 1
      : task.quadrant < 4
        ? (task.quadrant + 1) as Quadrant
        : null
    onChange(quadrantChange(task, next))
  }

  const sendSubtreeLine = useCallback((subLine: number, draftOnly: boolean) => {
    if (!task) return
    const absLine = task.line + 1 + subLine
    const subTask = tasksByLine.get(absLine)
    if (subTask) onSendTask(subTask, draftOnly)
  }, [onSendTask, task, tasksByLine])

  const startSubtreeSession = useCallback((subLine: number) => {
    if (!task) return
    const absLine = task.line + 1 + subLine
    const subTask = tasksByLine.get(absLine)
    if (subTask) onStartSession(subTask)
  }, [onStartSession, task, tasksByLine])

  const zoomIntoChild = useCallback((subLine: number) => {
    if (!task) return
    const absLine = task.line + 1 + subLine
    if (tasksByLine.has(absLine)) onFocusLine(absLine)
  }, [onFocusLine, task, tasksByLine])

  const zoomUpOneLevel = useCallback(() => {
    onFocusLine(task?.parentLine ?? null)
  }, [onFocusLine, task?.parentLine])

  const focusSubEditorEnd = (event: MouseEvent<HTMLElement>): void => {
    const view = subEditorRef.current
    if (event.target !== event.currentTarget || !view) return
    event.preventDefault()
    view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })
    view.focus()
  }

  if (!task) return null

  return (
    <main className="note-page is-focus-view" inert={disabled} aria-busy={disabled} onMouseDown={focusSubEditorEnd}>
      <nav className="note-breadcrumbs" aria-label={copy.zoomOut}>
        <button type="button" className="note-crumb-back" onClick={() => onFocusLine(null)} title={copy.zoomOut}>
          <CornerLeftUp size={13} aria-hidden />
          <span>{dayTitle}</span>
        </button>
        {ancestors.map(ancestor => (
          <span key={ancestor.line} className="note-crumb-step">
            <ChevronRight size={12} aria-hidden />
            <button type="button" onClick={() => onFocusLine(ancestor.line)}>
              {ancestor.text || copy.task}
            </button>
          </span>
        ))}
        <span className="note-crumb-step is-current">
          <ChevronRight size={12} aria-hidden />
          <span>{task.text || copy.task}</span>
        </span>
      </nav>

      <div className="note-focus-head">
        <div className="note-focus-title-row">
          <input
            type="checkbox"
            className="note-checkbox is-large"
            checked={task.done}
            disabled={disabled}
            aria-label={task.text || copy.task}
            onChange={() => onChange(toggleChange(task))}
          />
          <input
            type="text"
            className={'note-focus-title-input' + (task.done ? ' note-completed' : '')}
            value={titleDraft}
            disabled={disabled}
            placeholder={copy.task}
            aria-label={copy.task}
            onChange={event => {
              setTitleDraft(event.target.value)
              commitTitle(event.target.value)
            }}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                subEditorRef.current?.focus()
              } else if (event.key === 'Escape' || (event.altKey && event.key === 'ArrowLeft')) {
                event.preventDefault()
                zoomUpOneLevel()
              }
            }}
          />
        </div>

        <div className="note-focus-meta">
          <button
            type="button"
            className={task.quadrant ? `note-quadrant note-q${task.quadrant}` : 'note-quadrant is-unset'}
            disabled={disabled}
            title={task.quadrant ? copy[`q${task.quadrant}` as const] : copy.unsorted}
            onClick={cycleQuadrant}
          >
            {task.quadrant ? `${QUADRANT_NUMERALS[task.quadrant]} · ${copy[`q${task.quadrant}` as const]}` : '+ I–IV'}
          </button>

          <TaskLinkControls
            task={task}
            summary={task.link ? summaries[task.link.url] : undefined}
            copy={copy}
            disabled={disabled}
            canSend={canSend}
            canStartSession={canStartSession}
            onSendToKun={onSendTask}
            onStartSession={onStartSession}
            onOpenLink={onOpenLink}
            onMarkDone={(target, done) => onChange(toggleChange(target, done))}
            onUnlink={target => onChange(linkChange(target, null))}
          />
        </div>
      </div>

      <NoteEditor
        key={`${day}:focus:${task.line}`}
        day={`${day}:focus:${task.line}`}
        value={subtreeText}
        copy={copy}
        summaries={summaries}
        canSend={canSend}
        canStartSession={canStartSession}
        canZoom
        placeholderText={copy.subnotesPlaceholder}
        ariaLabel={copy.title}
        api={api}
        viewRef={subEditorRef}
        onEdit={handleSubtreeEdit}
        onSendLine={sendSubtreeLine}
        onStartSessionLine={startSubtreeSession}
        onZoomLine={zoomIntoChild}
        onZoomOut={zoomUpOneLevel}
        onOpenLink={onOpenLink}
      />

      <button
        type="button"
        className="note-add"
        disabled={disabled}
        onClick={() => { if (subEditorRef.current) insertDailyTask(subEditorRef.current) }}
      >
        <Plus size={15} />
        {copy.addTask}
      </button>
    </main>
  )
}
