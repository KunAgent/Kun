import type { HarnessInstallAction, HarnessInstallState } from '../../../../kun/src/contracts/harness-install'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeJson } from './kun-runtime-services'

export async function harnessInstallRequest(id: string, action: HarnessInstallAction,
  operation: 'state' | 'start' | 'cancel' = 'state', jobId?: string): Promise<HarnessInstallState | undefined> {
  const path = `/v1/harnesses/${encodeURIComponent(id)}/install`
  const response = await rendererRuntimeClient.runtimeRequest(
    operation === 'cancel' ? `${path}/cancel` : operation === 'state' ? `${path}?action=${action}` : path,
    operation === 'state' ? 'GET' : 'POST',
    operation === 'state' ? undefined : JSON.stringify(operation === 'cancel' ? { jobId } : { action }))
  if (!response.ok) {
    let message = 'Agent installation request failed'
    try { message = JSON.parse(response.body).message || message } catch { /* keep fallback */ }
    throw new Error(message)
  }
  if (operation !== 'cancel') return readRuntimeJson<HarnessInstallState>(response.body, 'Invalid installation state')
}
