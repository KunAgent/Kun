import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, CheckCircle2 } from 'lucide-react'
import type { HarnessInstallAction, HarnessInstallState } from '../../../../../kun/src/contracts/harness-install'
import { harnessInstallRequest } from '../../agent/kun-harness-install-client'
import { loadHarnesses } from '../../store/harness-store'
import { AgentSetupHelpButton } from './AgentSetupHelpButton'
import { setAgentInstall } from './agent-center-activity-store'
import { AgentElapsed } from './AgentCenterParts'
import { agentUpdateLastLine } from './AgentUpdateProgress'
import { installObservation } from './use-agent-install-watch'
import { settingsButtonClass } from '../settings-button'

type T = (key: string, options?: Record<string, unknown>) => string

export function AgentInstallControl({ harnessId, action, needed, t }: {
  harnessId: string; action: HarnessInstallAction; needed: boolean; t: T
}) {
  const [state, setState] = useState<HarnessInstallState>()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [revision, setRevision] = useState(0)
  const completed = useRef('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const refresh = async () => {
      let keepPolling = false
      try {
        const value = await harnessInstallRequest(harnessId, action)
        if (disposed) return
        setState(value)
        setError('')
        setAgentInstall(harnessId, value?.job ? installObservation(value.job, action) : undefined)
        keepPolling = value?.job?.status === 'running' || value?.job?.status === 'verifying'
        if (value?.job && !['running', 'verifying'].includes(value.job.status) && completed.current !== value.job.id) {
          completed.current = value.job.id
          void loadHarnesses(true, { waitMs: 3_000 })
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!disposed && keepPolling) timer = setTimeout(refresh, 1_500)
      }
    }
    void refresh()
    return () => { disposed = true; mounted.current = false; if (timer) clearTimeout(timer) }
  }, [harnessId, action, revision])
  const job = state?.job
  const busy = pending || job?.status === 'running' || job?.status === 'verifying'
  const run = async (operation: 'start' | 'cancel') => {
    setPending(true)
    setError('')
    try {
      const result = await harnessInstallRequest(harnessId, action, operation, job?.id)
      if (mounted.current && result) setState(result)
      if (mounted.current) setRevision((value) => value + 1)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { if (mounted.current) setPending(false) }
  }
  if (!needed && !job && !error) return null
  const failed = job?.status === 'failed'
  const startedAt = job ? Date.parse(job.startedAt) : NaN
  const lastLine = busy && job ? agentUpdateLastLine(job.output) : undefined
  const tone = busy ? 'border-[color-mix(in_srgb,var(--ds-accent)_20%,transparent)] bg-accent-soft'
    : failed || error ? 'border-[color-mix(in_srgb,var(--ds-warning)_28%,transparent)] bg-[var(--ds-warning-soft)]'
      : 'border-ds-border-muted bg-ds-card'
  return <div className={`mt-3 space-y-2 rounded-xl border px-3.5 py-3 ${tone}`} data-agent-install={harnessId}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1 basis-56 text-[12px]">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink" role="status" aria-live="polite">
          {busy ? <LoaderCircle aria-hidden size={14} className="animate-spin text-accent" /> : job?.status === 'completed' ? <CheckCircle2 aria-hidden size={14} className="text-ds-status-success" /> : null}
          {t(`agentInstall.${job?.status ?? 'title'}`)}
          {busy && Number.isFinite(startedAt) ? <AgentElapsed since={startedAt} className="text-[12px] font-normal text-ds-muted" /> : null}
        </div>
        <p className="mt-1 text-[12px] leading-[1.45] text-ds-muted">{t(job?.status === 'completed' ? 'agentInstall.signInHint'
          : busy ? 'agentCenter.activity.installLeaveHint' : 'agentInstall.description')}</p>
      </div>
      {busy ? <button aria-busy={pending} type="button" disabled={pending} onClick={() => void run('cancel')}
        className={settingsButtonClass({ size: 'compact', variant: 'ghost' })}>{t('agentInstall.cancel')}</button>
        : needed || failed || job?.status === 'cancelled' ? <button aria-busy={pending} type="button"
          disabled={!state?.plan?.available || pending} onClick={() => void run('start')}
          className={settingsButtonClass({ size: 'compact', variant: 'primary' })} data-agent-install-start>
          {pending ? <LoaderCircle aria-hidden size={14} className="animate-spin" /> : <Download aria-hidden size={14} />}
          {t(job ? 'agentInstall.retry' : action === 'adapter' ? 'agentInstall.adapter' : 'agentInstall.start')}
        </button> : null}
    </div>
    {lastLine ? <p className="truncate rounded-lg bg-ds-card px-2.5 py-1.5 font-mono text-[11px] text-ds-muted" title={lastLine} data-agent-install-last-line>{lastLine}</p> : null}
    {state && !state.plan ? <p className="text-[11.5px] text-ds-muted">{t('agentInstall.unsupported')}</p> : null}
    {state?.plan?.missingCommand ? <p className="text-[11.5px] text-ds-status-warning">{t('agentInstall.missingCommand', { command: state.plan.missingCommand })}</p> : null}
    {error || job?.error ? <p className="break-words text-[12px] text-ds-status-danger" role="alert">{error || job?.error}</p> : null}
    {error ? <button type="button" onClick={() => setRevision((value) => value + 1)} className={settingsButtonClass({ size: 'compact', variant: 'link' })}>{t('adeAgentAction.retry')}</button> : null}
    {!busy && (error || failed) ? <AgentSetupHelpButton t={t} issue={{
      harnessId, operation: action === 'adapter' ? 'adapter' : 'install',
      command: job?.command ?? state?.plan?.command, error: error || job?.error, output: job?.output
    }} /> : null}
    {state?.plan || job ? <details className="text-[11.5px] text-ds-muted">
      <summary className="cursor-pointer">{t('agentInstall.details')}</summary>
      <code className="mt-2 block break-all font-mono">{job?.command ?? state?.plan?.command}</code>
      {job?.output ? <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ds-subtle p-2 font-mono">{job.output}</pre> : null}
    </details> : null}
  </div>
}
