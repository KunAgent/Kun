import { useEffect, useState, type ReactElement } from 'react'
import { Check, Loader2 } from 'lucide-react'
import type { HarnessUpdateJob } from '../../../../../kun/src/contracts/harness-update'

type T = (key: string, options?: Record<string, unknown>) => string
export type AgentUpdateStep = 'wait' | 'install' | 'verify' | 'activate'
const STEPS: readonly AgentUpdateStep[] = ['wait', 'install', 'verify', 'activate']

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

export function AgentUpdateProgress({ job, version, activating, t }: {
  job: HarnessUpdateJob; version?: string; activating?: boolean; t: T
}): ReactElement {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const current = agentUpdateStepIndex(job.status, activating)
  const started = Date.parse(job.startedAt)
  const target = job.version ?? version
  const lastLine = agentUpdateLastLine(job.output)
  const label = (step: AgentUpdateStep): string => step === 'install'
    ? t(job.action === 'use-local' ? 'agentUpdate.progress.installLocal' : 'agentUpdate.progress.install', { version: target ?? '' })
    : t(`agentUpdate.progress.${step}`)
  return (
    <div className="space-y-3 px-3 py-3" role="status" aria-live="polite" data-agent-update-progress={job.status}>
      <div className="flex items-center gap-3">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ds-subtle" aria-hidden="true">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 motion-safe:animate-pulse"
            style={{ width: `${Math.min(100, ((current + 0.5) / STEPS.length) * 100)}%` }} />
        </div>
        {Number.isFinite(started) ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-ds-faint" data-agent-update-elapsed>
          {t('agentUpdate.progress.elapsed', { time: formatAgentUpdateElapsed(now - started) })}</span> : null}
      </div>
      <ol className="space-y-1.5">
        {STEPS.map((step, index) => {
          const state = index < current ? 'done' : index === current ? 'active' : 'todo'
          return (
            <li key={step} data-agent-update-step={step} data-state={state}
              className={`flex items-center gap-2 text-[12.5px] ${state === 'todo' ? 'text-ds-faint' : 'text-ds-ink'}`}>
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {state === 'done' ? <Check className="h-3.5 w-3.5 text-ds-success" strokeWidth={2.4} />
                  : state === 'active' ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent motion-reduce:animate-none" strokeWidth={2.2} />
                    : <span className="h-1.5 w-1.5 rounded-full bg-ds-border" />}
              </span>
              <span className={state === 'active' ? 'font-medium' : ''}>{label(step)}</span>
            </li>
          )
        })}
      </ol>
      {lastLine ? <p className="truncate rounded-md bg-ds-subtle px-2 py-1 font-mono text-[11px] text-ds-muted" title={lastLine} data-agent-update-last-line>{lastLine}</p> : null}
    </div>
  )
}
