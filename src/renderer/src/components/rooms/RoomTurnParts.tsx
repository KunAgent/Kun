import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Check, ChevronRight, CircleAlert, CircleCheck, CircleSlash, FileText, LoaderCircle, PanelRightOpen,
  ShieldCheck, ShieldX, Terminal, X } from 'lucide-react'
import { useRoomRunSteps } from './useRoomRunSteps'
import { changedFiles, durationParts, isDecidedApproval, isLiveRun, isToolStep, runElapsedMs, stepClock,
  stepCounts, stepGroup, stepSpanMs, stepsBetween, type RoomApprovalStep, type RoomToolStep } from './room-turn-steps'
import './rooms-direct-turns.css'

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })

export function turnDuration(ms: number, t: TFunction): string {
  const { hours, minutes, seconds } = durationParts(ms)
  if (hours) return t('directTurnDurationHours', { hours, minutes })
  if (minutes) return t('directTurnDurationMinutes', { minutes, seconds })
  return t('directTurnDurationSeconds', { seconds })
}

/** Ticks once a second while `active`, for running step and span times. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/** Header extras for a turn's first message: when it ended and how long it took. */
export function RoomTurnClock({ roomId, runId }: { roomId: string; runId: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const { data } = useRoomRunSteps(roomId, runId)
  if (!data) return null
  if (isLiveRun(data)) return <span className="room-turn-clock is-live">{t('directTurnRunning')}</span>
  const elapsed = runElapsedMs(data.run)
  return <span className="room-turn-clock">
    {data.run.endedAt ? <time dateTime={data.run.endedAt}>– {clock(data.run.endedAt)}</time> : null}
    {elapsed !== undefined && elapsed >= 1000 ? <span>{t('directTurnDuration', { duration: turnDuration(elapsed, t) })}</span> : null}
  </span>
}

function StepStatus({ step }: { step: RoomToolStep }): ReactElement {
  if (step.status === 'running') return <LoaderCircle size={11} className="animate-spin" aria-hidden="true" />
  if (step.status === 'failed') return <X size={11} strokeWidth={3} aria-hidden="true" />
  if (step.status === 'cancelled') return <CircleSlash size={11} aria-hidden="true" />
  return <Check size={11} strokeWidth={3} aria-hidden="true" />
}

function StepRow({ step, now }: { step: RoomToolStep; now: number }): ReactElement {
  const { t } = useTranslation('common')
  const group = stepGroup(step)
  const ms = (step.status === 'running' ? now : Date.parse(step.endedAt ?? step.startedAt)) - Date.parse(step.startedAt)
  const subject = step.target ?? (group === 'tool' ? step.toolName : step.label)
  return <li className={`room-turn-step is-${step.status}`}>
    <span className="room-turn-step-icon"><StepStatus step={step} /></span>
    <span className="room-turn-step-text">
      <span className="room-turn-step-title">{t(`directStepVerb_${group}`)} {subject ? <code title={subject}>{subject}</code> : null}</span>
      {step.label && step.label !== subject ? <span className="room-turn-step-detail">{step.label}</span> : null}
      {step.status === 'failed' ? <span className="room-turn-step-detail is-failed">{t('directStepFailed')}</span> : null}
    </span>
    <span className="room-turn-step-time">{ms >= 1000 ? stepClock(ms) : ''}</span>
  </li>
}

function Decision({ step }: { step: RoomApprovalStep }): ReactElement {
  const { t } = useTranslation('common')
  const Icon = step.status === 'allowed' ? ShieldCheck : ShieldX
  return <p className={`room-turn-decision is-${step.status}`}>
    <Icon size={13} aria-hidden="true" />
    <strong>{t(`directApprovalDecided_${step.status}`)}</strong>
    <span className="room-turn-decision-label" title={step.label}>{step.label}</span>
    <time dateTime={step.endedAt ?? step.startedAt}>{clock(step.endedAt ?? step.startedAt)}</time>
  </p>
}

/**
 * The work an Agent did between two of its messages, folded into one line.
 * It opens on its own while a step runs or after one failed; the reader's
 * choice wins once they toggle it.
 */
export function RoomTurnTrail({ roomId, runId, since, until }: {
  roomId: string; runId: string; since?: string; until?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const { data } = useRoomRunSteps(roomId, runId)
  const steps = useMemo(() => data ? stepsBetween(data.steps, since, until) : [], [data, since, until])
  const tools = useMemo(() => steps.filter(isToolStep), [steps])
  const decisions = steps.filter(isDecidedApproval)
  const running = tools.some((step) => step.status === 'running')
  const failed = tools.filter((step) => step.status === 'failed').length
  const [choice, setChoice] = useState<boolean>()
  const now = useNow(running)
  if (!tools.length && !decisions.length) return null
  const open = choice ?? (running || failed > 0)
  const counts = stepCounts(tools)
  const shown = counts.slice(0, 2)
  const rest = counts.slice(2).reduce((sum, entry) => sum + entry.count, 0)
  const span = stepSpanMs(tools, now)
  return <div className="room-turn-trail">
    {tools.length ? <>
      <button type="button" className="room-turn-trail-chip" aria-expanded={open} onClick={() => setChoice(!open)}>
        <ChevronRight size={14} className="room-turn-trail-chevron" aria-hidden="true" />
        {running ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <Terminal size={13} aria-hidden="true" />}
        <span className="room-turn-trail-summary">
          {shown.map((entry, index) => <span key={entry.group} className={index === 0 ? 'is-lead' : undefined}>
            {t(`directWork_${entry.group}`, { count: entry.count })}</span>)}
          {rest ? <span>{t('directWorkMore', { count: rest })}</span> : null}
          {failed ? <span className="is-failed">{t('directWorkFailed', { count: failed })}</span> : null}
        </span>
        {span >= 1000 ? <span className="room-turn-trail-time">{stepClock(span)}</span> : null}
      </button>
      {open ? <ol className="room-turn-steps" aria-label={t('directWorkSteps')}>
        {tools.map((step) => <StepRow key={step.id} step={step} now={now} />)}
      </ol> : null}
    </> : null}
    {decisions.map((step) => <Decision key={step.id} step={step} />)}
  </div>
}

/** What a finished turn changed, shown under its last message when it did more than read. */
export function RoomTurnResult({ roomId, runId, onRun }: {
  roomId: string; runId: string; onRun?: (id: string) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  const { data } = useRoomRunSteps(roomId, runId)
  if (!data || isLiveRun(data)) return null
  const tools = data.steps.filter(isToolStep)
  const commands = tools.filter((step) => stepGroup(step) === 'command').length
  const files = changedFiles(data.steps)
  const decisions = data.steps.filter(isDecidedApproval).length
  const failed = tools.filter((step) => step.status === 'failed').length
  const status = data.run.status
  if (status === 'completed' && !commands && !files.length && !decisions) return null
  if (status !== 'completed' && !tools.length) return null
  const elapsed = runElapsedMs(data.run)
  const Icon = status === 'completed' ? CircleCheck : status === 'cancelled' ? CircleSlash : CircleAlert
  const facts = [
    { key: 'commands', value: commands }, { key: 'files', value: files.length },
    { key: 'approvals', value: decisions }, { key: 'failed', value: failed }
  ].filter((fact) => fact.value > 0)
  return <section className={`room-turn-result is-${status}`} aria-label={t('directTurnResultLabel')}>
    <header>
      <span className="room-turn-result-icon"><Icon size={15} aria-hidden="true" /></span>
      <strong>{t(`directTurnResult_${status}`)}</strong>
      {elapsed !== undefined && elapsed >= 1000 ? <span>{t('directTurnDuration', { duration: turnDuration(elapsed, t) })}</span> : null}
    </header>
    {facts.length ? <dl className="room-turn-result-facts">
      {facts.map((fact) => <div key={fact.key} className={fact.key === 'failed' ? 'is-failed' : undefined}>
        <dt>{t(`directTurnFact_${fact.key}`)}</dt><dd>{fact.value}</dd></div>)}
    </dl> : null}
    {files.length ? <ul className="room-turn-result-files" aria-label={t('directTurnFact_files')}>
      {files.slice(0, 6).map((file) => <li key={file}><FileText size={13} aria-hidden="true" />
        <code title={file}>{file.split(/[\\/]/).filter(Boolean).at(-1) ?? file}</code></li>)}
      {files.length > 6 ? <li className="room-turn-result-more">{t('directWorkMore', { count: files.length - 6 })}</li> : null}
    </ul> : null}
    {status === 'failed' && data.run.error ? <p className="room-turn-result-error">{data.run.error}</p> : null}
    {onRun ? <footer><button type="button" onClick={() => onRun(runId)}>
      <PanelRightOpen size={13} aria-hidden="true" />{t('directTurnOpenRun')}</button></footer> : null}
  </section>
}
