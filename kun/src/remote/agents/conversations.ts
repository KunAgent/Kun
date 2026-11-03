import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { LocalCall } from '../runtime/local-call.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { currentAgentConversation, openAgentConversation } from '../../agents/agent-conversations.js'
import { directActivity } from '../../agents/agent-direct-service.js'
import { agentDirectoryPage } from '../../agents/agent-directory-query.js'
import { agentAttachmentSources } from './attachment-sources.js'
export class RemoteAgentConversations {
  constructor(private runtime: ServerRuntime, private call: LocalCall) {}
  async conversation(agentId: string) {
    const rooms = this.runtime.rooms!
    if (!await rooms.agents.store.get('agent_identity', agentId)) throw new Error('NOT_FOUND')
    return rooms.exclusive(() =>
      openAgentConversation(rooms.agents, rooms.service, agentId)
    )
  }
  async dispatch(envelope: Envelope, p: any): Promise<unknown> {
    const runtime = this.runtime, rooms = runtime.rooms!, { method, requestId } = envelope.call
    switch (method) {
case 'agent.list': {
        const page = await agentDirectoryPage(rooms.agents, p)
        return {
          agents: page.agents.map((a) => ({
            id: a.id,
            name: a.name,
            title: a.title
          })),
          activities: page.activities,
          nextCursor: page.nextCursor
        }
      }
case 'agent.history': {
        const { room } = await this.conversation(p.agentId)
        const cursor = await rooms.deps.store.latestEventSeq?.()
        const history = await this.call(
          '/v1/rooms/' +
            room.id +
            '/messages' +
            (p.cursor ? '?cursor=' + encodeURIComponent(p.cursor) : '')
        )
        return {
          ...history,
          messages: await agentAttachmentSources(runtime, room.id, history.messages ?? []),
          artifacts: (
            await rooms.artifactLibrary.list(p.agentId)
          ).artifacts.map((a) => ({
            id: a.artifactId,
            version: a.version,
            name: a.title,
            size: a.byteSize,
            mimeType: a.mimeType,
            available: a.byteSize <= 25 * 1024 * 1024
          })),
          roomId: room.id,
          name: room.name,
          activity: await directActivity(rooms, room.id),
          eventScope: await rooms.deps.store.eventScope?.(),
          historyVersion: String(room.privateEpoch ?? 0),
          cursor
        }
      }
case 'agent.message.send': {
        const { room } = await this.conversation(p.agentId)
        const result = await rooms.exclusive(() =>
          rooms.service.send(
            room.id,
            {
              clientRequestId: receiptKey(envelope, requestId),
              body: p.text,
              attachmentIds: p.attachmentIds
            },
            { clientSurface: 'api', remoteDeviceId: envelope.deviceId }
          )
        )
        rooms.wake()
        return { ...result, roomId: room.id }
      }
    }
  }
  async recover(scope: RemoteScope, receipt: Receipt) {
    if (receipt.method !== 'agent.message.send' || typeof receipt.params?.agentId !== 'string') return undefined
    const room = await currentAgentConversation(this.runtime.rooms!.agents, receipt.params.agentId)
    if (!room) return undefined
    const prior = await this.runtime.rooms!.deps.store.getRequest('room-message:' + room.id + ':' + receiptKey(scope, receipt.requestId))
    return prior?.result
  }
}
