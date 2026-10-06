import { configurationAfterLegacyPatch } from './provider-legacy-patch.js'
import { createHash, randomUUID } from 'node:crypto'
import { ProviderConfigurationPreviewRequestSchema, ProviderConfigurationCommitRequestSchema,
  type ProviderConfigurationOperation } from '../contracts/provider-configuration.js'
import { type ModelConnectionRegistry, type RegistryDocument, StoredProfileSchema,
  emptyDocument, assertRevision, appendCredentialRefs } from './model-connection-registry-core.js'
import { registryProviderReferences, scanProviderReferences, type ProviderConfigurationReference } from './provider-configuration-references.js'
import type { PreparedImportBinding } from './provider-configuration-secret-operations.js'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'

export type ConfigurationPreview = {
  previewId: string; expectedRevision: number; expiresAt: string; digest: string
  operations: ProviderConfigurationOperation[]; affectedConnections: string[]
  references?: ProviderConfigurationReference[]
  secretSlots?: Array<{ id: string; connectionId: string; kind: 'credential' | 'headers'; names?: string[]; headerClass?: 'custom' | 'adapter'; bound: boolean }>
}

export function applyOperations(document: RegistryDocument, operations: ProviderConfigurationOperation[]): RegistryDocument {
  const next = structuredClone(document)
  const state = next.configuration
  const deleted: string[] = []
  for (const operation of operations) {
    switch (operation.kind) {
      case 'remove-connection': {
        const profile = next.profiles[operation.connectionId]
        if (!profile) throw new Error('Connection does not exist')
        if (next.credentialTransactions[profile.id]) throw new Error('Connection credential replacement is pending')
        deleted.push(profile.id)
        next.tombstones[profile.id] = { deletedRevision: document.revision + 1,
          credentialMutationHighWater: profile.credentialMutationHighWater,
          ...(profile.credentialSourceId ? { legacyCredentialSourceToRetire: profile.credentialSourceId } : {}) }
        for (const reference of [profile.credentialRef, profile.customHeadersRef, profile.headersRef]) next.credentialRefCleanup = appendCredentialRefs(next.credentialRefCleanup, Date.now(), reference)
        delete next.profiles[profile.id]; delete state.connections[profile.id]
        break
      }
      case 'clear-connection-fields': {
        const profile = next.profiles[operation.connectionId]
        if (!profile) throw new Error('Connection does not exist')
        if (next.credentialTransactions[profile.id]) throw new Error('Connection credential replacement is pending')
        for (const field of operation.fields) delete profile[field]
        break
      }
      case 'apply-template': {
        const template = state.templates[operation.templateId]
        if (!template || template.revision !== operation.revision) throw new Error('Template revision changed; review the selected version')
        for (const connectionId of operation.connectionIds) {
          if (!next.profiles[connectionId]) throw new Error('Connection does not exist')
          const current = state.connections[connectionId] ?? { enabled: true, inherit: [], manualModels: [] }
          state.connections[connectionId] = { ...current, template: structuredClone(template),
            inherit: [...new Set([...current.inherit, ...operation.resetFields])] }
        }
        break
      }
      case 'put-group': state.groups[operation.group.id] = operation.group; break
      case 'remove-group': delete state.groups[operation.groupId]; break
      case 'put-template': state.templates[operation.template.id] = operation.template; break
      case 'remove-template': delete state.templates[operation.templateId]; break
      case 'set-client-policy': state.gatewayPolicies[operation.clientId] = operation.policy; break
      case 'configure-connection': {
        if (!next.profiles[operation.connectionId]) throw new Error('Connection does not exist')
        if (operation.configuration.endpointBinding && next.profiles[operation.connectionId]!.kind !== 'http') {
          throw new Error('Explicit HTTP endpoint bindings require an HTTP model provider')
        }
        const origin = state.connections[operation.connectionId]?.migrationOrigin
        if (operation.configuration.migrationOrigin && JSON.stringify(operation.configuration.migrationOrigin) !== JSON.stringify(origin)) throw new Error('Migration origin is read-only')
        state.connections[operation.connectionId] = { ...operation.configuration, ...(origin ? { migrationOrigin: origin } : {}) }
        break
      }
      case 'add-connection': {
        const connection = operation.connection
        if (connection.authType === 'none' && connection.kind !== 'http') throw new Error('Anonymous authentication requires an HTTP model provider')
        if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(connection.id)) throw new Error('Invalid connection identifier')
        if (next.profiles[connection.id] || next.tombstones[connection.id]) throw new Error('Connection identifier is already used; choose another imported identifier')
        next.profiles[connection.id] = StoredProfileSchema.parse({ ...connection,
          accountId: `account:${connection.id}`, configured: connection.kind === 'http' && connection.authType === 'none',
          incarnationId: randomUUID() })
        break
      }
      case 'patch-connection': {
        const current = next.profiles[operation.connectionId]
        if (!current) throw new Error('Connection does not exist')
        if (operation.patch.authType && operation.patch.authType !== current.authType &&
          (!['api-key', 'none'].includes(current.authType) || !['api-key', 'none'].includes(operation.patch.authType))) {
          throw new Error('Subscription authentication is managed by its provider login flow')
        }
        if (operation.patch.authType === 'none' && (operation.patch.kind ?? current.kind) !== 'http') {
          throw new Error('Anonymous authentication requires an HTTP model provider')
        }
        if (next.credentialTransactions[current.id]) throw new Error('Connection credential replacement is pending')
        state.connections = configurationAfterLegacyPatch(current, state, operation.patch, false).connections
        next.profiles[current.id] = StoredProfileSchema.parse({ ...current, ...operation.patch,
          ...(operation.patch.authType === 'none' && current.kind === 'http' ? { configured: true } : {}) })
        break
      }
      case 'set-default-selection': {
        if (!operation.selection) { delete next.defaultProviderId; delete next.defaultAccountId; delete next.defaultModel; break }
        const selected = next.profiles[operation.selection.connectionId]
        if (!selected || !selected.models.includes(operation.selection.modelId)) throw new Error('Default selection must reference a configured model')
        next.defaultProviderId = selected.id; next.defaultAccountId = selected.accountId; next.defaultModel = operation.selection.modelId
        break
      }
      case 'set-failover': next.failover = operation.groups; break
      case 'set-routes': next.routePools = operation.routes; break
    }
  }
  const remainingReferences = registryProviderReferences(next, deleted)
  if (remainingReferences.length) throw new Error(`Deleted connection still has references: ${remainingReferences.map((entry) => entry.path).join(', ')}`)
  if (Object.keys(next.profiles).length > 500 || Object.keys(state.groups).length > 500 || Object.keys(state.templates).length > 500) {
    throw new Error('Provider configuration exceeds the 500-entry limit')
  }
  for (const config of Object.values(state.connections)) {
    if (config.groupId && !state.groups[config.groupId]) throw new Error('A connection still references the removed or missing group')
  }
  for (const operation of operations) {
    if (operation.kind !== 'add-connection') continue
    const profile = next.profiles[operation.connection.id]!
    if (profile.kind === 'http' && !effectiveProviderConfiguration(profile, state).profile.baseUrl) {
      throw new Error('New HTTP connections require an explicit or inherited endpoint URL')
    }
  }
  for (const profile of Object.values(next.profiles)) {
    const effective = effectiveProviderConfiguration(profile, state)
    const auth = effective.authProfile
    const headerNames = new Set((profile.customHeaderNames ?? []).map((name) => name.toLowerCase()))
    if (auth && [...headerNames].some((name) => ['authorization', 'proxy-authorization', 'x-api-key', 'api-key', 'x-goog-api-key', auth.headerName?.toLowerCase()].includes(name))) {
      throw new Error('Protected headers cannot override the authentication profile')
    }
  }
  const aliases = new Set<string>()
  for (const route of next.routePools) {
    const alias = route.modelId.toLowerCase()
    if (alias.startsWith('kun/') || aliases.has(alias)) throw new Error('Route alias is duplicated or reserved')
    aliases.add(alias)
    for (const target of route.targets) {
      if (!next.profiles[target.providerId]) throw new Error('Route references an unknown connection')
    }
  }
  return next
}

