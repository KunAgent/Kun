import { z } from 'zod'
import type { ThreadTodosResponse } from '../../contracts/threads.js'
import type { ThreadService } from '../../services/thread-service.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'

const SyncThreadTodosFromPlanRequest = z.object({
  planId: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
  markdown: z.string()
})

export async function syncThreadTodosFromPlan(
  service: ThreadService,
  threadId: string,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = SyncThreadTodosFromPlanRequest.safeParse(body.value)
  if (!parsed.success) {
    return jsonResponse({
      code: 'validation_error',
      message: 'invalid sync plan todos body',
      details: parsed.error.issues
    }, 400)
  }
  try {
    const todos = await service.syncTodosFromPlan(threadId, {
      ...parsed.data,
      mode: 'document_edit'
    })
    return jsonResponse({ todos } satisfies ThreadTodosResponse)
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return jsonResponse({ code: 'not_found', message: error.message }, 404)
    }
    if (error instanceof Error && /plan|path/i.test(error.message)) {
      return jsonResponse({ code: 'validation_error', message: error.message }, 400)
    }
    throw error
  }
}
