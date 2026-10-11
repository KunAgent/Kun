import type { RegistryDocument } from './model-connection-registry-core.js'

/** Downgrade uses the current authoritative document, never the pre-upgrade backup. */
export function previewProviderRegistryDowngrade(document: RegistryDocument) {
  const blockingReasons: Array<{ path: string; reason: string }> = []
  const block = (path: string, reason: string) => blockingReasons.push({ path, reason })
  const state = document.configuration
  if (Object.keys(state.groups).length) block('configuration.groups', 'Provider groups require schema v2')
  if (Object.keys(state.templates).length) block('configuration.templates', 'Frozen provider templates require schema v2')
  if (Object.keys(state.gatewayPolicies).length) block('configuration.gatewayPolicies', 'Scoped gateway client policies require schema v2')
  for (const [id, config] of Object.entries(state.connections)) {
    if (!config.enabled) block(`configuration.connections.${id}.enabled`, 'Disabled connections must stay disabled after downgrade')
    if (config.groupId || config.template || config.inherit.length) block(`configuration.connections.${id}`, 'Inherited configuration requires schema v2')
    if (config.endpointBinding || config.authProfile || config.headerProfile || config.proxy || config.admission || (config.discovery && config.discovery.mode !== 'auto')) {
      block(`configuration.connections.${id}`, 'Endpoint, authentication, discovery or admission policy cannot be represented by schema v1')
    }
  }
  if (Object.keys(document.credentialTransactions).length) block('credentialTransactions', 'Wait for pending credential writes to settle before recovery')
  if (Object.keys(document.credentialRefCleanup).length) block('credentialRefCleanup', 'Wait for protected credential cleanup before recovery')
  for (const profile of Object.values(document.profiles)) {
    for (const [modelId, capability] of Object.entries(profile.modelCapabilities ?? {})) {
      if (['evidence', 'parallelTools', 'streaming', 'structuredOutput'].some((field) => (capability as unknown as Record<string, unknown>)[field] !== undefined)) {
        block(`profiles.${profile.id}.modelCapabilities.${modelId}`, 'Capability evidence and expanded capability fields require schema v2')
      }
    }
    if (profile.authType === 'none') block(`profiles.${profile.id}.authType`, 'Explicit anonymous authentication is a schema v2 contract')
    if (profile.headersRef) block(`profiles.${profile.id}.headersRef`, 'Protected adapter header references require schema v2')
    if (profile.customHeadersRef) block(`profiles.${profile.id}.customHeadersRef`, 'Protected request-header references require schema v2')
    if (profile.customHeaders || profile.headers) block(`profiles.${profile.id}.headers`, 'Plaintext legacy headers must be protected before recovery')
  }
  return { revision: document.revision, canDowngrade: !blockingReasons.length, blockingReasons,
    preservedConnectionIds: Object.keys(document.profiles), preservedAccountIds: Object.values(document.profiles).map((profile) => profile.accountId),
    historyAction: 'preserve' as const, credentialAction: 'retain-protected-store' as const }
}
export function exportProviderRegistryDowngrade(document: RegistryDocument, expectedRevision: number) {
  if (document.revision !== expectedRevision) throw new Error('Provider configuration changed; review recovery again')
  const preview = previewProviderRegistryDowngrade(document)
  if (!preview.canDowngrade) throw new Error('Schema v1 cannot express this configuration; retain v2 or remove the listed features explicitly')
  const { configuration: _configuration, ...legacy } = structuredClone(document)
  // Opaque protected references and all current identities remain intact; no key bytes are materialized.
  return { ...legacy, schemaVersion: 1 as const }
}
