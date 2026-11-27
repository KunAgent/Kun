import { useRef, useState, type DragEvent } from 'react'
import { Bot, Inbox, Plus } from 'lucide-react'
import type { DailyNoteLinkSummary } from '@shared/daily-notes'
import type { DailyNotesCopy } from './copy'
import { TaskLinkControls } from './link-pill'
import {
  appendTaskChange, linkChange, parseTasks, quadrantChange, QUADRANT_NUMERALS, QUADRANTS,
  taskAt, toggleChange, type NoteChange, type NoteTask, type Quadrant
} from './tasks'

type DropZone = Quadrant | 'unsorted'

type Props = {
  dateSubtitle: string
  markdown: string
  copy: DailyNotesCopy
  summaries: Readonly<Record<string, DailyNoteLinkSummary>>
  canSend: boolean
  canStartSession?: boolean
  disabled: boolean
  rolloverBanner?: { text: string; action: string; onRollover: () => void } | null
  onChange: (change: NoteChange) => void
  onSendTask: (task: NoteTask, draftOnly: boolean) => void
  onStartSession?: (task: NoteTask) => void
  onFocusTask?: (line: number) => void
  onPlanAll: (tasks: NoteTask[], draftOnly: boolean) => void
  onOpenLink: (url: string) => void
}

