import { RemoteArtifacts } from './artifacts.js'
import { agentAttachmentSources } from './agent-attachments.js'
import { versionedHistory } from './versioned-history.js'
import { createHash } from 'node:crypto'
import { READ_METHODS } from '@kun/remote-protocol'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { Router } from '../server/router.js'
import { CreateThreadRequest } from '../contracts/threads.js'
import {
  currentAgentConversation,
  openAgentConversation
} from '../agents/agent-conversations.js'
import {
  directActivity,
  controlDirectRequest
} from '../agents/agent-direct-service.js'
import { agentDirectoryPage } from '../agents/agent-directory-query.js'
import { Envelope, ParamSchemas } from './contracts.js'
import { RemoteReceipts, receiptKey } from './receipts.js'
import { RemoteApprovals } from './approvals.js'
import { localCaller, allowedThread, projects, requireCode } from './routing.js'
import { codeAgents, resolveCodeRoute } from './agents.js'
export class RemoteFacade {
  readonly artifacts: RemoteArtifacts
  private call
  private receipts
  private approvals
  constructor(
    private runtime: ServerRuntime,
    router: Router
  ) {
    this.artifacts = new RemoteArtifacts(runtime)
    this.call = localCaller(router, runtime)
    this.receipts = new RemoteReceipts(runtime.rooms!)
    this.approvals = new RemoteApprovals(runtime, this.call)
  }
  async execute(raw: unknown) {
    const envelope = Envelope.parse(raw),
      { method } = envelope.call
    const params = ParamSchemas[method].parse(envelope.call.params)
    if (method === 'request.get')
      return this.lookup(envelope, (params as { requestId: string }).requestId)
    // Agent/model picks are refused before a receipt exists, so the refusal is certain.
    if (
      method === 'code.create' &&
      !(await this.receipts.get(envelope, envelope.call.requestId))
    )
      await this.codeRoute(params)
    const run = () => this.dispatch(envelope, params)
    if (READ_METHODS.has(method) || method === 'approval.prepare') return run()
    return { receipt: await this.receipts.execute(envelope, run) }
  }
  private async lookup(scope: Envelope, id: string) {
    const receipt = await this.receipts.get(scope, id),
      key = receiptKey(scope, id),
      params = receipt?.params
    if (receipt?.status !== 'reconciliation_required' || !params)
      return { receipt }
    let result: unknown
    if (receipt.method === 'code.create') {
      const thread = await this.runtime.threadService.get(
        'thr_mobile_' +
          createHash('sha256').update(key).digest('hex').slice(0, 32)
      )
      if (thread) result = { thread }
    } else if (
      receipt.method === 'code.turn.start' &&
      typeof params.threadId === 'string'
    ) {
      const thread = await this.runtime.threadService.get(params.threadId),
        turn = thread?.turns.find((t) => t.clientRequestId === key)
      if (turn)
        result = { threadId: thread!.id, turnId: turn.id, status: turn.status }
    } else if (
      receipt.method === 'agent.message.send' &&
      typeof params.agentId === 'string'
    ) {
      const room = await currentAgentConversation(
        this.runtime.rooms!.agents,
        params.agentId
      )
      if (room) {
        const prior = await this.runtime.rooms!.deps.store.getRequest(
          'room-message:' + room.id + ':' + key
        )
        if (prior) result = prior.result
      }
    }
    return {
      receipt:
        result === undefined
          ? receipt
          : await this.receipts.recovered(scope, id, result)
    }
  }
  private async legacyModels() {
    const threads = await this.runtime.threadService.list({
      workbenchScope: 'code',
      limit: 1000
    })
    return [
      ...new Set(
        [this.runtime.defaultModel, ...threads.map((t) => t.model)].filter(
          (model): model is string => Boolean(model)
        )
      )
    ]
  }
  private async codeRoute(p: any) {
    return resolveCodeRoute(this.runtime, p, await this.legacyModels())
  }
  async conversation(agentId: string) {
    const rooms = this.runtime.rooms!
    if (!await rooms.agents.store.get('agent_identity', agentId)) throw new Error('NOT_FOUND')
    return rooms.exclusive(() =>
      openAgentConversation(rooms.agents, rooms.service, agentId)
    )
  }
  private async dispatch(envelope: Envelope, p: any): Promise<unknown> {
    const runtime = this.runtime,
      rooms = runtime.rooms!,
      { method, requestId } = envelope.call
    switch (method) {
      case 'catalog.get': {
        const list = await projects(runtime)
        const models = await this.legacyModels()
        return {
          projects: list.map(({ id, name }) => ({ id, name })),
          models,
          defaultModel: runtime.defaultModel,
          agents: await codeAgents(runtime, models),
          capabilities: [
            'agent',
            'code',
            'code.agents',
            'approvals',
            'attachments'
          ],
          attachmentMaxBytes: 10 * 1024 * 1024
        }
      }
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
      case 'code.list':
        return this.call(
          '/v1/threads?workbench_scope=code&lean=true&limit=50' +
            (p.cursor ? '&cursor=' + encodeURIComponent(p.cursor) : '')
        )
      case 'code.history': {
        await requireCode(runtime, p.threadId)
        const { history, historyVersion } = await versionedHistory(runtime.sessionStore, p.threadId, () => this.call(
          '/v1/threads/' +
            p.threadId +
            '/timeline' +
            (p.cursor ? '?before=' + encodeURIComponent(p.cursor) : '')
        ))
        return {
          ...history,
          historyVersion,
          artifacts: await this.artifacts.codeHistory(history)
        }
      }
      case 'code.create': {
        const project = (await projects(runtime)).find(
          (v) => v.id === p.projectId
        )
        if (!project) throw new Error('PROJECT_NOT_ALLOWED')
        const id =
          'thr_mobile_' +
          createHash('sha256')
            .update(receiptKey(envelope, requestId))
            .digest('hex')
            .slice(0, 32)
        const old = await runtime.threadService.get(id)
        if (old) return { thread: old }
        const { harnessId, credentialMode, providerId, model } =
          await this.codeRoute(p)
        const explicit = Boolean(p.harnessId || p.credentialMode || p.providerId)
        const thread = await runtime.threadService.create(
          CreateThreadRequest.parse({
            title: p.title,
            workspace: project.path,
            model,
            ...(explicit ? { harnessId } : {}),
            ...(credentialMode ? { credentialMode } : {}),
            ...(providerId ? { providerId } : {}),
            agentSurface: 'code',
            workspaceMode: 'code'
          }),
          { id }
        )
        return { thread }
      }
      case 'code.turn.start': {
        await requireCode(runtime, p.threadId)
        return this.call('/v1/threads/' + p.threadId + '/turns', 'POST', {
          prompt: p.text,
          attachmentIds: p.attachmentIds,
          clientRequestId: receiptKey(envelope, requestId),
          clientSurface: 'api'
        })
      }
      case 'execution.stop': {
        if (p.agentId) {
          const { room } = await this.conversation(p.agentId),
            target = await rooms.deps.store.get('request', p.executionId)
          if (!target || target.roomId !== room.id)
            throw new Error('INVALID_TARGET')
          return rooms.exclusive(() =>
            controlDirectRequest(rooms, room.id, target.id, {
              clientRequestId: receiptKey(envelope, requestId),
              expectedRevision: target.revision,
              action: 'stop'
            })
          )
        }
        if (!p.threadId || !p.turnId) throw new Error('INVALID_TARGET')
        await requireCode(runtime, p.threadId)
        return this.call(
          '/v1/threads/' + p.threadId + '/turns/' + p.turnId + '/interrupt',
          'POST',
          {}
        )
      }
      case 'approval.list': {
        let threadId = p.threadId
        if (p.agentId) {
          const { room } = await this.conversation(p.agentId)
          const activity = await directActivity(rooms, room.id)
          threadId = activity.active?.threadId
          if (!threadId) return { approvals: [], inputs: [] }
        }
        if (!threadId) throw new Error('INVALID_TARGET')
        await allowedThread(runtime, threadId)
        return {
          approvals: runtime.approvalGate.pending(threadId),
          inputs: runtime.userInputGate.pending(threadId)
        }
      }
      case 'approval.prepare':
        return this.approvals.prepare(envelope, p.approvalId)
      case 'approval.resolve':
        return this.approvals.resolve(envelope, p)
      case 'input.resolve': {
        const pending = runtime.userInputGate.get(p.inputId)
        if (!pending) throw new Error('INPUT_EXPIRED')
        await allowedThread(runtime, pending.threadId)
        return this.call('/v1/user-inputs/' + p.inputId, 'POST', {
          answers: p.answers
        })
      }
    }
  }
}
