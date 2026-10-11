import { z } from 'zod'
import { MemoryForgottenError } from '../memory/memory-forgetting.js'
import { MemoryErasureIncompleteError } from '../memory/memory-erasure-error.js'
import { MemoryNotFoundError } from '../memory/memory-not-found-error.js'
import { MemoryRevisionConflictError } from '../memory/memory-revisions.js'
import { jsonResponse, type JsonResponse } from '../server/response.js'
import { ServiceManagerHttpError } from './usage-errors.js'

const MemoryErrorBody = z.object({
  code: z.enum(['memory_not_found', 'memory_forgotten', 'memory_revision_conflict', 'memory_erasure_incomplete']),
  message: z.string().max(512)
})

export function managerMemoryErrorResponse(error: unknown): JsonResponse | undefined {
  if (error instanceof MemoryErasureIncompleteError) {
    return jsonResponse({ code: 'memory_erasure_incomplete', message: error.message }, 503)
  }
  if (error instanceof MemoryNotFoundError) {
    return jsonResponse({ code: 'memory_not_found', message: error.message }, 404)
  }
  if (error instanceof MemoryForgottenError) {
    return jsonResponse({ code: 'memory_forgotten', message: error.message }, 409)
  }
  if (error instanceof MemoryRevisionConflictError) {
    return jsonResponse({ code: 'memory_revision_conflict', message: error.message }, 409)
  }
  return undefined
}

export function restoreManagerMemoryError(error: unknown): Error | undefined {
  if (!(error instanceof ServiceManagerHttpError)) return undefined
  let body: unknown
  try { body = JSON.parse(error.detail) } catch { return undefined }
  const parsed = MemoryErrorBody.safeParse(body)
  if (!parsed.success) return undefined
  if (parsed.data.code === 'memory_not_found') {
    return error.status === 404 ? new MemoryNotFoundError() : undefined
  }
  if (parsed.data.code === 'memory_erasure_incomplete') {
    return error.status === 503 ? new MemoryErasureIncompleteError() : undefined
  }
  if (error.status !== 409) return undefined
  return parsed.data.code === 'memory_forgotten'
    ? new MemoryForgottenError()
    : new MemoryRevisionConflictError(parsed.data.message)
}
