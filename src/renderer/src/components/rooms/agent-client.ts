import { useEffect, useRef, useState } from 'react'
import type { AgentIdentity, AgentPage, RoomMember } from '@shared/rooms-api'
import { roomRequestId, roomsRequest, type RoomPresetCatalog } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'

export const agentPath = (id: string) => '/v1/agents/' + encodeURIComponent(id)
export type AgentModelSnapshot = {
  agent: AgentIdentity
  inheritedMain?: AgentIdentity['modelRef']
  main?: AgentIdentity['modelRef']
  mainAvailable?: boolean
}
export function modelBindingKey(
  value?: { providerId?: string; model?: string; accountId?: string } | null
) {
  return value ? JSON.stringify([value.providerId, value.accountId, value.model]) : ''
}
export function agentMember(agent: AgentIdentity, repositoryIds: string[] = []): RoomMember {
  return { id: agent.id, participantAgentId: agent.id, displayName: agent.name, avatar: agent.avatar, agentTitle: agent.title,
    role: agent.defaultRole, presetId: agent.presetId, roleNotes: '', enabled: !agent.archivedAt,
    revision: 0, allowedRepositoryIds: repositoryIds }
}
export async function saveAgentModels(
  agentId: string,
  input: {
    expectedRevision: number
    modelRef: AgentIdentity['modelRef'] | null
    fastModelRef?: AgentIdentity['fastModelRef'] | null
  }
) {
  return roomsRequest<AgentModelSnapshot>(agentPath(agentId) + '/models', 'PUT', {
    clientRequestId: roomRequestId(),
    expectedRevision: input.expectedRevision,
    modelRef: input.modelRef,
    fastModelRef: input.fastModelRef ?? null
  })
}
export async function loadAgentModelsMap(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  const entries = await Promise.all(unique.map(async (id) => {
    try {
      return [id, await roomsRequest<AgentModelSnapshot>(agentPath(id) + '/models')] as const
    } catch {
      return [id, undefined] as const
    }
  }))
  return Object.fromEntries(entries.filter((entry) => entry[1]).map(([id, value]) => [id, value!])) as Record<string, AgentModelSnapshot>
}
export async function persistMemberAgentModels(
  members: RoomMember[],
  originals: Record<string, AgentModelSnapshot>
) {
  for (const member of members) {
    const id = member.participantAgentId
    if (!id) continue
    const original = originals[id]
    if (!original || modelBindingKey(member.modelRef) === modelBindingKey(original.agent.modelRef)) continue
    await saveAgentModels(id, {
      expectedRevision: original.agent.revision,
      modelRef: member.modelRef ?? null,
      fastModelRef: original.agent.fastModelRef ?? null
    })
  }
}
export function memberModelUnavailable(
  member: RoomMember,
  catalog: RoomPresetCatalog,
  agentModels?: AgentModelSnapshot
) {
  if (agentModels) return agentModels.mainAvailable === false
  const preset = catalog.presets.find((item) => item.id === member.presetId)
  const provider = member.modelRef?.providerId ?? preset?.providerId ?? catalog.defaultModel?.providerId
  return Boolean(
    (provider && catalog.unsupportedProviderIds?.includes(provider)) ||
    (!member.modelRef && preset?.available === false)
  )
}
export function useAgentResource<T>(path: string | null, active = true) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const serial = useRef(0)
  const previousPath = useRef<string | null>(null)
  useEffect(() => {
    const generation = ++serial.current
    if (previousPath.current !== path) { setData(null); setError(''); previousPath.current = path }
    if (!path || !active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let responseVersion = 0
    const refresh = async () => {
      const current = ++responseVersion
      try {
        const next = await roomsRequest<T>(path, 'GET', undefined, controller.signal)
        if (!controller.signal.aborted && generation === serial.current && current === responseVersion) { setData(next); setError('') }
      } catch (cause) {
        if (!controller.signal.aborted && generation === serial.current && current === responseVersion) setError(String(cause))
      }
    }
    void refresh()
    const off = subscribeRoomEvents((event) => {
      if (!/^(agent\.|room_run\.|room\.|message\.|request\.|peer\.)/.test(event.kind)) return
      if (!timer) timer = setTimeout(() => { timer = undefined; void refresh() }, path.endsWith('/direct') ? 80 : 300)
    })
    const fallback = setInterval(() => void refresh(), path.endsWith('/direct') || path.includes('/items?') ? 1500 : 15000)
    return () => { controller.abort(); clearTimeout(timer); clearInterval(fallback); off() }
  }, [path, active, version])
  return { data, error, refresh: () => setVersion((value) => value + 1) }
}

export function useRoomAgentModels(room: { members: RoomMember[]; revision?: number }) {
  const key = room.members
    .filter((member) => member.participantAgentId && !member.removedAt)
    .map((member) => member.participantAgentId!)
    .sort()
    .join(',')
  const [data, setData] = useState<Record<string, AgentModelSnapshot>>({})
  useEffect(() => {
    if (!key) {
      setData({})
      return
    }
    let active = true
    void loadAgentModelsMap(key.split(',')).then((value) => {
      if (active) setData(value)
    })
    return () => {
      active = false
    }
  }, [key, room.revision])
  return data
}

export function useAgentCatalog(search = '', archived = false, active = true) {
  const path = '/v1/agents?limit=30&search=' + encodeURIComponent(search) + '&archived_only=' + archived
  const resource = useAgentResource<AgentPage>(path, active)
  const [tail, setTail] = useState<AgentPage>({ agents: [] }), [busy, setBusy] = useState(false)
  const scope = useRef(path); scope.current = path
  const request = useRef<AbortController | null>(null)
  useEffect(() => { request.current?.abort(); setTail({ agents: [] }); setBusy(false) }, [path, active])
  useEffect(() => () => request.current?.abort(), [])
  const headIds = new Set(resource.data?.agents.map((agent) => agent.id) ?? [])
  const agents = [...(resource.data?.agents ?? []), ...tail.agents.filter((agent) => !headIds.has(agent.id))]
  const cursor = tail.agents.length ? tail.nextCursor : resource.data?.nextCursor
  const more = async () => {
    if (!cursor || busy) return
    const controller = new AbortController(); request.current = controller
    const original = path; setBusy(true)
    try {
      const page = await roomsRequest<AgentPage>(path + '&cursor=' + encodeURIComponent(cursor), 'GET', undefined, controller.signal)
      if (!controller.signal.aborted && scope.current === original) setTail((old) => ({ ...page,
        agents: [...new Map([...old.agents, ...page.agents].map((agent) => [agent.id, agent])).values()],
        activities: { ...old.activities, ...page.activities } }))
    } finally { if (!controller.signal.aborted && scope.current === original) setBusy(false) }
  }
  return { ...resource, agents, cursor, more, busy, activities: { ...tail.activities, ...resource.data?.activities } }
}
