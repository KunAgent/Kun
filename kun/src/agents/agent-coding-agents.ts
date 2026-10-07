import { z } from 'zod'
import { AgentExecutorSchema, CONVERSATION_HARNESS_IDS, ConversationHarnessIdSchema, agentExecutorRouteKey,
  type AgentExecutor } from '../contracts/agent-executor.js'
import { HarnessCredentialModeSchema } from '../contracts/harness.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { WorkbenchHarnessService } from '../workbench-bridge/harnesses.js'
import type { AgentIdentityService } from './agent-identity-service.js'
import { agentStableId } from './agent-identity-service.js'

const Id = z.string().min(1).max(128)
export const EnsureCodingAgentRequest = z.object({
  clientRequestId: Id,
  harnessId: ConversationHarnessIdSchema,
  model: z.string().min(1).max(256),
  providerId: z.string().min(1).max(256).optional(),
  accountId: z.string().min(1).max(256).optional(),
  credentialMode: HarnessCredentialModeSchema.optional()
}).strict()

export type CodingAgentCatalogEntry = {
  harnessId: AgentExecutor['harnessId']
  displayName: string
  available: boolean
  reason?: string
  models: Array<Pick<AgentExecutor, 'model' | 'providerId' | 'accountId'> & { credentialMode?: AgentExecutor['credentialMode'] }>
}

const conversational = (id: string): id is AgentExecutor['harnessId'] =>
  (CONVERSATION_HARNESS_IDS as readonly string[]).includes(id)

/** Same discovery as Code's external Agent list, narrowed to engines that may join conversations. */
export async function codingAgentCatalog(harnesses: WorkbenchHarnessService | undefined): Promise<{ agents: CodingAgentCatalogEntry[] }> {
  if (!harnesses) return { agents: [] }
  const listed = await harnesses.list()
  return { agents: listed.agents.flatMap((agent) => conversational(agent.harnessId) ? [{
    harnessId: agent.harnessId, displayName: agent.displayName, available: agent.available,
    ...(agent.reason ? { reason: agent.reason } : {}),
    models: agent.models.map((route) => ({ model: route.model,
      ...(route.providerId ? { providerId: route.providerId } : {}),
      ...(route.accountId ? { accountId: route.accountId } : {}),
      ...(route.credentialMode ? { credentialMode: route.credentialMode } : {}) }))
  }] : []) }
}

/** Resolve and freeze one engine route; unavailable or disabled engines fail here, not mid-chat. */
export async function resolveCodingAgentExecutor(harnesses: WorkbenchHarnessService | undefined,
  executor: AgentExecutor): Promise<AgentExecutor> {
  if (!harnesses) throw new Error('Coding Agents are unavailable until Code finishes starting')
  const route = await harnesses.resolve({ title: 'Coding Agent', goal: '', mode: 'agent', isolation: 'inherit', report: 'final',
    execution: { mode: 'direct', model: { harnessId: executor.harnessId, model: executor.model,
      credentialMode: executor.credentialMode,
      ...(executor.providerId ? { providerId: executor.providerId } : {}),
      ...(executor.accountId ? { accountId: executor.accountId } : {}) } } })
  return AgentExecutorSchema.parse({ kind: 'harness', harnessId: route.harnessId ?? executor.harnessId,
    credentialMode: route.credentialMode ?? executor.credentialMode, model: route.model,
    ...(route.providerId ? { providerId: route.providerId } : {}),
    ...(route.accountId ? { accountId: route.accountId } : {}) })
}

/** Archived contacts are left alone; choosing the engine again starts a fresh contact. */
async function findCodingAgent(agents: AgentIdentityService, routeKey: string): Promise<AgentIdentity | undefined> {
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const result = await agents.list({ limit: 100, ...(cursor ? { cursor } : {}) })
    const found = result.agents.find((agent) => agent.executor && agentExecutorRouteKey(agent.executor) === routeKey)
    if (found) return found
    if (!result.nextCursor) return undefined
    cursor = result.nextCursor
  }
  return undefined
}

/** Resolve outside the room lock: engine discovery can take seconds. */
export async function prepareCodingAgent(harnesses: WorkbenchHarnessService | undefined, raw: unknown) {
  const input = EnsureCodingAgentRequest.parse(raw)
  const catalog = await codingAgentCatalog(harnesses)
  const entry = catalog.agents.find((agent) => agent.harnessId === input.harnessId)
  if (!entry) throw new Error('This coding Agent is not available in Code settings')
  const executor = await resolveCodingAgentExecutor(harnesses, AgentExecutorSchema.parse({ kind: 'harness',
    harnessId: input.harnessId, model: input.model,
    credentialMode: input.credentialMode ?? entry.models.find((model) => model.model === input.model)?.credentialMode ?? 'native-login',
    ...(input.providerId ? { providerId: input.providerId } : {}), ...(input.accountId ? { accountId: input.accountId } : {}) }))
  return { clientRequestId: input.clientRequestId, displayName: entry.displayName, executor }
}

/**
 * One contact per engine route. Picking another model for the same route
 * updates that contact so its conversations and history stay together.
 */
export async function saveCodingAgent(agents: AgentIdentityService,
  prepared: Awaited<ReturnType<typeof prepareCodingAgent>>): Promise<{ agent: AgentIdentity }> {
  const { executor, clientRequestId } = prepared
  const existing = await findCodingAgent(agents, agentExecutorRouteKey(executor))
  if (existing) {
    if (existing.executor!.model === executor.model) return { agent: existing }
    return agents.update(existing.id, { clientRequestId: agentStableId('coding-agent-model', clientRequestId),
      expectedRevision: existing.revision, executor, title: executor.model })
  }
  return agents.create({ clientRequestId: agentStableId('coding-agent', clientRequestId), name: prepared.displayName,
    title: executor.model, executor, avatar: { kind: 'harness', harnessId: executor.harnessId },
    instructions: '', defaultRole: 'developer', presetId: 'general' })
}
