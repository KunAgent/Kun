import { z } from 'zod'
import {
  CreateReferenceBranchSchema, HistoryReferenceError, type HistoryReferenceService
} from '../../history/history-reference-service.js'
import type { Router, RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'

const PathSchema = z.object({ path: z.string().min(1) }).strict()
const PageSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
})
const SourcePageSchema = PageSchema.extend({
  turnId: z.string().min(1).max(256).optional(),
  itemId: z.string().min(1).max(512).optional(),
  contentOffset: z.coerce.number().int().min(0).max(16 * 1024 * 1024).optional()
}).strict().refine((value) => value.contentOffset === undefined || Boolean(value.itemId), {
  message: 'contentOffset requires an itemId'
})
const PreviewSchema = PathSchema.extend(PageSchema.shape)
const DiscoverySchema = z.object({
  cwd: z.string().min(1).optional(), query: z.string().max(512).optional(),
  after: z.string().datetime().optional(), before: z.string().datetime().optional(),
  includeArchived: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).optional()
}).strict()

class HistoryBodyError extends Error {
  constructor(readonly response: JsonResponse) { super('Invalid history request body') }
}
async function readBody(request: Request): Promise<unknown> {
  const result = await readJsonBody(request)
  if (!result.ok) throw new HistoryBodyError(result.response)
  return result.value
}

export function registerHistoryReferenceRoutes(router: Router, runtime: ServerRuntime): void {
  type Handler = (history: HistoryReferenceService, request: Request, context: RouteContext) => Promise<unknown>
  const add = (method: string, path: string, handler: Handler) => {
    router.add(method, path, async (request, context) => {
      if (!authorize(request, runtime)) return ERRORS.unauthorized()
      if (!runtime.historyReferences) return ERRORS.unavailable('History references are not available')
      try {
        runtime.historyReferences.assertEnabled()
        return jsonResponse(await handler(runtime.historyReferences, request, context))
      } catch (error) {
        if (error instanceof HistoryBodyError) return error.response
        if (error instanceof z.ZodError) return ERRORS.validation('Invalid history request', error.issues)
        if (error instanceof HistoryReferenceError) return jsonResponse({
          code: error.code, message: error.message
        }, error.statusCode)
        const message = error instanceof Error ? error.message : String(error)
        const code = String((error as { code?: unknown })?.code ?? '')
        if (code.startsWith('EXTENSION_JSON_MANAGER_') || /Kun Service Manager|shared data resource/.test(message)) {
          return ERRORS.unavailable('History reference persistence is temporarily unavailable')
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ERRORS.notFound('Source history file was not found')
        if ((error as NodeJS.ErrnoException).code === 'EACCES') return ERRORS.forbidden('Source history file is not readable')
        // Parser failures are user-recoverable input/source issues, never an invitation to mutate the source.
        return ERRORS.validation(message)
      }
    })
  }

  add('GET', '/v1/history-sources/codex/sessions', async (history, request) => ({
    sessions: await history.discover(DiscoverySchema.parse(Object.fromEntries(new URL(request.url).searchParams)))
  }))
  add('POST', '/v1/history-sources/codex/preview', async (history, request) =>
    history.preview(PreviewSchema.parse(await readBody(request))))
  add('GET', '/v1/history-sources/claude-code/sessions', async (history, request) => ({
    sessions: await history.discover(DiscoverySchema.parse(Object.fromEntries(new URL(request.url).searchParams)), 'claude-code')
  }))
  add('POST', '/v1/history-sources/claude-code/preview', async (history, request) =>
    history.preview(PreviewSchema.parse(await readBody(request)), 'claude-code'))
  add('POST', '/v1/threads/reference-branches', async (history, request) =>
    history.createBranch(CreateReferenceBranchSchema.parse(await readBody(request))))
  add('GET', '/v1/history-sources/:id/timeline', async (history, request, context) => {
    const params = new URL(request.url).searchParams
    const page = SourcePageSchema.parse(Object.fromEntries(params))
    return history.page(context.params.id, { ...page, threadId: `source:${context.params.id}` })
  })
  add('GET', '/v1/history-sources/:id', async (history, _request, context) => {
    const reference = await history.get(context.params.id)
    if (!reference) throw new HistoryReferenceError('history_reference_not_found', 'History reference not found', 404)
    return { reference, ...(history.isEnabled(reference.provider) ? await history.status(context.params.id)
      : { status: 'disabled', warnings: [] }) }
  })
  add('GET', '/v1/history-sources/:id/attachments/:itemId/:index', async (history, _request, context) =>
    history.attachment(context.params.id, context.params.itemId,
      z.coerce.number().int().min(0).max(31).parse(context.params.index)))
  add('POST', '/v1/history-sources/:id/relink', async (history, request, context) => ({
    reference: await history.relink(context.params.id, PathSchema.parse(await readBody(request)).path)
  }))
}
