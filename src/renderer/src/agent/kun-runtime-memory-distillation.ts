import {
  KUN_MEMORY_DISTILLATION_PATH,
  kunMemoryDistillationDecisionPath
} from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError } from '@shared/runtime-error'
import type { CorePendingMemoryCandidateJson } from './kun-contract'
import { rendererRuntimeClient } from './runtime-client'
import { buildQuery } from './kun-mapper'

export async function listRuntimeMemoryCandidates(
  workspace: string
): Promise<CorePendingMemoryCandidateJson[]> {
  const query = buildQuery({ workspace })
  const response = await rendererRuntimeClient.runtimeRequest(
    `${KUN_MEMORY_DISTILLATION_PATH}${query}`,
    'GET'
  )
  if (!response.ok) {
    throw runtimeErrorToError(parseRuntimeErrorBody(
      response.body,
      'failed to list memory candidates'
    ))
  }
  return parseJson<{ candidates: CorePendingMemoryCandidateJson[] }>(
    response.body,
    'runtime returned an invalid memory candidate list'
  ).candidates ?? []
}

export async function decideRuntimeMemoryCandidate(
  candidateId: string,
  decision: 'allow' | 'deny' | 'withdraw',
  workspace: string
): Promise<CorePendingMemoryCandidateJson> {
  const query = buildQuery({ workspace })
  const response = await rendererRuntimeClient.runtimeRequest(
    `${kunMemoryDistillationDecisionPath(candidateId)}${query}`,
    'POST',
    JSON.stringify({ decision })
  )
  if (!response.ok) {
    throw runtimeErrorToError(parseRuntimeErrorBody(
      response.body,
      'failed to decide memory candidate'
    ))
  }
  return parseJson<{ candidate: CorePendingMemoryCandidateJson }>(
    response.body,
    'runtime returned an invalid memory candidate response'
  ).candidate
}

function parseJson<T>(body: string, fallback: string): T {
  try {
    return JSON.parse(body) as T
  } catch {
    throw runtimeErrorToError({ code: 'unknown', message: fallback })
  }
}
