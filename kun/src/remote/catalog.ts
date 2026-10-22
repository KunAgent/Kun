import { VERSION as REMOTE_PROTOCOL_VERSION, DIRECTORY_LIVE_CAPABILITY, MODEL_INFO_CAPABILITY, OPERATION_READ_METHODS, REASONING_EFFORT_CAPABILITY } from '@kun/remote-protocol'
import { KUN_VERSION, KUN_RELEASE_CHANNEL } from '../version.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { Envelope } from './contracts.js'
import { REMOTE_CAPABILITY_ORDER } from './method-order.js'
import { CodeManagementParamSchemas } from './code/contracts.js'
import { CodeHistoryParamSchemas } from './code/history/contracts.js'
import { AgentSearchParamSchemas } from './agents/search-contracts.js'
import { AgentDirectoryParams } from './agents/directory.js'
import type { RemoteAgents } from './agents/service.js'
import { MessageParamSchemas } from './messages/contracts.js'
import type { RemoteSourceContent } from './messages/source/content.js'
import { AttentionParamSchemas } from './attention/contracts.js'
import { ArtifactDirectoryParamSchemas } from './files/artifact-contracts.js'
import { ProjectFilesParamSchemas } from './files/project-contracts.js'
import { ExecutionQueueParamSchemas } from './execution/contracts.js'
import { GoalParamSchemas } from './goals/contracts.js'
import { GroupParamSchemas } from './groups/contracts.js'
import { CollaborationParamSchemas } from './collaboration/contracts.js'
import { ScheduleParamSchemas } from './schedules/contracts.js'
import { PluginParamSchemas } from './plugins/contracts.js'
import { operationAuthorized } from './authorization/scopes.js'
import { projects } from './files/project-directory.js'
import { codeAgents } from './code/model-catalog.js'

/** Catalog policy belongs to capabilities, independently of implementation file layout. */
export async function remoteCapabilityDescriptors(
  runtime: ServerRuntime,
  scope: Envelope,
  agents: RemoteAgents,
  source: RemoteSourceContent
) {
  const descriptors: any[] = []
  const reads = new Set<string>(OPERATION_READ_METHODS)
  const add = (schemas: object, resourceKind: string, limits: Record<string, number>, available = true) => {
    for (const operation of Object.keys(schemas)) {
      if (!available || !operationAuthorized(scope, operation)) continue
      descriptors.push({ operation, schemaVersion: 1, resourceKind,
        allowedActions: [reads.has(operation) ? 'read' : 'write'],
        supported: true, enabled: true, authorized: true, online: true, limits: { ...limits } })
    }
  }
  add(CodeManagementParamSchemas, 'code', { pageSize: 50 })
  const search = descriptors.find((descriptor) => descriptor.operation === 'code.search')
  if (search) search.limits.dateRange = 1
  add(AgentSearchParamSchemas, 'agent', { pageSize: 50 })
  add(MessageParamSchemas, 'message', { pageSize: 50 })
  add(AttentionParamSchemas, 'attention', { pageSize: 50 })
  add(ArtifactDirectoryParamSchemas, 'artifact', { pageSize: 50 })
  descriptors.push(...await agents.descriptors())
  add(CodeHistoryParamSchemas, 'code', { pageSize: 20, nativeTurns: 1, requiresIdle: 1 })
  for (const descriptor of descriptors) {
    if (descriptor.operation.startsWith('code.rewind.')) {
      descriptor.limits.maxDraftChars = 64000
      descriptor.limits.attachmentCount = 8
    }
  }
  add(ExecutionQueueParamSchemas, 'code', { pageSize: 20 })
  add(GoalParamSchemas, 'code', { pageSize: 20 })
  for (const [operation, schema] of Object.entries(ProjectFilesParamSchemas)) {
    add({ [operation]: schema }, 'file', { pageSize: operation.startsWith('project.') ? 50 : 20 })
  }
  add(GroupParamSchemas, 'group', { pageSize: 20 }, Boolean(runtime.rooms))
  const send = descriptors.find((descriptor) => descriptor.operation === 'group.message.send')
  if (send) send.limits.attachments = 0
  add({ 'agent.directory.list': AgentDirectoryParams }, 'agent', { pageSize: 20 }, Boolean(runtime.rooms))
  add(ScheduleParamSchemas, 'schedule', { pageSize: 20 }, Boolean(runtime.rooms))
  add(CollaborationParamSchemas, 'collaboration', { pageSize: 20 }, Boolean(runtime.rooms))
  add(PluginParamSchemas, 'plugin', { pageSize: 20 }, Boolean(runtime.extensionPlatform))
  const order = new Map<string, number>(REMOTE_CAPABILITY_ORDER.map((method, index) => [method, index]))
  return descriptors.filter(({ operation }) => {
    if (operation === 'message.source.get') return source.available
    return !['code.search', 'message.search', 'message.get', 'artifact.list'].includes(operation) ||
      Boolean(runtime.sessionStore.loadItemPage)
  }).sort((left, right) => order.get(left.operation)! - order.get(right.operation)!)
}

/**
 * Catalog refreshes scan Code threads for projects and model choices. Concurrent and repeated
 * reads share one scan until a directory invalidation or this TTL. Task creation and other
 * mutations keep reading the directory directly.
 */
export const CATALOG_SCAN_TTL_MS = 10000
const scans = new WeakMap<object, Map<string, { at: number; value: Promise<unknown> }>>()
/** A push must never be followed by the old directory snapshot from the scan cache. */
export function invalidateRemoteCatalog(runtime: object): void { scans.delete(runtime) }
function scanned<T>(runtime: object, key: string, read: () => Promise<T>): Promise<T> {
  let entries = scans.get(runtime)
  if (!entries) scans.set(runtime, entries = new Map())
  const hit = entries.get(key)
  if (hit && Date.now() - hit.at < CATALOG_SCAN_TTL_MS) return hit.value as Promise<T>
  const value = read(), owner = entries
  owner.set(key, { at: Date.now(), value })
  value.catch(() => { if (owner.get(key)?.value === value) owner.delete(key) })
  return value
}

export async function remoteCatalog(runtime: ServerRuntime, scope: Envelope, models: () => Promise<string[]>, descriptors: () => Promise<unknown[]>) {
  const [list, availableModels] = await Promise.all([scanned(runtime, 'projects', () => projects(runtime)), scanned(runtime, 'models', models)])
  return {
    host: { runtimeVersion: KUN_VERSION, protocolVersion: REMOTE_PROTOCOL_VERSION,
      releaseChannel: KUN_RELEASE_CHANNEL, confirmedAt: Date.now() },
    projects: list.map(({ id, name }) => ({ id, name })), models: availableModels,
    defaultModel: runtime.defaultModel,
    agents: await codeAgents(runtime, availableModels),
    capabilities: ['agent', 'code', 'code.agents', REASONING_EFFORT_CAPABILITY, MODEL_INFO_CAPABILITY, 'approvals', 'attachments',
      ...(runtime.threadActivity ? [DIRECTORY_LIVE_CAPABILITY] : [])],
    scopes: scope.scopes, capabilityDescriptors: await descriptors(), attachmentMaxBytes: 10 * 1024 * 1024
  }
}
