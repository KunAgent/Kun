import { GEN_UI_STATE_MAX_BYTES, isGenUiWidgetId } from '../../contracts/gen-ui.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

const STATE_BODY_LIMIT = GEN_UI_STATE_MAX_BYTES * 2 + 1_024

/**
 * Generated UI routes for the desktop sandbox host: immutable widget snapshots
 * and per-thread widget state written by pages through the workbench.
 */
export function registerGenUiRoutes(router: Router, runtime: ServerRuntime): void {
  const unavailable = () => ERRORS.unavailable('generated UI is not available')

  router.add('GET', '/v1/gen-ui/widgets/:widgetId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const store = runtime.genUi?.store
    if (!store) return unavailable()
    const widgetId = ctx.params.widgetId ?? ''
    if (!isGenUiWidgetId(widgetId)) return ERRORS.validation('invalid widget id')
    const html = await store.readWidget(widgetId)
    if (html === null) return ERRORS.notFound('widget not found')
    return jsonResponse({ widgetId, html })
  })

  router.add('GET', '/v1/threads/:threadId/gen-ui/state', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const store = runtime.genUi?.store
    if (!store) return unavailable()
    const threadId = ctx.params.threadId ?? ''
    if (runtime.threadStore && !(await runtime.threadStore.get(threadId))) return ERRORS.notFound('thread not found')
    return jsonResponse({ entries: await store.readState(threadId) })
  })

  router.add('PUT', '/v1/threads/:threadId/gen-ui/state/:widgetId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const store = runtime.genUi?.store
    if (!store) return unavailable()
    const threadId = ctx.params.threadId ?? ''
    const widgetId = ctx.params.widgetId ?? ''
    if (!isGenUiWidgetId(widgetId)) return ERRORS.validation('invalid widget id')
    if (runtime.threadStore && !(await runtime.threadStore.get(threadId))) return ERRORS.notFound('thread not found')
    const body = await readJsonBody(request, STATE_BODY_LIMIT)
    if (!body.ok) return body.response
    const state = (body.value as { state?: unknown } | null)?.state
    try {
      return jsonResponse({ entry: await store.writeState(threadId, widgetId, state) })
    } catch (error) {
      return ERRORS.validation(error instanceof Error ? error.message : 'invalid widget state')
    }
  })
}
