import { useEffect, useMemo, useState } from 'react'
import { FolderGit2, MessageSquare, Play, X } from 'lucide-react'
import type {
  DailyNotesApi,
  DailyNoteTargetProject,
  DailyNoteTargetThread
} from '@shared/daily-notes'
import type { DailyNotesCopy } from './copy'
import { buildDailyNoteTaskPrompt, type NoteTask } from './tasks'

export type MentionTriggerState = {
  lineNumber: number
  atFrom: number
  atTo: number
  query: string
  top: number
  left: number
}

type MentionPopoverProps = {
  state: MentionTriggerState
  threads: readonly DailyNoteTargetThread[]
  copy: DailyNotesCopy
  onSelect: (thread: DailyNoteTargetThread) => void
  onClose: () => void
}

export function MentionPopover({
  state,
  threads,
  copy,
  onSelect,
  onClose
}: MentionPopoverProps) {
  const filtered = useMemo(() => {
    const q = state.query.trim().toLowerCase()
    const list = q
      ? threads.filter(item =>
          item.title.toLowerCase().includes(q) ||
          item.workspaceLabel.toLowerCase().includes(q))
      : threads
    return list.slice(0, 8)
  }, [state.query, threads])

  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setActiveIndex(0)
  }, [state.query, filtered.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (filtered.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex(index => (index + 1) % filtered.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex(index => (index - 1 + filtered.length) % filtered.length)
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        if (event.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        const target = filtered[activeIndex] ?? filtered[0]
        if (target) onSelect(target)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeIndex, filtered, onClose, onSelect])

  return (
    <div
      className="note-mention-popover"
      role="listbox"
      aria-label={copy.mentionHeader}
      style={{ top: state.top, left: state.left }}
      onMouseDown={event => event.preventDefault()}
    >
      <div className="note-mention-head">{copy.mentionHeader}</div>
      {filtered.length === 0 ? (
        <div className="note-mention-empty">{copy.mentionEmpty}</div>
      ) : (
        filtered.map((thread, index) => (
          <button
            key={thread.id}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={'note-mention-item' + (index === activeIndex ? ' is-active' : '')}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onSelect(thread)}
          >
            <i className={`note-mention-dot is-${thread.status}`} aria-hidden />
            <span className="note-mention-title">{thread.title || copy.threadBadge}</span>
            {thread.workspaceLabel && (
              <small className="note-mention-project">{thread.workspaceLabel}</small>
            )}
          </button>
        ))
      )}
    </div>
  )
}

type StartSessionDialogProps = {
  api: DailyNotesApi
  copy: DailyNotesCopy
  markdown: string
  task: NoteTask
  onStarted: (task: NoteTask, result: { threadId: string; label: string }) => void
  onClose: () => void
}

export function StartSessionDialog({
  api,
  copy,
  markdown,
  task,
  onStarted,
  onClose
}: StartSessionDialogProps) {
  const hasParent = task.parentLine !== null
  const [includeParents, setIncludeParents] = useState(hasParent)
  const [editedManually, setEditedManually] = useState(false)
  const [prompt, setPrompt] = useState(() => buildDailyNoteTaskPrompt(markdown, task, { includeParents: hasParent }))
  const [projects, setProjects] = useState<DailyNoteTargetProject[]>([])
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.listTargets?.().then(snapshot => {
      if (cancelled || !snapshot) return
      setProjects(snapshot.projects)
      setWorkspaceRoot(snapshot.activeWorkspaceRoot || snapshot.projects[0]?.root || '')
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [api])

  const toggleIncludeParents = (checked: boolean): void => {
    setIncludeParents(checked)
    if (!editedManually) {
      setPrompt(buildDailyNoteTaskPrompt(markdown, task, { includeParents: checked }))
    }
  }

  const submit = async (): Promise<void> => {
    const trimmed = prompt.trim()
    if (!trimmed || !api.startThread || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await api.startThread({
        title: task.text || copy.task,
        prompt: trimmed,
        workspaceRoot: workspaceRoot || null
      })
      if (!response.ok || !response.threadId) {
        setError(response.error || copy.sendFailed)
        setSubmitting(false)
        return
      }
      const chosenProject = projects.find(item => item.root === workspaceRoot)
      const label = response.title || chosenProject?.label || copy.threadBadge
      onStarted(task, { threadId: response.threadId, label })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.sendFailed)
      setSubmitting(false)
    }
  }

  return (
    <div className="note-modal-backdrop" role="dialog" aria-modal="true" aria-label={copy.startSessionTitle}
      onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose() }}>
      <div className="note-modal-card">
        <header className="note-modal-head">
          <strong>{copy.startSessionTitle}</strong>
          <button type="button" className="note-icon-button" aria-label={copy.cancel}
            disabled={submitting} onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <label className="note-modal-field">
          <span>{copy.chooseProject}</span>
          <div className="note-project-select-wrap">
            {workspaceRoot ? <FolderGit2 size={13} aria-hidden /> : <MessageSquare size={13} aria-hidden />}
            <select
              value={workspaceRoot}
              disabled={submitting}
              onChange={event => setWorkspaceRoot(event.target.value)}
            >
              {projects.map(project => (
                <option key={project.root} value={project.root}>{project.label}</option>
              ))}
              <option value="">{copy.pureConversation}</option>
            </select>
          </div>
        </label>

        {hasParent && (
          <label className="note-modal-check">
            <input
              type="checkbox"
              checked={includeParents}
              disabled={submitting}
              onChange={event => toggleIncludeParents(event.target.checked)}
            />
            <span>{copy.includeParentNotes}</span>
          </label>
        )}

        <textarea
          className="note-modal-textarea"
          rows={5}
          autoFocus
          disabled={submitting}
          value={prompt}
          onChange={event => {
            setEditedManually(true)
            setPrompt(event.target.value)
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }}
        />

        {error && <div className="note-modal-error" role="alert">{error}</div>}

        <footer className="note-modal-foot">
          <button type="button" className="note-btn-ghost" disabled={submitting} onClick={onClose}>
            {copy.cancel}
          </button>
          <button type="button" className="note-btn-primary" disabled={submitting || !prompt.trim()}
            onClick={() => void submit()}>
            <Play size={12} aria-hidden />
            <span>{copy.launchSession}</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
