import { sameAppSessionOwner, type AppSessionOwner } from '../contracts/app-session-owner.js'
import type { RuntimeRegistration } from '../contracts/runtime-flavor.js'
import { runtimeProcessIsAlive } from '../server/runtime-process-identity.js'

export type ManagerOwnerLossHandle = {
  beginDrain(): void
  close(): Promise<void>
  discovery: { appOwner?: AppSessionOwner }
  state: { snapshot(): Array<{ registration: RuntimeRegistration }> }
}

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

export function ownedManagerRuntimes(handle: Pick<ManagerOwnerLossHandle, 'discovery' | 'state'>): RuntimeRegistration[] {
  const owner = handle.discovery.appOwner
  if (!owner) return []
  return handle.state.snapshot()
    .map(({ registration }) => registration)
    .filter((runtime) => sameAppSessionOwner(runtime.appOwner, owner))
}

/** Keep the data writer open while orphaned Runtime processes finish their final writes.
 * An independent process guard terminates stuck consumers before its later Manager deadline. */
export async function drainManagerAfterOwnerLoss(
  handle: Pick<ManagerOwnerLossHandle, 'beginDrain' | 'discovery' | 'state'>,
  options: { deadlineMs?: number; fetchImpl?: typeof fetch; wait?: 'owned' | 'all' } = {}
): Promise<void> {
  handle.beginDrain()
  const owned = ownedManagerRuntimes(handle)
  const waiting = options.wait === 'all'
    ? handle.state.snapshot().map(({ registration }) => registration)
    : owned
  const fetchImpl = options.fetchImpl ?? fetch
  await Promise.allSettled(owned.map(async (runtime) => {
    if (!runtimeProcessIsAlive(runtime.pid, runtime)) return
    await fetchImpl(`${runtime.baseUrl}/v1/runtime/shutdown`, {
      method: 'POST', headers: { authorization: `Bearer ${runtime.runtimeToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: runtime.instanceId }), signal: AbortSignal.timeout(1_000)
    })
  }))
  const deadline = Date.now() + (options.deadlineMs ?? 22_000)
  while (waiting.some((runtime) => runtimeProcessIsAlive(runtime.pid, runtime))) {
    if (Date.now() >= deadline) {
      throw new Error('Owned Runtime remained alive during Manager owner-loss cleanup')
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Owner-loss must unpublish even when drain times out, so the next desktop is not blocked. */
export async function stopManagerAfterOwnerLoss(
  handle: ManagerOwnerLossHandle,
  options: { deadlineMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<void> {
  try {
    await drainManagerAfterOwnerLoss(handle, options)
  } catch (error) {
    process.stderr.write(`kun Manager cleanup failed: ${String(error)}\n`)
  }
  await handle.close()
}
