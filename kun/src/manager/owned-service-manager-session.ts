import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { AppSessionOwnerSchema, sameAppSessionOwner, type AppSessionOwner, type AppSessionOwnerKind } from '../contracts/app-session-owner.js'
import { runtimeProcessIdentity } from '../server/runtime-process-identity.js'
import { stopOwnedProcess } from '../process/owned-process.js'
import { acquireAppSessionReservation, AppSessionConflictError, canonicalSessionPath, type AppSessionReservation } from './app-session-reservation.js'
import { defaultKunControlDir, defaultProductionSettingsPath, removeManagerDiscovery, withManagerStartLock } from './manager-discovery.js'
import { inspectServiceManager } from './manager-resolution.js'
import { launchServiceManagerProcess } from './manager-launch.js'
import { retireVerifiablyIdleLegacyManager } from './legacy-manager-retire.js'
import type { EnsureServiceManagerInput, ServiceManagerConnection } from './manager-client.js'

export type OwnedServiceManagerHandle = {
  child: ChildProcess
  connection: ServiceManagerConnection
  generation: number
  owner: AppSessionOwner
}
export type OwnedServiceManagerSession = {
  readonly ownerSessionId: string
  ensure(input: EnsureServiceManagerInput): Promise<ServiceManagerConnection>
  stop(options?: { deadline?: number }): Promise<void>
  close(options?: { deadline?: number }): Promise<void>
  current(): OwnedServiceManagerHandle | undefined
}
const managerChildren = new Set<ChildProcess>()
export function ownedServiceManagerProcesses(): ChildProcess[] { return [...managerChildren] }

