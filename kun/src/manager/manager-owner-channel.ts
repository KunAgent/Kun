import { sameAppSessionOwner, type AppSessionOwner } from '../contracts/app-session-owner.js'
import type { ServiceManagerHandle } from './service-manager-state.js'
import { runtimeProcessIsAlive } from '../server/runtime-process-identity.js'

export function monitorManagerOwner(owner: AppSessionOwner): {
  startGranted: Promise<boolean>
  disconnected: Promise<void>
  stopRequested: Promise<void>
  dispose(): void
} {
  if (!process.connected || !process.send) throw new Error('Owned Manager requires its live parent IPC channel')
  let grant!: (value: boolean) => void
  let disconnect!: () => void
  let stop!: () => void
  const startGranted = new Promise<boolean>((resolve) => { grant = resolve })
  const disconnected = new Promise<void>((resolve) => { disconnect = resolve })
  const stopRequested = new Promise<void>((resolve) => { stop = resolve })
  const onDisconnect = () => { grant(false); disconnect() }
  const onMessage = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const message = value as { type?: string; owner?: AppSessionOwner }
    if (!sameAppSessionOwner(message.owner, owner)) return
    if (message.type === 'kun-manager-start') grant(true)
    if (message.type === 'kun-manager-stop') { grant(false); stop() }
  }
  process.once('disconnect', onDisconnect)
  process.on('message', onMessage)
  process.send({ type: 'kun-manager-owner-ready', owner }, () => undefined)
  return {
    startGranted, disconnected, stopRequested,
    dispose: () => {
      process.removeListener('disconnect', onDisconnect)
      process.removeListener('message', onMessage)
    }
  }
}

/** Keep the data writer open while orphaned Runtime processes finish their final writes.
 * An independent process guard terminates stuck consumers before its later Manager deadline. */
export async function drainManagerAfterOwnerLoss(handle: ServiceManagerHandle): Promise<void> {
  handle.beginDrain()
  const runtimes = handle.state.snapshot().map(({ registration }) => registration)
  await Promise.allSettled(runtimes.map(async (runtime) => {
    if (!runtimeProcessIsAlive(runtime.pid, runtime)) return
    if (!handle.discovery.appOwner || !sameAppSessionOwner(runtime.appOwner, handle.discovery.appOwner)) return
    await fetch(`${runtime.baseUrl}/v1/runtime/shutdown`, {
      method: 'POST', headers: { authorization: `Bearer ${runtime.runtimeToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: runtime.instanceId }), signal: AbortSignal.timeout(1_000)
    })
  }))
  const deadline = Date.now() + 22_000
  while (runtimes.some((runtime) => runtimeProcessIsAlive(runtime.pid, runtime))) {
    if (Date.now() >= deadline) {
      // Do not release the writer ahead of an execution process that the OS
      // refused to terminate. The independent guard is the final crash fallback.
      throw new Error('Owned Runtime remained alive during Manager owner-loss cleanup')
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
