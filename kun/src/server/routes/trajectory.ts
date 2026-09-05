import { z } from 'zod'
import {
  TrajectoryDetailSectionSchema,
  TrajectoryFilterSchema
} from '../../contracts/trajectory.js'
import { TrajectoryQueryService } from '../../services/trajectory-query-service.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

const TrajectoryQuerySchema = z.object({
  limit: z.preprocess((value) => {
    if (value === null || value === '') return 100
    return Number(value)
  }, z.number().int().positive().max(200)),
  cursor: z.string().min(1).max(2_048).optional(),
  filter: TrajectoryFilterSchema.default('all'),
  query: z.string().max(512).default('')
})

export async function trajectoryPageResponse(
  runtime: ServerRuntime,
  threadId: string,
  request: Request
): Promise<JsonResponse> {
  const service = await serviceFor(runtime, threadId)
  if ('error' in service) return service.error
  const url = new URL(request.url)
  const parsed = TrajectoryQuerySchema.safeParse({
    limit: url.searchParams.get('limit'),
    cursor: url.searchParams.get('cursor') ?? undefined,
    filter: url.searchParams.get('filter') ?? 'all',
    query: url.searchParams.get('q') ?? ''
  })
  if (!parsed.success) return ERRORS.validation('invalid trajectory query', parsed.error.issues)
  return jsonResponse(await service.value.page(threadId, parsed.data))
}

export async function trajectorySummaryResponse(
  runtime: ServerRuntime,
  threadId: string
): Promise<JsonResponse> {
  const service = await serviceFor(runtime, threadId)
  if ('error' in service) return service.error
  return jsonResponse(await service.value.summary(threadId))
}

export async function trajectoryDetailResponse(
  runtime: ServerRuntime,
  threadId: string,
  recordId: string,
  request: Request
): Promise<JsonResponse> {
  const service = await serviceFor(runtime, threadId)
  if ('error' in service) return service.error
  const parsed = TrajectoryDetailSectionSchema.safeParse(
    new URL(request.url).searchParams.get('section') ?? 'overview'
  )
  if (!parsed.success) return ERRORS.validation('invalid trajectory detail section', parsed.error.issues)
  const detail = await service.value.detail(threadId, recordId, parsed.data)
  return detail ? jsonResponse(detail) : ERRORS.notFound('trajectory record not found')
}

async function serviceFor(runtime: ServerRuntime, threadId: string): Promise<
  | { value: TrajectoryQueryService }
  | { error: JsonResponse }
> {
  if (!await runtime.threadService.get(threadId)) {
    return { error: ERRORS.notFound(`thread not found: ${threadId}`) }
  }
  if (!runtime.llmDebug) {
    return { error: ERRORS.unavailable('trajectory recorder is unavailable') }
  }
  return { value: new TrajectoryQueryService(runtime.llmDebug, runtime.sessionStore) }
}