export function createOwnedServiceManagerSession(input: {
  ownerKind: AppSessionOwnerKind
  ownerSessionId?: string
}): OwnedServiceManagerSession {
  const ownerSessionId = input.ownerSessionId ?? randomUUID()
  const identity = runtimeProcessIdentity()
  if (!identity) throw new Error('Cannot establish application process identity')
  const ownerBase = {
    ownerSessionId, ownerKind: input.ownerKind, ownerPid: process.pid,
    ownerStartedAt: new Date().toISOString(), ownerProcessIdentity: identity
  }
  let reservation: AppSessionReservation | undefined
  let current: OwnedServiceManagerHandle | undefined
  let candidate: ChildProcess | undefined
  let generation = 0
  let closed = false
  let cancel = new AbortController()
  let startup: Promise<ServiceManagerConnection> | undefined
  let stopping: Promise<void> | undefined
  let closing: Promise<void> | undefined

  const stop = (options: { deadline?: number } = {}): Promise<void> => {
    cancel.abort(new Error('Application service startup was cancelled'))
    if (stopping) return stopping
    const deadline = options.deadline ?? Date.now() + 10_000
    stopping = (async () => {
      // Cancelling readiness is synchronous. The startup catch joins exact child cleanup.
      await startup?.catch(() => undefined)
      const child = current?.child ?? candidate
      if (!child) return
      const handle = current
      if (child.connected && handle) {
        child.send({ type: 'kun-manager-stop', owner: handle.owner }, () => undefined)
        await waitForExit(child, Math.min(deadline - 1_000, Date.now() + 5_000))
      }
      await stopOwnedProcess(child, { graceMs: 0, timeoutMs: Math.max(1, deadline - Date.now()) })
      managerChildren.delete(child)
      if (handle) await removeManagerDiscovery(reservation!.profile.controlDir,
        handle.connection.discovery.instanceId, handle.connection.discovery)
      current = undefined
      candidate = undefined
    })().finally(() => { stopping = undefined })
    return stopping
  }

  const ensure = (request: EnsureServiceManagerInput): Promise<ServiceManagerConnection> => {
    if (closed || stopping) return Promise.reject(new Error('Application service session is stopping'))
    if (startup) return startup
    cancel = new AbortController()
    const signal = cancel.signal
    startup = (async () => {
      const profile = {
        dataDir: await canonicalSessionPath(request.dataDir),
        controlDir: await canonicalSessionPath(request.controlDir ?? defaultKunControlDir()),
        settingsPath: await canonicalSessionPath(request.settingsPath ?? defaultProductionSettingsPath())
      }
      if (reservation && Object.entries(profile).some(([key, value]) =>
        reservation!.profile[key as keyof typeof profile] !== value)) {
        throw new Error('Application session profile changed; close the existing session before relocation')
      }
      signal.throwIfAborted()
      if (current && childAlive(current.child)) return current.connection
      if (current) {
        await stopOwnedProcess(current.child, { graceMs: 0, timeoutMs: 2_000 })
        managerChildren.delete(current.child)
      }
      current = undefined
      const owner = AppSessionOwnerSchema.parse({ ...ownerBase, generation: ++generation })
      reservation ??= await acquireAppSessionReservation({ ...profile, owner, signal })
      signal.throwIfAborted()
      return withManagerStartLock(profile.controlDir, async () => {
        signal.throwIfAborted()
        const fetchImpl: typeof fetch = (url, init) => (request.fetch ?? fetch)(url, {
          ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal
        })
        const existing = await inspectServiceManager(profile.controlDir, fetchImpl)
        signal.throwIfAborted()
        if (existing.state === 'unavailable') {
          if (existing.error.kind !== 'protocol_incompatible' && existing.error.kind !== 'capability_incompatible') {
            throw existing.error
          }
          // Managers from incompatible builds lack the atomic retire-idle
          // endpoint; the same verified idle shutdown the CLI performs can
          // still drain them safely before this session launches its own.
          try {
            await retireVerifiablyIdleLegacyManager({
              controlDir: profile.controlDir, dataDir: profile.dataDir,
              settingsPath: profile.settingsPath, fetch: fetchImpl, signal
            })
          } catch (error) {
            signal.throwIfAborted()
            const reason = error instanceof Error ? error.message : String(error)
            existing.error.message += ` Automatic takeover was not safe (${reason}).` +
              ' Close its clients, then explicitly run `kun manager retire --data-dir <this-data-directory>`' +
              ' with the same KUN_MANAGER_CONTROL_DIR and KUN_MANAGER_SETTINGS_PATH.'
            throw existing.error
          }
        }
        if (existing.state === 'ready') {
          if (await canonicalSessionPath(existing.discovery.dataDir) !== profile.dataDir ||
            await canonicalSessionPath(existing.discovery.settingsPath) !== profile.settingsPath) {
            throw new AppSessionConflictError(profile.controlDir, 'Manager owns a different data or settings profile')
          }
          if (existing.discovery.appOwner) throw new AppSessionConflictError(profile.dataDir)
          await retireIdleLegacyManager(existing.discovery, fetchImpl, signal)
        }
        signal.throwIfAborted()
        const launched = await launchServiceManagerProcess({
          ...profile, appOwner: owner, reservationPath: reservation!.path,
          ...(request.buildId ? { buildId: request.buildId } : {}),
          ...(request.launch ? { launch: request.launch } : {})
        })
        const child = launched.child
        managerChildren.add(child)
        candidate = child
        let spawnError: Error | undefined
        child.on('error', (error) => { spawnError = error })
        let recorded = false
        let ownerReady = false
        const grantStartup = () => {
          if (recorded && ownerReady && !signal.aborted && child.connected) {
            child.send({ type: 'kun-manager-start', owner }, () => undefined)
          }
        }
        child.on('message', (value: unknown) => {
          if (!value || typeof value !== 'object') return
          const message = value as { type?: string; owner?: AppSessionOwner }
          if (message.type !== 'kun-manager-owner-ready' || !sameAppSessionOwner(message.owner, owner)) return
          ownerReady = true
          grantStartup()
        })
        try {
          signal.throwIfAborted()
          if (!child.pid) throw spawnError ?? new Error('Manager process did not start')
          await reservation!.recordProcess({ pid: child.pid, instanceId: `manager-${generation}` })
          signal.throwIfAborted()
          recorded = true
          grantStartup()
          const deadline = Date.now() + (request.timeoutMs ?? 30_000)
          while (Date.now() < deadline) {
            signal.throwIfAborted()
            if (spawnError || !childAlive(child)) throw spawnError ?? new Error('Owned Manager exited before readiness')
            const observed = await inspectServiceManager(profile.controlDir, fetchImpl, { deadline: Math.min(deadline, Date.now() + 500) })
            signal.throwIfAborted()
            if (observed.state === 'ready') {
              if (observed.discovery.pid !== child.pid || !sameAppSessionOwner(observed.discovery.appOwner, owner)) {
                throw new Error('Owned Manager readiness identity mismatch')
              }
              current = { child, connection: { discovery: observed.discovery }, generation, owner }
              candidate = undefined
              return current.connection
            }
            await abortableDelay(25, signal)
          }
          throw new Error(`Owned Manager readiness timed out; inspect ${launched.logPath}`)
        } catch (error) {
          await stopOwnedProcess(child, { graceMs: 0, timeoutMs: 2_000 })
          managerChildren.delete(child)
          candidate = undefined
          throw error
        }
      }, signal)
    })().finally(() => { startup = undefined })
    return startup
  }

  return {
    ownerSessionId, ensure, stop, current: () => current,
    close: (options = {}) => {
      closed = true
      cancel.abort(new Error('Application service session closed'))
      if (closing) return closing
      closing = (async () => {
        await stop(options)
        await reservation?.release()
        reservation = undefined
      })().catch((error) => { closing = undefined; throw error })
      return closing
    }
  }
}

function childAlive(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null
}
async function waitForExit(child: ChildProcess, deadline: number): Promise<void> {
  while (childAlive(child) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
}
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, ms)
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

async function retireIdleLegacyManager(
  discovery: ServiceManagerConnection['discovery'], fetchImpl: typeof fetch, signal: AbortSignal
): Promise<void> {
  const response = await fetchImpl(`${discovery.baseUrl}/v1/manager/retire-idle`, {
    method: 'POST', headers: { authorization: `Bearer ${discovery.managerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: discovery.instanceId }), signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)])
  })
  if (!response.ok) throw new AppSessionConflictError(discovery.dataDir,
    'the legacy service has a live owner or cannot atomically prove it is idle; close its clients, then explicitly run `kun manager retire --data-dir <this-data-directory>` with the same KUN_MANAGER_CONTROL_DIR and KUN_MANAGER_SETTINGS_PATH')
  const deadline = Date.now() + 5_000
  const { runtimeProcessIsAlive } = await import('../server/runtime-process-identity.js')
  while (runtimeProcessIsAlive(discovery.pid, { startedAt: discovery.startedAt }) && Date.now() < deadline) {
    await abortableDelay(25, signal)
  }
  if (runtimeProcessIsAlive(discovery.pid, { startedAt: discovery.startedAt })) {
    throw new AppSessionConflictError(discovery.dataDir, 'legacy Manager did not exit')
  }
}
