import { useEffect, useState, type ReactElement } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import type { HarnessUpdateJob } from '../../../../../kun/src/contracts/harness-update'
import type { AgentUpdatePhase } from '../../store/harness-update-item'

type T = (key: string, options?: Record<string, unknown>) => string
export type AgentUpdateStep = 'wait' | 'install' | 'verify' | 'activate'
const STEPS: readonly AgentUpdateStep[] = ['wait', 'install', 'verify', 'activate']
const PHASE_STEP: Record<AgentUpdatePhase, number> = { starting: 0, waiting: 0, running: 1, verifying: 2, switching: 3, completed: 4, failed: -1 }
const HINT: Partial<Record<AgentUpdateStep, string>> = { wait: 'agentUpdate.progress.waitHint', verify: 'agentUpdate.progress.verifyHint', activate: 'agentUpdate.progress.activateHint' }

/**
 * The updater reports a stage, not a percentage: waiting for the Agent's
 * current turn, installing, verifying the new executable, then Kun switching
 * to it. `activating` is the renderer's own save-and-switch after `ready`.
 */
export function agentUpdateStepIndex(status: HarnessUpdateJob['status'], activating = false): number {
  if (status === 'completed') return STEPS.length
  if (status === 'ready' || activating) return 3
  return status === 'verifying' ? 2 : status === 'running' ? 1 : 0
}

/** Last meaningful updater line, without terminal colour codes. */
export function agentUpdateLastLine(output: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const lines = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean)
  return lines.at(-1)?.slice(0, 160)
}

export function formatAgentUpdateElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function phaseOf(job: HarnessUpdateJob, activating: boolean): AgentUpdatePhase {
  if (activating || job.status === 'ready') return 'switching'
  if (job.status === 'cancelled') return 'failed'
  return job.status
}

/**
 * The four update steps with the live installer line. Reads either a runtime
 * job or the background runner's phase (`failedAt` marks the step that failed).
 */
export function AgentUpdateProgress({ job, phase: phaseProp, failedAt, action: actionProp, startedAt: startedProp, output: outputProp, version, activating = false, t }: {
  job?: HarnessUpdateJob
  phase?: AgentUpdatePhase
  failedAt?: AgentUpdatePhase
  action?: HarnessUpdateJob['action']
  startedAt?: number
  output?: string
  version?: string
  activating?: boolean
  t: T
}): ReactElement {
  const phase = phaseProp ?? (job ? phaseOf(job, activating) : 'starting')
  const running = phase !== 'completed' && phase !== 'failed'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running])
  const current = phase === 'failed' ? PHASE_STEP[failedAt ?? 'running'] ?? 1 : PHASE_STEP[phase]
  const started = startedProp ?? (job ? Date.parse(job.startedAt) : NaN)
  const action = actionProp ?? job?.action ?? 'update'
  const target = job?.version ?? version
  const lastLine = agentUpdateLastLine(outputProp ?? job?.output ?? '')
  const label = (step: AgentUpdateStep): string => step === 'install'
    ? t(action === 'use-local' || action === 'rollback' ? 'agentUpdate.progress.installLocal' : 'agentUpdate.progress.install', { version: target ?? '' })
    : t(`agentUpdate.progress.${step}`)
  return (
    <div className="space-y-2.5" role="status" aria-live="polite" data-agent-update-progress={job && !phaseProp ? job.status : phase}>
      <ol className="space-y-0.5">
        {STEPS.map((step, index) => {
          const state = phase === 'failed' && index === current ? 'failed' : index < current ? 'done' : index === current && running ? 'active' : 'todo'
          return (
            <li key={step} data-agent-update-step={step} data-state={state}
              className={`flex min-h-[28px] items-center gap-2.5 text-[12.5px] ${state === 'todo' ? 'text-ds-faint' : 'text-ds-ink'}`}>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {state === 'done' ? <Check className="h-3.5 w-3.5 text-ds-status-success" strokeWidth={2.6} />
                  : state === 'active' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent motion-reduce:animate-none" strokeWidth={2.2} />
                    : state === 'failed' ? <X className="h-3.5 w-3.5 text-[var(--ds-warning)]" strokeWidth={2.6} />
                      : <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--ds-border-strong)]" />}
              </span>
              <span className={`min-w-0 flex-1 truncate ${state === 'active' || state === 'failed' ? 'font-medium' : ''}`}>
                {label(step)}
                {HINT[step] && state !== 'todo' ? <span className="ml-2 text-[11.5px] font-normal text-ds-faint">{t(HINT[step]!)}</span> : null}
              </span>
              {state === 'active' && Number.isFinite(started) ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-ds-faint" data-agent-update-elapsed>
                {t('agentUpdate.progress.elapsed', { time: formatAgentUpdateElapsed(now - started) })}</span> : null}
            </li>
          )
        })}
      </ol>
      {lastLine ? <p className="truncate rounded-lg bg-ds-subtle px-2.5 py-1.5 font-mono text-[11px] text-ds-muted" title={lastLine} data-agent-update-last-line>{lastLine}</p> : null}
    </div>
  )
}
