import { useEffect, useState, type ReactElement } from 'react'
import type { ProviderConfigurationOperation, ProviderConfigurationSnapshot } from '@shared/provider-configuration'
import { settingsButtonClass } from './settings-button'

type Translate = (key: string, options?: Record<string, unknown>) => string
type Catalog = { source?: string; identityChanged?: boolean; models: string[]; manualModels?: string[] }

export type StaleModelPlan = {
  /** Models the provider's own list no longer offers, still referenced here. */
  models: Array<{ id: string; selected: boolean; routes: string[]; keys: string[]; isDefault: boolean }>
  operations: ProviderConfigurationOperation[]
  /** Routes left with only stale members; they keep them so nothing is left empty. */
  keptRoutes: string[]
}

/**
 * What to remove when a provider stops listing models that are still
 * selected, in route members or in key allowances. Only a list fetched from
 * the provider counts, and models the user added by hand are never stale:
 * providers often serve models they do not list.
 */
export function planStaleModelRemoval(snapshot: ProviderConfigurationSnapshot, connectionId: string, catalog: Catalog | null,
  clientNames: ReadonlyMap<string, string> = new Map()): StaleModelPlan {
  const empty: StaleModelPlan = { models: [], operations: [], keptRoutes: [] }
  const connection = snapshot.connections.find((item) => item.id === connectionId)
  if (!connection || !catalog || catalog.source !== 'provider' || catalog.identityChanged) return empty
  const listed = new Set(catalog.models), manual = new Set(catalog.manualModels ?? [])
  const stale = (model: string): boolean => !listed.has(model) && !manual.has(model)
  const prefix = `${connectionId}/`
  const ids = new Set<string>(connection.models.filter(stale))
  for (const route of snapshot.routePools) for (const target of route.targets) if (target.providerId === connectionId && stale(target.modelId)) ids.add(target.modelId)
  for (const policy of Object.values(snapshot.configuration.gatewayPolicies)) {
    for (const id of policy.allowedModelIds) if (id.startsWith(prefix) && stale(id.slice(prefix.length))) ids.add(id.slice(prefix.length))
  }
  if (!ids.size) return empty
  const clientName = (clientId: string): string => clientNames.get(clientId) ?? clientId
  const models = [...ids].sort().map((id) => ({ id, selected: connection.models.includes(id),
    routes: snapshot.routePools.filter((route) => route.targets.some((target) => target.providerId === connectionId && target.modelId === id)).map((route) => route.name),
    keys: Object.entries(snapshot.configuration.gatewayPolicies).filter(([, policy]) => policy.allowedModelIds.includes(`${prefix}${id}`)).map(([clientId]) => clientName(clientId)),
    isDefault: snapshot.defaultProviderId === connectionId && snapshot.defaultModel === id }))
  const operations: ProviderConfigurationOperation[] = []
  const keptModels = connection.models.filter((model) => !ids.has(model))
  if (keptModels.length !== connection.models.length && keptModels.length) {
    operations.push({ kind: 'patch-connection', connectionId, patch: { models: keptModels } })
  }
  const keptRoutes: string[] = []
  let routesChanged = false
  const routes = snapshot.routePools.map((route) => {
    const targets = route.targets.filter((target) => !(target.providerId === connectionId && ids.has(target.modelId)))
    if (targets.length === route.targets.length) return route
    if (!targets.length) { keptRoutes.push(route.name); return route }
    routesChanged = true
    return { ...route, targets, ...(route.pick && !targets.some((target) => target.id === route.pick) ? { pick: undefined } : {}),
      ...(route.rules ? { rules: route.rules.filter((rule) => targets.some((target) => target.id === rule.use)) } : {}) }
  })
  if (routesChanged) operations.push({ kind: 'set-routes', routes })
  for (const [clientId, policy] of Object.entries(snapshot.configuration.gatewayPolicies)) {
    const allowed = policy.allowedModelIds.filter((id) => !(id.startsWith(prefix) && ids.has(id.slice(prefix.length))))
    if (allowed.length !== policy.allowedModelIds.length) operations.push({ kind: 'set-client-policy', clientId, policy: { ...policy, allowedModelIds: allowed } })
  }
  return { models, operations, keptRoutes }
}

/** Lists models the provider stopped offering that are still in use, and reviews their removal. */
export function ProviderStaleModels({ snapshot, connectionId, review, disabled, t }: {
  snapshot: ProviderConfigurationSnapshot; connectionId: string; review: (operations: ProviderConfigurationOperation[]) => void; disabled?: boolean; t: Translate
}): ReactElement | null {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [clientNames, setClientNames] = useState<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    let cancelled = false
    void window.kunGui.gatewayClients?.({ action: 'list' }).then((result) => {
      if (!cancelled && result.ok) setClientNames(new Map((result.clients ?? []).map((client) => [client.clientId, client.name])))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [snapshot.revision])
  useEffect(() => {
    let cancelled = false
    void window.kunGui.runtimeRequest(`/v1/model-connections/${encodeURIComponent(connectionId)}/catalog`, 'GET').then((response) => {
      if (cancelled || !response.ok) return
      const body = JSON.parse(response.body) as Catalog & { cached?: boolean }
      setCatalog(body.cached === true ? body : null)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [connectionId, snapshot.revision])
  const plan = planStaleModelRemoval(snapshot, connectionId, catalog, clientNames)
  if (!plan.models.length) return null
  return <section className="col-span-full space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" aria-label={t('providerStaleModels.title')} data-provider-stale-models>
    <p className="font-medium">{t('providerStaleModels.title')}</p>
    <p className="text-[12px] text-ds-muted">{t('providerStaleModels.description')}</p>
    <ul className="space-y-1 text-[12px]">
      {plan.models.map((model) => <li key={model.id} className="min-w-0">
        <span className="break-all font-mono text-ds-ink">{model.id}</span>
        <span className="text-ds-muted"> · {[model.selected ? t('providerStaleModels.selected') : '',
          model.routes.length ? t('providerStaleModels.routes', { names: model.routes.join(', ') }) : '',
          model.keys.length ? t('providerStaleModels.keys', { names: model.keys.join(', ') }) : '',
          model.isDefault ? t('providerStaleModels.default') : ''].filter(Boolean).join(' · ')}</span>
      </li>)}
    </ul>
    {plan.keptRoutes.length ? <p className="text-[12px] text-amber-700 dark:text-amber-200">{t('providerStaleModels.keptRoutes', { names: plan.keptRoutes.join(', ') })}</p> : null}
    {plan.operations.length ? <button className={settingsButtonClass()} disabled={disabled} onClick={() => review(plan.operations)}>{t('providerStaleModels.review')}</button> : null}
  </section>
}
