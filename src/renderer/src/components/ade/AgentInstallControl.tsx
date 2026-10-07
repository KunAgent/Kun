import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, CheckCircle2 } from 'lucide-react'
import type { HarnessInstallAction, HarnessInstallState } from '../../../../../kun/src/contracts/harness-install'
import { harnessInstallRequest } from '../../agent/kun-harness-install-client'
import { loadHarnesses } from '../../store/harness-store'
import { AgentSetupHelpButton } from './AgentSetupHelpButton'

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
  return <div className="mt-3 rounded-xl border border-ds-border-muted bg-ds-main/40 p-3" data-agent-install={harnessId}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 text-[12px]">
        <div className="flex items-center gap-1.5 font-medium text-ds-ink" role="status" aria-live="polite">
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : job?.status === 'completed' ? <CheckCircle2 size={14} className="text-emerald-500" /> : null}
          {t(`agentInstall.${job?.status ?? 'title'}`)}
        </div>
        <p className="mt-1 text-[11px] text-ds-faint">{t(job?.status === 'completed' ? 'agentInstall.signInHint' : 'agentInstall.description')}</p>
      </div>
      {busy ? <button aria-busy={pending} data-settings-action="secondary" data-settings-size="default" type="button" disabled={pending} onClick={() => void run('cancel')}
        className="rounded-lg border border-ds-border-muted px-3 py-1.5 text-[12px] text-ds-muted disabled:opacity-45">{t('agentInstall.cancel')}</button>
        : needed || job?.status === 'failed' || job?.status === 'cancelled' ? <button aria-busy={pending} data-settings-action="primary" data-settings-size="default" type="button"
          disabled={!state?.plan?.available || pending} onClick={() => void run('start')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-45" data-agent-install-start>
          <Download size={14} />{t(job ? 'agentInstall.retry' : action === 'adapter' ? 'agentInstall.adapter' : 'agentInstall.start')}
        </button> : null}
    </div>
    {state && !state.plan ? <p className="mt-2 text-[11px] text-ds-muted">{t('agentInstall.unsupported')}</p> : null}
    {state?.plan?.missingCommand ? <p className="mt-2 text-[11px] text-amber-600">{t('agentInstall.missingCommand', { command: state.plan.missingCommand })}</p> : null}
    {error || job?.error ? <p className="mt-2 break-words text-[11px] text-red-600" role="alert">{error || job?.error}</p> : null}
    {error ? <button data-settings-action="link" data-settings-size="compact" type="button" onClick={() => setRevision((value) => value + 1)} className="mt-1 text-[11px] text-accent">{t('adeAgentAction.retry')}</button> : null}
    {!busy && (error || job?.status === 'failed') ? <AgentSetupHelpButton t={t} issue={{
      harnessId, operation: action === 'adapter' ? 'adapter' : 'install',
      command: job?.command ?? state?.plan?.command, error: error || job?.error, output: job?.output
    }} /> : null}
    {state?.plan || job ? <details className="mt-2 text-[11px] text-ds-muted">
      <summary className="cursor-pointer">{t('agentInstall.details')}</summary>
      <code className="mt-2 block break-all">{job?.command ?? state?.plan?.command}</code>
      {job?.output ? <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ds-main p-2 font-mono">{job.output}</pre> : null}
    </details> : null}
  </div>
}
