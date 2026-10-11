import { AgentDispatchActionSchema, publicAgentDispatchIntent } from '../../contracts/agent-dispatch-intents.js'
import { isRuntimeTokenAuthorized } from '../auth.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'

/** User-bound controls never accept execution payloads or model gateway tokens. */
export function registerAgentDispatchIntentRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/agent-dispatch-intents', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const service = runtime.agentDispatchService
    if (!service) return ERRORS.unavailable('Agent dispatch is unavailable')
    const threadId = new URL(request.url).searchParams.get('threadId') ?? undefined
    return jsonResponse({ intents: (await service.list(threadId)).map(publicAgentDispatchIntent) })
  })
  router.add('GET', '/v1/agent-dispatch-intents/:id', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const service = runtime.agentDispatchService
    if (!service) return ERRORS.unavailable('Agent dispatch is unavailable')
    const intent = await service.get(context.params.id)
    return intent ? jsonResponse({ intent: publicAgentDispatchIntent(intent) }) : ERRORS.notFound('Agent task not found')
  })
  router.add('POST', '/v1/agent-dispatch-intents/:id/actions', async (request, context) => {
    if (!isRuntimeTokenAuthorized(request.headers, runtime.runtimeToken)) return ERRORS.unauthorized()
    const service = runtime.agentDispatchService
    if (!service) return ERRORS.unavailable('Agent dispatch is unavailable')
    const body = await readJsonBody(request, 256 * 1024)
    if (!body.ok) return body.response
    const parsed = AgentDispatchActionSchema.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('Invalid Agent task action', parsed.error.issues)
    try {
      const intent = await service.act(context.params.id, parsed.data)
      return jsonResponse({ intent: publicAgentDispatchIntent(intent) })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (/not found/i.test(message)) return ERRORS.notFound(message)
      if (/revision|conflict|already|state/i.test(message)) return ERRORS.conflict(message)
      return ERRORS.validation(message)
    }
  })
}
