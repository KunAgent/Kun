import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { TurnReasoningEffort } from '../../contracts/turn-reasoning.js'
import { ThreadRevisionConflict } from '../../domain/thread-revision-conflict.js'
import { TaskExecutionConfigConflict } from '../../services/thread-service-execution-config.js'
import { encodeThreadCursor } from '../../domain/thread-list-query.js'
import { codeAgents, gatewayRouteKey, resolveCodeRoute, type CodeRouteChoice, type CodeRoutePick } from './model-catalog.js'
import { isRemoteCodeAllowed, requireCode } from './access.js'
import { projects } from '../files/project-directory.js'
import { cursorScope, readCursor, writeCursor } from '../cursor-codec.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { RemoteMessages } from '../messages/service.js'
import { matchesUpdatedRange, type UpdatedRange } from './search-filters.js'
export const metadataRevision = (thread: Pick<ThreadRecord, 'revision'>) => `thread-v1:${thread.revision ?? 0}`
export class RemoteCodeManagement {
  constructor(private runtime: ServerRuntime, private legacyModels: () => Promise<string[]>) {}
  async summary(thread: ThreadRecord) {
    let projectId: string | undefined
    try { projectId = createHash('sha256').update(await realpath(thread.workspace)).digest('hex') } catch {}
    return { id: thread.id, title: thread.title, status: thread.status,
      pinned: thread.pinned === true, archived: thread.status === 'archived', revision: metadataRevision(thread),
      model: thread.model, harnessId: thread.harnessId, providerId: thread.providerId,
      createdAt: thread.createdAt, updatedAt: thread.updatedAt, ...(projectId ? { projectId } : {}) }
  }
  async search(p: { query?: string; status?: string; harnessId?: string; projectId?: string; cursor?: string; limit?: number } & UpdatedRange) {
    const { cursor, ...filter } = p, scope = cursorScope(['code.search', filter])
    type Coverage = { metadataMatched: number; nativeMatched: number; sourceMatched: number; searchedWithoutMatch: number; sourceUnavailable: number }
    type Position = { after?: string; pending?: { id: string; after: string; cursor: string }; coverage?: Coverage }
    const position = readCursor<Position>(cursor, scope, {})
    if (position.after !== undefined && typeof position.after !== 'string') throw new Error('INVALID_CURSOR')
    if (position.pending && (typeof position.pending.id !== 'string' || typeof position.pending.after !== 'string' ||
      typeof position.pending.cursor !== 'string')) throw new Error('INVALID_CURSOR')
    const coverage: Coverage = position.coverage ?? { metadataMatched: 0, nativeMatched: 0, sourceMatched: 0, searchedWithoutMatch: 0, sourceUnavailable: 0 }
    if (Object.keys(coverage).sort().join(',') !== 'metadataMatched,nativeMatched,searchedWithoutMatch,sourceMatched,sourceUnavailable' ||
      Object.values(coverage).some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('INVALID_CURSOR')
    const project = p.projectId ? (await projects(this.runtime)).find((v) => v.id === p.projectId) : undefined
    if (p.projectId && !project) throw new Error('PROJECT_NOT_ALLOWED')
    const threads: Awaited<ReturnType<RemoteCodeManagement['summary']>>[] = [], limit = p.limit ?? 20,
      deadline = Date.now() + 1500, messages = new RemoteMessages(this.runtime)
    let after = position.after, hasMore = false, scanned = 0, pending = position.pending
    const projectRoots = new Map<string, Promise<boolean>>()
    const projectMatch = (workspace: string) => {
      if (!project) return true
      let match = projectRoots.get(workspace)
      if (!match) { match = realpath(workspace).then((root) => root === project.path, () => false); projectRoots.set(workspace, match) }
      return match
    }
    const eligible = async (thread: ThreadRecord) => await isRemoteCodeAllowed(this.runtime, thread) && thread.status !== 'deleted' &&
      (p.status === 'archived' ? thread.status === 'archived' : thread.status !== 'archived') &&
      (!p.status || p.status === 'all' || p.status === 'archived' || thread.status === p.status) &&
      (!p.harnessId || (thread.harnessId ?? 'kun') === p.harnessId) && matchesUpdatedRange(thread, p) && await projectMatch(thread.workspace)
    const inspect = async (thread: ThreadRecord, next: string, contentCursor?: string) => {
      if (!await eligible(thread)) return true
      const text = [thread.title, thread.summary ?? ''].join('\n').toLowerCase()
      if (p.query && !text.includes(p.query.toLowerCase())) {
        const result = await messages.search({ resource: { kind: 'code', id: thread.id }, query: p.query, cursor: contentCursor, limit: 1 })
        if (!result.messages.length && result.hasMore) {
          pending = { id: thread.id, after: next, cursor: result.nextCursor! }
          return false
        }
        if (!result.messages.length) { if (result.complete) coverage.searchedWithoutMatch++; else coverage.sourceUnavailable++; return true }
        if (result.messages[0].sourceHistoryOrder) coverage.sourceMatched++; else coverage.nativeMatched++
      } else coverage.metadataMatched++
      threads.push(await this.summary(thread))
      return true
    }
    if (pending) {
      const current = pending, thread = await this.runtime.threadService.getMetadata(current.id)
      pending = undefined
      if (thread && !await inspect(thread, current.after, current.cursor)) hasMore = true
      else { after = current.after; scanned++ }
    }
    const finish = () => ({ threads, hasMore, searchScope: p.query ? 'title_and_content' as const : 'metadata' as const,
      scanned, coverage, complete: !hasMore && coverage.sourceUnavailable === 0,
      ...(hasMore ? { nextCursor: writeCursor(scope, { after, coverage, ...(pending ? { pending } : {}) }) } : {}) })
    if (pending) return finish()
    if (threads.length >= limit) { hasMore = true; return finish() }
    do {
      const page = await this.runtime.threadService.listPage({ workbenchScope: 'code', lean: true,
        archivedOnly: p.status === 'archived',
        cursor: after, limit: Math.min(100, Math.max(limit, 20)) })
      hasMore = page.hasMore
      for (const row of page.threads) {
        const next = encodeThreadCursor(row.updatedAt, row.id)
        if (next === after) throw new Error('INVALID_CURSOR')
        const thread = await this.runtime.threadService.getMetadata(row.id)
        if (thread && !await inspect(thread, next)) { hasMore = true; return finish() }
        scanned++
        after = next
        if (threads.length >= limit || scanned >= 100 || Date.now() >= deadline) {
          hasMore = row !== page.threads.at(-1) || page.hasMore
          return finish()
        }
      }
      if (!hasMore) break
      if (!page.nextCursor || page.nextCursor === position.after) throw new Error('INVALID_CURSOR')
      after = page.nextCursor
    } while (true)
    return finish()
  }
  async preflight(method: string, p: any) {
    if (['code.rename', 'code.pin', 'code.archive', 'code.restore', 'code.delete'].includes(method)) {
      const thread = await this.mutable(p.threadId)
      const expected = Number(p.expectedRevision.slice('thread-v1:'.length))
      if (!Number.isSafeInteger(expected)) throw new RemoteNoEffect('INVALID_REQUEST')
      if (metadataRevision(thread) !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
      this.assertState(method, thread)
    } else if (method === 'code.settings.update') {
      await this.mutable(p.threadId)
      const settings = await this.runtime.threadService.getExecutionConfig(p.threadId)
      if (!settings) throw new RemoteNoEffect('NOT_FOUND')
      if (settings.revision !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
      await this.offeredRoute(p.next)
    }
  }
  private async mutable(id: string) {
    const thread = await this.runtime.threadService.getMetadata(id)
    if (!thread) throw new RemoteNoEffect('NOT_FOUND')
    if (!await isRemoteCodeAllowed(this.runtime, thread)) throw new RemoteNoEffect('NOT_A_CODE_TASK')
    return thread
  }
  private assertState(method: string, thread: ThreadRecord) {
    if (['code.archive', 'code.restore', 'code.delete'].includes(method) &&
      (thread.status === 'running' || thread.turns.some((turn) => turn.status === 'running' || turn.status === 'queued')))
      throw new RemoteNoEffect('TASK_BUSY')
  }
  async mutate(method: string, p: any) {
    const thread = await this.mutable(p.threadId)
    if (metadataRevision(thread) !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
    this.assertState(method, thread)
    if ((method === 'code.restore' && thread.status === 'idle') ||
      (method === 'code.archive' && thread.status === 'archived')) return { thread: await this.summary(thread) }
    const options = { expectedRevision: Number(p.expectedRevision.slice('thread-v1:'.length)) }
    try {
      if (method === 'code.delete') {
        if (!await this.runtime.threadService.delete(p.threadId, options)) throw new Error('DELETE_NOT_CONFIRMED')
        return { threadId: p.threadId, deleted: true }
      }
      const patch = method === 'code.rename' ? { title: p.title, titleAuto: false }
        : method === 'code.pin' ? { pinned: p.pinned }
          : { status: method === 'code.archive' ? 'archived' as const : 'idle' as const }
      return { thread: await this.summary(await this.runtime.threadService.update(p.threadId, patch, options)) }
    } catch (error) {
      if (error instanceof ThreadRevisionConflict) throw new RemoteNoEffect('REVISION_CONFLICT')
      throw error
    }
  }
  async settings(id: string) {
    await requireCode(this.runtime, id)
    const value = await this.runtime.threadService.getExecutionConfig(id)
    if (!value) throw new Error('NOT_FOUND')
    const agents = await codeAgents(this.runtime, await this.legacyModels())
    // The phone sees a gateway route only by the key its catalog lists, never the binding itself.
    const route = (r: typeof value.current.route): Omit<CodeRouteChoice, 'gatewayBinding'> & { routeKey?: string } => ({ model: r.model, harnessId: r.harnessId ?? 'kun',
      ...(r.providerId ? { providerId: r.providerId } : {}), ...(r.credentialMode ? { credentialMode: r.credentialMode } : {}),
      ...(r.gatewayBinding && r.credentialMode === 'kun-gateway' ? { routeKey: gatewayRouteKey({ harnessId: r.harnessId ?? 'kun', credentialMode: r.credentialMode, gatewayBinding: r.gatewayBinding }) } : {}),
      ...(r.reasoningEffort ? { reasoningEffort: r.reasoningEffort } : {}) })
    return { threadId: id, revision: value.revision, effective: route(value.current.route),
      next: route((value.pending ?? value.current).route), agents,
      models: [...new Set(agents.flatMap((a) => a.routes.flatMap((r) => r.models)))],
      editable: value.editable.route.allowed, reason: value.editable.route.reason }
  }
  async updateSettings(p: any) {
    await this.mutable(p.threadId)
    const route = await this.offeredRoute(p.next)
    try {
      await this.runtime.threadService.mutateExecutionConfig(p.threadId, { expectedRevision: p.expectedRevision, set: { route } })
    } catch (error) {
      if (error instanceof TaskExecutionConfigConflict) {
        if (error.code === 'revision_conflict') throw new RemoteNoEffect('REVISION_CONFLICT')
        if (['active_team_route_locked', 'route_change_requires_idle'].includes(error.code)) throw new RemoteNoEffect('TASK_BUSY')
      }
      throw error
    }
    return this.settings(p.threadId)
  }
  private async offeredRoute(pick: CodeRoutePick & { model: string; reasoningEffort?: TurnReasoningEffort }) {
    const models = await this.legacyModels(), agents = await codeAgents(this.runtime, models)
    const agent = agents.find((entry) => entry.id === (pick.harnessId ?? 'kun'))
    if (!agent) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    // A keyed (gateway) route is chosen only by its key; an unkeyed pick never lands on one.
    const route = agent.routes.find((entry) => entry.models.includes(pick.model) && entry.routeKey === pick.routeKey &&
      (pick.providerId === undefined || entry.providerId === pick.providerId) &&
      (pick.credentialMode === undefined || entry.credentialMode === pick.credentialMode))
    if (!route) throw new RemoteNoEffect('MODEL_NOT_AVAILABLE')
    return resolveCodeRoute(this.runtime, { model: pick.model, harnessId: agent.id, credentialMode: route.credentialMode,
      providerId: route.providerId, routeKey: route.routeKey, reasoningEffort: pick.reasoningEffort }, models)
  }
}
