import type { RegistryDocument } from './model-connection-registry-core.js'
export type ProviderConfigurationReference = { connectionId: string; kind: string; path: string; blocking: boolean }
/** Only reference field values are returned; owner configuration may contain unrelated protected values. */
export function scanProviderReferences(value: unknown, ids: ReadonlySet<string>, root = 'configuration', blocking = true) {
  const found: ProviderConfigurationReference[] = []
  let visited = 0
  const visit = (entry: unknown, path: string, key: string): void => {
    if (++visited > 100_000) throw new Error('Provider reference scan exceeds its limit')
    if (typeof entry === 'string' && ids.has(entry) && /(?:providerId|connectionId|allowedConnectionIds|connectionIds|summaryProviderId|smallModelProviderId|titleModelProviderId)$/.test(key)) {
      found.push({ connectionId: entry, kind: root, path, blocking })
    } else if (Array.isArray(entry)) entry.forEach((item, index) => visit(item, `${path}[${index}]`, key))
    else if (entry && typeof entry === 'object') for (const [name, item] of Object.entries(entry)) visit(item, `${path}.${name}`, name)
  }
  visit(value, root, '')
  return found
}
export function registryProviderReferences(document: RegistryDocument, connectionIds: string[]) {
  const ids = new Set(connectionIds)
  return [
    ...scanProviderReferences({ providerId: document.defaultProviderId }, ids, 'default'),
    ...scanProviderReferences(document.routePools, ids, 'routes'),
    ...scanProviderReferences(document.failover, ids, 'failover'),
    ...scanProviderReferences(document.configuration.gatewayPolicies, ids, 'gatewayClients'),
    ...Object.entries(document.configuration.gatewayPolicies).flatMap(([clientId, policy]) => policy.allowedModelIds.flatMap((modelId, index) => connectionIds.filter((id) => modelId.startsWith(`${id}/`)).map((connectionId) => ({ connectionId, kind: 'gatewayClients', path: `gatewayClients.${clientId}.allowedModelIds[${index}]`, blocking: true })))),
    ...Object.keys(document.credentialTransactions).filter((id) => ids.has(id)).map((connectionId) =>
      ({ connectionId, kind: 'credentialTransaction', path: `credentialTransactions.${connectionId}`, blocking: true }))
  ]
}
