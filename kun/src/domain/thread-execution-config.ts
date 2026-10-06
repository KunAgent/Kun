import { createHash } from 'node:crypto'
import {
  ThreadExecutionConfigSchema,
  type ThreadExecutionConfig,
  type ThreadExecutionRoute
} from '../contracts/thread-execution-config.js'
import type { CreateThreadRequest } from '../contracts/threads.js'

export class ProjectDefaultsStaleError extends Error {
  constructor(message: string) { super(message) }
}

export class ThreadExecutionConfigConflictError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

export type ProjectExecutionDefaults = {
  route?: ThreadExecutionRoute & { harnessId: string }
  collaborationEnabled?: boolean
  managerModel?: ThreadExecutionConfig['managerModel']
  limits?: ThreadExecutionConfig['limits']
  budget?: ThreadExecutionConfig['budget']
  isolation?: ThreadExecutionConfig['isolation']
}

export type GlobalExecutionDefaults = {
  defaultRoute?: ThreadExecutionRoute
  managerModel?: ThreadExecutionConfig['managerModel']
  limits?: ThreadExecutionConfig['limits']
  budget?: ThreadExecutionConfig['budget']
}

export function stampThreadExecutionConfig(
  value: Omit<ThreadExecutionConfig, 'revision' | 'resolvedAt'>,
  resolvedAt: string
): ThreadExecutionConfig {
  const revision = createHash('sha256').update(JSON.stringify(value)).digest('hex')
  return ThreadExecutionConfigSchema.parse({ ...value, revision, resolvedAt })
}

/** Resolve once at create; later global/project saves cannot mutate this task. */
export function resolveThreadExecutionConfig(input: {
  request: CreateThreadRequest
  projectKey?: string
  project?: ProjectExecutionDefaults
  global?: GlobalExecutionDefaults
  nowIso: string
}): { snapshot: ThreadExecutionConfig; route: ThreadExecutionRoute } {
  const { request, project, global } = input
  const inheritRoute = request.routeIntent === 'inherit' && project?.route
  const route: ThreadExecutionRoute = inheritRoute
    ? { ...project.route! }
    : {
        model: request.model,
        ...(request.providerId ? { providerId: request.providerId } : {}),
        ...(request.harnessId ? { harnessId: request.harnessId } : {}),
        ...(request.credentialMode ? { credentialMode: request.credentialMode } : {}),
        ...(request.gatewayBinding ? { gatewayBinding: structuredClone(request.gatewayBinding) } : {})
      }
  const collaborationEnabled = request.collaboration?.enabled ??
    project?.collaborationEnabled ?? request.workspaceMode === 'ade'
  if (collaborationEnabled && request.workspaceMode !== 'ade' && route.harnessId !== 'kun') {
    throw new ThreadExecutionConfigConflictError(
      'collaboration_requires_kun', 'Kun coordination requires the Kun main Agent route'
    )
  }
  const managerModel = project?.managerModel ?? global?.managerModel
  const limits = project?.limits ?? global?.limits ?? { softWorkers: 4, hardWorkers: 8 }
  const budget = project?.budget ?? global?.budget
  const isolation = request.workspaceIsolation ?? project?.isolation ?? 'local'
  const data = {
    version: 1 as const,
    ...(input.projectKey ? { projectKey: input.projectKey } : {}),
    route,
    collaborationEnabled,
    ...(managerModel ? { managerModel } : {}),
    limits,
    ...(budget ? { budget } : {}),
    isolation,
    origins: {
      route: inheritRoute ? 'project' as const : request.routeIntent === 'inherit' ? 'global' as const : 'task' as const,
      collaborationEnabled: request.collaboration ? 'task' as const
        : project?.collaborationEnabled !== undefined ? 'project' as const : 'global' as const,
      managerModel: project?.managerModel ? 'project' as const : 'global' as const,
      limits: project?.limits ? 'project' as const : 'global' as const,
      budget: project?.budget ? 'project' as const : 'global' as const,
      isolation: request.workspaceIsolation ? 'task' as const
        : project?.isolation ? 'project' as const : 'global' as const
    }
  }
  return {
    route,
    snapshot: stampThreadExecutionConfig(data, input.nowIso)
  }
}
