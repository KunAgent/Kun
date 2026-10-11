import { ZodError } from 'zod'
import type { ThreadService } from '../../services/thread-service.js'
import { ExecutionTaskError } from '../../services/execution-task-service.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'

export async function executionTaskRoute(service: ThreadService, threadId: string, request: Request, taskId?: string): Promise<JsonResponse | Response> {
  try {
    if (request.method === 'GET') {
      if (taskId) return jsonResponse({ task: await service.executionTasks.get(threadId, taskId) })
      const query = new URL(request.url).searchParams
      return jsonResponse(await service.executionTasks.list(threadId, {
        ...(query.has('status') ? { status: query.get('status') } : {}),
        ...(query.has('runnable') ? { runnable: query.get('runnable') === 'true' } : {}),
        ...(query.has('cursor') ? { cursor: query.get('cursor') } : {}),
        ...(query.has('limit') ? { limit: Number(query.get('limit')) } : {})
      }))
    }
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    return jsonResponse(taskId ? await service.executionTasks.update(threadId, taskId, body.value)
      : await service.executionTasks.create(threadId, body.value), taskId ? 200 : 201)
  } catch (error) {
    if (error instanceof ZodError) return jsonResponse({ code: 'validation_error', details: error.issues }, 400)
    if (error instanceof ExecutionTaskError) return jsonResponse({ code: error.code, message: error.message },
      error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : error.code === 'conflict' ? 409 : 400)
    throw error
  }
}
