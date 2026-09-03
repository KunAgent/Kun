import { MemoryDistillationDecisionRequest } from '../../contracts/memory-distillation-runtime.js'
import type { MemoryDistillationCoordinator } from '../../memory/memory-distillation-coordinator.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'

export async function listMemoryDistillationCandidates(
  coordinator: MemoryDistillationCoordinator | undefined,
  request: Request
): Promise<JsonResponse> {
  if (!coordinator) return ERRORS.unavailable('memory distillation is unavailable')
  const workspace = new URL(request.url).searchParams.get('workspace')?.trim()
  if (!workspace) return ERRORS.validation('workspace is required')
  return jsonResponse({ candidates: await coordinator.list(workspace, 'pending') })
}

export async function decideMemoryDistillationCandidate(
  coordinator: MemoryDistillationCoordinator | undefined,
  id: string,
  request: Request
): Promise<JsonResponse | Response> {
  if (!coordinator) return ERRORS.unavailable('memory distillation is unavailable')
  const workspace = new URL(request.url).searchParams.get('workspace')?.trim()
  if (!workspace) return ERRORS.validation('workspace is required')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MemoryDistillationDecisionRequest.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid memory distillation decision body', parsed.error.issues)
  }
  try {
    return jsonResponse({ candidate: await coordinator.decide(id, parsed.data, workspace) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('already ')) return ERRORS.conflict(message)
    if (message.includes('not found') || message.includes('not active')) {
      return ERRORS.notFound(message)
    }
    return ERRORS.internal('memory distillation decision failed')
  }
}
