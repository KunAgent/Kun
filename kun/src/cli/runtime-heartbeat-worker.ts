import { parentPort, workerData } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { heartbeatRuntimeWithManager } from '../manager/manager-runtime-heartbeat-request.js'
import { ServiceManagerTransportError } from '../manager/usage-errors.js'
import { startRuntimeManagerHeartbeat, type RuntimeManagerHeartbeatOptions } from './runtime-manager-heartbeat.js'

export type HeartbeatWorkerInput = Pick<RuntimeManagerHeartbeatOptions, 'manager' | 'registration' | 'intervalMs'> & {
  progressTimeoutMs: number
}

const port = parentPort!
const input = workerData as HeartbeatWorkerInput
let lastProgressAt = performance.now()
let authority: string | undefined
let progressWarningSent = false
const heartbeat = startRuntimeManagerHeartbeat({
  ...input,
  heartbeat: (request) => {
    // A busy main loop gets a bounded window, not an immortal registration.
    // Thread leases still expire independently and retain their fencing tokens.
    if (performance.now() - lastProgressAt > input.progressTimeoutMs) {
      throw new ServiceManagerTransportError('timeout', 'Runtime main loop progress deadline exceeded')
    }
    return heartbeatRuntimeWithManager(request)
  },
  onAuthorityChange: (state) => {
    if (state === authority) return
    authority = state
    port.postMessage({ kind: 'authority', state })
  },
  onOwnershipLost: (reason) => port.postMessage({ kind: 'lost', reason }),
  log: (line) => {
    if (performance.now() - lastProgressAt > input.progressTimeoutMs) {
      if (progressWarningSent) return
      progressWarningSent = true
      line = '[kun] main-loop progress deadline exceeded; isolated Manager heartbeat is parked'
    }
    port.postMessage({ kind: 'log', line })
  }
})
port.on('message', (message: { kind: string }) => {
  if (message.kind === 'progress') {
    lastProgressAt = performance.now()
    progressWarningSent = false
  }
  if (message.kind === 'stop') {
    void heartbeat.stop()
    port.close()
  }
})
port.postMessage({ kind: 'ready' })
