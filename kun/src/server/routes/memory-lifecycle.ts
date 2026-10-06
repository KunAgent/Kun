import { MemoryErasureIncompleteError } from '../../memory/memory-erasure-error.js'
import { MemoryLifecycleRequest } from '../../contracts/memory-lifecycle.js'
import { MemoryRevisionConflictError } from '../../memory/memory-revisions.js'
import { MemoryForgottenError } from '../../memory/memory-forgetting.js'
import { MemoryNotFoundError } from '../../memory/memory-not-found-error.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

const accessFor = (request: Request) => {
  const query = new URL(request.url).searchParams
  return { workspace: query.get('workspace') ?? undefined, project: query.get('project') ?? undefined }
}
export async function memoryHistory(store: MemoryStore | undefined, id: string,
  request: Request): Promise<JsonResponse> {
  if (!store?.history) return ERRORS.unavailable('memory history is unavailable')
  try { return jsonResponse(await store.history(id, accessFor(request))) }
  catch (error) {
    if (error instanceof MemoryNotFoundError) return ERRORS.notFound(error.message)
    throw error
  }
}
export async function memoryLifecycle(store: MemoryStore | undefined, id: string,
  request: Request): Promise<JsonResponse | Response> {
  if (!store?.lifecycle) return ERRORS.unavailable('memory lifecycle is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MemoryLifecycleRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid memory lifecycle request', parsed.error.issues)
  try { return jsonResponse(await store.lifecycle(id, parsed.data, accessFor(request))) }
  catch (error) {
    if (error instanceof MemoryErasureIncompleteError) return ERRORS.unavailable(error.message)
    if (error instanceof MemoryRevisionConflictError || error instanceof MemoryForgottenError) return ERRORS.conflict(error.message)
    if (error instanceof MemoryNotFoundError) return ERRORS.notFound(error.message)
    throw error
  }
}
