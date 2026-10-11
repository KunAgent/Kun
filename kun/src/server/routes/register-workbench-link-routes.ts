import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { ResolveWorkbenchLinkSchema, WorkbenchDirectorySchema, WorkbenchLinkStatusSchema } from '../../contracts/workbench-links.js'
import { buildWorkbenchPlan, confirmWorkbenchLink, dismissWorkbenchLink, requestWorkbenchCancel, runNowWorkbenchLink,
  setSeriesPaused, skipMissedWorkbenchLink, updateScheduledWorkbenchLink, watchWorkbenchThread } from '../../workbench-bridge/actions.js'
import { listWorkbenchLinks, readWorkbenchLink } from '../../workbench-bridge/link-store.js'
import type { Router, RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void

async function body(request: Request): Promise<unknown> {
  const result = await readJsonBody(request)
  if (!result.ok) throw new z.ZodError([{ code: 'custom', path: [], message: 'invalid workbench request body' }])
  return result.value
}

const ListQuery = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().nonnegative().optional()
})

/**
 * User-authorized decisions on Code/Work hand-off cards. Agents can only draft
 * a card with a tool; accepting, dismissing or stopping it is bound to these routes.
 */
export function registerWorkbenchLinkRoutes(add: Add): void {
  add('GET', '/v1/rooms/:roomId/workbench-links', async (rooms, request, { params }) => {
    const query = ListQuery.parse(Object.fromEntries(new URL(request.url).searchParams.entries()))
    const status = query.status ? z.array(WorkbenchLinkStatusSchema).parse(query.status.split(',')) : undefined
    return listWorkbenchLinks(rooms.deps.store, params.roomId, { status, limit: query.limit, beforeSeq: query.cursor })
  })
  // Static segment first: `watch` must not be read as a link id.
  add('POST', '/v1/rooms/:roomId/workbench-links/watch', async (rooms, request, { params }) =>
    ({ link: await watchWorkbenchThread(rooms.workbench, params.roomId, await body(request)) }))
  add('GET', '/v1/rooms/:roomId/workbench-links/:linkId', async (rooms, _request, { params }) =>
    ({ link: await readWorkbenchLink(rooms.deps.store, params.roomId, RoomIdSchema.parse(params.linkId)) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/confirm', async (rooms, request, { params }) =>
    ({ link: await confirmWorkbenchLink(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), await body(request)) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/update', async (rooms, request, { params }) =>
    ({ link: await updateScheduledWorkbenchLink(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), await body(request)) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/run-now', async (rooms, request, { params }) =>
    ({ link: await runNowWorkbenchLink(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), await body(request)) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/pause', async (rooms, request, { params }) =>
    ({ link: await setSeriesPaused(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), await body(request), true) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/resume', async (rooms, request, { params }) =>
    ({ link: await setSeriesPaused(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), await body(request), false) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/build', async (rooms, request, { params }) =>
    ({ link: await buildWorkbenchPlan(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), await body(request)) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/skip', async (rooms, request, { params }) =>
    ({ link: await skipMissedWorkbenchLink(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), await body(request)) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/dismiss', async (rooms, request, { params }) =>
    ({ link: await dismissWorkbenchLink(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), await body(request)) }))
  add('POST', '/v1/rooms/:roomId/workbench-links/:linkId/cancel', async (rooms, request, { params }) => {
    const input = ResolveWorkbenchLinkSchema.parse(await body(request))
    return { link: await requestWorkbenchCancel(rooms.workbench, params.roomId, RoomIdSchema.parse(params.linkId), input) }
  })
}

/** The desktop shell pushes the Work workspaces and Code projects Kun cannot discover on its own. */
export function registerWorkbenchDirectoryRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('GET', '/v1/workbench/directory', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.rooms) return ERRORS.unavailable('rooms are not available')
    return jsonResponse(await runtime.rooms.workbench.directory.get())
  })
  router.add('PUT', '/v1/workbench/directory', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.rooms) return ERRORS.unavailable('rooms are not available')
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response
    const input = WorkbenchDirectorySchema.safeParse(parsed.value)
    if (!input.success) return ERRORS.validation('invalid workbench directory', input.error.issues)
    return jsonResponse(await runtime.rooms.workbench.directory.set(input.data))
  })
}
