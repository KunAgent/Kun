import { settingsButtonClass } from './settings-button'
import type { ModelProviderSettingsV1, ModelRoutePoolV1 } from '@shared/app-settings'
import { modelProviderIsOauthOrDelegated } from '@shared/app-settings-provider-failover'
import { resolveModelRouteTargetReference } from '@shared/app-settings-provider-core'
import type { TFunction } from 'i18next'
import { AlertTriangle, ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { Toggle } from './settings-controls'
import { Field, compactInputClass, reorderTarget } from './settings-section-model-routes-support'

type RouteMetrics = Record<string, { successes: number; failures: number; ewmaLatencyMs?: number; lastError?: string }>

export function ModelRouteTargets({
  settings,
  pool,
  metrics,
  onUpdate,
  t
}: {
  settings: ModelProviderSettingsV1
  pool: ModelRoutePoolV1
  metrics?: RouteMetrics
  onUpdate: (patch: Partial<ModelRoutePoolV1>) => void
  t: TFunction
}): ReactElement {
  const providers = settings.providers.filter((provider) => provider.models.length > 0 && !modelProviderIsOauthOrDelegated(provider))
  const changeTarget = (targetId: string, patch: Partial<ModelRoutePoolV1['targets'][number]>): void => {
    onUpdate({ targets: pool.targets.map((target) => target.id === targetId ? { ...target, ...patch } : target) })
  }
  const moveTarget = (source: number, destination: number): void => {
    if (destination < 0 || destination >= pool.targets.length) return
    const targets = [...pool.targets]
    const [target] = targets.splice(source, 1)
    targets.splice(destination, 0, target)
    onUpdate({ targets })
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-ds-ink">{t('modelRoutes.routeTargets')}</h3>
          <p className="mt-1 text-[11px] text-ds-faint">{t('modelRoutes.routeTargetsHint')}</p>
        </div>
        <button className={settingsButtonClass()}
          type="button"
          disabled={providers.length === 0}
          title={providers.length === 0 ? t('modelRoutes.addTargetUnavailable') : undefined}
          onClick={() => {
            const provider = providers[0]
            if (!provider) return
            onUpdate({ targets: [...pool.targets, {
              id: `${pool.id}-target-${Date.now().toString(36)}`,
              providerId: provider.id,
              modelId: provider.models[0],
              enabled: true,
              weight: 1
            }] })
          }}
        >
          <Plus className="h-3.5 w-3.5" /> {t('modelRoutes.addTarget')}
        </button>
      </div>
      {providers.length === 0 ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{t('modelRoutes.addTargetUnavailable')}</p> : null}
      <p className="text-[11px] text-ds-muted">{t('modelRoutes.stableAliasHint', { defaultValue: 'Clients keep the same alias. Account and model changes apply to new requests; in-flight requests keep their route.' })}</p>
      <div className="grid gap-2">
        {pool.targets.map((target, index) => {
          const resolution = resolveModelRouteTargetReference(target, settings.providers)
          const provider = resolution.provider
          const nativeOnly = modelProviderIsOauthOrDelegated(provider)
          const selection = JSON.stringify([target.providerId, target.modelId])
          const metric = metrics?.[`${pool.id}:${target.id}`]
          return (
            <article
              key={target.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => reorderTarget(event, index, pool, onUpdate)}
              className={`rounded-xl border bg-ds-card p-3 ${resolution.status === 'valid' && !nativeOnly ? 'border-ds-border' : 'border-amber-300/80'}`}
            >
              <div className="grid items-start gap-3 md:grid-cols-[112px_minmax(0,1fr)_112px]">
                <div className="flex items-center gap-1 pt-1">
                  <button
                    type="button"
                    draggable
                    title={t('modelRoutes.reorderTarget')}
                    aria-label={t('modelRoutes.reorderTarget')}
                    onDragStart={(event) => event.dataTransfer.setData('text/route-target-index', String(index))}
                    className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
                  ><GripVertical className="h-4 w-4" /></button>
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-ds-main text-[11px] text-ds-muted">{index + 1}</span>
                  <div className="grid gap-0.5">
                    <button type="button" disabled={index === 0} onClick={() => moveTarget(index, index - 1)} aria-label={t('modelRoutes.moveTargetUp')} className={settingsButtonClass({ variant: 'ghost', size: 'icon' })} ><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button type="button" disabled={index === pool.targets.length - 1} onClick={() => moveTarget(index, index + 1)} aria-label={t('modelRoutes.moveTargetDown')} className={settingsButtonClass({ variant: 'ghost', size: 'icon' })} ><ChevronDown className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <Field label={t('modelRoutes.targetEnabled')}><Toggle checked={target.enabled} onChange={(enabled) => changeTarget(target.id, { enabled })} ariaLabel={t('modelRoutes.targetEnabled')} /></Field>
                  <div className="sm:col-span-2">
                    <Field label={t('modelRoutes.targetAccountModel', { defaultValue: 'Account / model' })}>
                      <select value={selection} aria-label={t('modelRoutes.targetAccountModel', { defaultValue: 'Account / model' })}
                        onChange={(event) => {
                          const choice = providers.flatMap((item) => item.models.map((modelId) => ({ providerId: item.id, modelId })))
                            .find((item) => JSON.stringify([item.providerId, item.modelId]) === event.target.value)
                          if (choice) changeTarget(target.id, choice)
                        }} className={compactInputClass}>
                        {resolution.status !== 'valid' || nativeOnly ? <option value={selection} disabled>
                          {resolution.status === 'provider-missing' ? t('modelRoutes.providerDeleted', { providerId: target.providerId }) : provider?.name ?? target.providerId} / {resolution.status === 'provider-missing' ? t('modelRoutes.originalModel', { modelId: target.modelId }) : resolution.status === 'model-missing' ? t('modelRoutes.modelDeleted', { modelId: target.modelId }) : target.modelId} ({t('modelRoutes.targetUnavailable', { defaultValue: 'unavailable for gateway' })})
                        </option> : null}
                        {providers.map((item) => <optgroup key={item.id} label={item.name}>
                          {item.models.map((modelId) => <option key={modelId} value={JSON.stringify([item.id, modelId])}>
                            {item.name} / {modelId}
                          </option>)}
                        </optgroup>)}
                      </select>
                    </Field>
                  </div>
                  <Field label={t('modelRoutes.targetWeight')}><input type="number" min={1} max={100} disabled={pool.strategy !== 'weighted-round-robin'} title={pool.strategy === 'weighted-round-robin' ? undefined : t('modelRoutes.weightInactive')} value={target.weight} onChange={(event) => changeTarget(target.id, { weight: Number(event.target.value) || 1 })} className={compactInputClass} /></Field>
                </div>
                <div className="flex items-start justify-between gap-2 pt-1 text-[11px] text-ds-muted">
                  <div><span className="block text-ds-faint">{t('modelRoutes.targetHealth')}</span>{metric?.ewmaLatencyMs ? `${Math.round(metric.ewmaLatencyMs)} ms` : t('modelRoutes.notProbed')}<br /><span className="text-ds-faint">{metric ? t('modelRoutes.successCount', { successes: metric.successes, total: metric.successes + metric.failures }) : ''}</span></div>
                  <button type="button" onClick={() => onUpdate({ targets: pool.targets.filter((item) => item.id !== target.id) })} aria-label={t('modelRoutes.deleteTarget')} className={settingsButtonClass({ variant: 'danger-ghost', size: 'icon' })} ><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              {pool.strategy !== 'weighted-round-robin' ? <p className="mt-2 text-[10.5px] text-ds-faint">{t('modelRoutes.weightInactive')}</p> : null}
              {nativeOnly ? <p className="mt-2 text-[11px] text-amber-700">{t('modelRoutes.targetNativeOnly', { defaultValue: 'This account is available only through its native Agent, not as a gateway model API.' })}</p> : null}
              {resolution.status !== 'valid' ? <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{resolution.status === 'provider-missing' ? t('modelRoutes.providerMissingWarning', { providerId: target.providerId }) : t('modelRoutes.modelMissingWarning', { modelId: target.modelId, providerId: target.providerId })}</p> : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
