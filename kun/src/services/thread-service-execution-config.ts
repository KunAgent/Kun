import { createHash } from 'node:crypto'
import type { ThreadRecord } from '../contracts/threads.js'
import {
  TaskExecutionConfigMutationSchema,
  TaskExecutionConfigResponseSchema,
  type TaskExecutionConfigMutation,
  type TaskExecutionConfigResponse,
  type ThreadExecutionConfig
} from '../contracts/thread-execution-config.js'
import { canonicalProjectIdentity } from '../shared/project-identity.js'
import { resolveThreadExecutionConfig, stampThreadExecutionConfig } from '../domain/thread-execution-config.js'
import type { ThreadService } from './thread-service-core.js'

function revisionOf(current: ThreadExecutionConfig, pending?: ThreadExecutionConfig): string {
  return `task-config-v1:${createHash('sha256')
    .update(JSON.stringify([current.revision, pending?.revision ?? null])).digest('hex')}`
}

function routeFromThread(thread: ThreadRecord): ThreadExecutionConfig['route'] {
  return {
    model: thread.model,
    ...(thread.providerId ? { providerId: thread.providerId } : {}),
    ...(thread.harnessId ? { harnessId: thread.harnessId } : {})
  }
}

async function projectKeyFor(service: ThreadService, thread: ThreadRecord): Promise<string | undefined> {
  if (thread.executionConfig?.projectKey) return thread.executionConfig.projectKey
  const sourceRoot = thread.taskWorkspaceId
    ? service['projectSourceRoot']?.(thread.taskWorkspaceId) ?? thread.workspace
    : thread.workspace
  return canonicalProjectIdentity(sourceRoot).then((identity) => identity.key).catch(() => undefined)
}

async function snapshots(service: ThreadService, thread: ThreadRecord): Promise<{
  current: ThreadExecutionConfig
  inherited: ThreadExecutionConfig
}> {
  const global = service['projectSettings']?.()
  const managed = thread.executionUnit?.kind === 'worker' || Boolean(thread.roomContext)
  const projectKey = await projectKeyFor(service, thread)
  const project = projectKey ? global?.projectDefaults?.[projectKey] : undefined
  const current = thread.executionConfig ?? resolveThreadExecutionConfig({
    request: {
      workspace: thread.workspace, model: thread.model, mode: thread.mode,
      ...(thread.providerId ? { providerId: thread.providerId } : {}),
      ...(thread.harnessId ? { harnessId: thread.harnessId } : {}),
      ...(managed ? { collaboration: { enabled: false } }
        : thread.collaboration ? { collaboration: { enabled: thread.collaboration.enabled } } : {}),
      ...(thread.workspaceMode ? { workspaceMode: thread.workspaceMode } : {})
    },
    ...(projectKey ? { projectKey } : {}),
    ...(global ? { global } : {}),
    nowIso: thread.createdAt
  }).snapshot
  const fallbackRoute = global?.defaultRoute ?? routeFromThread(thread)
  const inherited = resolveThreadExecutionConfig({
    request: {
      workspace: thread.workspace, model: fallbackRoute.model, mode: thread.mode,
      ...(fallbackRoute.providerId ? { providerId: fallbackRoute.providerId } : {}),
      ...(fallbackRoute.harnessId ? { harnessId: fallbackRoute.harnessId } : {}),
      ...(thread.workspaceMode ? { workspaceMode: thread.workspaceMode } : {}),
      ...(managed ? { collaboration: { enabled: false } } : {}),
      routeIntent: 'inherit'
    },
    ...(projectKey ? { projectKey } : {}),
    ...(project ? { project } : {}),
    ...(global ? { global } : {}),
    nowIso: thread.createdAt
  }).snapshot
  return { current, inherited }
}

function editable(thread: ThreadRecord, activeTeam: boolean): TaskExecutionConfigResponse['editable'] {
  const blocked = thread.executionUnit?.kind === 'worker' || Boolean(thread.roomContext)
  const item = blocked ? { allowed: false, reason: 'managed_execution_unit' } : { allowed: true }
  return {
    route: blocked ? item : activeTeam
      ? { allowed: false, reason: 'active_team_route_locked' } : { allowed: true },
    collaborationEnabled: item,
    managerModel: item,
    limits: item,
    budget: item,
    isolation: { allowed: false, reason: 'workspace_bound' }
  }
}

function response(
  thread: ThreadRecord, current: ThreadExecutionConfig,
  inherited: ThreadExecutionConfig, activeTeam: boolean
): TaskExecutionConfigResponse {
  return TaskExecutionConfigResponseSchema.parse({
    current,
    ...(thread.pendingExecutionConfig ? { pending: thread.pendingExecutionConfig } : {}),
    inherited,
    revision: revisionOf(current, thread.pendingExecutionConfig),
    editable: editable(thread, activeTeam)
  })
}

