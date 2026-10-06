import { configurationAfterLegacyPatch } from './provider-legacy-patch.js'
import { createHash, randomUUID } from 'node:crypto'
import { ProviderConfigurationPreviewRequestSchema, ProviderConfigurationCommitRequestSchema,
  type ProviderConfigurationOperation } from '../contracts/provider-configuration.js'
import { type ModelConnectionRegistry, type RegistryDocument, StoredProfileSchema,
  emptyDocument, assertRevision } from './model-connection-registry-core.js'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'

export type ConfigurationPreview = {
  previewId: string; expectedRevision: number; expiresAt: string; digest: string
  operations: ProviderConfigurationOperation[]; affectedConnections: string[]
}

function applyOperations(document: RegistryDocument, operations: ProviderConfigurationOperation[]): RegistryDocument {
  const next = structuredClone(document)
  const state = next.configuration
  for (const operation of operations) {
    switch (operation.kind) {
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
        state.connections[operation.connectionId] = operation.configuration
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
      case 'set-routes': next.routePools = operation.routes; break
    }
  }
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
    const next = applyOperations(document, input.operations)
    const affectedConnections = Object.keys(next.profiles).filter((id) =>
      JSON.stringify(effectiveProviderConfiguration(document.profiles[id] ?? next.profiles[id]!, document.configuration)) !==
      JSON.stringify(effectiveProviderConfiguration(next.profiles[id]!, next.configuration)) || !document.profiles[id])
    const preview: ConfigurationPreview = { previewId: randomUUID(), expectedRevision: document.revision,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      digest: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      operations: input.operations, affectedConnections }
    const previews = this['configurationPreviews']
    for (const [id, value] of previews) if (Date.parse(value.expiresAt) <= Date.now()) previews.delete(id)
    if (previews.size >= 128) previews.delete(previews.keys().next().value!)
    const bytes = new TextEncoder().encode(JSON.stringify(preview)).byteLength
    if (bytes > 8 * 1024 * 1024) throw new Error('Configuration preview exceeds its size limit')
    let total = [...previews.values()].reduce((sum, value) => sum + new TextEncoder().encode(JSON.stringify(value)).byteLength, bytes)
    while (previews.size && total > 16 * 1024 * 1024) {
      const oldest = previews.keys().next().value!
      total -= new TextEncoder().encode(JSON.stringify(previews.get(oldest))).byteLength
      previews.delete(oldest)
    }
    previews.set(preview.previewId, preview)
    return structuredClone(preview)
  },

  async commitConfiguration(this: ModelConnectionRegistry, raw: unknown) {
    const input = ProviderConfigurationCommitRequestSchema.parse(raw)
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
    return { committedRevision, applied, snapshot: await this.configurationSnapshot() }
  }
}
