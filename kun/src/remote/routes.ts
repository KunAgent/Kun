import { registerSharedTaskRoutes } from './sharing/routes.js'
import { registerRemoteDirectoryRoutes } from './directory/routes.js'
import { registerRemoteAvatarRoute } from './agents/avatar-route.js'
import { registerDesktopScheduleAudit } from './schedules/desktop-audit.js'
import { RemoteNotificationFeed } from './notifications/feed.js'
import { projectRemoteGroupEvent } from './groups/events.js'
import { REMOTE_SCOPES } from '@kun/remote-protocol'
import { transferReceipt } from './files/transfer-receipts.js'
import { z } from 'zod'
import type { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { authorize } from '../server/routes/route-auth.js'
import { jsonResponse } from '../server/response.js'
import { readJsonBody } from '../server/read-json-body.js'
import { buildEventStreamResponse } from '../server/routes/events.js'
import { roomEventStream } from '../server/routes/room-event-stream.js'
import { RemoteFacade } from './facade.js'
import { requireCode } from './code/access.js'
import { RemoteId } from './contracts.js'
import { remoteAttachmentContent } from './files/access.js'
export function registerRemoteRoutes(router: Router, runtime: ServerRuntime) {
  if (!runtime.rooms) return
  const facade = new RemoteFacade(runtime, router)
  registerDesktopScheduleAudit(router, runtime)
  registerSharedTaskRoutes(router, runtime)
  registerRemoteAvatarRoute(router, runtime)
  registerRemoteDirectoryRoutes(router, runtime)
  const notifications = new RemoteNotificationFeed(runtime)
  router.add('GET', '/v1/remote/notification-events', (request) => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    return notifications.stream(request)
  })
  router.add('GET', '/v1/remote/project-files/:projectId/:fileRef', async (request, { params }) => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    try {
      const scope = { accountId: RemoteId.parse(request.headers.get('X-Kun-Remote-Account')),
        deviceId: RemoteId.parse(request.headers.get('X-Kun-Remote-Device')),
        authorizationId: RemoteId.parse(request.headers.get('X-Kun-Remote-Authorization')) }
      const revision = z.string().regex(/^file-v1:[a-f0-9]{64}$/).parse(new URL(request.url).searchParams.get('revision'))
      const file = await facade.projectFiles.read(scope, RemoteId.parse(params.projectId), RemoteId.parse(params.fileRef), revision)
      return new Response(new Uint8Array(file.data), { headers: { 'Content-Type': file.mimeType,
        'X-Kun-File-Name': encodeURIComponent(file.name), 'Cache-Control': 'no-store' } })
    } catch { return jsonResponse({ code: 'FILE_NOT_ALLOWED' }, 403) }
  })
  router.add(
    'GET',
    '/v1/remote/artifacts/:kind/:resource/:id',
    async (request, { params }) => {
      if (!authorize(request, runtime))
        return jsonResponse({ code: 'unauthorized' }, 401)
      try {
        const resource = RemoteId.parse(params.resource),
          id = RemoteId.parse(params.id)
        const version = new URL(request.url).searchParams.get('version')
        const file =
          params.kind === 'agent'
            ? await facade.artifacts.readAgent(
                resource,
                id,
                version
                  ? z.coerce.number().int().positive().parse(version)
                  : undefined
              )
            : params.kind === 'code'
              ? await facade.artifacts.readCode(resource, id)
              : null
        if (!file) throw new Error('FORBIDDEN')
        return new Response(new Uint8Array(file.data), {
          headers: {
            'Content-Type': file.mimeType,
            'X-Kun-File-Name': encodeURIComponent(file.name),
            'Cache-Control': 'no-store'
          }
        })
      } catch {
        return jsonResponse({ code: 'FILE_NOT_ALLOWED' }, 403)
      }
    }
  )
  router.add('POST', '/v1/remote/transfer-receipt', async (request) => {
    if (!authorize(request, runtime))
      return jsonResponse({ code: 'unauthorized' }, 401)
    const body = await readJsonBody(request, 262144)
    if (!body.ok) return body.response
    try {
      return jsonResponse(await transferReceipt(runtime.rooms!, body.value))
    } catch {
      return jsonResponse({ code: 'RECEIPT_CONFLICT' }, 409)
    }
  })
  router.add(
    'GET',
    '/v1/remote/attachments/:id',
    async (request, { params }) => {
      if (!authorize(request, runtime))
        return jsonResponse({ code: 'unauthorized' }, 401)
      try {
        const threadId = RemoteId.parse(
          new URL(request.url).searchParams.get('threadId')
        )
        const content = await remoteAttachmentContent(runtime, threadId, params.id)
        if (!content) throw new Error('NOT_FOUND')
        return new Response(new Uint8Array(content.data), {
          headers: {
            'Content-Type': content.mimeType,
            'X-Kun-File-Name': encodeURIComponent(content.name),
            'Cache-Control': 'no-store'
          }
        })
      } catch {
        return jsonResponse({ code: 'FORBIDDEN' }, 403)
      }
    }
  )
  router.add('POST', '/v1/remote/invoke', async (request) => {
    if (!authorize(request, runtime))
      return jsonResponse({ code: 'unauthorized' }, 401)
    const body = await readJsonBody(request, 262144)
    if (!body.ok) return body.response
    try {
      return jsonResponse(await facade.execute(body.value))
    } catch (error) {
      return jsonResponse(
        {
          code:
            error instanceof z.ZodError
              ? 'INVALID_REQUEST'
              : error instanceof Error && /^[A-Z_]+$/.test(error.message)
                ? error.message
                : 'REMOTE_REJECTED'
        },
        400
      )
    }
  })
  router.add(
    'GET',
    '/v1/remote/events/:kind/:id',
    async (request, { params }) => {
      if (!authorize(request, runtime))
        return jsonResponse({ code: 'unauthorized' }, 401)
      try {
        const id = RemoteId.parse(params.id),
          sinceSeq = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(new URL(request.url).searchParams.get('since') ?? 0)
        if (params.kind === 'group') {
          const scopes = (request.headers.get('X-Kun-Remote-Scopes') ?? 'personal').split(',')
          if (scopes.some((scope) => !(REMOTE_SCOPES as readonly string[]).includes(scope))) throw new Error('REMOTE_SCOPE_REQUIRED')
          const authority = { accountId: RemoteId.parse(request.headers.get('X-Kun-Remote-Account')),
            deviceId: RemoteId.parse(request.headers.get('X-Kun-Remote-Device')),
            authorizationId: RemoteId.parse(request.headers.get('X-Kun-Remote-Authorization')),
            scopes: scopes as import('@kun/remote-protocol').RemoteScopeName[] }
          await facade.groups.requireGroup(authority, id)
          return roomEventStream({ runtime, rooms: runtime.rooms!, roomId: id, request, sinceSeq,
            projectEvent: (event) => projectRemoteGroupEvent(event, authority) })
        }
        if (params.kind === 'agent') {
          const { room } = await facade.conversation(id)
          return roomEventStream({
            runtime,
            rooms: runtime.rooms!,
            roomId: room.id,
            request,
            sinceSeq
          })
        }
        if (params.kind !== 'code') throw new Error('INVALID_TARGET')
        await requireCode(runtime, id)
        return buildEventStreamResponse({
          request,
          threadId: id,
          eventBus: runtime.eventBus,
          sessionStore: runtime.sessionStore,
          streamRegistry: runtime.eventStreamRegistry,
          sinceSeq
        })
      } catch {
        return jsonResponse({ code: 'FORBIDDEN' }, 403)
      }
    }
  )
}
