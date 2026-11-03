import type { AssistantPresenceView } from '../../shared/assistant-mailbox'
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const time = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const optionalTime = (v: unknown): v is string | null => v === null || time(v)
export function parseAssistantPresence(input: unknown, owner: string): Map<string, AssistantPresenceView> {
  if (!input || typeof input !== 'object') throw new Error('ASSISTANT_PRESENCE_INVALID')
  const data = input as Record<string, unknown>
  if (data.version !== 2 || data.userId !== owner || !Array.isArray(data.assistants) || data.assistants.length > 16) throw new Error('ASSISTANT_PRESENCE_INVALID')
  const results = new Map<string, AssistantPresenceView>()
  for (const row of data.assistants) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !id.test(row.id) || results.has(row.id)) throw new Error('ASSISTANT_PRESENCE_INVALID')
    const p = row.presence
    if (p === null) continue
    if (!p || typeof p !== 'object' || typeof p.instanceId !== 'string' || !id.test(p.instanceId)
      || typeof p.platform !== 'string' || !/^[a-z0-9_.-]{1,32}$/.test(p.platform)
      || typeof p.agentVersion !== 'string' || !/^[a-zA-Z0-9.+-]{1,32}$/.test(p.agentVersion)
      || !Array.isArray(p.capabilities) || p.capabilities.length > 8 || !p.capabilities.every((v: unknown) => typeof v === 'string' && /^[a-z_]{1,32}$/.test(v))
      || !['online', 'reconnecting', 'stopped', 'error', 'offline'].includes(p.syncState) || typeof p.listening !== 'boolean'
      || !time(p.reportedAt) || !optionalTime(p.lastConsumerAt)
      || !(p.lastError === null || typeof p.lastError === 'string' && /^[a-z0-9_]{1,64}$/.test(p.lastError))) throw new Error('ASSISTANT_PRESENCE_INVALID')
    results.set(row.id, { instanceId: p.instanceId, platform: p.platform, agentVersion: p.agentVersion, capabilities: p.capabilities,
      syncState: p.syncState, listening: p.listening, reportedAt: p.reportedAt, lastConsumerAt: p.lastConsumerAt, lastError: p.lastError })
  }
  return results
}
export async function loadAssistantPresence(origin: string, owner: string, token: string, request: typeof fetch): Promise<Map<string, AssistantPresenceView>> {
  const response = await request(`${origin}/api/account/v2/assistants`, { headers: { Authorization: `Bearer ${token}` },
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store' })
  if (response.status === 404) { await response.body?.cancel(); return new Map() }
  if (!response.ok) { await response.body?.cancel(); throw new Error('ASSISTANT_PRESENCE_UNAVAILABLE') }
  const body = await response.text()
  if (body.length > 65536) throw new Error('ASSISTANT_PRESENCE_INVALID')
  return parseAssistantPresence(JSON.parse(body), owner)
}