export const providerConfigurationOperations = {
  async gatewayClientPolicy(this: ModelConnectionRegistry, clientId: string) {
    const document = await this['file'].read(emptyDocument)
    const policy = document.configuration.gatewayPolicies[clientId]
    return { revision: document.revision, policy: policy ? structuredClone(policy) : undefined }
  },
  async configurationSnapshot(this: ModelConnectionRegistry) {
    const document = await this['file'].read(emptyDocument)
    const snapshot = await this['projectWithCredentialHealth'](document)
    const { commits: _commits, ...configuration } = document.configuration
    return { schemaVersion: 2 as const, revision: document.revision, activeRevision: this['lastAppliedRevision'],
      defaultProviderId: document.defaultProviderId, defaultAccountId: document.defaultAccountId, defaultModel: document.defaultModel,
      configuration, connections: snapshot.providers, routePools: document.routePools,
      connectionOverrides: Object.fromEntries(Object.values(document.profiles).map((profile) => [profile.id,
        { baseUrl: profile.baseUrl, endpointFormat: profile.endpointFormat, endpoints: profile.endpoints, useProxy: profile.useProxy }])) ,
      failover: document.failover, localModelGateway: document.localModelGateway,
      fieldSources: Object.fromEntries(Object.values(document.profiles).map((profile) =>
        [profile.id, effectiveProviderConfiguration(profile, document.configuration).sources])) }
  },

  async previewConfiguration(this: ModelConnectionRegistry, raw: unknown): Promise<ConfigurationPreview> {
    const input = ProviderConfigurationPreviewRequestSchema.parse(raw)
    const document = await this['file'].read(emptyDocument)
    assertRevision(document, input.expectedRevision)
    const deletionIds = input.operations.filter((operation) => operation.kind === 'remove-connection').map((operation) => operation.connectionId)
    const next = applyOperations(document, input.operations)
    const affectedConnections = Object.keys(next.profiles).filter((id) =>
      JSON.stringify(effectiveProviderConfiguration(document.profiles[id] ?? next.profiles[id]!, document.configuration)) !==
      JSON.stringify(effectiveProviderConfiguration(next.profiles[id]!, next.configuration)) || !document.profiles[id]).concat(deletionIds)
    const changedIds = [...new Set([...affectedConnections, ...input.operations.flatMap((operation) => 'connectionId' in operation ? [operation.connectionId] : [])])]
    const external = await this['options'].referenceSources?.() ?? {}
    const histories = await this['options'].historyReferenceSources?.() ?? {}
    const references = [...Object.entries(histories).flatMap(([kind, value]) => scanProviderReferences(value, new Set(changedIds), kind, false)), ...registryProviderReferences(document, changedIds), ...Object.entries(external).flatMap(([kind, value]) => scanProviderReferences(value, new Set(changedIds), kind))]
    const blocked = references.filter((entry) => entry.blocking && deletionIds.includes(entry.connectionId) && !['default', 'routes', 'failover', 'gatewayClients'].includes(entry.kind))
    if (blocked.length) throw new Error(`Connection is referenced outside this transaction: ${blocked.map((entry) => entry.path).join(', ')}`)

    const preview: ConfigurationPreview = { previewId: randomUUID(), expectedRevision: document.revision,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      digest: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      operations: input.operations, affectedConnections, references }
    const previews = this['configurationPreviews']
    for (const [id, value] of previews) if (Date.parse(value.expiresAt) <= Date.now()) { previews.delete(id); this['configurationImportSecrets'].delete(id) }
    if (previews.size >= 128) { const oldest = previews.keys().next().value!; previews.delete(oldest); this['configurationImportSecrets'].delete(oldest) }
    const bytes = new TextEncoder().encode(JSON.stringify(preview)).byteLength
    if (bytes > 8 * 1024 * 1024) throw new Error('Configuration preview exceeds its size limit')
    let total = [...previews.values()].reduce((sum, value) => sum + new TextEncoder().encode(JSON.stringify(value)).byteLength, bytes)
    while (previews.size && total > 16 * 1024 * 1024) {
      const oldest = previews.keys().next().value!
      total -= new TextEncoder().encode(JSON.stringify(previews.get(oldest))).byteLength
      previews.delete(oldest); this['configurationImportSecrets'].delete(oldest)
    }
    previews.set(preview.previewId, preview)
    return structuredClone(preview)
  },

  async commitConfiguration(this: ModelConnectionRegistry, raw: unknown, bindings: PreparedImportBinding[] = []) {
    const input = ProviderConfigurationCommitRequestSchema.parse(raw)
    const previewForReferences = this['configurationPreviews'].get(input.previewId)
    const deletionIds = previewForReferences?.operations.filter((operation) => operation.kind === 'remove-connection').map((operation) => operation.connectionId) ?? []
    if (deletionIds.length) {
      const external = await this['options'].referenceSources?.() ?? {}
      const references = Object.entries(external).flatMap(([kind, value]) => scanProviderReferences(value, new Set(deletionIds), kind))
      if (references.some((entry) => entry.blocking)) throw new Error('Connection references changed; review and remove the external bindings first')
    }
    let committedRevision = 0
    const document = await this['file'].update(emptyDocument, (current) => {
      const receipt = current.configuration.commits[input.idempotencyKey]
      if (receipt) {
        if (receipt.previewId !== input.previewId) throw new Error('Idempotency key belongs to another preview')
        committedRevision = receipt.revision
        return current
      }
      const preview = this['configurationPreviews'].get(input.previewId)
      if (!preview || Date.parse(preview.expiresAt) <= Date.now()) throw new Error('Configuration preview expired; review the changes again')
      if (preview.expectedRevision !== input.expectedRevision) throw new Error('Configuration preview revision mismatch')
      assertRevision(current, input.expectedRevision)
      const next = applyOperations(current, preview.operations)
      for (const binding of bindings) {
        const profile = next.profiles[binding.connectionId]
        if (!profile || !preview.operations.some((operation) => operation.kind === 'add-connection' && operation.connection.id === profile.id)) throw new Error('Import credential cannot bind an existing account')
        if (binding.kind === 'credential') { profile.credentialRef = binding.reference; profile.configured = true; if (binding.accountId) profile.accountId = binding.accountId }
        else if (binding.headerClass === 'adapter') { profile.headersRef = binding.reference; profile.generatedHeaderNames = binding.names }
        else { profile.customHeadersRef = binding.reference; profile.customHeaderNames = binding.names }
      }
      if (bindings.length) applyOperations(next, [])
      next.revision = current.revision + 1
      const receipts = Object.entries(next.configuration.commits).slice(-255)
      next.configuration.commits = Object.fromEntries(receipts)
      next.configuration.commits[input.idempotencyKey] = { previewId: input.previewId, digest: preview.digest,
        revision: next.revision, committedAt: new Date().toISOString() }
      committedRevision = next.revision
      return next
    })
    let applied = true
    try { await this['changed'](document) } catch { applied = false }
    this['configurationPreviews'].delete(input.previewId)
    this['configurationImportSecrets'].delete(input.previewId)
    await this['drainCredentialRefCleanup']()
    for (const id of deletionIds) await this['retireDeletedLegacyCredentialSource'](id)
    return { committedRevision, applied, snapshot: await this.configurationSnapshot() }
  }
}