function applyTaskMutation(
  base: ThreadExecutionConfig,
  inherited: ThreadExecutionConfig,
  mutation: TaskExecutionConfigMutation,
  nowIso: string
): ThreadExecutionConfig {
  const { revision: _revision, resolvedAt: _resolvedAt, ...values } = base
  const next = { ...values, origins: { ...base.origins } }
  for (const field of mutation.unset ?? []) {
    if (field === 'route') next.route = inherited.route
    else if (field === 'collaborationEnabled') next.collaborationEnabled = inherited.collaborationEnabled
    else if (field === 'limits') next.limits = inherited.limits
    else if (field === 'managerModel') {
      if (inherited.managerModel) next.managerModel = inherited.managerModel
      else delete next.managerModel
    } else if (field === 'budget') {
      if (inherited.budget) next.budget = inherited.budget
      else delete next.budget
    }
    next.origins[field] = inherited.origins[field]
  }
  for (const [field, value] of Object.entries(mutation.set ?? {})) {
    if (value === undefined) continue
    if (field === 'route') next.route = value as ThreadExecutionConfig['route']
    else if (field === 'collaborationEnabled') next.collaborationEnabled = value as boolean
    else if (field === 'limits') next.limits = value as ThreadExecutionConfig['limits']
    else if (field === 'managerModel') next.managerModel = value as ThreadExecutionConfig['managerModel']
    else if (field === 'budget') next.budget = value as ThreadExecutionConfig['budget']
    next.origins[field as keyof typeof next.origins] = 'task'
  }
  return stampThreadExecutionConfig(next, nowIso)
}

export class TaskExecutionConfigConflict extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

/** Called only by a fresh turn admission after all busy/replay checks pass. */
export function promotePendingExecutionConfig(thread: ThreadRecord): ThreadRecord {
  const pending = thread.pendingExecutionConfig
  if (!pending) return thread
  return {
    ...thread,
    executionConfig: pending,
    pendingExecutionConfig: undefined,
    model: pending.route.model,
    providerId: pending.route.providerId,
    harnessId: pending.route.harnessId,
    collaboration: {
      enabled: pending.collaborationEnabled,
      everEnabled: thread.collaboration?.everEnabled === true || pending.collaborationEnabled
    }
  }
}

export const threadServiceExecutionConfigOperations = {
  async getExecutionConfig(this: ThreadService, threadId: string): Promise<TaskExecutionConfigResponse | null> {
    const thread = await this['threadStore'].get(threadId)
    if (!thread) return null
    const { current, inherited } = await snapshots(this, thread)
    return response(thread, current, inherited, await this['hasActiveTeam']?.(threadId) ?? false)
  },

  async mutateExecutionConfig(
    this: ThreadService,
    threadId: string,
    raw: TaskExecutionConfigMutation
  ): Promise<TaskExecutionConfigResponse> {
    const mutation = TaskExecutionConfigMutationSchema.parse(raw)
    const updated = await this['withThreadMutation'](threadId, async () => {
      const thread = await this['threadStore'].get(threadId)
      if (!thread) throw new TaskExecutionConfigConflict('not_found', 'thread not found')
      if (thread.executionUnit?.kind === 'worker' || thread.roomContext) {
        throw new TaskExecutionConfigConflict('managed_execution_unit', 'worker and Rooms task settings are host-managed')
      }
      const { current, inherited } = await snapshots(this, thread)
      if (mutation.expectedRevision !== revisionOf(current, thread.pendingExecutionConfig)) {
        throw new TaskExecutionConfigConflict('revision_conflict', 'task settings changed; reload before saving')
      }
      const next = applyTaskMutation(
        thread.pendingExecutionConfig ?? current, inherited, mutation, this['nowIso']()
      )
      if (next.limits.softWorkers > next.limits.hardWorkers ||
          (next.budget?.softTokens !== undefined && next.budget.hardTokens !== undefined &&
            next.budget.softTokens > next.budget.hardTokens)) {
        throw new TaskExecutionConfigConflict('invalid_limits',
          'soft worker and token limits must not exceed their hard limits')
      }
      const activeTeam = await this['hasActiveTeam']?.(threadId) ?? false
      const routeChanged = JSON.stringify(next.route) !== JSON.stringify(
        (thread.pendingExecutionConfig ?? current).route
      )
      if (routeChanged && activeTeam) {
        throw new TaskExecutionConfigConflict('active_team_route_locked',
          'finish or detach the active team before changing the main Agent')
      }
      if (next.collaborationEnabled && next.route.harnessId !== 'kun') {
        throw new TaskExecutionConfigConflict('collaboration_requires_kun', 'Kun coordination requires the Kun main Agent route')
      }
      const busy = thread.turns.some((turn) => turn.status === 'running' || turn.status === 'queued')
      if (busy && routeChanged && next.route.harnessId !== 'kun') {
        throw new TaskExecutionConfigConflict('route_change_requires_idle',
          'wait for the active turn to finish before handing this task to another Agent')
      }
      const merged: ThreadRecord = {
        ...thread,
        ...(busy ? { pendingExecutionConfig: next } : {
          executionConfig: next,
          pendingExecutionConfig: undefined,
          model: next.route.model,
          providerId: next.route.providerId,
          harnessId: next.route.harnessId,
          collaboration: {
            enabled: next.collaborationEnabled,
            everEnabled: thread.collaboration?.everEnabled === true || next.collaborationEnabled
          }
        }),
        updatedAt: this['nowIso']()
      }
      await this['threadStore'].upsert(merged)
      return merged
    })
    const { current, inherited } = await snapshots(this, updated)
    return response(updated, current, inherited,
      await this['hasActiveTeam']?.(threadId) ?? false)
  }
}
