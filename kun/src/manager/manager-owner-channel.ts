import { sameAppSessionOwner, type AppSessionOwner } from '../contracts/app-session-owner.js'
import type { RuntimeRegistration } from '../contracts/runtime-flavor.js'
import { runtimeProcessIsAlive } from '../server/runtime-process-identity.js'

export type ManagerOwnerLossHandle = {
  beginDrain(): void
  close(): Promise<void>
  discovery: { appOwner?: AppSessionOwner }
  state: { snapshot(): Array<{ registration: RuntimeRegistration }> }
}

export function monitorManagerOwner(owner: AppSessionOwner, options: {
  channel?: Pick<NodeJS.Process, 'connected' | 'send' | 'once' | 'on' | 'removeListener'>
  exit?: (code: number) => void
  deadlineMs?: number
} = {}): {
  startGranted: Promise<boolean>
  disconnected: Promise<void>
  stopRequested: Promise<void>
  dispose(): void
} {
  const channel = options.channel ?? process
  if (!channel.connected || !channel.send) throw new Error('Owned Manager requires its live parent IPC channel')
  let grant!: (value: boolean) => void
  let disconnect!: () => void
  let stop!: () => void
  const startGranted = new Promise<boolean>((resolve) => { grant = resolve })
  const disconnected = new Promise<void>((resolve) => { disconnect = resolve })
  const stopRequested = new Promise<void>((resolve) => { stop = resolve })
  let cancelDeadline: (() => void) | undefined
  const onDisconnect = () => {
    // Arm at IPC loss, even before startup finishes or while an earlier
    // graceful stop is stuck. The stop handler's single-flight guard must
    // never suppress the final owner-loss exit deadline.
    cancelDeadline ??= armOwnerLossExitDeadline(options.exit ?? ((code) => process.exit(code)), options)
    grant(false)
    disconnect()
  }
  const onMessage = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const message = value as { type?: string; owner?: AppSessionOwner }
    if (!sameAppSessionOwner(message.owner, owner)) return
    if (message.type === 'kun-manager-start') grant(true)
    if (message.type === 'kun-manager-stop') { grant(false); stop() }
  }
  channel.once('disconnect', onDisconnect)
  channel.on('message', onMessage)
  channel.send({ type: 'kun-manager-owner-ready', owner }, () => undefined)
  return {
    startGranted, disconnected, stopRequested,
    dispose: () => {
      cancelDeadline?.()
      channel.removeListener('disconnect', onDisconnect)
      channel.removeListener('message', onMessage)
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

/** Drain (22s) plus close; past this the orphaned Manager exits regardless. */
export const OWNER_LOSS_EXIT_DEADLINE_MS = 45_000

/**
 * Once the owner is gone, nothing else will stop this Manager, and while it
 * lives its reservation participant blocks every later client of the profile.
 * Bound the whole owner-loss cleanup, including close(), by a hard exit.
 */
export function armOwnerLossExitDeadline(
  exit: (code: number) => void,
  options: { deadlineMs?: number; log?: (line: string) => void } = {}
): () => void {
  const deadlineMs = options.deadlineMs ?? OWNER_LOSS_EXIT_DEADLINE_MS
  const timer = setTimeout(() => {
    const log = options.log ?? ((line: string) => { process.stderr.write(line) })
    log(`kun Manager owner-loss cleanup did not finish within ${deadlineMs}ms; exiting\n`)
    exit(75)
  }, deadlineMs)
  timer.unref?.()
  return () => clearTimeout(timer)
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
