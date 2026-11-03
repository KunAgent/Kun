import { emptyMemoryRelationContext, MemoryWorkingContextRequest } from '../../contracts/memory-working-context.js'
import { resolveMemoryTurnContext } from '../../memory/memory-turn-context.js'
import { DEFAULT_MEMORY_PROMPT_CHARACTER_BUDGET } from '../../memory/memory-retrieval-trace.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

export async function previewMemoryWorkingContext(runtime: ServerRuntime, request: Request): Promise<JsonResponse> {
  if (!runtime.memoryStore) return ERRORS.unavailable('Memory is unavailable')
  const body = await readJsonBody(request, 32_768)
  if (!body.ok) return body.response
  const parsed = MemoryWorkingContextRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('Invalid memory context preview request')
  try {
    const context = await resolveMemoryTurnContext(runtime.memoryStore, { ...parsed.data, preview: true })
    const response = jsonResponse({
      memories: context.memories,
      relations: context.relationContext ?? emptyMemoryRelationContext('unavailable'),
      referenceBlocks: context.referenceBlocks,
      characterCount: context.referenceBlocks.join('\n').length,
      characterBudget: DEFAULT_MEMORY_PROMPT_CHARACTER_BUDGET
    })
    response.headers['cache-control'] = 'no-store'
    return response
  } catch {
    return jsonResponse({ code: 'memory_context_unavailable', message: 'Memory context preview is unavailable.' }, 503)
  }
}
