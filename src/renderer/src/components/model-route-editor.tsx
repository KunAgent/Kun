import type { TFunction } from 'i18next'
import { Trash2 } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import type { ModelProviderSettingsV1, ModelRoutePoolV1, ModelRouteStrategy } from '@shared/app-settings'
import { RouteGovernanceFields } from './route-governance-fields'
import { settingsButtonClass } from './settings-button'
import { Toggle } from './settings-controls'
import { compactInputClass, Field, inputClass, ToggleRow, type useValidatedTextDraft } from './settings-section-model-routes-support'
import { ModelRouteTargets } from './settings-section-model-routes-targets'
import { ModelRouteDecisions } from './settings-section-model-routes-rules'
import type { RouteStatus } from './settings-section-model-routes'

type TextDraft = ReturnType<typeof useValidatedTextDraft>

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): ReactElement {
  return <section className="grid min-w-0 gap-3 border-t border-ds-border-muted pt-5">
    <div>
      <h4 className="text-[13px] font-semibold text-ds-ink">{title}</h4>
      {description ? <p className="mt-0.5 text-[11.5px] leading-5 text-ds-faint">{description}</p> : null}
    </div>
    {children}
  </section>
}

/**
 * Everything about one routed model on one page: its public id and strategy,
 * where requests go, when to fail over, and the end-to-end check.
 */
export function ModelRouteEditor({ t, settings, pool, strategies, metrics, modelIdDraft, failoverCodesDraft, onUpdate, onRemove, verification }: {
  t: TFunction
  settings: ModelProviderSettingsV1
  pool: ModelRoutePoolV1
  strategies: { id: ModelRouteStrategy; label: string }[]
  metrics: RouteStatus['metrics']
  modelIdDraft: TextDraft
  failoverCodesDraft: TextDraft
  onUpdate: (patch: Partial<ModelRoutePoolV1>) => void
  onRemove: () => void
  verification: ReactNode
}): ReactElement {
  const failure = pool.failurePolicy
  const health = pool.healthPolicy
  return <div className="grid min-w-0 content-start gap-5" data-model-route-editor={pool.id}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[11px] font-medium text-accent">{settings.localGateway.name} / {t('modelRoutes.routedModel')}</p>
        <input aria-label={t('modelRoutes.routeModelNameAria')} value={pool.name} onChange={(event) => onUpdate({ name: event.target.value })}
          className="w-full bg-transparent text-[18px] font-semibold text-ds-ink outline-none" />
        <p className="mt-1 text-[12px] text-ds-faint">{t('modelRoutes.hotUpdateHint')}</p>
      </div>
      <div className="flex items-center gap-3"><span className="text-[12px] text-ds-muted">{t('modelRoutes.enable')}</span>
        <Toggle checked={pool.enabled} onChange={(enabled) => onUpdate({ enabled })} ariaLabel={t('modelRoutes.enablePoolAria')} /></div>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <Field label={t('modelRoutes.publicModelId')}><input aria-label={t('modelRoutes.publicModelId')} value={modelIdDraft.draft}
          onChange={(event) => modelIdDraft.onChange(event.target.value)} onFocus={modelIdDraft.onFocus} onBlur={modelIdDraft.onBlur}
          onKeyDown={modelIdDraft.onKeyDown} className={`${inputClass} font-mono`} spellCheck={false} /></Field>
        {modelIdDraft.error ? <p className="mt-1 text-[11px] text-ds-status-danger">{modelIdDraft.error}</p>
          : <p className="mt-1 text-[11px] text-ds-faint">{t('gatewaySetup.publicIdHint')}</p>}
      </div>
      <Field label={t('modelRoutes.loadStrategy')}><select value={pool.strategy} onChange={(event) => onUpdate({ strategy: event.target.value as ModelRouteStrategy })}
        className={inputClass}>{strategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}</select></Field>
      <RouteGovernanceFields pool={pool} update={onUpdate} inputClass={inputClass} translation={t} />
    </div>

    <ModelRouteTargets settings={settings} pool={pool} routes={settings.routePools} metrics={metrics} onUpdate={onUpdate} t={t} />
    <ModelRouteDecisions settings={settings} pool={pool} onUpdate={onUpdate} t={t} />

    <Section title={t('gatewaySetup.resilienceTitle')} description={t('modelRoutes.afterStreamNoRetry')}>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="grid content-start gap-3 rounded-xl border border-ds-border p-4 text-[12px] text-ds-muted">
          <div className="text-[12px] font-medium text-ds-ink">{t('modelRoutes.failoverRules')}</div>
          <ToggleRow label={t('modelRoutes.networkError')} checked={failure.failoverOnNetworkError} onChange={(value) => onUpdate({ failurePolicy: { ...failure, failoverOnNetworkError: value } })} />
          <ToggleRow label={t('modelRoutes.requestTimeout')} checked={failure.failoverOnTimeout} onChange={(value) => onUpdate({ failurePolicy: { ...failure, failoverOnTimeout: value } })} />
          <ToggleRow label={t('modelRoutes.credentialError')} checked={failure.failoverOnAuthError} onChange={(value) => onUpdate({ failurePolicy: { ...failure, failoverOnAuthError: value } })} />
          <div><Field label={t('modelRoutes.failoverStatuses')}><input aria-label={t('modelRoutes.failoverStatuses')} value={failoverCodesDraft.draft}
            onChange={(event) => failoverCodesDraft.onChange(event.target.value)} onFocus={failoverCodesDraft.onFocus} onBlur={failoverCodesDraft.onBlur}
            onKeyDown={failoverCodesDraft.onKeyDown} className={compactInputClass} /></Field>
          {failoverCodesDraft.error ? <p className="mt-1 text-[11px] text-ds-status-danger">{failoverCodesDraft.error}</p> : null}</div>
        </div>
        <div className="grid content-start gap-3 rounded-xl border border-ds-border p-4">
          <div className="text-[12px] font-medium text-ds-ink">{t('modelRoutes.healthCircuit')}</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('modelRoutes.consecutiveFailures')}><input type="number" min={1} max={20} value={health.failureThreshold}
              onChange={(event) => onUpdate({ healthPolicy: { ...health, failureThreshold: Number(event.target.value) } })} className={compactInputClass} /></Field>
            <Field label={t('modelRoutes.cooldownSeconds')}><input type="number" min={1} value={Math.round(health.cooldownMs / 1000)}
              onChange={(event) => onUpdate({ healthPolicy: { ...health, cooldownMs: Number(event.target.value) * 1000 } })} className={compactInputClass} /></Field>
            <Field label={t('modelRoutes.halfOpenProbes')}><input type="number" min={1} max={10} value={health.halfOpenMaxAttempts}
              onChange={(event) => onUpdate({ healthPolicy: { ...health, halfOpenMaxAttempts: Number(event.target.value) } })} className={compactInputClass} /></Field>
          </div>
        </div>
      </div>
    </Section>

    <div className="border-t border-ds-border-muted pt-5">{verification}</div>

    <div className="flex justify-end border-t border-ds-border-muted pt-4">
      <button className={settingsButtonClass({ variant: 'danger-ghost' })} type="button" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />{t('modelRoutes.deleteModel')}
      </button>
    </div>
  </div>
}
