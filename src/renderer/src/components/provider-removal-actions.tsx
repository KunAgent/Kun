import { useState } from 'react'
import type { ProviderConfigurationOperation, ProviderConfigurationSnapshot } from '@shared/provider-configuration'
import { settingsButtonClass } from './settings-button'
type T = (key: string, options?: Record<string, unknown>) => string
export function ProviderRemovalActions({ snapshot, connectionId, review, disabled, t }: {
  snapshot: ProviderConfigurationSnapshot; connectionId: string; review: (operations: ProviderConfigurationOperation[]) => void; disabled?: boolean; t: T
}) {
  const [clearRegistryReferences, setClearRegistryReferences] = useState(false)
  const routes = snapshot.routePools.filter((route) => route.targets.some((target) => target.providerId === connectionId))
  const clientIds = Object.entries(snapshot.configuration.gatewayPolicies).filter(([, policy]) => policy.allowedConnectionIds.includes(connectionId)).map(([id]) => id)
  const prepare = () => {
    const operations: ProviderConfigurationOperation[] = []
    if (clearRegistryReferences) {
      const keptRoutes = snapshot.routePools.flatMap((route) => {
        const targets = route.targets.filter((target) => target.providerId !== connectionId)
        return targets.length ? [{ ...route, targets }] : []
      })
      const keptIds = new Set(keptRoutes.map((route) => route.id))
      operations.push({ kind: 'set-routes', routes: keptRoutes }, { kind: 'set-failover', groups: snapshot.failover.flatMap((group) => {
        if (group.providerId === connectionId) return []
        const members = group.members.filter((member) => member.providerId !== connectionId)
        return members.length ? [{ ...group, members, fallbackTargets: group.fallbackTargets.filter((target) => target.providerId !== connectionId) }] : []
      }) })
      for (const [clientId, policy] of Object.entries(snapshot.configuration.gatewayPolicies)) operations.push({ kind: 'set-client-policy', clientId,
        policy: { ...policy, allowedConnectionIds: policy.allowedConnectionIds.filter((id) => id !== connectionId), allowedRouteIds: policy.allowedRouteIds.filter((id) => keptIds.has(id)),
          allowedModelIds: policy.allowedModelIds.filter((id) => !id.startsWith(`${connectionId}/`)) } })
      // Clearing is explicit. No alternative supplier is selected on the user's behalf.
      if (snapshot.defaultProviderId === connectionId) operations.push({ kind: 'set-default-selection' })
    }
    operations.push({ kind: 'remove-connection', connectionId }); review(operations)
  }
  return <section className="col-span-full space-y-2 rounded-lg border border-ds-border-muted p-3" aria-label={t('providerRemoval.title')}>
    <p className="font-medium">{t('providerRemoval.title')}</p>
    <p className="text-[12px] text-ds-muted">{t('providerRemoval.impact', { routes: routes.length, clients: clientIds.length })}</p>
    <p className="text-[12px] text-ds-muted">{t('providerRemoval.externalReferences')}</p>
    <label className="flex items-center gap-2"><input type="checkbox" disabled={disabled} checked={clearRegistryReferences}
      onChange={(event) => setClearRegistryReferences(event.target.checked)} />{t('providerRemoval.clearRegistryReferences')}</label>
    <button className={settingsButtonClass()} disabled={disabled} onClick={prepare}>{t('providerRemoval.review')}</button>
  </section>
}
