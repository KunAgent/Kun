import type { RuntimeRegistration } from '../contracts/runtime-flavor.js'
import type { ThreadLeaseAuthorityState } from '../ports/thread-execution-lease.js'
import {
  heartbeatRuntimeWithManager,
  ManagerRuntimeSlotBusyError,
  type ServiceManagerConnection
} from '../manager/manager-client.js'
import { ServiceManagerHttpError, ServiceManagerTransportError } from '../manager/usage-errors.js'

export type ManagerOwnershipLostReason = {
  code: 'manager_runtime_ownership_lost'
  source: 'heartbeat_rejected' | 'runtime_slot_busy'
  managerInstanceId: string
  ownerInstanceId?: string
}

export type RuntimeManagerHeartbeat = { stop(): void }

/** Transport failures do not prove that another Runtime owns this slot. */
export function startRuntimeManagerHeartbeat(input: {
  manager: ServiceManagerConnection
  registration: RuntimeRegistration
  onAuthorityChange(state: ThreadLeaseAuthorityState): void
  onOwnershipLost(reason: ManagerOwnershipLostReason): void
  /** Only legacy/shared runtimes may resolve or elect a different Manager. */
  recoverUnownedManager?: (signal: AbortSignal) => Promise<void>
  heartbeat?: typeof heartbeatRuntimeWithManager
  intervalMs?: number
  log?: (line: string) => void
}): RuntimeManagerHeartbeat {
  const intervalMs = input.intervalMs ?? 5_000
  const log = input.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  const abort = new AbortController()
  let stopped = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const identity = () => ({
    flavor: input.registration.flavor,
    instanceId: input.registration.instanceId,
    managerInstanceId: input.manager.discovery.instanceId
  })
  const schedule = (delayMs: number): void => {
    if (stopped) return
    timer = setTimeout(() => { timer = undefined; void tick() }, delayMs)
    timer.unref?.()
  }
  const loseOwnership = (source: ManagerOwnershipLostReason['source'], ownerInstanceId?: string): void => {
    if (stopped) return
    stopped = true
    abort.abort()
    input.onAuthorityChange('lost')
    input.onOwnershipLost({
      code: 'manager_runtime_ownership_lost', source,
      managerInstanceId: input.manager.discovery.instanceId,
      ...(ownerInstanceId ? { ownerInstanceId } : {})
    })
  }
  const tick = async (): Promise<void> => {
    try {
      const accepted = await (input.heartbeat ?? heartbeatRuntimeWithManager)({
        manager: input.manager,
        flavor: input.registration.flavor,
        instanceId: input.registration.instanceId,
        signal: abort.signal
      })
      if (stopped) return
      if (!accepted) {
        loseOwnership('heartbeat_rejected')
        return
      }
      if (failures > 0) {
        log(`[kun] manager heartbeat recovered ${JSON.stringify({ ...identity(), failures })}`)
      }
      failures = 0
      input.onAuthorityChange('holder')
    } catch (error) {
      if (stopped) return
      if (error instanceof ManagerRuntimeSlotBusyError) {
        loseOwnership('runtime_slot_busy', error.owner.instanceId)
        return
      }
      failures += 1
      input.onAuthorityChange('grace')
      // A small retry burst is followed by normal periodic probes. Per-thread
      // lease deadlines remain authoritative; uncertainty never extends them.
      if (failures === 1 || failures % 3 === 0) {
        log(`[kun] manager heartbeat delayed ${JSON.stringify({
          ...identity(), failures, retryMs: retryDelay(failures, intervalMs), ...failureFields(error)
        })}`)
      }
      if (failures >= 3 && !input.manager.discovery.appOwner && input.recoverUnownedManager) {
        try {
          await input.recoverUnownedManager(abort.signal)
        } catch (recoveryError) {
          if (stopped) return
          if (recoveryError instanceof ManagerRuntimeSlotBusyError) {
            loseOwnership('runtime_slot_busy', recoveryError.owner.instanceId)
            return
          }
          if (failures % 3 === 0) {
            log(`[kun] manager recovery delayed ${JSON.stringify({ ...identity(), ...failureFields(recoveryError) })}`)
          }
        }
      }
    } finally {
      // Schedule only after the request/recovery settles: slow requests cannot
      // overlap, and stop() fences every late response before it changes state.
      schedule(failures ? retryDelay(failures, intervalMs) : intervalMs)
    }
  }
  schedule(intervalMs)
  return {
    stop() {
      if (stopped) return
      stopped = true
      if (timer) clearTimeout(timer)
      abort.abort()
    }
  }
}

function retryDelay(failures: number, intervalMs: number): number {
  return failures <= 3 ? Math.min(500 * (2 ** (failures - 1)), intervalMs) : intervalMs
}

function failureFields(error: unknown): { failure: string; status?: number } {
  // Do not print transport messages, response bodies, or connection objects:
  // they can contain authentication headers, tokens, or private request data.
  if (error instanceof ServiceManagerTransportError) return { failure: error.kind }
  if (error instanceof ServiceManagerHttpError) return { failure: 'http_error', status: error.status }
  if (error instanceof Error && error.name === 'TimeoutError') return { failure: 'timeout' }
  return { failure: 'request_failed' }
}
