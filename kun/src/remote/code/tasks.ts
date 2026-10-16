import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { LocalCall } from '../runtime/local-call.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { createHash } from 'node:crypto'
import { CreateThreadRequest, type ThreadRecord } from '../../contracts/threads.js'
import { isRemoteCodeAllowed, requireCode } from './access.js'
import { projects } from '../files/project-directory.js'
import { resolveCodeRoute } from './model-catalog.js'
import { RemoteCodeManagement, metadataRevision } from './management.js'
import { RemoteCodeHistory } from './history/service.js'
import type { RemoteArtifacts } from '../files/artifacts.js'
import { versionedHistory } from '../messages/history-version.js'

/**
 * The task depth a new turn inherits. A fresh admission promotes pending settings first, so they win; the
 * current depth applies only while the thread still runs the route it was chosen for.
 */
function storedEffort(thread: ThreadRecord) {
  const pending = thread.pendingExecutionConfig?.route
  if (pending) return pending.reasoningEffort
  const route = thread.executionConfig?.route
  return route && route.model === thread.model && route.harnessId === thread.harnessId &&
    route.providerId === thread.providerId ? route.reasoningEffort : undefined
}
export class RemoteCodeTasks {
  constructor(private runtime: ServerRuntime, private call: LocalCall, private management: RemoteCodeManagement, private history: RemoteCodeHistory, private artifacts: RemoteArtifacts) {}
  async models() {
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
  async route(p: any) {
    return resolveCodeRoute(this.runtime, p, await this.models())
  }
  async dispatch(envelope: Envelope, p: any): Promise<unknown> {
    const runtime = this.runtime, { method, requestId } = envelope.call
    switch (method) {
case 'code.list': {
        const page = await this.call(
          '/v1/threads?workbench_scope=code&lean=true&limit=50' +
            (p.cursor ? '&cursor=' + encodeURIComponent(p.cursor) : '')
        )
        const threads = []
        for (const row of page.threads ?? []) if (await isRemoteCodeAllowed(runtime, row)) {
          const thread = await runtime.threadService.getMetadata(row.id)
          if (thread) threads.push(await this.management.summary(thread))
        }
        return { threads, hasMore: page.hasMore, nextCursor: page.nextCursor }
      }
case 'code.history': {
        await requireCode(runtime, p.threadId)
        await this.history.reconcileThread(p.threadId)
        const { history, historyVersion } = await versionedHistory(runtime.sessionStore, p.threadId, () => this.call(
          '/v1/threads/' +
            p.threadId +
            '/timeline' +
            (p.cursor ? '?before=' + encodeURIComponent(p.cursor) : '')
        ))
        const metadata = await requireCode(runtime, p.threadId)
        return {
          ...history,
          revision: metadataRevision(metadata),
          historyState: metadata.remoteRewind?.phase === 'pending' ? 'reconciliation_required' : 'ready',
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
        const { harnessId, credentialMode, providerId, model, reasoningEffort } =
          await this.route(p)
        const explicit = Boolean(p.harnessId || p.credentialMode || p.providerId)
        const thread = await runtime.threadService.create(
          CreateThreadRequest.parse({
            title: p.title,
            workspace: project.path,
            model,
            ...(explicit ? { harnessId } : {}),
            ...(credentialMode ? { credentialMode } : {}),
            ...(providerId ? { providerId } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            agentSurface: 'code',
            workspaceMode: 'code'
          }),
          { id }
        )
        return { thread }
      }
case 'code.turn.start': {
        const reasoningEffort = storedEffort(await requireCode(runtime, p.threadId))
        return this.call('/v1/threads/' + p.threadId + '/turns', 'POST', {
          prompt: p.text,
          attachmentIds: p.attachmentIds,
          clientRequestId: receiptKey(envelope, requestId),
          clientSurface: 'api',
          ...(reasoningEffort ? { reasoningEffort } : {})
        })
      }
    }
  }
  async recover(scope: RemoteScope, receipt: Receipt) {
    const key = receiptKey(scope, receipt.requestId), p = receipt.params
    if (receipt.method === 'code.create') {
      const thread = await this.runtime.threadService.get('thr_mobile_' + createHash('sha256').update(key).digest('hex').slice(0, 32))
      if (thread) return { thread }
    } else if (receipt.method === 'code.turn.start' && typeof p?.threadId === 'string') {
      const thread = await this.runtime.threadService.get(p.threadId), turn = thread?.turns.find((t) => t.clientRequestId === key)
      if (turn) return { threadId: thread!.id, turnId: turn.id, status: turn.status }
    }
    return undefined
  }
}
