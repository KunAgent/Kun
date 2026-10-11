import type { ReactElement, ReactNode } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { AGENT_UPDATE_RUNNING, cancelAgentUpdate, dismissAgentUpdate, rollbackAgentUpdate, startAgentUpdate,
  useAgentUpdateRunner, type AgentUpdatePhase } from '../../store/harness-update-runner'
import { settingsButtonClass } from '../settings-button'
import { AgentElapsed } from './AgentCenterParts'
import { formatAgentUpdateElapsed } from './AgentUpdateProgress'

type T = (key: string, options?: Record<string, unknown>) => string

const PROGRESS: Partial<Record<AgentUpdatePhase, number>> = { starting: 6, waiting: 16, running: 45, verifying: 74, switching: 90 }

const TONE = {
  running: 'border-[color-mix(in_srgb,var(--ds-accent)_20%,transparent)] bg-accent-soft',
  success: 'border-[color-mix(in_srgb,var(--ds-success)_22%,transparent)] bg-ds-success-soft',
  warning: 'border-[color-mix(in_srgb,var(--ds-warning)_28%,transparent)] bg-[var(--ds-warning-soft)]'
} as const

function Banner({ tone, icon, title, detail, children, progress, alert = false, ...data }: {
  tone: keyof typeof TONE
  icon: ReactNode
  title: ReactNode
  detail?: ReactNode
  children?: ReactNode
  progress?: number
  alert?: boolean
} & Record<`data-${string}`, string | undefined>): ReactElement {
  return <div role={alert ? 'alert' : 'status'} aria-live={alert ? undefined : 'polite'} {...data}
    className={`relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden rounded-xl border px-3.5 py-2.5 text-[12.5px] ${TONE[tone]}`}>
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
    <p className="min-w-0 flex-1 basis-56 leading-5 text-ds-ink">
      <span className="font-semibold">{title}</span>
      {detail ? <span className="text-ds-muted"> · {detail}</span> : null}
    </p>
    {children ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{children}</div> : null}
    {progress !== undefined ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-[color-mix(in_srgb,var(--ds-accent)_14%,transparent)]">
      <span className="block h-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
    </span> : null}
  </div>
}

/**
 * Work in flight for this Agent, right under its header and on every tab:
 * the enablement check, or the background update (running, then its result
 * until dismissed). The Version tab holds the step-by-step details.
 */
export function AgentActivityBanner({ row, tab, checking, checkPhase, onCancelCheck, onViewVersion, t }: {
  row: AdeHarnessRow
  tab: string
  checking: boolean
  checkPhase: string
  onCancelCheck: () => void
  onViewVersion: () => void
  t: T
}): ReactElement | null {
  const id = row.definition.id
  const name = row.definition.displayName
  const item = useAgentUpdateRunner((state) => state.items[id])
  const compact = settingsButtonClass({ size: 'compact' })
  const ghost = settingsButtonClass({ size: 'compact', variant: 'ghost' })
  const close = <button type="button" onClick={() => dismissAgentUpdate(id)} aria-label={t('agentCenter.activity.close')}
    title={t('agentCenter.activity.close')} data-agent-activity-close
    className="grid h-7 w-7 place-items-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40">
    <X aria-hidden className="h-3.5 w-3.5" strokeWidth={2.2} />
  </button>

  if (checking) {
    return <Banner tone="running" data-agent-check-progress="" icon={<LoaderCircle aria-hidden className="h-4 w-4 animate-spin text-accent" />}
      title={t('agentCenter.activity.checking', { name })} detail={t(`agentEnablement.phases.${checkPhase}`)}>
      <button type="button" onClick={onCancelCheck} data-agent-enable-cancel className={compact}>{t('agentEnablement.cancel')}</button>
    </Banner>
  }
  if (!item) return null
  const base = item.action === 'rollback' ? 'agentCenter.activity.rollback' : 'agentCenter.activity.update'
  if (AGENT_UPDATE_RUNNING.has(item.phase)) {
    return <Banner tone="running" data-agent-activity="update" data-phase={item.phase} progress={PROGRESS[item.phase]}
      icon={<LoaderCircle aria-hidden className="h-4 w-4 animate-spin text-accent" />}
      title={item.version ? t(`${base}.running`, { version: item.version }) : t(`${base}.runningPlain`)}
      detail={<>{t(`agentCenter.activity.step.${item.phase}`)} · <AgentElapsed since={item.startedAt} className="text-[12px]" /></>}>
      {tab !== 'version' ? <button type="button" onClick={onViewVersion} className={compact} data-agent-activity-view>{t('agentCenter.activity.view')}</button> : null}
      {item.phase !== 'switching' ? <button type="button" onClick={() => void cancelAgentUpdate(id)} className={ghost} data-agent-activity-cancel>
        {t('agentCenter.activity.cancel')}</button> : null}
    </Banner>
  }
  if (item.phase === 'completed') {
    return <Banner tone="success" data-agent-activity="update" data-phase="completed"
      icon={<span className="grid h-5 w-5 place-items-center rounded-full bg-ds-status-success text-white"><Check aria-hidden className="h-3 w-3" strokeWidth={3} /></span>}
      title={t(`${base}.done`, { version: item.version ?? '' })}
      detail={item.finishedAt ? t(`${base}.doneDetail`, { time: formatAgentUpdateElapsed(item.finishedAt - item.startedAt) }) : undefined}>
      {item.canRollback && item.jobId && item.action !== 'rollback' ? <button type="button" className={compact}
        onClick={() => void rollbackAgentUpdate(id, item.jobId!)} data-agent-activity-rollback>
        {item.previousVersion ? t('agentCenter.activity.rollbackTo', { version: item.previousVersion }) : t('agentCenter.activity.rollbackPlain')}</button> : null}
      {close}
    </Banner>
  }
  return <Banner tone="warning" alert data-agent-activity="update" data-phase="failed"
    icon={<span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--ds-warning)] text-[11px] font-bold text-white">!</span>}
    title={t(`${base}.failed`)} detail={t(`${base}.failedDetail`, { name })}>
    {item.action !== 'rollback' ? <button type="button" className={compact}
      onClick={() => void startAgentUpdate(id, item.action as 'update' | 'managed' | 'use-local')} data-agent-activity-retry>{t('agentCenter.activity.retry')}</button> : null}
    {tab !== 'version' ? <button type="button" onClick={onViewVersion} className={compact}>{t('agentCenter.toast.view')}</button> : null}
    {close}
  </Banner>
}
