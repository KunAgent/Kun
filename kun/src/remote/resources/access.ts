import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { currentAgentConversation } from '../../agents/agent-conversations.js'
import { requireCode } from '../code/access.js'
import type {RemoteResource } from './contracts.js'
export async function remoteResource(runtime: ServerRuntime, resource: RemoteResource) {
  if (resource.kind === 'code') {
    const thread = await requireCode(runtime, resource.id)
    return { thread, room: null, version: await runtime.sessionStore.itemHistoryVersion?.(thread.id) ?? 'legacy' }
  }
  const rooms = runtime.rooms!
  if (!await rooms.agents.store.get('agent_identity', resource.id)) throw new Error('NOT_FOUND')
  const row = await currentAgentConversation(rooms.agents, resource.id)
  const room = row ? await rooms.service.get(row.id) : null
  return { thread: null, room, version: String(room?.privateEpoch ?? 0) }
}
export async function verifyResourceVersion(runtime: ServerRuntime, resource: RemoteResource, version: string) {
  if ((await remoteResource(runtime, resource)).version !== version) throw new Error('HISTORY_CHANGED')
}
