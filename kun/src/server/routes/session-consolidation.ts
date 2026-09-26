import { jsonResponse } from '../response.js'
import type { JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

export async function consolidationPreview(runtime: ServerRuntime): Promise<JsonResponse> {
  if (!runtime.sessionConsolidation) return ERRORS.unavailable('session consolidation is unavailable')
  return jsonResponse(await runtime.sessionConsolidation.preview())
}

export async function runSessionConsolidation(runtime: ServerRuntime): Promise<JsonResponse> {
  if (!runtime.sessionConsolidation) return ERRORS.unavailable('session consolidation is unavailable')
  const result = await runtime.sessionConsolidation.runOnce()
  if (!result.enabled) return ERRORS.unavailable('session consolidation is disabled')
  return jsonResponse(result)
}
