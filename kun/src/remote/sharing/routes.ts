import { z } from 'zod'
import type { Router } from '../../server/router.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { authorize } from '../../server/routes/route-auth.js'
import { readJsonBody } from '../../server/read-json-body.js'
import { jsonResponse } from '../../server/response.js'
import { buildEventStreamResponse } from '../../server/routes/events.js'
import { localCaller } from '../runtime/local-call.js'
import { SharedTaskFacade } from './guest.js'
import { ShareActorSchema, ShareOwnerSchema, ShareSummarySchema } from './contracts.js'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
/** Protected local routes only. Main supplies identities obtained from the independent ShareRelay connection. */
export function registerSharedTaskRoutes(router: Router, runtime: ServerRuntime) {
  const facade = new SharedTaskFacade(runtime, localCaller(router, runtime)), journal = facade.journal
  const handlers: Record<string, (raw: any, request: Request) => Promise<unknown>> = {
    'owner-prepare': async (raw) => journal.prepare(ShareOwnerSchema.parse(raw.owner), Id.parse(raw.requestId), raw.params),
    'owner-settle': async (raw) => journal.settle(ShareOwnerSchema.parse(raw.owner), Id.parse(raw.requestId), raw.result),
    'owner-lookup': async (raw) => journal.lookup(ShareOwnerSchema.parse(raw.owner), Id.parse(raw.requestId)),
    'resource': async (raw) => {
      const resource = await journal.resource(ShareOwnerSchema.parse(raw.owner), Id.parse(raw.resourceHandle))
      const thread = resource ? await runtime.threadService.getMetadata(resource.threadId) : null
      return { resource, title: thread?.title }
    },
    'resource-bind': async (raw) => journal.bind(ShareOwnerSchema.parse(raw.owner), ShareSummarySchema.parse(raw.share)),
    'guest-admit': async (raw) => journal.admit(ShareActorSchema.parse(raw.actor)),
    'guest-fence': async (raw) => journal.fence(ShareOwnerSchema.parse(raw.owner), Id.parse(raw.shareId), raw.memberId === undefined ? undefined : Id.parse(raw.memberId), raw.sessionId === undefined ? undefined : Id.parse(raw.sessionId)),
    'file-start': async (raw) => facade.files.start(raw.actor, raw.call),
    'file-finish': async (raw) => facade.files.finish(raw.actor, raw.call, raw.result),
    'file-content': async (raw) => {
      const content = await facade.files.content(raw.actor, raw.params)
      return new Response(new Uint8Array(content.data), { headers: { 'Content-Type': content.mimeType,
        'X-Kun-File-Name': encodeURIComponent(content.name), 'Cache-Control': 'no-store' } })
    },
    'guest-invoke': async (raw) => facade.execute(raw.actor, raw.call),
    'guest-events': async (raw, request) => {
      const actor = ShareActorSchema.parse(raw.actor), target = await journal.authorize(actor)
      const since = z.number().int().nonnegative().parse(raw.since ?? 0), encoder = new TextEncoder(), decoder = new TextDecoder()
      const response = buildEventStreamResponse({ request, threadId: target.thread.id, eventBus: runtime.eventBus,
        sessionStore: runtime.sessionStore, streamRegistry: runtime.eventStreamRegistry, sinceSeq: since })
      let pending = ''
      const stream = response.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        async transform(chunk, controller) {
          await journal.authorize(actor)
          pending += decoder.decode(chunk, { stream: true })
          if (Buffer.byteLength(pending) > 4 * 1024 * 1024 + 65536) throw new Error('STREAM_LIMIT')
          let end: number
          while ((end = pending.indexOf('\n\n')) >= 0) {
            const block = pending.slice(0, end); pending = pending.slice(end + 2)
            const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
            if (!data) continue
            const event = JSON.parse(data), seq = Number.isSafeInteger(event.seq) ? event.seq : event.cursor
            if (!Number.isSafeInteger(seq) || seq < 0) continue
            // Invalidations are intentionally body-free: no pending foreign queue text or consent payload can escape.
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ kind: event.kind === 'replay_synchronized' ? 'replay_synchronized' : 'shared.updated',
              threadId: target.thread.id, seq, cursor: seq }) + '\n\n'))
          }
        }
      }))
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
    }
  }
  for (const [path, handle] of Object.entries(handlers)) router.add('POST', '/v1/remote/shares/' + path, async (request) => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    const body = await readJsonBody(request, 262144)
    if (!body.ok) return body.response
    try {
      const result = await handle(body.value, request)
      return result instanceof Response ? result : jsonResponse(result)
    } catch (error) {
      return jsonResponse({ code: error instanceof z.ZodError ? 'INVALID_REQUEST' : error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'SHARE_REQUEST_REJECTED' }, 400)
    }
  })
  return facade
}
