import { z } from 'zod'
import type { RuntimeFlavor, RuntimeRegistration } from '../contracts/runtime-flavor.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { requestManagerJson } from './manager-client-support.js'
import { ServiceManagerHttpError } from './usage-errors.js'

export class ManagerRuntimeSlotBusyError extends Error {
  constructor(readonly owner: RuntimeRegistration) {
    super(`Kun runtime slot ${owner.flavor} is already owned by ${owner.instanceId}`)
    this.name = 'ManagerRuntimeSlotBusyError'
  }
}

/** Small control-plane import graph; no store, query, or Manager bootstrap. */
export async function heartbeatRuntimeWithManager(input: {
  manager: ServiceManagerConnection
  flavor: RuntimeFlavor
  instanceId: string
  fetch?: typeof fetch
  signal?: AbortSignal
}): Promise<boolean> {
  try {
    const body = await requestManagerJson(input.manager, `/v1/runtimes/${input.flavor}/heartbeat`, {
      method: 'POST',
      body: { instanceId: input.instanceId },
      fetch: input.fetch,
      signal: input.signal
    })
    return z.object({ accepted: z.literal(true) }).parse(body).accepted
  } catch (error) {
    if (error instanceof ServiceManagerHttpError && error.status === 409 &&
      error.code === 'runtime_instance_changed') return false
    throw error
  }
}
