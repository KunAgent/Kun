import { useEffect, useRef, useState } from 'react'
import type { AgentIdentity, AgentPage, RoomMember } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'

export const agentPath = (id: string) => '/v1/agents/' + encodeURIComponent(id)
export function agentMember(agent: AgentIdentity, repositoryIds: string[] = []): RoomMember {
  return { id: agent.id, participantAgentId: agent.id, displayName: agent.name, avatar: agent.avatar, agentTitle: agent.title,
    role: agent.defaultRole, presetId: agent.presetId, roleNotes: '', enabled: !agent.archivedAt,
    revision: 0, allowedRepositoryIds: repositoryIds }
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
