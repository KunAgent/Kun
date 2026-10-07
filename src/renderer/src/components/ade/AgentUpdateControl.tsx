import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import type { HarnessUpdateJob, HarnessUpdateState } from '../../../../../kun/src/contracts/harness-update'
import { agentUpdateRequest, checkHarnessUpdate, dismissHarnessUpdate, harnessUpdateBusy, receiveHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
import { invalidateHarnessModels, loadHarnesses, loadHarnessModels } from '../../store/harness-store'
import { waitForAgentSettings } from './agent-enablement-settings'
import { useChatStore } from '../../store/chat-store'
import { AgentSetupHelpButton } from './AgentSetupHelpButton'

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
    const selected = latest.current.settings.binaryPaths[id]
    const original = selected === current.activationPath ? current.previousPath : selected
    const paths = { ...latest.current.settings.binaryPaths, [id]: current.activationPath }
    let saved = false
    try {
      const confirmed = await agentUpdateRequest<HarnessUpdateState>(id)
      if (confirmed.job?.id !== current.id || confirmed.job.status !== 'ready' ||
        confirmed.job.activationFingerprint !== current.activationFingerprint || confirmed.job.activationPath !== current.activationPath) {
        throw new Error(t('agentUpdate.settingsChanged'))
      }
      latest.current.patch({ binaryPaths: paths })
      saved = true
      if (latest.current.beforeCheck && !await latest.current.beforeCheck()) throw new Error(t('agentUpdate.saveFailed'))
      await waitForAgentSettings({ ...latest.current.settings, binaryPaths: paths }, AbortSignal.timeout(30_000), { harnessId: id })
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
        const restore = { ...latest.current.settings.binaryPaths, [id]: original || current.previousPath || '' }
        latest.current.patch({ binaryPaths: restore })
        try {
          if (latest.current.beforeCheck && !await latest.current.beforeCheck()) throw new Error(t('agentUpdate.saveFailed'))
          await waitForAgentSettings({ ...latest.current.settings, binaryPaths: restore }, AbortSignal.timeout(30_000), { harnessId: id })
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
    if (!state || pending) return
    setPending(true); setError('')
    try {
      if (latest.current.beforeCheck && !await latest.current.beforeCheck()) throw new Error(t('agentUpdate.saveFailed'))
      receiveHarnessUpdate(await agentUpdateRequest(id, 'start', { action, expectedFingerprint: state.current.fingerprint }))
    } catch (cause) { setError(String(cause)) } finally { setPending(false) }
  }
  const refreshModels = async (): Promise<void> => { invalidateHarnessModels(id); await loadHarnessModels(id, true) }
  const button = 'rounded-lg border border-ds-border-muted px-3 py-1.5 text-[12px] text-ds-ink hover:bg-ds-hover disabled:opacity-50'
  const failure = error || entry?.error || job?.error || state?.error
  return <div className="mt-3 space-y-2 rounded-xl border border-ds-border-muted bg-ds-main/40 p-3" data-agent-update={id}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
      <span className="font-medium">{t('agentUpdate.title')}</span>
      <span className="text-ds-muted" role="status">{t(`agentUpdate.${job?.status ?? (entry?.loading ? 'checking' : state?.status ?? 'unchecked')}`)}</span>
    </div>
    {state ? <>
      <p className="text-[12px] text-ds-muted">{t('agentUpdate.currentVersion', { version: state.current.version ?? '—', source: t(`agentUpdate.source.${state.current.source}`) })}{state.current.source === 'application' && state.current.owner ? ` · ${state.current.owner}` : ''}</p>
      {state.latestVersion ? <p className="text-[12px] text-ds-muted">{t('agentUpdate.latestVersion', { version: state.latestVersion, channel: state.channel })}</p> : null}
      {state.candidate ? <p className="text-[12px] text-accent">{t('agentUpdate.localVersion', { version: state.candidate.version })}</p> : null}
    </> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || entry?.loading} onClick={() => void checkHarnessUpdate(id, true)}>{t('agentUpdate.check')}</button>
      {!busy && state?.candidate ? <button type="button" className={button} onClick={() => void start('use-local')}>{t('agentUpdate.useLocal')}</button> : null}
      {!busy && state?.canUpdate ? <button type="button" className={button} onClick={() => void start('update')}>{t('agentUpdate.update')}</button> : null}
      {!busy && state?.canInstallManaged && state.latestVersion && state.current.source !== 'managed' ? <button type="button" className={button} onClick={() => void start('managed')}>{t('agentUpdate.managed')}</button> : null}
      {!busy && state?.ownerUpdateRequired ? <button type="button" className={button} onClick={() => {
        if (state.current.owner === 'Kun') useChatStore.getState().openSettings('updates')
        else if (state.docsUrl?.startsWith('https://')) void window.kunGui?.openExternal(state.docsUrl)
      }}>{t('agentUpdate.updateOwner')}</button> : null}
      <button type="button" className={button} disabled={busy} onClick={() => void refreshModels()}>{t('agentUpdate.refreshModels')}</button>
      {job && harnessUpdateBusy(job) && !pending ? <button type="button" className={button} onClick={() => void agentUpdateRequest(id, 'cancel', { jobId: job.id }).then(() => checkHarnessUpdate(id, true))}>{t('cancel')}</button> : null}
      {job?.status === 'ready' && error ? <button type="button" className={button} onClick={() => void activate(job)}>{t('agentUpdate.activate')}</button> : null}
      {job?.status === 'completed' && job.previousPath && job.previousPath !== job.activationPath ? <button type="button" className={button} onClick={() => {
        void agentUpdateRequest<HarnessUpdateState>(id, 'rollback', { jobId: job.id }).then(receiveHarnessUpdate).catch((cause) => setError(String(cause)))
      }}>{t('agentUpdate.rollback')}</button> : null}
    </div>
    {state?.status === 'available' && !busy ? <div className="flex gap-3 text-[11px] text-ds-muted"><button onClick={() => dismissHarnessUpdate(id, true)}>{t('agentUpdate.later')}</button><button onClick={() => dismissHarnessUpdate(id)}>{t('agentUpdate.ignore')}</button></div> : null}
    <p className="text-[11px] leading-5 text-ds-faint">{t('agentUpdate.hint')}</p>
    {failure ? <p role="alert" className="break-words text-[11px] text-orange-600">{failure}</p> : null}
    {failure && !busy ? <AgentSetupHelpButton t={t} issue={{
      harnessId: id, operation: 'update', error: failure, output: job?.output,
      currentVersion: state?.current.version, currentPath: state?.current.path, targetVersion: job?.version ?? state?.latestVersion
    }} /> : null}
    <details className="text-[11px] text-ds-muted"><summary className="cursor-pointer">{t('agentUpdate.details')}</summary>
      <code className="mt-2 block break-all">{state?.current.path}</code>
      {state?.checkedAt ? <p>{t('agentUpdate.checkedAt', { time: new Date(state.checkedAt).toLocaleString() })}</p> : null}
      {job?.output ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{job.output}</pre> : null}
    </details>
  </div>
}
