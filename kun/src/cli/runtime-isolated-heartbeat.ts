import { Worker } from 'node:worker_threads'
import type { ThreadLeaseAuthorityState } from '../ports/thread-execution-lease.js'
import {
  startRuntimeManagerHeartbeat,
  type ManagerOwnershipLostReason,
  type RuntimeManagerHeartbeat,
  type RuntimeManagerHeartbeatOptions
} from './runtime-manager-heartbeat.js'
import type { HeartbeatWorkerInput } from './runtime-heartbeat-worker.js'

export const RUNTIME_MAIN_PROGRESS_TIMEOUT_MS = 30_000
const MAIN_PROGRESS_INTERVAL_MS = 1_000

type WorkerMessage =
  | { kind: 'ready' }
  | { kind: 'authority'; state: ThreadLeaseAuthorityState }
  | { kind: 'lost'; reason: ManagerOwnershipLostReason }
  | { kind: 'log'; line: string }

/**
 * Keep the application-owned Manager slot alive during bounded Runtime stalls.
 * No worker can elect/register a Manager, acquire a lease, or extend a thread
 * deadline. Loss of main-loop progress eventually stops all heartbeats.
 */
export async function startIsolatedRuntimeManagerHeartbeat(
  input: RuntimeManagerHeartbeatOptions,
  options: { progressTimeoutMs?: number; progressIntervalMs?: number; workerUrl?: URL } = {}
): Promise<RuntimeManagerHeartbeat> {
  // Legacy independent hosts retain owner-controlled discovery/recovery.
  if (!input.manager.discovery.appOwner) return startRuntimeManagerHeartbeat(input)
  const log = input.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  const workerData: HeartbeatWorkerInput = {
    manager: input.manager,
    registration: input.registration,
    intervalMs: input.intervalMs,
    progressTimeoutMs: options.progressTimeoutMs ?? RUNTIME_MAIN_PROGRESS_TIMEOUT_MS
  }
  const worker = new Worker(options.workerUrl ?? new URL('./runtime-heartbeat-worker.js', import.meta.url), { workerData })
  let stopped = false
  let ready = false
  let fallback: RuntimeManagerHeartbeat | undefined
  let pulse: ReturnType<typeof setInterval> | undefined
  let stopping: Promise<void> | undefined
  let startupTimer: ReturnType<typeof setTimeout>
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const started = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const fail = (): void => {
    if (stopped || fallback) return
    if (pulse) clearInterval(pulse)
    if (!ready) {
      rejectReady(new Error('Runtime heartbeat worker could not start'))
      return
    }
    input.onAuthorityChange('grace')
    log('[kun] isolated Manager heartbeat unavailable; using bounded main-loop recovery')
    fallback = startRuntimeManagerHeartbeat(input)
  }
  worker.on('message', (message: WorkerMessage) => {
    if (stopped || fallback) return
    switch (message.kind) {
      case 'ready':
        ready = true
        clearTimeout(startupTimer)
        pulse = setInterval(() => worker.postMessage({ kind: 'progress' }),
          options.progressIntervalMs ?? MAIN_PROGRESS_INTERVAL_MS)
        pulse.unref()
        worker.unref()
        resolveReady()
        break
      case 'authority': input.onAuthorityChange(message.state); break
      case 'lost': input.onOwnershipLost(message.reason); break
      case 'log': log(message.line); break
    }
  })
  worker.on('error', fail)
  worker.on('exit', fail)
  startupTimer = setTimeout(fail, 10_000)
  try {
    await started
  } catch (error) {
    stopped = true
    clearTimeout(startupTimer)
    await worker.terminate()
    throw error
  }
  return {
    stop() {
      if (stopping) return stopping
      stopped = true
      if (pulse) clearInterval(pulse)
      worker.postMessage({ kind: 'stop' })
      stopping = Promise.all([fallback?.stop(), worker.terminate()]).then(() => undefined)
      return stopping
    }
  }
}
