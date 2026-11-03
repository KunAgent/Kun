import { useState, type ReactElement } from 'react'
import { ArrowUpRight, MessageCircle, RotateCw, Square, X, XCircle } from 'lucide-react'
import { useActivityStore } from '../../store/activity-store'
import { useChatStore } from '../../store/chat-store'
import { KunMark } from './TerminalIcon'
import { sendKunProcessInput, stopKunProcess, useKunProcessStore } from './terminal-kun-processes'
import type { TerminalLastFailure, TerminalSessionStatus } from './terminal-dock-model'

type T = (key: string, options?: Record<string, unknown>) => string

export function formatTerminalDuration(ms: number, t: T): string {
  if (ms < 1_000) return t('termDockDurationMs', { value: Math.max(0, Math.round(ms)) })
  if (ms < 60_000) return t('termDockDurationSeconds', { value: (ms / 1_000).toFixed(ms < 10_000 ? 2 : 1) })
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return t('termDockDurationMinutes', { value: minutes })
  return t('termDockDurationHours', { value: Math.floor(minutes / 60), minutes: minutes % 60 })
}

function openThread(threadId: string): void {
  const state = useChatStore.getState()
  if (state.route !== 'chat') state.setRoute?.('chat')
  void state.selectThread(threadId)
}

const PROCESS_STATUS_KEYS: Record<string, string> = {
  completed: 'termDockKunProcessCompleted',
  stopped: 'termDockKunProcessStopped',
  failed: 'termDockKunProcessFailed'
}

export function KunProcessStrip({ processId, t }: { processId: string; t: T }): ReactElement | null {
  const process = useKunProcessStore((state) => state.processes.find((candidate) => candidate.id === processId))
  const threadTitle = useChatStore((state) => process ? state.threads.find((thread) => thread.id === process.threadId)?.title : undefined)
  if (!process) return null
  const running = process.status === 'running'
  const elapsed = (process.finishedAt ? Date.parse(process.finishedAt) : Date.now()) - Date.parse(process.startedAt)
  return (
    <div className="kun-terminal-strip">
      <KunMark />
      <strong>{t('termDockKunProcess')}</strong>
      <span className="kun-terminal-muted">
        {threadTitle ? t('termDockKunProcessFrom', { title: threadTitle }) : null}
        {threadTitle ? ' · ' : ''}
        {running ? t('termDockRunningFor', { duration: formatTerminalDuration(elapsed, t) }) : t(PROCESS_STATUS_KEYS[process.status] ?? 'termDockKunProcessCompleted', { code: process.exitCode ?? '' })}
      </span>
      <span className="kun-terminal-spacer" />
      <button type="button" className="kun-terminal-chip-button" onClick={() => openThread(process.threadId)}>
        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockJumpToChat')}
      </button>
      {running ? (
        <button type="button" className="kun-terminal-chip-button" data-tone="danger" onClick={() => void stopKunProcess(process.id)}>
          <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} />{t('termDockStop')}
        </button>
      ) : null}
    </div>
  )
}

export function KunProcessInput({ processId, t }: { processId: string; t: T }): ReactElement | null {
  const running = useKunProcessStore((state) => state.processes.find((candidate) => candidate.id === processId)?.status === 'running')
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  if (!running) return null
  const inputId = `kun-process-stdin-${processId}`
  return (
    <form
      className="kun-terminal-input-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (!value || sending) return
        setSending(true)
        void sendKunProcessInput(processId, `${value}\n`).finally(() => {
          setSending(false)
          setValue('')
        })
      }}
    >
      <label htmlFor={inputId}>stdin</label>
      <input id={inputId} value={value} disabled={sending} placeholder={t('termDockStdinPlaceholder')} onChange={(event) => setValue(event.target.value)} />
      <small>{t('termDockStdinNote')}</small>
    </form>
  )
}

const PHASE_KEYS: Record<string, string> = {
  investigating: 'termDockPhaseInvestigating',
  implementing: 'termDockPhaseImplementing',
  verifying: 'termDockPhaseVerifying',
  blocked: 'termDockPhaseBlocked',
  compacting: 'termDockPhaseCompacting'
}

