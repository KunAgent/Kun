import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { canonical } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { RemoteScope } from '../contracts.js'
import { currentAgentConversation } from '../../agents/agent-conversations.js'
import { agentWorkspace } from '../../agents/agent-direct-runner.js'
import { agentSetupConversationPolicy, agentSetupPending } from '../../agents/agent-setup.js'
import { normalizeSkillId } from '../../skills/skill-runtime-support.js'
import { canUseMcpServer } from '../../adapters/tool/mcp-naming.js'
import { ROOM_APP_CATALOG, isHiddenRoomGoogleApp, canonicalRoomAppId } from '../../contracts/room-app-catalog.js'
import { requireAgent } from './access.js'
import { libraryCursor } from './library/access.js'
import { writeCursor } from '../cursor-codec.js'
import { RemoteNoEffect } from '../requests/rejections.js'
type Entry = { ref: string; name: string; status: 'available' | 'connected' | 'reconnecting' | 'unavailable'; available: boolean }
type Reason = 'EXTERNAL_AGENT_UNSUPPORTED' | 'AGENT_UNAVAILABLE' | 'NO_CONVERSATION' | 'CATALOG_UNAVAILABLE'
type CatalogPage = { agentId: string; agentRevision: number; appliesTo: 'next_api_turn'; editable: false; available: boolean;
  enabled: boolean; reason?: Reason; revision?: string; items: Entry[]; hasMore: boolean; complete: boolean; nextCursor?: string }
