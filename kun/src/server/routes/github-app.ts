import { z } from 'zod'
import { GitHubBindingSchema, GITHUB_SHARING_POLICY, type GitHubBinding } from '../../contracts/github-app.js'
import { GitHubAppError } from '../../github-app/client.js'
import { GITHUB_BLOCKED_IDS } from '../../adapters/tool/github-app-scope.js'
import { roomAppConnectionMessage } from '../../rooms/room-app-connections.js'
import type { Router, RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import { strictRuntimeTokenAuthorized } from './gateway-request-guard.js'
import type { ServerRuntime } from './server-runtime.js'
import { ERRORS } from './runtime-error.js'
import { continueGitHubTask, GitHubContinueSchema } from './github-app-continuation.js'
import { TurnConflictError, TurnInProgressError, TurnCapacityError } from '../../services/turn-service.js'

const Mutation = z.object({ binding: GitHubBindingSchema, allowModelSharing: z.boolean().optional(),
  sharingPolicy: z.literal(GITHUB_SHARING_POLICY).optional() }).strict()

export async function githubRequestScope(runtime: ServerRuntime, binding: GitHubBinding): Promise<string> {
  if ('threadId' in binding) {
    const thread = await runtime.threadService.get(binding.threadId)
    const last = thread?.turns.at(-1)
    if (!thread || thread.roomContext || thread.status === 'archived' || thread.status === 'deleted' ||
        (last?.harnessId ?? thread.harnessId ?? 'kun') !== 'kun' || last?.clientSurface !== 'gui' || last.imContext) {
      throw new GitHubAppError('invalid_context', 'The native Kun desktop conversation is unavailable')
    }
    return `thread:${thread.id}`
  }
  const rooms = runtime.rooms
  if (!rooms) throw new GitHubAppError('invalid_context', 'The private Agent conversation is unavailable')
  const room = await rooms.service.get(binding.roomId)
  const { row, run } = await roomAppConnectionMessage(rooms.deps.store, room.id, binding.messageId)
  const member = room.members.find((entry) => entry.id === run.value.memberId)
  const thread = await runtime.threadService.get(run.value.threadId!)
  const scope = thread?.roomContext
  const source = thread?.turns.find((turn) => turn.id === run.value.turnId)
  if (room.archivedAt || room.conversationKind !== 'user_agent' || row.value.appConnection?.serverId !== 'github' ||
      row.value.appConnection.status === 'skipped' || !member?.enabled || member.removedAt ||
      !member.participantAgentId || member.participantAgentId !== run.value.participantAgentId ||
      !thread || thread.status === 'archived' || thread.status === 'deleted' || !scope || scope.kind !== 'conversation' ||
      scope.roomId !== room.id || scope.memberId !== member.id || scope.participantAgentId !== member.participantAgentId ||
      scope.blockedProviderIds.some((id) => GITHUB_BLOCKED_IDS.includes(id)) || !source ||
      source.clientSurface !== 'gui' || source.imContext || (source.harnessId ?? thread.harnessId ?? 'kun') !== 'kun') {
    throw new GitHubAppError('invalid_context', 'The GitHub card no longer belongs to an active private Agent')
  }
  await rooms.deps.agentDirectory?.active(member.participantAgentId)
  return `room:${room.id}`
}

export function registerGitHubAppRoutes(router: Router, runtime: ServerRuntime): void {
  const add = (method: string, path: string, handler: (request: Request, context: RouteContext) => Promise<unknown>) =>
    router.add(method, `/v1/github${path}`, async (request, context) => {
      if (!strictRuntimeTokenAuthorized(request, runtime.runtimeToken)) return ERRORS.unauthorized()
      if (!runtime.githubApp) return ERRORS.unavailable('GitHub connection is unavailable')
      try {
        if (method !== 'GET') await runtime.rooms?.deps.waitForOwnership?.(request.signal)
        const result = jsonResponse(await handler(request, context))
        result.headers['cache-control'] = 'no-store'
        return result
      } catch (error) {
        if (error instanceof z.ZodError) return ERRORS.validation('Invalid GitHub request', error.issues)
        if (error instanceof GitHubAppError) return jsonResponse({ code: error.code, message: error.message }, 409)
        if (error instanceof TurnConflictError || error instanceof TurnInProgressError || error instanceof TurnCapacityError) {
          return ERRORS.conflict('The original task is still running; retry continuation when it finishes')
        }
        return ERRORS.internal('GitHub connection could not be updated')
      }
    })
  const body = async (request: Request) => {
    const result = await readJsonBody(request)
    if (!result.ok) throw new GitHubAppError('invalid_request', 'Invalid GitHub request body')
    return result.value
  }
  const query = (request: Request) => GitHubBindingSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
  const acknowledged = (value: z.infer<typeof Mutation>) => {
    if (value.allowModelSharing !== true || value.sharingPolicy !== GITHUB_SHARING_POLICY) {
      throw new GitHubAppError('sharing_required', 'Review GitHub data use in this conversation before connecting')
    }
  }
  add('GET', '/status', async (request) => runtime.githubApp!.status(await githubRequestScope(runtime, query(request)), true))
  add('POST', '/authorize', async (request) => {
    const input = Mutation.parse(await body(request)); acknowledged(input)
    return runtime.githubApp!.authorize(await githubRequestScope(runtime, input.binding))
  })
  for (const method of ['GET', 'DELETE']) add(method, '/authorization/:id', async (request, context) => {
    const scope = await githubRequestScope(runtime, query(request)), id = z.string().uuid().parse(context.params.id)
    if (method === 'DELETE') await runtime.githubApp!.cancel(id, scope)
    return runtime.githubApp!.poll(id, scope)
  })
  add('PATCH', '/sharing', async (request) => {
    const input = Mutation.parse(await body(request))
    if (input.allowModelSharing !== false) acknowledged(input)
    return runtime.githubApp!.sharing(await githubRequestScope(runtime, input.binding), input.allowModelSharing === true)
  })
  add('DELETE', '/connection', async (request) => {
    const input = Mutation.parse(await body(request)), scope = await githubRequestScope(runtime, input.binding)
    await runtime.githubApp!.disconnect()
    return runtime.githubApp!.status(scope)
  })
  add('POST', '/repositories', async (request) => {
    const input = Mutation.parse(await body(request)); await githubRequestScope(runtime, input.binding)
    await runtime.githubApp!.manageRepositories()
    return { opened: true }
  })
  add('POST', '/continue', async (request) => continueGitHubTask(runtime, GitHubContinueSchema.parse(await body(request))))
}
