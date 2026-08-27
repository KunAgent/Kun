import { TurnUsageResponseSchema } from '../../contracts/usage.js'
import type { UsageService } from '../../services/usage-service.js'
import {
  buildDailyUsageResponse,
  buildModelUsageResponse,
  buildThreadUsageResponse,
  buildTurnUsageResponse,
  loadUsageHistory,
  parseDailyUsageQuery,
  parseModelUsageQuery,
  parseTurnUsageQuery,
  usageQueryUtcRange,
  UsageValidationError
} from '../../services/usage-service.js'
import type { ServerRuntime } from './server-runtime.js'
import { jsonResponse, type JsonResponse } from '../response.js'

/** Runtime-cumulative response retained for backward compatibility. */
export type UsageEndpointResponse = {
  total: ReturnType<UsageService['total']>
  perThread: Array<{ threadId: string; usage: ReturnType<UsageService['forThread']> }>
}

export async function buildUsageResponse(runtime: ServerRuntime): Promise<UsageEndpointResponse> {
  const threads = await runtime.threadService.list()
  return {
    total: runtime.usageService.total(),
    perThread: threads.map((thread) => ({
      threadId: thread.id,
      usage: runtime.usageService.forThread(thread.id)
    }))
  }
}

export async function usageJsonResponse(
  request: Request,
  runtime: ServerRuntime
): Promise<JsonResponse> {
  const query = queryRecord(request)
  const groupBy = stringParam(query, 'group_by') ?? 'runtime'
  try {
    if (groupBy === 'thread') {
      return jsonResponse(buildThreadUsageResponse(await loadUsageHistory(runtime, {
        threadId: stringParam(query, 'thread_id')
      })))
    }
    if (groupBy === 'day') {
      const dayQuery = parseDailyUsageQuery(query)
      return jsonResponse(
        buildDailyUsageResponse(
          await loadUsageHistory(runtime, usageQueryUtcRange(dayQuery)),
          dayQuery
        )
      )
    }
    if (groupBy === 'model') {
      const modelQuery = parseModelUsageQuery(query)
      return jsonResponse(
        buildModelUsageResponse(
          await loadUsageHistory(runtime, usageQueryUtcRange(modelQuery)),
          modelQuery
        )
      )
    }
    if (groupBy === 'turn') {
      const turnQuery = parseTurnUsageQuery(query)
      const response = buildTurnUsageResponse(
        await loadUsageHistory(runtime, { threadId: turnQuery.threadId }),
        turnQuery
      )
      return jsonResponse(TurnUsageResponseSchema.parse(response))
    }
  } catch (error) {
    if (error instanceof UsageValidationError) {
      return jsonResponse({ code: error.code, message: error.message }, 400)
    }
    throw error
  }
  if (groupBy !== 'runtime') {
    return jsonResponse({
      code: 'validation_error',
      message: `unsupported usage grouping: ${groupBy}`
    }, 400)
  }
  return jsonResponse(await buildUsageResponse(runtime))
}

function queryRecord(request: Request): Record<string, string> {
  const url = new URL(request.url)
  return Object.fromEntries(url.searchParams.entries())
}

function stringParam(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