export function AgentUnitStrip({ unitId, t }: { unitId: string; t: T }): ReactElement | null {
  const row = useActivityStore((state) => state.rows[unitId])
  if (!row) return null
  const waiting = row.state === 'waiting'
  return (
    <div className="kun-terminal-strip">
      <strong>{t('termDockWorkUnit', { title: row.title })}</strong>
      {row.phase ? <span className="kun-terminal-pill">{t(PHASE_KEYS[row.phase] ?? 'termDockPhaseImplementing')}</span> : null}
      {row.progressNote ? <span className="kun-terminal-muted">{row.progressNote}</span> : null}
      <span className="kun-terminal-spacer" />
      {waiting ? <span className="kun-terminal-pill" data-tone="warn"><span className="kun-terminal-status-dot" data-dot="waiting" />{t('termDockWaitingForYou')}</span> : null}
      {row.state === 'done' ? <span className="kun-terminal-pill" data-tone="ok">{t('termDockUnitDone')}</span> : null}
      {row.threadId ? (
        <button type="button" className="kun-terminal-chip-button" onClick={() => openThread(row.parentThreadId ?? row.threadId)}>
          <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockOpenChat')}
        </button>
      ) : null}
    </div>
  )
}

export function TerminalExitBar({
  status,
  ssh,
  onRestart,
  onClose,
  onSendToKun,
  t
}: {
  status: TerminalSessionStatus
  ssh: boolean
  onRestart: () => void
  onClose: () => void
  onSendToKun: () => void
  t: T
}): ReactElement {
  const failed = typeof status.exitCode === 'number' && status.exitCode !== 0
  const text = ssh ? t('termDockSshClosed')
    : failed ? t('termDockExitedFailed', { code: status.exitCode })
      : t('termDockExited', { code: status.exitCode ?? '—' })
  return (
    <div className="kun-terminal-bar" data-tone={failed && !ssh ? 'error' : undefined} role="status">
      <span className="kun-terminal-bar-text">{text}</span>
      {failed && !ssh ? (
        <button type="button" className="kun-terminal-chip-button" data-tone="accent" onClick={onSendToKun}>
          <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockSendToKun')}
        </button>
      ) : null}
      <button type="button" className="kun-terminal-chip-button" onClick={onRestart}>
        <RotateCw className="h-3.5 w-3.5" strokeWidth={1.9} />{ssh ? t('termDockReconnect') : t('termDockRestart')}
      </button>
      <button type="button" className="kun-terminal-chip-button" onClick={onClose}>{t('termDockCloseTab')}</button>
    </div>
  )
}

export function TerminalFailureBar({
  failure,
  onSend,
  onRerun,
  onDismiss,
  t
}: {
  failure: TerminalLastFailure
  onSend: () => void
  onRerun: () => void
  onDismiss: () => void
  t: T
}): ReactElement {
  return (
    <div className="kun-terminal-bar" data-tone="failure" role="status">
      <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--ds-danger)]" strokeWidth={1.9} aria-hidden="true" />
      <span className="kun-terminal-bar-text">
        <code>{failure.command || t('termDockLastCommand')}</code>
        {' · '}{t('termDockExitCode', { code: failure.exitCode })}
        {' · '}{formatTerminalDuration(failure.durationMs, t)}
      </span>
      <button type="button" className="kun-terminal-chip-button" data-tone="accent" onClick={onSend}>
        <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockSendToKun')}
      </button>
      <button type="button" className="kun-terminal-chip-button" disabled={!failure.command} onClick={onRerun}>
        <RotateCw className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockRerun')}
      </button>
      <button type="button" className="kun-terminal-icon-button" data-size="sm" aria-label={t('termDockDismiss')} title={t('termDockDismiss')} onClick={onDismiss}>
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  )
}

export function TerminalErrorOverlay({ message, onRestart, t }: { message: string; onRestart: () => void; t: T }): ReactElement {
  return (
    <div className="kun-terminal-error" role="alert">
      <strong>{t('termDockUnavailable')}</strong>
      <p>{message}</p>
      <button type="button" className="kun-terminal-chip-button" onClick={onRestart}>
        <RotateCw className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockRestart')}
      </button>
    </div>
  )
}
