import { providerUrlHasCredentials } from '../contracts/provider-safe-url.js'
import { z } from 'zod'
import { ProviderConfigurationPreviewRequestSchema, type ProviderConfigurationOperation,
  type ProviderConfigurationSnapshot } from '../contracts/provider-configuration.js'

export const ProviderSecretSlotSchema = z.object({ id: z.string().min(1).max(256), connectionId: z.string().min(1).max(128),
  kind: z.enum(['credential', 'headers']), headerClass: z.enum(['custom', 'adapter']).optional(), names: z.array(z.string().max(128)).max(64).optional() }).strict()
const ADAPTER_REVISIONS: Record<string, number> = { http: 3, 'agent-sdk': 1, 'antigravity-cli': 1, 'cursor-sdk': 1, 'gemini-cli-api': 1, 'gemini-code-assist': 1 }
export const ProviderImportSchema = z.object({ adapterRevisions: z.record(z.string(), z.number().int().positive()).optional(), schemaVersion: z.literal(2), secretFree: z.literal(true),
  expectedRevision: z.number().int().nonnegative(),
  operations: ProviderConfigurationPreviewRequestSchema.shape.operations,
  secretSlots: z.array(ProviderSecretSlotSchema).max(1_000).default([]) }).strict()

/** Exchange documents have no local credential references or existing client permissions. */
export function exportProviderConfiguration(snapshot: ProviderConfigurationSnapshot,
  selection?: { connectionIds?: string[]; routeIds?: string[] }) {
  const routeIds = selection?.routeIds ? new Set(selection.routeIds) : undefined
  const routes = snapshot.routePools.filter((route) => !routeIds || routeIds.has(route.id))
  if (routeIds && routes.length !== routeIds.size) throw new Error('Export references an unknown route')
  const connectionIds = selection?.connectionIds ? new Set(selection.connectionIds) : new Set(snapshot.connections.map((entry) => entry.id))
  for (const route of routes) for (const target of route.targets) connectionIds.add(target.providerId)
  const connections = snapshot.connections.filter((entry) => connectionIds.has(entry.id))
  if (connections.length !== connectionIds.size) throw new Error('Export references an unknown connection')
  const configurations = Object.entries(snapshot.configuration.connections).filter(([id]) => connectionIds.has(id))
  const groups = Object.values(snapshot.configuration.groups).filter((group) => configurations.some(([, config]) => config.groupId === group.id))

  const operations: ProviderConfigurationOperation[] = [
    ...Object.values(snapshot.configuration.templates).map((template) => ({ kind: 'put-template' as const, template })),
    ...groups.map((group) => ({ kind: 'put-group' as const, group })),
    ...connections.map(({ id, name, presetSource, presetMode, kind, authType, baseUrl,
      endpointFormat, endpoints, useProxy, models, modelCapabilities, selectedModel }) => ({
      kind: 'add-connection' as const, connection: { id, name, presetSource, presetMode, kind, authType, baseUrl,
        endpointFormat, endpoints, useProxy, models, modelCapabilities, selectedModel, ...(snapshot.connectionOverrides?.[id] ?? {}) }
    })),
    ...configurations.map(([connectionId, configuration]) =>
      ({ kind: 'configure-connection' as const, connectionId, configuration: { ...configuration, migrationOrigin: undefined } })),
    { kind: 'set-routes', routes }
  ]
  const secretSlots = connections.flatMap((connection) => [
    ...(connection.authType !== 'none' ? [{ id: `${connection.id}:credential`, connectionId: connection.id, kind: 'credential' as const }] : []),
    ...(connection.generatedHeaderNames?.length ? [{ id: `${connection.id}:adapter-headers`, connectionId: connection.id, kind: 'headers' as const, headerClass: 'adapter' as const, names: connection.generatedHeaderNames }] : []),
    ...(connection.customHeaderNames?.length ? [{ id: `${connection.id}:headers`, connectionId: connection.id,
      kind: 'headers' as const, names: connection.customHeaderNames }] : [])
  ])
  const result = { adapterRevisions: Object.fromEntries(connections.map((connection) => [connection.kind, ADAPTER_REVISIONS[connection.kind]!])), schemaVersion: 2 as const, secretFree: true as const, operations, secretSlots }
  assertSecretFreeExchange(result)
  return result
}

/** Merge is additive. Conflicting IDs/aliases receive new identities, with every dependent reference rewritten. */
export function prepareProviderImport(raw: unknown, snapshot: ProviderConfigurationSnapshot) {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > 8 * 1024 * 1024) throw new Error('Provider exchange exceeds the 8 MiB limit')
  const input = ProviderImportSchema.parse(raw)
  assertSecretFreeExchange(input)
  for (const [adapter, revision] of Object.entries(input.adapterRevisions ?? {})) if (!ADAPTER_REVISIONS[adapter] || revision > ADAPTER_REVISIONS[adapter]!) throw new Error('Provider adapter revision requires a newer Kun runtime')
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
        configuration: { ...operation.configuration, migrationOrigin: undefined, ...(operation.configuration.groupId
          ? { groupId: remap('group', operation.configuration.groupId) } : {}) } }
      case 'put-group': return { ...operation, group: { ...operation.group, id: remap('group', operation.group.id) } }
      case 'put-template': return { ...operation, template: { ...operation.template, id: remap('template', operation.template.id) } }
      case 'set-routes': return { ...operation, routes: [...snapshot.routePools, ...operation.routes.map((route) => ({ ...route,
        id: remap('route', route.id), modelId: remap('alias', route.modelId),
        targets: route.targets.map((target) => ({ ...target, providerId: remap('connection', target.providerId) })) }))] }
      default: throw new Error('Unsupported import operation')
    }
  })
  const seenSlots = new Set<string>()
  const seenKinds = new Set<string>()
  for (const slot of input.secretSlots) {
    if (seenSlots.has(slot.id) || seenKinds.has(`${slot.connectionId}:${slot.kind}:${slot.headerClass ?? "custom"}`)) throw new Error('Duplicate secret slot')
    seenSlots.add(slot.id); seenKinds.add(`${slot.connectionId}:${slot.kind}:${slot.headerClass ?? "custom"}`)
    const connection = input.operations.find((operation) => operation.kind === 'add-connection' && operation.connection.id === slot.connectionId)
    if (connection?.kind !== 'add-connection' || (slot.kind === 'credential' && connection.connection.authType === 'none')) throw new Error('Secret slot has no compatible connection')
  }
  const secretSlots = input.secretSlots.map((slot) => ({ ...slot, connectionId: remap('connection', slot.connectionId), bound: false as const }))
  return { expectedRevision: input.expectedRevision, operations, remaps, secretSlots }
}

/** URL credentials belong in protected slots, including legacy query-key endpoints. */
export function assertSecretFreeExchange(value: unknown): void {
  const visit = (entry: unknown): void => {
    if (typeof entry === 'string' && /^(?:https?|socks5h?):\/\//i.test(entry)) {
      if (providerUrlHasCredentials(entry)) {
        throw new Error('Endpoint embeds credentials; move them to protected authentication before exchanging configuration')
      }
    } else if (Array.isArray(entry)) entry.forEach(visit)
    else if (entry && typeof entry === 'object') Object.values(entry).forEach(visit)
  }
  visit(value)
}
