import { kunThreadPath } from '@shared/kun-endpoints'
import { runtimeErrorToError } from '@shared/runtime-error'
import type { CoreThreadJson } from './kun-contract'
import { threadFromCore } from './kun-mapper'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'
import type { NormalizedThread } from './types'

/** Update the task policy and return the runtime's effective snapshot. */
export async function updateKunThreadCollaboration(
  threadId: string,
  enabled: boolean
): Promise<NormalizedThread> {
  const response = await rendererRuntimeClient.runtimeRequest(
    kunThreadPath(threadId), 'PATCH', JSON.stringify({ collaboration: { enabled } })
  )
  if (!response.ok) {
    throw runtimeErrorToError(readRuntimeError(response.body, 'update thread collaboration failed'))
  }
  return threadFromCore(readRuntimeJson<CoreThreadJson>(
    response.body, 'runtime returned an invalid thread response'
  ))
}
