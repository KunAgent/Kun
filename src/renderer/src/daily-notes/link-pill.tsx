import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Copy, ExternalLink, MoreHorizontal, Play, RotateCcw, Unlink } from 'lucide-react'
import type { DailyNoteLinkSummary } from '@shared/daily-notes'
import type { DailyNotesCopy } from './copy'
import type { NoteTask } from './tasks'

type Props = {
  task: NoteTask
  summary?: DailyNoteLinkSummary
  copy: DailyNotesCopy
  disabled: boolean
  canSend: boolean
  canStartSession?: boolean
  onSendToKun: (task: NoteTask, draftOnly: boolean) => void
  onStartSession?: (task: NoteTask) => void
  onOpenLink: (url: string) => void
  onMarkDone: (task: NoteTask, done?: boolean) => void
  onUnlink?: (task: NoteTask) => void
}

export function TaskLinkControls({
  task,
  summary,
  copy,
  disabled,
  canSend,
  canStartSession = false,
  onSendToKun,
  onStartSession,
  onOpenLink,
  onMarkDone,
  onUnlink
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [menuOpen])

  if (task.link) {
    const tone = summary?.tone ?? 'idle'
    const text = summary?.statusText || task.link.label
    const tip = summary?.detail ? `${text} — ${summary.detail}` : text
    const taskTitle = task.text || copy.task

    const copySummaryText = (): void => {
      const payload = summary?.detail
        ? `${taskTitle} (${text}: ${summary.detail})`
        : `${taskTitle} (${text})`
      void navigator.clipboard?.writeText(payload).catch(() => undefined)
      setMenuOpen(false)
    }

    return (
      <span className="note-link-group" ref={rootRef}>
        <button
          type="button"
          className={`note-link-pill is-${tone}`}
          disabled={disabled}
          title={tip}
          aria-label={tip}
          onClick={event => { event.stopPropagation(); onOpenLink(task.link!.url) }}
          onContextMenu={event => {
            event.preventDefault()
            event.stopPropagation()
            if (!disabled) setMenuOpen(open => !open)
          }}
        >
          <i aria-hidden />
          <span>{text}</span>
        </button>
        {!task.done && summary?.canMarkDone && (
          <button
            type="button"
            className="note-complete-pill"
            disabled={disabled}
            title={copy.completeTodo}
            aria-label={`${taskTitle}: ${copy.completeTodo}`}
            onClick={event => { event.stopPropagation(); onMarkDone(task, true) }}
          >
            <Check size={11} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="note-link-more"
          disabled={disabled}
          title={copy.moreActions}
          aria-label={`${taskTitle}: ${copy.moreActions}`}
          aria-expanded={menuOpen}
          onClick={event => { event.stopPropagation(); setMenuOpen(open => !open) }}
        >
          <MoreHorizontal size={12} aria-hidden />
        </button>
        {menuOpen && (
          <div className="note-pill-menu" role="menu" onClick={event => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenLink(task.link!.url) }}>
              <ExternalLink size={12} aria-hidden />
              <span>{copy.openLinked}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onMarkDone(task, !task.done) }}>
              {task.done ? <RotateCcw size={12} aria-hidden /> : <Check size={12} aria-hidden />}
              <span>{task.done ? copy.reopenTodo : copy.completeTodo}</span>
            </button>
            <button type="button" role="menuitem" onClick={copySummaryText}>
              <Copy size={12} aria-hidden />
              <span>{copy.copySummary}</span>
            </button>
            {onUnlink && (
              <button type="button" role="menuitem" className="is-danger"
                onClick={() => { setMenuOpen(false); onUnlink(task) }}>
                <Unlink size={12} aria-hidden />
                <span>{copy.unlinkSession}</span>
              </button>
            )}
          </div>
        )}
      </span>
    )
  }

  if (task.done || !task.text || (!canSend && !canStartSession)) return null

  return (
    <span className="note-task-actions">
      {canStartSession && onStartSession && (
        <button
          type="button"
          className="note-start-session"
          disabled={disabled}
          title={copy.startSession}
          aria-label={`${task.text}: ${copy.startSession}`}
          onClick={event => { event.stopPropagation(); onStartSession(task) }}
        >
          <Play size={10} aria-hidden />
        </button>
      )}
      {canSend && (
        <button
          type="button"
          className="note-send-kun"
          disabled={disabled}
          title={copy.sendToKun}
          aria-label={`${task.text}: ${copy.sendToKun}`}
          onClick={event => { event.stopPropagation(); onSendToKun(task, event.altKey) }}
        >
          <Bot size={11} aria-hidden />
          <span>{copy.sendToKun}</span>
        </button>
      )}
    </span>
  )
}
