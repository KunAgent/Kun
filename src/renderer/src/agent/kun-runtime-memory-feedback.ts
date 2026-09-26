import { kunMemoryFeedbackActionPath } from '@shared/kun-endpoints'
import { parseRuntimeErrorBody, runtimeErrorToError } from '@shared/runtime-error'
import type {
  CoreMemoryConfirmResultJson,
  CoreMemoryCorrectResultJson,
  CoreMemoryRecordJson
} from './kun-contract'
import { rendererRuntimeClient } from './runtime-client'

type MemoryAccess = { workspace?: string; project?: string }
type MemoryCorrection = {
  content: string
  tags?: string[]
  confidence?: number
  importance?: number
  type?: CoreMemoryRecordJson['type']
  observedAt?: string
  validFrom?: string | null
  validTo?: string | null
  expiresAt?: string | null
}

export async function confirmRuntimeMemory(
  memoryId: string,
  operationId: string,
  access: MemoryAccess = {}
): Promise<CoreMemoryConfirmResultJson> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunMemoryFeedbackActionPath(memoryId, 'confirm'),
    'POST',
    JSON.stringify({ operationId, access })
  )
  if (!response.ok) throw runtimeErrorToError(parseRuntimeErrorBody(response.body, 'failed to confirm memory'))
  return parseJson<{ confirmation: CoreMemoryConfirmResultJson }>(
    response.body,
    'runtime returned an invalid memory confirmation response'
  ).confirmation
}

export async function correctRuntimeMemory(
  memoryId: string,
  operationId: string,
  replacement: MemoryCorrection,
  access: MemoryAccess = {}
): Promise<CoreMemoryCorrectResultJson> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunMemoryFeedbackActionPath(memoryId, 'correct'),
    'POST',
    JSON.stringify({ operationId, access, replacement })
  )
  if (!response.ok) throw runtimeErrorToError(parseRuntimeErrorBody(response.body, 'failed to correct memory'))
  return parseJson<{ correction: CoreMemoryCorrectResultJson }>(
    response.body,
    'runtime returned an invalid memory correction response'
  ).correction
}

function parseJson<T>(body: string, fallback: string): T {
  try {
    return JSON.parse(body) as T
  } catch {
    throw runtimeErrorToError({ code: 'unknown', message: fallback })
  }
}
