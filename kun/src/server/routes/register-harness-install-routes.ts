import type { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { jsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { HarnessInstallRequestSchema, HarnessInstallCancelSchema } from '../../contracts/harness-install.js'
import { HarnessInstaller } from '../../harness/harness-installer.js'

export function registerHarnessInstallRoutes(router: Router, runtime: ServerRuntime): void {
  const installer = new HarnessInstaller({
    definition: (id) => runtime.harnesses?.catalog.get(id),
    detect: (id) => {
      if (!runtime.harnesses) throw new Error('Agent catalog is unavailable')
      return runtime.harnesses.detector.status(id, { force: true })
    },
    network: () => runtime.harnesses?.installNetwork?.()
  })
  router.add('GET', '/v1/harnesses/:id/install', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const action = new URL(request.url).searchParams.get('action') ?? 'install'
    const parsed = HarnessInstallRequestSchema.safeParse({ action })
    if (!parsed.success) return ERRORS.validation('Invalid installation action')
    try { return jsonResponse(await installer.state(context.params.id!, parsed.data.action)) }
    catch (error) { return ERRORS.validation(error instanceof Error ? error.message : 'Installation unavailable') }
  })
  router.add('POST', '/v1/harnesses/:id/install', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = HarnessInstallRequestSchema.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('Invalid installation request')
    try { return jsonResponse(await installer.start(context.params.id!, parsed.data.action), 202) }
    catch (error) { return ERRORS.validation(error instanceof Error ? error.message : 'Installation failed') }
  })
  router.add('POST', '/v1/harnesses/:id/install/cancel', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = HarnessInstallCancelSchema.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('Invalid installation job')
    try {
      await installer.cancel(context.params.id!, parsed.data.jobId)
      return jsonResponse({ ok: true })
    } catch (error) { return ERRORS.conflict(error instanceof Error ? error.message : 'Cancellation failed') }
  })
}
