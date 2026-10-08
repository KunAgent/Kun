import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import type { HarnessUpdateJob, HarnessUpdateState } from '../../../../../kun/src/contracts/harness-update'
import { agentUpdateRequest, checkHarnessUpdate, dismissHarnessUpdate, harnessUpdateBusy, receiveHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
import { invalidateHarnessModels, loadHarnesses, loadHarnessModels } from '../../store/harness-store'
import { waitForAgentSettings } from './agent-enablement-settings'
import { useChatStore } from '../../store/chat-store'
import { AgentSetupHelpButton } from './AgentSetupHelpButton'
import { settingsButtonClass } from '../settings-button'
import { agentCommandPath, withAgentCommandPath } from '@shared/harness-provider-settings'

type T = (key: string, options?: Record<string, unknown>) => string
export function AgentUpdateControl({ row, settings, patch, beforeCheck, t }: {
  row: AdeHarnessRow; settings: KunHarnessSettingsV1; patch: (value: Partial<KunHarnessSettingsV1>) => void
  beforeCheck?: () => Promise<boolean>; t: T
}) {
  const id = row.definition.id
  const entry = useHarnessUpdateStore((state) => state.entries[id])
  const latest = useRef({ settings, patch, beforeCheck }); latest.current = { settings, patch, beforeCheck }
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  const applying = useRef<string | null>(null)
  const state = entry?.info, job = state?.job
  const updating = harnessUpdateBusy(job)
  const busy = pending || updating
  // A running check may replace the installation these actions were offered for.
  const checking = Boolean(entry?.loading)
  useEffect(() => { void checkHarnessUpdate(id, false, true) }, [id])
  useEffect(() => {
    if (!updating) return
    const timer = setInterval(() => { void agentUpdateRequest<HarnessUpdateState>(id).then(receiveHarnessUpdate).catch((cause) => setError(String(cause))) }, 1_500)
    return () => clearInterval(timer)
  }, [id, updating])

  const activate = useCallback(async (current: HarnessUpdateJob): Promise<void> => {
    if (!current.activationPath || applying.current) return
    if (row.status.resolvedCommand && current.previousPath && row.status.resolvedCommand !== current.previousPath &&
      row.status.resolvedCommand !== current.activationPath) { setError(t('agentUpdate.settingsChanged')); return }
    applying.current = current.id; setPending(true); setError('')
    const selected = agentCommandPath(latest.current.settings.providers, id)
    const original = selected === current.activationPath ? current.previousPath : selected
    const providers = withAgentCommandPath(latest.current.settings.providers, id, current.activationPath)
    let saved = false
    try {
      const confirmed = await agentUpdateRequest<HarnessUpdateState>(id)
      if (confirmed.job?.id !== current.id || confirmed.job.status !== 'ready' ||
        confirmed.job.activationFingerprint !== current.activationFingerprint || confirmed.job.activationPath !== current.activationPath) {
        throw new Error(t('agentUpdate.settingsChanged'))
      }
      latest.current.patch({ providers })
      saved = true
      if (latest.current.beforeCheck && !await latest.current.beforeCheck()) throw new Error(t('agentUpdate.saveFailed'))
      await waitForAgentSettings({ ...latest.current.settings, providers }, AbortSignal.timeout(30_000), { harnessId: id })
      await agentUpdateRequest(id, 'activate', { jobId: current.id })
      invalidateHarnessModels(id)
      await loadHarnesses(true)
      await loadHarnessModels(id, true)
      await checkHarnessUpdate(id, true)
    } catch (cause) {
      // Restore only this path; retain other settings edited while the updater ran.
      if (saved) {
        // Settings diffs cannot represent deletion with undefined; pin the
        // previous effective executable when discovery was previously automatic.
        const restore = withAgentCommandPath(latest.current.settings.providers, id, original || current.previousPath || '')
        latest.current.patch({ providers: restore })
        try {
          if (latest.current.beforeCheck && !await latest.current.beforeCheck()) throw new Error(t('agentUpdate.saveFailed'))
          await waitForAgentSettings({ ...latest.current.settings, providers: restore }, AbortSignal.timeout(30_000), { harnessId: id })
          await agentUpdateRequest(id, 'cancel', { jobId: current.id })
          await checkHarnessUpdate(id, true)
          await loadHarnesses(true)
        } catch (restoreError) { setError(`${String(cause)} · ${String(restoreError)}`); return }
      }
      setError(String(cause))
    } finally { applying.current = null; setPending(false) }
  }, [id, row.status.resolvedCommand, t])
  const autoApplied = useRef('')
  useEffect(() => {
    if (job?.status !== 'ready' || autoApplied.current === job.id) return
    autoApplied.current = job.id
    void activate(job)
  }, [activate, job])

  const start = async (action: HarnessUpdateJob['action']): Promise<void> => {
    if (!state || pending || entry?.loading) return
    setPending(true); setError('')
    try {
      if (latest.current.beforeCheck && !await latest.current.beforeCheck()) throw new Error(t('agentUpdate.saveFailed'))
      // Saving settings can finish a re-check; pin the installation shown now.
      const shown = useHarnessUpdateStore.getState().entries[id]?.info?.current.fingerprint ?? state.current.fingerprint
      receiveHarnessUpdate(await agentUpdateRequest(id, 'start', { action, expectedFingerprint: shown }))
    } catch (cause) {
      if (/installation changed/i.test(String(cause))) {
        // Show what is installed now instead of a bare mismatch.
        await checkHarnessUpdate(id, true).catch(() => undefined)
        setError(t('agentUpdate.installationChanged'))
      } else setError(String(cause))
    } finally { setPending(false) }
  }
  const refreshModels = async (): Promise<void> => { invalidateHarnessModels(id); await loadHarnessModels(id, true) }
  const failure = error || entry?.error || job?.error || state?.error
  const statusKey = job?.status ?? (entry?.loading ? 'checking' : state?.status ?? 'unchecked')
  const available = !busy && Boolean(state?.canUpdate || state?.candidate)
  const rowClass = 'flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3 py-3'
  const small = settingsButtonClass({ size: 'compact' })
  return <section className="ds-settings-card rounded-[var(--ds-radius-card)] border border-ds-border bg-ds-card" data-agent-update={id}>
    <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-[18px]">
      <div className="min-w-0">
        <h2 className="ds-settings-card-title">{t('agentUpdate.title')}</h2>
        <p className="ds-settings-card-description mt-1" role="status">{t(`agentUpdate.${statusKey}`)}</p>
      </div>
      <span className="shrink-0 font-mono text-[20px] font-semibold text-ds-ink" data-agent-version>{state?.current.version ?? '—'}</span>
    </div>
    <div className="divide-y divide-ds-border-muted px-2">
      {state ? <div className={rowClass}>
        <div className="min-w-0 text-[12px] text-ds-muted">
          <p>{t('agentUpdate.currentVersion', { version: state.current.version ?? '—', source: t(`agentUpdate.source.${state.current.source}`) })}{state.current.source === 'application' && state.current.owner ? ` · ${state.current.owner}` : ''}</p>
          {state.current.path ? <p className="mt-0.5 break-all font-mono text-[11px] text-ds-faint">{state.current.path}</p> : null}
        </div>
      </div> : null}
      {available ? <div className={`${rowClass} my-2 rounded-xl bg-accent-soft`} data-agent-update-available>
        <div className="min-w-0 text-[12px] text-ds-ink">
          {state?.latestVersion ? <p className="font-medium">{t('agentUpdate.latestVersion', { version: state.latestVersion, channel: state.channel })}</p> : null}
          {state?.candidate ? <p className="font-medium">{t('agentUpdate.localVersion', { version: state.candidate.version })}</p> : null}
          <p className="mt-0.5 text-ds-muted">{t('agentUpdate.hint')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {state?.status === 'available' ? <>
            <button type="button" className={settingsButtonClass({ variant: 'link', size: 'compact' })} onClick={() => dismissHarnessUpdate(id, true)}>{t('agentUpdate.later')}</button>
            <button type="button" className={settingsButtonClass({ variant: 'link', size: 'compact' })} onClick={() => dismissHarnessUpdate(id)}>{t('agentUpdate.ignore')}</button>
          </> : null}
          {state?.canUpdate ? <button type="button" className={settingsButtonClass({ variant: 'primary', size: 'compact' })} disabled={checking} onClick={() => void start('update')}>{t('agentUpdate.update')}</button> : null}
          {!state?.canUpdate && state?.candidate ? <button type="button" className={settingsButtonClass({ variant: 'primary', size: 'compact' })} disabled={checking} onClick={() => void start('use-local')}>{t('agentUpdate.useLocal')}</button> : null}
        </div>
      </div> : null}
      <div className={rowClass}>
        <div className="min-w-0 text-[12px] text-ds-muted">
          <div className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.check')}</div>
          {state?.checkedAt ? <p className="mt-0.5">{t('agentUpdate.checkedAt', { time: new Date(state.checkedAt).toLocaleString() })}</p> : null}
        </div>
        <button type="button" className={small} disabled={busy || entry?.loading} onClick={() => void checkHarnessUpdate(id, true)}>{t('agentUpdate.check')}</button>
      </div>
      {!busy && state?.candidate && state.canUpdate ? <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.useLocal')}</span>
        <button type="button" className={small} disabled={checking} onClick={() => void start('use-local')}>{t('agentUpdate.useLocal')}</button>
      </div> : null}
      {!busy && state?.canInstallManaged && state.latestVersion && state.current.source !== 'managed' ? <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.managed')}</span>
        <button type="button" className={small} disabled={checking} onClick={() => void start('managed')}>{t('agentUpdate.managed')}</button>
      </div> : null}
      {!busy && state?.ownerUpdateRequired ? <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.updateOwner')}</span>
        <button type="button" className={small} onClick={() => {
          if (state.current.owner === 'Kun') useChatStore.getState().openSettings('updates')
          else if (state.docsUrl?.startsWith('https://')) void window.kunGui?.openExternal(state.docsUrl)
        }}>{t('agentUpdate.updateOwner')}</button>
      </div> : null}
      <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.refreshModels')}</span>
        <button type="button" className={small} disabled={busy} onClick={() => void refreshModels()}>{t('agentUpdate.refreshModels')}</button>
      </div>
      {(job && harnessUpdateBusy(job) && !pending) || (job?.status === 'ready' && error) ||
        (job?.status === 'completed' && job.previousPath && job.previousPath !== job.activationPath) ? <div className={`${rowClass} justify-end`}>
        {job && harnessUpdateBusy(job) && !pending ? <button type="button" className={small} onClick={() => void agentUpdateRequest(id, 'cancel', { jobId: job.id }).then(() => checkHarnessUpdate(id, true))}>{t('cancel')}</button> : null}
        {job?.status === 'ready' && error ? <button type="button" className={small} onClick={() => void activate(job)}>{t('agentUpdate.activate')}</button> : null}
        {job?.status === 'completed' && job.previousPath && job.previousPath !== job.activationPath ? <button type="button" className={small} onClick={() => {
          void agentUpdateRequest<HarnessUpdateState>(id, 'rollback', { jobId: job.id }).then(receiveHarnessUpdate).catch((cause) => setError(String(cause)))
        }}>{t('agentUpdate.rollback')}</button> : null}
      </div> : null}
      {failure ? <div className="space-y-1 px-3 py-3">
        <p role="alert" className="break-words text-[11px] text-orange-600">{failure}</p>
        {!busy ? <AgentSetupHelpButton t={t} issue={{
          harnessId: id, operation: 'update', error: failure, output: job?.output,
          currentVersion: state?.current.version, currentPath: state?.current.path, targetVersion: job?.version ?? state?.latestVersion
        }} /> : null}
      </div> : null}
      <details className="px-3 py-3 text-[11px] text-ds-muted"><summary className="cursor-pointer">{t('agentUpdate.details')}</summary>
        <code className="mt-2 block break-all">{state?.current.path}</code>
        {job?.output ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{job.output}</pre> : null}
      </details>
    </div>
  </section>
}
