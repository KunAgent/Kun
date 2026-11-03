import { z } from 'zod'
import { AppConnectionError } from '../../contracts/app-connections.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

const PresetId = z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/u)
const AttemptId = z.string().trim().min(1).max(128)
const CredentialRequest = z.object({
  token: z.string().trim().min(1).max(512),
  expiresAt: z.string().datetime().optional()
}).strict()

/**
 * Settings-facing connection routes. They are account-level only: nothing here
 * creates or widens a conversation grant, and no handler accepts a model-supplied
 * endpoint, header, or secret destination.
 */
export function registerAppConnectionRoutes(router: Router, runtime: ServerRuntime): void {
  const service = () => runtime.appConnections

  router.add('GET', '/v1/apps/connections', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const appConnections = service()
    if (!appConnections) return ERRORS.unavailable('App connections are unavailable')
    return jsonResponse({ connections: await appConnections.list() })
  })

  router.add('GET', '/v1/apps/connections/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const appConnections = service()
    if (!appConnections) return ERRORS.unavailable('App connections are unavailable')
    const id = PresetId.safeParse(ctx.params.id)
    if (!id.success) return ERRORS.validation('invalid app connection id', id.error.issues)
    return handle(async () => jsonResponse({ connection: await appConnections.status(id.data) }))
  })

  router.add('POST', '/v1/apps/connections/:id/connect', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const appConnections = service()
    if (!appConnections) return ERRORS.unavailable('App connections are unavailable')
    const id = PresetId.safeParse(ctx.params.id)
    if (!id.success) return ERRORS.validation('invalid app connection id', id.error.issues)
    return handle(async () => jsonResponse({ attempt: await appConnections.connect(id.data) }, 202))
  })

  router.add('GET', '/v1/apps/connections/:id/attempts/:attemptId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const appConnections = service()
    if (!appConnections) return ERRORS.unavailable('App connections are unavailable')
    const id = PresetId.safeParse(ctx.params.id)
    const attempt = AttemptId.safeParse(ctx.params.attemptId)
    if (!id.success || !attempt.success) return ERRORS.validation('invalid connection attempt')
    return handle(async () =>
      jsonResponse({ attempt: await appConnections.pollAttempt(id.data, attempt.data) }))
  })

  router.add('DELETE', '/v1/apps/connections/:id/attempts/:attemptId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const appConnections = service()
    if (!appConnections) return ERRORS.unavailable('App connections are unavailable')
    const id = PresetId.safeParse(ctx.params.id)
    const attempt = AttemptId.safeParse(ctx.params.attemptId)
    if (!id.success || !attempt.success) return ERRORS.validation('invalid connection attempt')
    return handle(async () => {
      await appConnections.cancelAttempt(id.data, attempt.data)
      return jsonResponse({ cancelled: true })
    })
  })

  router.add('POST', '/v1/apps/connections/:id/check', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const appConnections = service()
    if (!appConnections) return ERRORS.unavailable('App connections are unavailable')
    const id = PresetId.safeParse(ctx.params.id)
    if (!id.success) return ERRORS.validation('invalid app connection id', id.error.issues)
    return handle(async () => jsonResponse({ connection: await appConnections.check(id.data) }))
  })

  router.add('PUT', '/v1/apps/connections/:id/credential', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const appConnections = service()
    if (!appConnections) return ERRORS.unavailable('App connections are unavailable')
    const id = PresetId.safeParse(ctx.params.id)
    if (!id.success) return ERRORS.validation('invalid app connection id', id.error.issues)
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = CredentialRequest.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('invalid credential payload', parsed.error.issues)
    return handle(async () => jsonResponse({
      connection: await appConnections.setCredential(id.data, parsed.data.token, parsed.data.expiresAt)
    }))
  })

  router.add('DELETE', '/v1/apps/connections/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const appConnections = service()
    if (!appConnections) return ERRORS.unavailable('App connections are unavailable')
    const id = PresetId.safeParse(ctx.params.id)
    if (!id.success) return ERRORS.validation('invalid app connection id', id.error.issues)
    return handle(async () => jsonResponse({ connection: await appConnections.disconnect(id.data) }))
  })
}

/** Maps service failures onto the existing HTTP error vocabulary. */
async function handle(run: () => Promise<ReturnType<typeof jsonResponse>>) {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof AppConnectionError)) throw error
    const message = error.message.slice(0, 512)
    if (error.code === 'not_found') return ERRORS.notFound(message)
    if (error.code === 'credential_store_unavailable') return ERRORS.unavailable(message)
    if (error.code === 'connect_failed') return ERRORS.conflict(message)
    return ERRORS.validation(message, { code: error.code })
  }
}
