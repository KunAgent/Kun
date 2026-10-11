import { TaskExecutionConfigMutationSchema } from '../../contracts/thread-execution-config.js'
import { TaskExecutionConfigConflict } from '../../services/thread-service-execution-config.js'
import type { ThreadService } from '../../services/thread-service.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'

export async function getThreadExecutionConfig(
  service: ThreadService,
  threadId: string
): Promise<JsonResponse> {
  const snapshot = await service.getExecutionConfig(threadId)
  return snapshot ? jsonResponse(snapshot) : ERRORS.notFound('thread not found')
}

export async function patchThreadExecutionConfig(
  service: ThreadService,
  threadId: string,
  request: Request
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = TaskExecutionConfigMutationSchema.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid task execution config', parsed.error.issues)
  try {
    return jsonResponse(await service.mutateExecutionConfig(threadId, parsed.data))
  } catch (error) {
    if (error instanceof TaskExecutionConfigConflict) {
      const status = error.code === 'not_found' ? 404
        : error.code === 'revision_conflict' ? 409
          : error.code === 'managed_execution_unit' || error.code === 'active_team_route_locked' ? 403
            : 400
      return jsonResponse({ code: error.code, message: error.message },
        status)
    }
    throw error
  }
}
