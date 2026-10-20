import { z } from 'zod'
import { MemoryRelationAnalyzeRequest, MemoryRelationCommand } from '../../contracts/memory-relations.js'
import { analyzeMemoryRelations } from '../../memory/memory-relation-analysis.js'
import { MemoryNotFoundError } from '../../memory/memory-not-found-error.js'
import { MemoryRevisionConflictError } from '../../memory/memory-revisions.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

const ReviewOrList = z.union([
  MemoryRelationCommand.options[0], MemoryRelationCommand.options[2], MemoryRelationCommand.options[3]
])
const activeAnalyses = new WeakSet<ServerRuntime>()

export async function memoryRelations(runtime: ServerRuntime, request: Request, analyze: boolean): Promise<JsonResponse> {
  if (!runtime.memoryStore?.relations) return ERRORS.unavailable('Memory relations are unavailable')
  const body = await readJsonBody(request, 16_384)
  if (!body.ok) return body.response
  if (!analyze) {
    const parsed = ReviewOrList.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('Invalid memory relation request')
    try { return jsonResponse(await runtime.memoryStore.relations(parsed.data)) }
    catch (error) { return relationError(error) }
  }
  const parsed = MemoryRelationAnalyzeRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('Invalid memory relation analysis request')
  if (!runtime.modelClient || !runtime.defaultModel) return ERRORS.unavailable('Configure a model before analyzing relations')
  if (activeAnalyses.has(runtime)) return ERRORS.conflict('Memory relation analysis is already running')
  activeAnalyses.add(runtime)
  try {
    return jsonResponse(await analyzeMemoryRelations({
      store: runtime.memoryStore, model: runtime.modelClient, modelId: runtime.defaultModel,
      input: parsed.data, signal: request.signal
    }))
  } catch (error) { return relationError(error) }
  finally { activeAnalyses.delete(runtime) }
}

function relationError(error: unknown): JsonResponse {
  if (error instanceof MemoryNotFoundError) return ERRORS.notFound('Memory relation')
  if (error instanceof MemoryRevisionConflictError) return ERRORS.conflict('Memory relation is stale or unavailable. Refresh and analyze again.')
  return jsonResponse({ code: 'memory_relation_unavailable', message: 'Memory relation request failed. No memories were changed.' }, 503)
}
