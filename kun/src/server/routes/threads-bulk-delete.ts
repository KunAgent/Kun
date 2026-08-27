import { z } from 'zod'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import type { ThreadService } from '../../services/thread-service.js'

const BulkDeleteThreadsRequest = z.object({
  workspace: z.string().trim().min(1)
})

export async function deleteThreadsByWorkspace(
  service: ThreadService,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = BulkDeleteThreadsRequest.safeParse(body.value)
  if (!parsed.success) {
    return jsonResponse({ error: 'invalid bulk delete thread body' }, 400)
  }
  const deletedIds = await service.deleteByWorkspace(parsed.data.workspace)
  return jsonResponse({ deletedIds })
}
