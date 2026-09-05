import type { RuntimeRegistration } from '../contracts/runtime-flavor.js'
import {
  heartbeatRuntimeWithManager,
  registerRuntimeWithManager,
  type ServiceManagerConnection
} from '../manager/manager-client.js'

export const STARTUP_MANAGER_HEARTBEAT_INTERVAL_MS = 5_000

export class RuntimeStartupOwnershipLostError extends Error {
  constructor(readonly registration: RuntimeRegistration) {
    super(
      `Runtime ${registration.flavor}/${registration.instanceId} lost Manager ownership during startup`
    )
    this.name = 'RuntimeStartupOwnershipLostError'
  }
}

/**
 * Bridges the gap between the initial Manager registration and the steady
 * serve-entry heartbeat. Restart reconciliation can scan a large profile for
 * longer than Manager's liveness TTL, so this bridge must begin before that
 * scan and must never overlap its own requests.
 */
export function startRuntimeStartupManagerHeartbeat(input: {
  manager: ServiceManagerConnection
  registration: RuntimeRegistration
  intervalMs?: number
  heartbeat?: typeof heartbeatRuntimeWithManager
  register?: typeof registerRuntimeWithManager
}): {
  revalidate(): Promise<void>
  stop(): Promise<void>
} {
  let stopped = false
  let ownershipLost = false
  let inFlight: Promise<boolean> | null = null

  const heartbeat = (): Promise<boolean> => {
    if (stopped) return Promise.resolve(!ownershipLost)
    if (inFlight) return inFlight
    let request: Promise<boolean>
    request = (input.heartbeat ?? heartbeatRuntimeWithManager)({
      manager: input.manager,
      flavor: input.registration.flavor,
      instanceId: input.registration.instanceId
    }).then((accepted) => {
      if (!accepted) ownershipLost = true
      return accepted
    }).finally(() => {
      if (inFlight === request) inFlight = null
    })
    inFlight = request
    return request
  }

  const timer = setInterval(() => {
    void heartbeat().catch(() => undefined)
  }, input.intervalMs ?? STARTUP_MANAGER_HEARTBEAT_INTERVAL_MS)
  timer.unref?.()

  return {
    async revalidate() {
      await inFlight?.catch(() => undefined)
      const accepted = await heartbeat()
      if (!accepted || ownershipLost) {
        throw new RuntimeStartupOwnershipLostError(input.registration)
      }
      // Same-instance registration is idempotent and refreshes liveness while
      // proving that no replacement won between the final heartbeat and
      // discovery publication.
      await (input.register ?? registerRuntimeWithManager)({
        manager: input.manager,
        registration: input.registration
      })
    },
    async stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      await inFlight?.catch(() => undefined)
    }
  }
}
