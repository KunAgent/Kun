import {
  isSafeRuntimeHandoffDiscovery,
  type RuntimeHandoffDiscoveryRecord
} from '../server/runtime-discovery.js'

const SHUTDOWN_REQUEST_TIMEOUT_MS = 5_000

/**
 * Ask one exact local Runtime instance to stop. This is intentionally
 * independent of the current Runtime info/capability schema: possession of
 * the discovery token plus the instance-bound endpoint is the control proof.
 */
export async function requestExactRuntimeShutdown(
  target: RuntimeHandoffDiscoveryRecord,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (!isSafeRuntimeHandoffDiscovery(target)) {
    throw new Error('runtime shutdown target is not a safe loopback discovery owner')
  }
  const response = await fetchImpl(
    `${target.baseUrl.replace(/\/$/u, '')}/v1/runtime/shutdown`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${target.runtimeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ instanceId: target.instanceId }),
      signal: AbortSignal.timeout(SHUTDOWN_REQUEST_TIMEOUT_MS)
    }
  )
  if (!response.ok) throw new Error(`runtime shutdown failed with HTTP ${response.status}`)
}
