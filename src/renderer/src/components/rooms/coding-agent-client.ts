import type { AgentIdentity } from '@shared/rooms-api'
import { useEffect, useState } from 'react'
import { roomsRequest } from './rooms-client'

export type CodingAgentRoute = {
  model: string
  providerId?: string
  accountId?: string
  credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
}
export type CodingAgentEntry = {
  /** Engines whose native tools Kun can force read-only (kun contracts/agent-executor). */
  harnessId: import('../../../../../kun/src/contracts/agent-executor').ConversationHarnessId
  displayName: string
  available: boolean
  reason?: string
  models: CodingAgentRoute[]
}

export const codingRouteKey = (route: CodingAgentRoute): string =>
  JSON.stringify([route.credentialMode ?? '', route.providerId ?? '', route.accountId ?? '', route.model])

type CodingAgentCatalog = { agents: CodingAgentEntry[] }
let lastCatalog: CodingAgentCatalog | null = null
let inflight: Promise<CodingAgentCatalog> | null = null

/** One shared request; the last result outlives the dialog so reopening it is instant. */
export function loadCodingAgentCatalog(): Promise<CodingAgentCatalog> {
  inflight ??= roomsRequest<CodingAgentCatalog>('/v1/agents/coding-agents', 'GET')
    .then((value) => { lastCatalog = value; return value })
    .finally(() => { inflight = null })
  return inflight
}

/**
 * Ready engines come from Code's own Agent discovery, which spawns every CLI.
 * Kun caches it; here we show the last list at once and refresh quietly,
 * instead of re-probing on every conversation event.
 */
export function useCodingAgentCatalog(active: boolean) {
  const [state, setState] = useState<{ data: CodingAgentCatalog | null; error: string }>(() => ({ data: lastCatalog, error: '' }))
  useEffect(() => {
    if (!active) return
    let alive = true, failures = 0, retry: ReturnType<typeof setTimeout> | undefined
    // A cold probe can outlive one request timeout while Kun keeps discovering;
    // retry soon and keep the loading state for the first misses.
    const refresh = () => void loadCodingAgentCatalog().then(
      (data) => { failures = 0; if (alive) setState({ data, error: '' }) },
      (cause) => {
        if (!alive) return
        if (++failures < 3) { clearTimeout(retry); retry = setTimeout(refresh, 2_000) }
        setState((old) => ({ data: old.data, error: old.data || failures < 3 ? '' : String(cause) }))
      })
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => { alive = false; clearInterval(timer); clearTimeout(retry) }
  }, [active])
  return state
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
