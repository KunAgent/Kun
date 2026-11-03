import { z } from 'zod'
import { REMOTE_METHOD_ORDER } from './method-order.js'
import { CodeManagementParamSchemas, CodeTaskParamSchemas } from './code/contracts.js'
import { AgentParamSchemas } from './agents/contracts.js'
import { AgentSearchParamSchemas } from './agents/search-contracts.js'
import { AgentConversationParamSchemas } from './agents/conversation-contracts.js'
import { MessageParamSchemas } from './messages/contracts.js'
import { AttentionParamSchemas } from './attention/contracts.js'
import { ArtifactDirectoryParamSchemas } from './files/artifact-contracts.js'
import { ExecutionQueueParamSchemas, ExecutionStopParamSchemas } from './execution/contracts.js'
import { GoalParamSchemas } from './goals/contracts.js'
import { ProjectFilesParamSchemas } from './files/project-contracts.js'
import { CodeHistoryParamSchemas } from './code/history/contracts.js'
import { GroupParamSchemas } from './groups/contracts.js'
import { CollaborationParamSchemas } from './collaboration/contracts.js'
import { ScheduleParamSchemas } from './schedules/contracts.js'
import { PluginParamSchemas } from './plugins/contracts.js'
import { AgentDirectoryParams } from './agents/directory.js'
import { RequestParamSchemas } from './requests/contracts.js'
import { ApprovalParamSchemas } from './approvals/contracts.js'
export const RemoteId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const schemas = {
  ...CodeManagementParamSchemas,
  ...CodeTaskParamSchemas,
  ...AgentParamSchemas,
  ...AgentSearchParamSchemas,
  ...AgentConversationParamSchemas,
  ...MessageParamSchemas,
  ...AttentionParamSchemas,
  ...ArtifactDirectoryParamSchemas,
  ...ExecutionQueueParamSchemas,
  ...ExecutionStopParamSchemas,
  ...GoalParamSchemas,
  ...ProjectFilesParamSchemas,
  ...CodeHistoryParamSchemas,
  ...GroupParamSchemas,
  ...CollaborationParamSchemas,
  ...ScheduleParamSchemas,
  ...PluginParamSchemas,
  ...RequestParamSchemas,
  ...ApprovalParamSchemas,
  'agent.directory.list': AgentDirectoryParams,
  'catalog.get': z.object({}).strict()
} as const
const orderedMethods = new Set<string>(REMOTE_METHOD_ORDER)
if (orderedMethods.size !== REMOTE_METHOD_ORDER.length || orderedMethods.size !== Object.keys(schemas).length ||
  Object.keys(schemas).some((method) => !orderedMethods.has(method))) {
  throw new Error('REMOTE_SCHEMA_REGISTRATION_INCOMPLETE')
}
export const ParamSchemas = Object.fromEntries(REMOTE_METHOD_ORDER.map((method) => [method, schemas[method]])) as typeof schemas
export type Method = keyof typeof ParamSchemas
export const Envelope = z
  .object({
    accountId: RemoteId,
    deviceId: RemoteId,
    authorizationId: RemoteId,
    scopes: z.array(z.enum(['personal', 'groups.read', 'groups.write', 'collaboration.read', 'collaboration.control', 'schedules.read', 'extensions.read', 'extensions.control', 'shares.manage'])).max(9).default(['personal']),
    call: z
      .object({
        method: z.enum(Object.keys(ParamSchemas) as [Method, ...Method[]]),
        requestId: RemoteId,
        expiresAt: z.number().int().positive(),
        params: z.record(z.string(), z.unknown())
      })
      .strict()
  })
  .strict()
export type Envelope = z.infer<typeof Envelope>
export type RemoteScope = Pick<
  Envelope,
  'accountId' | 'deviceId' | 'authorizationId'
>
