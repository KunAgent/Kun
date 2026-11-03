import type { TFunction } from 'i18next'
import { Check } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { settingsButtonClass } from './settings-button'

type StepAction = { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }

function Step({ index, done, title, description, actions }: {
  index: number
  done: boolean
  title: string
  description: ReactNode
  actions: StepAction[]
}): ReactElement {
  return <li className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0" data-gateway-step={index} data-done={done}>
    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold ${done
      ? 'bg-ds-success-soft text-ds-status-success' : 'border border-ds-border bg-ds-main text-ds-muted'}`}>
      {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : index}
    </span>
    <div className="min-w-0 flex-1">
      <div className={`text-[13px] font-semibold ${done ? 'text-ds-muted' : 'text-ds-ink'}`}>{title}</div>
      <p className="mt-0.5 break-words text-[12px] leading-5 text-ds-muted">{description}</p>
    </div>
    {!done && actions.length ? <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
      {actions.map((action) => <button key={action.label} type="button" disabled={action.disabled} onClick={action.onClick}
        className={settingsButtonClass({ variant: action.primary ? 'primary' : 'secondary', size: 'compact' })}>{action.label}</button>)}
    </div> : null}
  </li>
}

/**
 * First-run path through the gateway: turn it on, give it models, connect an
 * agent. Each step says what it does and offers the one action that does it;
 * the card goes away once all three are done.
 */
export function GatewaySetupGuide({ t, address, enabled, keyReady, models, sharing, agents, pending, onEnable, onShareModels, onCreateRoute, onChooseAgent }: {
  t: TFunction
  address: string
  enabled: boolean
  keyReady: boolean
  /** Public model ids the runtime exports; undefined while it is unreachable. */
  models?: string[]
  sharing: boolean
  agents: number
  pending: boolean
  onEnable: () => void
  onShareModels: () => void
  onCreateRoute: () => void
  onChooseAgent: () => void
}): ReactElement | null {
  const on = enabled && keyReady
  const modelCount = models?.length ?? 0
  const steps = [on, modelCount > 0, agents > 0]
  if (steps.every(Boolean)) return null
  const shown = (models ?? []).slice(0, 3).join(', ') + (modelCount > 3 ? ' …' : '')
  return <section className="grid min-w-0 gap-3 rounded-2xl border border-ds-border bg-ds-card p-4" data-gateway-setup-guide>
    <div>
      <h3 className="text-[14px] font-semibold text-ds-ink">{t('gatewaySetup.guideTitle')}</h3>
      <p className="mt-1 max-w-[46rem] text-[12px] leading-5 text-ds-muted">{t('gatewaySetup.guideDesc')}</p>
    </div>
    <ol className="grid min-w-0 divide-y divide-ds-border-muted">
      <Step index={1} done={on} title={t('gatewaySetup.stepOn')}
        description={on ? t('gatewaySetup.stepOnDone') : t('gatewaySetup.stepOnDesc', { address })}
        actions={[{ label: t('gatewaySetup.stepOnAction'), onClick: onEnable, primary: true, disabled: pending }]} />
      <Step index={2} done={modelCount > 0} title={t('gatewaySetup.stepModels')}
        description={modelCount > 0 ? t('gatewaySetup.stepModelsDone', { count: modelCount, list: shown })
          : sharing ? t('gatewaySetup.stepModelsSharing') : t('gatewaySetup.stepModelsDesc')}
        actions={[
          ...(sharing ? [] : [{ label: t('gatewaySetup.stepModelsShare'), onClick: onShareModels, primary: on }]),
          { label: t('gatewaySetup.stepModelsRoute'), onClick: onCreateRoute, primary: on && sharing }
        ]} />
      <Step index={3} done={agents > 0} title={t('gatewaySetup.stepAgents')}
        description={agents > 0 ? t('gatewaySetup.stepAgentsDone', { count: agents }) : t('gatewaySetup.stepAgentsDesc')}
        actions={[{ label: t('gatewaySetup.stepAgentsAction'), onClick: onChooseAgent, primary: on && modelCount > 0 }]} />
    </ol>
  </section>
}