export function QuadrantView({
  dateSubtitle, markdown, copy, summaries, canSend, canStartSession = false, disabled,
  rolloverBanner, onChange, onSendTask, onStartSession, onFocusTask, onPlanAll, onOpenLink
}: Props) {
  const tasks = parseTasks(markdown)
  const unsorted = tasks.filter(task => task.quadrant === null)
  const unlinkedOpen = tasks.filter(task => !task.done && !task.link && task.text.length > 0)
  const dragLine = useRef<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<DropZone | null>(null)
  const [adding, setAdding] = useState<Quadrant | null>(null)
  const [draft, setDraft] = useState('')
  const draftRef = useRef('')

  const updateDraft = (value: string): void => {
    draftRef.current = value
    setDraft(value)
  }

  const moveTask = (line: number, quadrant: Quadrant | null): void => {
    const target = taskAt(markdown, line)
    if (target && target.quadrant !== quadrant) onChange(quadrantChange(target, quadrant))
  }

  const startDrag = (event: DragEvent<HTMLElement>, line: number): void => {
    dragLine.current = line
    setDragging(line)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(line))
  }

  const endDrag = (): void => {
    dragLine.current = null
    setDragging(null)
    setDropTarget(null)
  }

  const dragOverZone = (event: DragEvent<HTMLElement>, zone: DropZone): void => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropTarget !== zone) setDropTarget(zone)
  }

  const leaveZone = (event: DragEvent<HTMLElement>, zone: DropZone): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDropTarget(current => current === zone ? null : current)
    }
  }

  const dropOnZone = (event: DragEvent<HTMLElement>, zone: DropZone): void => {
    event.preventDefault()
    const raw = dragLine.current ?? Number(event.dataTransfer.getData('text/plain'))
    endDrag()
    if (Number.isInteger(raw)) moveTask(raw, zone === 'unsorted' ? null : zone)
  }

  const commitDraft = (quadrant: Quadrant, keepOpen: boolean): void => {
    const trimmed = draftRef.current.trim()
    draftRef.current = ''
    setDraft('')
    if (trimmed) onChange(appendTaskChange(markdown, trimmed, quadrant))
    if (!keepOpen) setAdding(null)
  }

  const openAdd = (quadrant: Quadrant): void => {
    const trimmed = draftRef.current.trim()
    if (adding !== null && adding !== quadrant && trimmed) {
      onChange(appendTaskChange(markdown, trimmed, adding))
    }
    draftRef.current = ''
    setDraft('')
    setAdding(quadrant)
  }

  const renderItem = (task: NoteTask, showQuickAssign = false) => {
    const label = task.text || copy.task
    const subBadge = task.subLineCount > 0 && onFocusTask ? (
      <button
        type="button"
        className="note-subnote-badge"
        disabled={disabled}
        title={copy.subnoteCount.replace('{{count}}', String(task.subLineCount))}
        aria-label={`${label}: ${copy.zoomIn}`}
        onClick={event => { event.stopPropagation(); onFocusTask(task.line) }}
      >
        {task.subLineCount}
      </button>
    ) : null

    return (
      <div key={task.line} draggable={!disabled}
        data-task-line={task.line}
        className={'note-quadrant-item' + (dragging === task.line ? ' is-dragging' : '')}
        onDoubleClick={() => { if (!disabled && onFocusTask) onFocusTask(task.line) }}
        onDragStart={event => startDrag(event, task.line)} onDragEnd={endDrag}>
        <input type="checkbox" className="note-checkbox" checked={task.done} disabled={disabled}
          aria-label={label} onChange={() => onChange(toggleChange(task))} />
        {showQuickAssign ? (
          <>
            <span className={'note-task-body' + (task.done ? ' note-completed' : '')}>{label}</span>
            {subBadge}
            <TaskLinkControls task={task} summary={task.link ? summaries[task.link.url] : undefined}
              copy={copy} disabled={disabled} canSend={canSend} canStartSession={canStartSession}
              onSendToKun={onSendTask} onStartSession={onStartSession} onOpenLink={onOpenLink}
              onMarkDone={(target, done = true) => onChange(toggleChange(target, done))}
              onUnlink={target => onChange(linkChange(target, null))} />
            <span className="note-quick-quadrants">
              {QUADRANTS.map(q => <button key={q} type="button" className={`note-quadrant note-q${q}`}
                disabled={disabled} title={copy[`q${q}` as const]}
                aria-label={`${label} → ${copy[`q${q}` as const]}`}
                onClick={() => moveTask(task.line, q)}>{QUADRANT_NUMERALS[q]}</button>)}
            </span>
          </>
        ) : (
          <div className="note-quadrant-main">
            <div className="note-quadrant-title-line">
              <span className={'note-task-body' + (task.done ? ' note-completed' : '')}>{label}</span>
              {subBadge}
            </div>
            <TaskLinkControls task={task} summary={task.link ? summaries[task.link.url] : undefined}
              copy={copy} disabled={disabled} canSend={canSend} canStartSession={canStartSession}
              onSendToKun={onSendTask} onStartSession={onStartSession} onOpenLink={onOpenLink}
              onMarkDone={(target, done = true) => onChange(toggleChange(target, done))}
              onUnlink={target => onChange(linkChange(target, null))} />
          </div>
        )}
      </div>
    )
  }

  const showTray = unsorted.length > 0 || dragging !== null

  return (
    <main className="note-quadrants" inert={disabled} aria-busy={disabled}>
      <div className="note-view-title">
        <h2>{copy.viewQuadrants}</h2>
        <span>{dateSubtitle}</span>
        {canSend && unlinkedOpen.length > 0 && (
          <button type="button" className="note-plan-kun" disabled={disabled}
            onClick={event => onPlanAll(unlinkedOpen, event.altKey)}>
            <Bot size={13} aria-hidden />{copy.planWithKun}
          </button>
        )}
      </div>
      {rolloverBanner && (
        <div className="note-rollover-banner">
          <span>{rolloverBanner.text}</span>
          <button type="button" disabled={disabled} onClick={rolloverBanner.onRollover}>{rolloverBanner.action}</button>
        </div>
      )}
      <div className="note-quadrants-grid">
        {QUADRANTS.map(quadrant => {
          const title = copy[`q${quadrant}` as const]
          const items = tasks.filter(task => task.quadrant === quadrant)
          const isTarget = dropTarget === quadrant
          return (
            <section key={quadrant} data-quadrant={quadrant} aria-label={title}
              className={`note-quadrant-card is-q${quadrant}${isTarget ? ' is-drop-target' : ''}`}
              onDragOver={event => dragOverZone(event, quadrant)}
              onDragLeave={event => leaveZone(event, quadrant)}
              onDrop={event => dropOnZone(event, quadrant)}>
              <header className="note-quadrant-head">
                <span className={`note-quadrant note-q${quadrant}`} aria-hidden>{QUADRANT_NUMERALS[quadrant]}</span>
                <h3>{title}</h3>
                <b>{items.length}</b>
              </header>
              <div className="note-quadrant-list">
                {items.map(task => renderItem(task))}
              </div>
              {adding === quadrant ? (
                <input type="text" className="note-inline-input" autoFocus value={draft}
                  placeholder={copy.newTaskPlaceholder} aria-label={`${title}: ${copy.addTask}`}
                  onChange={event => updateDraft(event.target.value)}
                  onBlur={() => commitDraft(quadrant, false)}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitDraft(quadrant, Boolean(draftRef.current.trim()))
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      updateDraft('')
                      setAdding(null)
                    }
                  }} />
              ) : (
                <button type="button" className="note-quadrant-add" disabled={disabled}
                  aria-label={`${title}: ${copy.addInQuadrant}`}
                  onClick={() => openAdd(quadrant)}>
                  <Plus size={13} aria-hidden />{copy.addInQuadrant}
                </button>
              )}
            </section>
          )
        })}
      </div>
      {showTray && (
        <section data-quadrant="unsorted" aria-label={copy.unsorted}
          className={'note-unsorted-tray' + (dropTarget === 'unsorted' ? ' is-drop-target' : '')}
          onDragOver={event => dragOverZone(event, 'unsorted')}
          onDragLeave={event => leaveZone(event, 'unsorted')}
          onDrop={event => dropOnZone(event, 'unsorted')}>
          <div className="note-unsorted-head">
            <Inbox size={13} aria-hidden />
            <span>{copy.unsorted}{unsorted.length ? ` ${unsorted.length}` : ''}</span>
            <span className="note-unsorted-hint">{copy.dropHint}</span>
          </div>
          {unsorted.length > 0 && (
            <div className="note-unsorted-list">
              {unsorted.map(task => renderItem(task, true))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
