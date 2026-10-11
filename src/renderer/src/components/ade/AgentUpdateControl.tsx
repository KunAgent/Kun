import { useEffect, useState, type ReactElement } from 'react'
import { ArrowUpCircle, Check, LoaderCircle, RefreshCw } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { checkHarnessUpdate, dismissHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
import { AGENT_UPDATE_RUNNING, rollbackAgentUpdate, startAgentUpdate, useAgentUpdateRunner } from '../../store/harness-update-runner'
import { invalidateHarnessModels, loadHarnessModels } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { AgentSetupHelpButton } from './AgentSetupHelpButton'
import { AgentUpdateProgress, formatAgentUpdateElapsed } from './AgentUpdateProgress'
import { AgentSection } from './AgentCenterParts'
import { settingsButtonClass } from '../settings-button'

type T = (key: string, options?: Record<string, unknown>) => string
const rowClass = 'flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-3 py-3'

/**
 * The Version tab: what runs now, the update on offer, and the update in
 * flight. The work itself belongs to the background runner, so this view can
 * unmount at any step; it only starts, cancels and reads.
 */
export function AgentUpdateControl({ row, t }: { row: AdeHarnessRow; t: T }): ReactElement {
  const id = row.definition.id
  const entry = useHarnessUpdateStore((state) => state.entries[id])
  const item = useAgentUpdateRunner((state) => state.items[id])
  const [refreshing, setRefreshing] = useState(false)
  const state = entry?.info
  const job = state?.job
  // A running check may replace the installation these actions were offered for.
  const checking = Boolean(entry?.loading)
  const running = Boolean(item && AGENT_UPDATE_RUNNING.has(item.phase))
  const failed = item?.phase === 'failed'
  useEffect(() => { void checkHarnessUpdate(id, false, true) }, [id])

  const text = (value?: string): string => value?.startsWith('agentUpdate.') ? t(value) : value ?? ''
  const failure = failed ? text(item.error) || t('agentUpdate.failed') : text(entry?.error || state?.error)
  const target = item?.version ?? state?.latestVersion ?? state?.candidate?.version
  const available = !running && !failed && Boolean(state?.canUpdate || state?.candidate)
  const status = running ? t('agentUpdate.running') : checking ? t('agentUpdate.checking')
    : state?.status === 'current' ? t('agentUpdate.upToDate') : t(`agentUpdate.${state?.status ?? 'unchecked'}`)
  const checkedAt = state?.checkedAt ? t('agentUpdate.checkedAt', { time: new Date(state.checkedAt).toLocaleString() }) : ''
  const rollbackJob = job?.status === 'completed' && job.previousPath && job.previousPath !== job.activationPath ? job : undefined
  const refreshModels = async (): Promise<void> => {
    setRefreshing(true)
    try { invalidateHarnessModels(id); await loadHarnessModels(id, true) } finally { setRefreshing(false) }
  }
  const small = settingsButtonClass({ size: 'compact' })

  return <div className="space-y-6" data-agent-update={id}>
    <AgentSection title={t('agentUpdate.title')} description={[status, checkedAt].filter(Boolean).join(' · ')}
      action={<button type="button" className={small} disabled={running || checking} aria-busy={checking || undefined}
        onClick={() => void checkHarnessUpdate(id, true)} data-agent-update-check>
        <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} strokeWidth={2} />{t('agentUpdate.check')}
      </button>}>
      <div className="flex min-w-0 items-center gap-4 px-3 py-3.5">
        <span className="shrink-0 font-mono text-[22px] font-semibold leading-7 text-ds-ink" data-agent-version>{state?.current.version ?? row.status.version ?? '—'}</span>
        <div className="min-w-0 text-[12px] text-ds-muted">
          <p>{state ? t(`agentUpdate.source.${state.current.source}`) : ''}{state?.current.source === 'application' && state.current.owner ? ` · ${state.current.owner}` : ''}</p>
          {state?.current.path ? <p className="mt-0.5 truncate font-mono text-[11px] text-ds-faint" title={state.current.path}>{state.current.path}</p> : null}
        </div>
      </div>

      {running || failed ? <div className="space-y-3 px-3 py-3.5" data-agent-update-run={item.phase}>
        <AgentUpdateProgress phase={item.phase} failedAt={item.failedAt} action={item.action} startedAt={item.startedAt}
          output={item.output} version={target} t={t} />
        {running ? <p className="text-[12px] text-ds-muted">{t('agentCenter.activity.leaveHint')}</p> : null}
        {failed ? <>
          <p role="alert" className="break-words rounded-lg bg-[var(--ds-warning-soft)] px-3 py-2 text-[12px] leading-[1.5] text-ds-ink" data-agent-update-error>{failure}</p>
          <div className="flex flex-wrap items-center gap-2">
            {item.action !== 'rollback' ? <button type="button" className={settingsButtonClass({ variant: 'primary', size: 'compact' })}
              disabled={checking} onClick={() => void startAgentUpdate(id, item.action as 'update' | 'managed' | 'use-local')} data-agent-update-retry>
              {t('agentCenter.activity.retry')}</button> : null}
            <AgentSetupHelpButton t={t} issue={{ harnessId: id, operation: 'update', error: failure, output: item.output ?? job?.output,
              currentVersion: state?.current.version, currentPath: state?.current.path, targetVersion: target }} />
          </div>
        </> : null}
      </div> : null}

      {item?.phase === 'completed' ? <div className={rowClass} data-agent-update-done>
        <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-ds-ink">
          <Check aria-hidden className="h-4 w-4 shrink-0 text-ds-status-success" strokeWidth={2.4} />
          {t(item.action === 'rollback' ? 'agentCenter.activity.rollback.done' : 'agentCenter.activity.update.done', { version: item.version ?? state?.current.version ?? '' })}
          {item.finishedAt ? <span className="text-ds-faint">· {formatAgentUpdateElapsed(item.finishedAt - item.startedAt)}</span> : null}
        </span>
        {rollbackJob ? <button type="button" className={small} onClick={() => void rollbackAgentUpdate(id, rollbackJob.id)}>{t('agentCenter.activity.rollbackPlain')}</button> : null}
      </div> : null}

      {available ? <div className="m-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-accent-soft px-3 py-3" data-agent-update-available>
        <ArrowUpCircle aria-hidden className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
        <div className="min-w-0 flex-1 basis-56 text-[12px] text-ds-muted">
          <p className="text-[13px] font-medium text-ds-ink">{state?.canUpdate && state.latestVersion
            ? t('agentUpdate.newVersion', { version: state.latestVersion }) : t('agentUpdate.newLocal', { version: state?.candidate?.version ?? '' })}</p>
          <p className="mt-0.5">{t('agentUpdate.hint')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {state?.status === 'available' ? <>
            <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })} onClick={() => dismissHarnessUpdate(id, true)}>{t('agentUpdate.later')}</button>
            <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'compact' })} onClick={() => dismissHarnessUpdate(id)}>{t('agentUpdate.ignore')}</button>
          </> : null}
          {state?.canUpdate ? <button type="button" className={settingsButtonClass({ variant: 'primary', size: 'compact' })} disabled={checking}
            onClick={() => void startAgentUpdate(id, 'update')} data-agent-update-start>{state.latestVersion ? t('agentUpdate.updateTo', { version: state.latestVersion }) : t('agentUpdate.update')}</button>
            : state?.candidate ? <button type="button" className={settingsButtonClass({ variant: 'primary', size: 'compact' })} disabled={checking}
              onClick={() => void startAgentUpdate(id, 'use-local')} data-agent-update-start>{t('agentUpdate.useLocal')}</button> : null}
        </div>
      </div> : null}
    </AgentSection>

    <AgentSection>
      {!running && state?.candidate && state.canUpdate ? <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.localVersion', { version: state.candidate.version ?? '' })}</span>
        <button type="button" className={small} disabled={checking} onClick={() => void startAgentUpdate(id, 'use-local')}>{t('agentUpdate.useLocal')}</button>
      </div> : null}
      {!running && state?.canInstallManaged && state.latestVersion && state.current.source !== 'managed' ? <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.managed')}</span>
        <button type="button" className={small} disabled={checking} onClick={() => void startAgentUpdate(id, 'managed')}>{t('agentUpdate.managed')}</button>
      </div> : null}
      {!running && state?.ownerUpdateRequired ? <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.updateOwner')}</span>
        <button type="button" className={small} onClick={() => {
          if (state.current.owner === 'Kun') useChatStore.getState().openSettings('updates')
          else if (state.docsUrl?.startsWith('https://')) void window.kunGui?.openExternal(state.docsUrl)
        }}>{t('agentUpdate.updateOwner')}</button>
      </div> : null}
      {rollbackJob && item?.phase !== 'completed' && !running ? <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.retained')}</span>
        <button type="button" className={small} onClick={() => void rollbackAgentUpdate(id, rollbackJob.id)}>{t('agentUpdate.rollback')}</button>
      </div> : null}
      <div className={rowClass}>
        <span className="text-[13px] font-medium text-ds-ink">{t('agentUpdate.refreshModels')}</span>
        <button type="button" className={small} disabled={running || refreshing} aria-busy={refreshing || undefined} onClick={() => void refreshModels()}>
          {refreshing ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}{t('agentUpdate.refreshModels')}
        </button>
      </div>
      {!failed && failure ? <p role="alert" className="px-3 py-3 text-[12px] text-ds-status-danger">{failure}</p> : null}
      <details key={running ? 'running' : 'idle'} open={running || undefined} className="px-3 py-3 text-[12px] text-ds-muted">
        <summary className="cursor-pointer font-medium text-ds-ink">{t('agentUpdate.details')}</summary>
        <code className="mt-2 block break-all font-mono text-[11px]">{state?.current.path}</code>
        {item?.output ?? job?.output ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-ds-subtle p-2 font-mono text-[11px]">{item?.output ?? job?.output}</pre> : null}
      </details>
    </AgentSection>
  </div>
}
