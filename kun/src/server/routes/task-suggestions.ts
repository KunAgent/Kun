import { TaskSuggestionActionSchema, publicTaskSuggestion } from '../../contracts/task-suggestions.js'
import { isRuntimeTokenAuthorized } from '../auth.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'

/** Suggestion cards: reads for any authorized client, actions only with the runtime token. */
export function registerTaskSuggestionRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/task-suggestions', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const service = runtime.taskSuggestionService
    if (!service) return ERRORS.unavailable('Task suggestions are unavailable')
    const threadId = new URL(request.url).searchParams.get('threadId') ?? undefined
    return jsonResponse({ taskSuggestions: (await service.list(threadId)).map(publicTaskSuggestion) })
  })
  router.add('GET', '/v1/task-suggestions/:id', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const service = runtime.taskSuggestionService
    if (!service) return ERRORS.unavailable('Task suggestions are unavailable')
    const intent = await service.get(context.params.id)
    return intent ? jsonResponse({ taskSuggestion: publicTaskSuggestion(intent) }) : ERRORS.notFound('Suggestion card not found')
  })
  router.add('POST', '/v1/task-suggestions/:id/actions', async (request, context) => {
    if (!isRuntimeTokenAuthorized(request.headers, runtime.runtimeToken)) return ERRORS.unauthorized()
    const service = runtime.taskSuggestionService
    if (!service) return ERRORS.unavailable('Task suggestions are unavailable')
    const body = await readJsonBody(request, 64 * 1024)
    if (!body.ok) return body.response
    const parsed = TaskSuggestionActionSchema.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('Invalid suggestion card action', parsed.error.issues)
    try {
      const intent = await service.act(context.params.id, parsed.data)
      return jsonResponse({ taskSuggestion: publicTaskSuggestion(intent) })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (/not found/i.test(message)) return ERRORS.notFound(message)
      if (/revision|changed|cannot|no task/i.test(message)) return ERRORS.conflict(message)
      return ERRORS.validation(message)
    }
  })
}
