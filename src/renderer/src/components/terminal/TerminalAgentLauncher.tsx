import { useEffect, useRef, useState, type ReactElement } from 'react'
import { profileCommandLine, quoteShellWord } from '@shared/app-settings-terminal-dock'
import type { TerminalAgentEntry } from './terminal-agent-catalog'
import { TerminalAgentEntryIcon } from './TerminalIcon'
import { submitShortcut } from './terminal-shortcuts'

type T = (key: string, options?: Record<string, unknown>) => string

/** Preview of what will run, for harnesses (argv from Kun) and profiles. */
export function launchPreview(entry: TerminalAgentEntry, task: string): string {
  if (entry.kind === 'profile' && entry.profile) return profileCommandLine(entry.profile, task)
  const argv = entry.harness?.definition.terminal?.argv ?? []
  const command = entry.harness?.definition.launch?.command ?? argv[0] ?? entry.id
  const base = [command.split(/[\\/]/).pop() ?? command, ...argv.slice(1)].join(' ')
  if (!task.trim()) return base
  const flag = entry.harness?.definition.terminal?.taskFlag
  return [base, ...(flag ? [flag] : []), quoteShellWord(task.trim())].join(' ')
}

export function TerminalAgentLauncher({
  entry,
  workspaceRoot,
  position,
  onCancel,
  onLaunch,
  t
}: {
  entry: TerminalAgentEntry
  workspaceRoot: string
  position: { left: number; top: number }
  onCancel: () => void
  onLaunch: (options: { task: string; report: boolean }) => void
  t: T
}): ReactElement {
  const [task, setTask] = useState('')
  const [report, setReport] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const canReport = entry.kind === 'harness'
  useEffect(() => { textareaRef.current?.focus() }, [entry.id])
  const submit = (): void => onLaunch({ task, report: canReport && report })
  const folder = workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? workspaceRoot
  return (
    <div
      className="kun-terminal-popover kun-terminal-launcher"
      role="dialog"
      aria-label={t('termDockLaunchTitle', { name: entry.name })}
      style={position}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          submit()
        }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <TerminalAgentEntryIcon icon={entry.icon} size={26} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>{t('termDockLaunchTitle', { name: entry.name })}</h3>
          <p>{[entry.detail, t('termDockLaunchInTab')].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <label className="kun-terminal-field-label" htmlFor={`terminal-agent-task-${entry.id}`}>{t('termDockTaskLabel')}</label>
      <textarea id={`terminal-agent-task-${entry.id}`} ref={textareaRef} rows={3} value={task} placeholder={t('termDockTaskPlaceholder')} onChange={(event) => setTask(event.target.value)} />
      <p style={{ marginTop: 6 }}>{t('termDockLaunchFolder', { folder })}</p>
      {canReport ? (
        <div className="kun-terminal-report">
          <input id={`terminal-agent-report-${entry.id}`} type="checkbox" checked={report} onChange={(event) => setReport(event.target.checked)} style={{ marginTop: 2, accentColor: 'var(--ds-accent)' }} />
          <label htmlFor={`terminal-agent-report-${entry.id}`}>
            {t('termDockReport')}
            <small>{t('termDockReportNote')}</small>
          </label>
        </div>
      ) : null}
      <label className="kun-terminal-field-label" style={{ marginTop: 12 }}>{t('termDockWillRun')}</label>
      <div className="kun-terminal-preview">
        {launchPreview(entry, task)}
        {canReport && report && task.trim() ? <span style={{ color: 'var(--ds-text-muted)' }}> + {t('termDockReportAppendix')}</span> : null}
      </div>
      <div className="kun-terminal-dialog-actions">
        <span className="kun-terminal-kbd" style={{ marginLeft: 0, marginRight: 'auto' }}>{t('termDockLaunchKeys', { keys: submitShortcut() })}</span>
        <button type="button" className="kun-terminal-button" onClick={onCancel}>{t('termDockCancel')}</button>
        <button type="button" className="kun-terminal-button" data-tone="primary" onClick={submit}>{t('termDockRun')}</button>
      </div>
    </div>
  )
}
