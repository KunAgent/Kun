import { z } from 'zod'
import { ProviderConfigurationPreviewRequestSchema, type ProviderConfigurationOperation,
  type ProviderConfigurationSnapshot } from '../contracts/provider-configuration.js'

const SecretSlot = z.object({ id: z.string().min(1).max(256), connectionId: z.string().min(1).max(128),
  kind: z.enum(['credential', 'headers']), names: z.array(z.string().max(128)).max(64).optional() }).strict()
export const ProviderImportSchema = z.object({ schemaVersion: z.literal(2), secretFree: z.literal(true),
  expectedRevision: z.number().int().nonnegative(),
  operations: ProviderConfigurationPreviewRequestSchema.shape.operations,
  secretSlots: z.array(SecretSlot).max(1_000).default([]) }).strict()

/** Exchange documents have no local credential references or existing client permissions. */
export function exportProviderConfiguration(snapshot: ProviderConfigurationSnapshot) {
  const operations: ProviderConfigurationOperation[] = [
    ...Object.values(snapshot.configuration.templates).map((template) => ({ kind: 'put-template' as const, template })),
    ...Object.values(snapshot.configuration.groups).map((group) => ({ kind: 'put-group' as const, group })),
    ...snapshot.connections.map(({ id, name, presetSource, presetMode, kind, authType, baseUrl,
      endpointFormat, endpoints, useProxy, models, modelCapabilities, selectedModel }) => ({
      kind: 'add-connection' as const, connection: { id, name, presetSource, presetMode, kind, authType, baseUrl,
        endpointFormat, endpoints, useProxy, models, modelCapabilities, selectedModel, ...(snapshot.connectionOverrides?.[id] ?? {}) }
    })),
    ...Object.entries(snapshot.configuration.connections).map(([connectionId, configuration]) =>
      ({ kind: 'configure-connection' as const, connectionId, configuration })),
    { kind: 'set-routes', routes: snapshot.routePools }
  ]
  const secretSlots = snapshot.connections.flatMap((connection) => [
    ...(connection.authType !== 'none' ? [{ id: `${connection.id}:credential`, connectionId: connection.id, kind: 'credential' as const }] : []),
    ...(connection.customHeaderNames?.length ? [{ id: `${connection.id}:headers`, connectionId: connection.id,
      kind: 'headers' as const, names: connection.customHeaderNames }] : [])
  ])
  return { schemaVersion: 2 as const, secretFree: true as const, operations, secretSlots }
}

/** Merge is additive. Conflicting IDs/aliases receive new identities, with every dependent reference rewritten. */
export function prepareProviderImport(raw: unknown, snapshot: ProviderConfigurationSnapshot) {
  const input = ProviderImportSchema.parse(raw)
  const remaps: Record<'connection' | 'group' | 'template' | 'route' | 'alias', Record<string, string>> = {
    connection: {}, group: {}, template: {}, route: {}, alias: {}
  }
  const used = {
    connection: new Set(snapshot.connections.map((entry) => entry.id)), group: new Set(Object.keys(snapshot.configuration.groups)),
    template: new Set(Object.keys(snapshot.configuration.templates)), route: new Set(snapshot.routePools.map((entry) => entry.id)),
    alias: new Set(snapshot.routePools.map((entry) => entry.modelId.toLowerCase()))
  }
  const allocate = (kind: keyof typeof remaps, original: string) => {
    if (remaps[kind][original]) throw new Error(`Duplicate ${kind} identity in this document`)
    let value = original, suffix = 1
    while (used[kind].has(kind === 'alias' ? value.toLowerCase() : value)) value = `${original.slice(0, kind === 'alias' ? 480 : 104)}-import-${suffix++}`
    used[kind].add(kind === 'alias' ? value.toLowerCase() : value); remaps[kind][original] = value
  }
  for (const operation of input.operations) {
    if (operation.kind === 'add-connection') allocate('connection', operation.connection.id)
    else if (operation.kind === 'put-group') allocate('group', operation.group.id)
    else if (operation.kind === 'put-template') allocate('template', operation.template.id)
    else if (operation.kind === 'set-routes') for (const route of operation.routes) { allocate('route', route.id); allocate('alias', route.modelId) }
    else if (operation.kind !== 'configure-connection') throw new Error('Imports may add objects; destructive edits and client permissions require a separate reviewed transaction')
  }
  const remap = (kind: keyof typeof remaps, id: string): string => {
    const value = remaps[kind][id]
    if (!value) throw new Error(`Import has an unresolved ${kind} reference: ${id}`)
    return value
  }
  const operations: ProviderConfigurationOperation[] = input.operations.map((operation) => {
    switch (operation.kind) {
      case 'add-connection': return { ...operation, connection: { ...operation.connection, id: remap('connection', operation.connection.id) } }
      case 'configure-connection': return { ...operation, connectionId: remap('connection', operation.connectionId),
        configuration: { ...operation.configuration, ...(operation.configuration.groupId
          ? { groupId: remap('group', operation.configuration.groupId) } : {}) } }
      case 'put-group': return { ...operation, group: { ...operation.group, id: remap('group', operation.group.id) } }
      case 'put-template': return { ...operation, template: { ...operation.template, id: remap('template', operation.template.id) } }
      case 'set-routes': return { ...operation, routes: [...snapshot.routePools, ...operation.routes.map((route) => ({ ...route,
        id: remap('route', route.id), modelId: remap('alias', route.modelId),
        targets: route.targets.map((target) => ({ ...target, providerId: remap('connection', target.providerId) })) }))] }
      default: throw new Error('Unsupported import operation')
    }
  })
  const secretSlots = input.secretSlots.map((slot) => ({ ...slot, connectionId: remap('connection', slot.connectionId), bound: false as const }))
  return { expectedRevision: input.expectedRevision, operations, remaps, secretSlots }
}
