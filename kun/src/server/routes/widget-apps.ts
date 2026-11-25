import { z } from 'zod'
import { GEN_UI_STATE_MAX_BYTES, GenUiWidgetIdSchema } from '../../contracts/gen-ui.js'
import { WidgetAppId, WidgetAppSource } from '../../contracts/widget-app.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

export function registerWidgetAppRoutes(router: Router, runtime: ServerRuntime): void {
  const apps = () => runtime.genUi?.store.apps
  const root = '/v1/gen-ui/apps'
  router.add('GET', root, async request => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return jsonResponse({ apps: await apps()?.list() ?? [] })
  })
  router.add('POST', root, async request => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const service = apps()
    if (!service) return ERRORS.unavailable('Widget apps unavailable')
    const body = await readJsonBody(request, 4096)
    if (!body.ok) return body.response
    const source = WidgetAppSource.safeParse(body.value)
    if (!source.success) return ERRORS.validation('Invalid widget source')
    if (!await runtime.threadStore?.get(source.data.threadId)) return ERRORS.notFound('Conversation unavailable')
    return jsonResponse(await service.install(source.data))
  })
  for (const operation of ['info', 'page'] as const) {
    router.add('GET', root + '/:id/' + operation, async (request, ctx) => {
      if (!authorize(request, runtime)) return ERRORS.unauthorized()
      const id = WidgetAppId.safeParse(ctx.params.id)
      if (!id.success) return ERRORS.validation('Invalid app ID')
      const result = operation === 'page' ? await apps()?.page(id.data) : await apps()?.get(id.data)
      return result ? jsonResponse(result) : ERRORS.notFound('Installed app unavailable')
    })
  }
  router.add('PUT', root + '/:id/state', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const id = WidgetAppId.safeParse(ctx.params.id)
    if (!id.success) return ERRORS.validation('Invalid app ID')
    const body = await readJsonBody(request, GEN_UI_STATE_MAX_BYTES * 2 + 1024)
    if (!body.ok) return body.response
    const input = z.object({ widgetId: GenUiWidgetIdSchema, state: z.record(z.string(), z.unknown()) }).strict().safeParse(body.value)
    if (!input.success) return ERRORS.validation('Invalid app state')
    try {
      return await apps()?.save(id.data, input.data.widgetId, input.data.state)
        ? jsonResponse({ ok: true }) : ERRORS.conflict('The app was removed or updated. Reopen it to continue.')
    } catch (error) {
      return ERRORS.validation(error instanceof Error ? error.message : 'Invalid state')
    }
  })
  router.add('DELETE', root + '/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const id = WidgetAppId.safeParse(ctx.params.id)
    if (!id.success) return ERRORS.validation('Invalid app ID')
    const service = apps()
    if (!service) return ERRORS.unavailable('Widget apps unavailable')
    await service.uninstall(id.data)
    return jsonResponse({ ok: true })
  })
}
