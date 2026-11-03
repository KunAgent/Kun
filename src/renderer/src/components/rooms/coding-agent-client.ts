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
  /** Kun is still checking this engine; the entry may become ready on the next refresh. */
  detecting?: boolean
  models: CodingAgentRoute[]
}

export const codingRouteKey = (route: CodingAgentRoute): string =>
  JSON.stringify([route.credentialMode ?? '', route.providerId ?? '', route.accountId ?? '', route.model])

type CodingAgentCatalog = { agents: CodingAgentEntry[]; discovering?: boolean }

/** Follow-up cadence while Kun reports engines still detecting; its own cache answers in between. */
export const CODING_AGENT_DISCOVERING_POLL_MS = 5_000
const CODING_AGENT_DISCOVERING_POLL_LIMIT = 6
const CODING_AGENT_RETRY_BASE_MS = 2_000
const CODING_AGENT_RETRY_LIMIT = 3
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
 * Ready engines come from Code's own Agent discovery. Kun caches it for
 * minutes and answers from that cache, so the dialog asks once when it opens
 * and only follows up while Kun says an engine is still being checked.
 */
export function useCodingAgentCatalog(active: boolean) {
  const [state, setState] = useState<{ data: CodingAgentCatalog | null; error: string }>(() => ({ data: lastCatalog, error: '' }))
  useEffect(() => {
    if (!active) return
    let alive = true, failures = 0, followUps = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (delayMs: number) => { clearTimeout(timer); timer = setTimeout(refresh, delayMs) }
    function refresh(): void {
      void loadCodingAgentCatalog().then(
        (data) => {
          failures = 0
          if (!alive) return
          setState({ data, error: '' })
          if (data.discovering && ++followUps <= CODING_AGENT_DISCOVERING_POLL_LIMIT) schedule(CODING_AGENT_DISCOVERING_POLL_MS)
        },
        (cause) => {
          if (!alive) return
          // A cold discovery can outlive one request; back off instead of re-asking every few seconds.
          if (++failures < CODING_AGENT_RETRY_LIMIT) schedule(CODING_AGENT_RETRY_BASE_MS * 2 ** (failures - 1))
          setState((old) => ({ data: old.data, error: old.data || failures < CODING_AGENT_RETRY_LIMIT ? '' : String(cause) }))
        })
    }
    refresh()
    return () => { alive = false; clearTimeout(timer) }
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
