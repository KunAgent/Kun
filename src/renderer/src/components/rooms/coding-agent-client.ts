import type { AgentIdentity } from '@shared/rooms-api'
import { useAgentResource } from './agent-client'
import { roomsRequest } from './rooms-client'

export type CodingAgentRoute = {
  model: string
  providerId?: string
  accountId?: string
  credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
}
export type CodingAgentEntry = {
  harnessId: 'claude-code' | 'codex' | 'opencode'
  displayName: string
  available: boolean
  reason?: string
  models: CodingAgentRoute[]
}

export const codingRouteKey = (route: CodingAgentRoute): string =>
  JSON.stringify([route.credentialMode ?? '', route.providerId ?? '', route.accountId ?? '', route.model])

/** Ready engines come from Code's own Agent discovery; probing can take a few seconds. */
export function useCodingAgentCatalog(active: boolean) {
  return useAgentResource<{ agents: CodingAgentEntry[] }>('/v1/agents/coding-agents', active)
}

/** One contact per engine route; choosing another model updates that contact. */
export async function ensureCodingAgent(clientRequestId: string, harnessId: CodingAgentEntry['harnessId'],
  route: CodingAgentRoute): Promise<AgentIdentity> {
  const result = await roomsRequest<{ agent: AgentIdentity }>('/v1/agents/coding-agents', 'POST', {
    clientRequestId, harnessId, model: route.model,
    ...(route.providerId ? { providerId: route.providerId } : {}),
    ...(route.accountId ? { accountId: route.accountId } : {}),
    ...(route.credentialMode ? { credentialMode: route.credentialMode } : {})
  })
  return result.agent
}

/** Kun leads every group; coding Agents only join its discussion. */
export function groupLeadId(selected: AgentIdentity[]): string | undefined {
  return selected.find((agent) => !agent.executor)?.id
}