const ref = (agentId: string, kind: string, id: string) => createHash('sha256').update(canonical([agentId, kind, id])).digest('hex')
function label(value: unknown, fallback: string) {
  if (typeof value !== 'string' || /(?:https?:\/\/|^[\/\\]|^[A-Za-z]:[\/\\]|\b(?:token|secret|password|bearer|api[_-]?key)\s*[:=])/i.test(value)) return fallback
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160) || fallback
}
const work = new WeakMap<ServerRuntime, { active: number }>()
async function bounded<T>(runtime: ServerRuntime, run: () => Promise<T>): Promise<T> {
  let state = work.get(runtime)
  if (!state) { state = { active: 0 }; work.set(runtime, state) }
  if (state.active >= 2) throw new Error('AGENT_CATALOG_BUSY')
  state.active++
  let timer: ReturnType<typeof setTimeout> | undefined
  const operation = Promise.resolve().then(run).finally(() => { state.active-- })
  try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('AGENT_CATALOG_UNAVAILABLE')), 5000) })]) }
  finally { clearTimeout(timer) }
}
/** Eligible discovery for a new API input, never a claim that a skill is currently activated. */
export class RemoteAgentCatalog {
  constructor(private readonly runtime: ServerRuntime) {}
  async list(method: 'agent.skills.list' | 'agent.connections.list', p: any, access?: RemoteScope) {
    return bounded(this.runtime, () => this.read(method, p, access))
  }
  private async read(method: 'agent.skills.list' | 'agent.connections.list', p: any, access?: RemoteScope): Promise<CatalogPage> {
    const rooms = this.runtime.rooms!, agent = await requireAgent(rooms, p.agentId), kind = method === 'agent.skills.list' ? 'skills' : 'connections'
    const room = await currentAgentConversation(rooms.agents, p.agentId)
    const base = { agentId: p.agentId, agentRevision: agent.revision, appliesTo: 'next_api_turn' as const, editable: false as const }
    const empty = (reason: Reason): CatalogPage => ({ ...base, available: false, enabled: false, reason, items: [], hasMore: false, complete: true })
    if (agent.executor) return empty('EXTERNAL_AGENT_UNSUPPORTED')
    if (agent.archivedAt || !room || room.value.archivedAt || room.value.deletedAt) return empty(room ? 'AGENT_UNAVAILABLE' : 'NO_CONVERSATION')
    const snapshot = await rooms.agents.freeze(room.value), member = snapshot.members.find((item) => item.id === snapshot.defaultMemberId && item.participantAgentId === p.agentId)
    if (!member || snapshot.conversationKind !== 'user_agent') throw new RemoteNoEffect('NOT_FOUND')
    const profile = member.presetSnapshot ?? rooms.deps.profiles()[agent.presetId], limits = member.capabilityOverrides
    const policy = agentSetupConversationPolicy(agentSetupPending(agent), profile, limits)
    const requestedWorkspace = snapshot.privateWorkspace ?? agentWorkspace(rooms.deps.dataDir, agent.id)
    const workspace = await realpath(requestedWorkspace).catch(() => requestedWorkspace)
    const items: Entry[] = []
    let enabled = true, complete = true
    if (kind === 'skills') {
      if (!this.runtime.skills) return empty('CATALOG_UNAVAILABLE')
      const diagnostics = await this.runtime.skills(workspace)
      enabled = diagnostics.enabled && policy.skillsEnabled && profile?.skillsEnabled !== false
      if (enabled) {
        const denied = new Set([...(limits?.blockedSkills ?? []), ...(profile?.blockedSkills ?? [])].map(normalizeSkillId))
        complete = diagnostics.skills.length <= 2000 && diagnostics.validationErrors.length === 0
        for (const skill of diagnostics.skills.slice(0, 2000)) if (!denied.has(normalizeSkillId(skill.id)))
          items.push({ ref: ref(agent.id, kind, skill.id), name: label(skill.name, 'Skill'), status: 'available', available: true })
      }
    } else {
      if (!this.runtime.mcpConfig || !this.runtime.toolDiagnostics || !this.runtime.mcpOAuth) return empty('CATALOG_UNAVAILABLE')
      const config = this.runtime.mcpConfig(), [diagnostics, oauth] = await Promise.all([this.runtime.toolDiagnostics(), this.runtime.mcpOAuth()])
      enabled = config.enabled && !agentSetupPending(agent)
      complete = diagnostics.mcpServers.length <= 2000
      const denied = new Set([...(limits?.blockedMcpServers ?? []), ...(profile?.blockedMcpServers ?? [])])
      if (enabled) for (const server of diagnostics.mcpServers.slice(0, 2000)) {
        const configured = config.servers[server.id]
        const provider = diagnostics.providers.find((entry) => ['mcp:' + server.id, 'mcp:facade', 'mcp:search'].includes(entry.id) && entry.enabled && entry.available)
        if (!configured?.enabled || denied.has(server.id) || denied.has('mcp:' + server.id) || isHiddenRoomGoogleApp(server.id) || canonicalRoomAppId(server.id) === 'google_gmail') continue
        if (!canUseMcpServer(configured, workspace)) continue
        if (configured.oauth?.enabled !== false && configured.oauth && !oauth.some((item) => item.serverId === server.id && item.status === 'authorized')) continue
        const allowed = policy.allowed ? new Set<string>(policy.allowed) : undefined, names = server.toolNames
        if (allowed && (!names || !names.some((name) => allowed.has(name) && !policy.blocked.includes(name)))) continue
        if (names?.length && names.every((name) => policy.blocked.includes(name))) continue
        const known = ROOM_APP_CATALOG[server.id as keyof typeof ROOM_APP_CATALOG]
        const available = Boolean(server.available && server.status === 'connected' && provider?.enabled && provider.available)
        items.push({ ref: ref(agent.id, kind, server.id), name: label(known?.name ?? server.serverInfo?.name, 'MCP'),
          status: server.status === 'connected' ? 'connected' : server.status === 'reconnecting' ? 'reconnecting' : 'unavailable', available })
      }
    }
    const after = await requireAgent(rooms, agent.id), latest = await rooms.deps.store.get('room', room.id)
    if (after.revision !== agent.revision || latest?.revision !== room.revision) throw new RemoteNoEffect('REVISION_CONFLICT')
    items.sort((a, b) => a.ref.localeCompare(b.ref))
    const revision = createHash('sha256').update(canonical([agent.revision, room.revision, enabled, items, complete])).digest('hex')
    const page = libraryCursor(method, [agent.id, revision, access?.accountId ?? null, access?.deviceId ?? null], p.cursor)
    const offset = page.before ?? 0
    if (offset > items.length) throw new RemoteNoEffect('INVALID_REQUEST')
    const selected = items.slice(offset, offset + p.limit), next = offset + selected.length, hasMore = next < items.length
    return { ...base, available: true, enabled, revision, items: selected, hasMore, complete: !hasMore && complete,
      ...(hasMore ? { nextCursor: writeCursor(page.scope, { before: next }) } : {}) }
  }
}
