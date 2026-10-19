import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSessionOwner } from '../contracts/app-session-owner.js'
import { stopOwnedProcess } from '../process/owned-process.js'
import { requireRuntimeProcessIdentity } from '../server/runtime-process-identity.js'
import { acquireAppSessionReservation, type AppSessionReservation } from './app-session-reservation.js'
import { KUN_MANAGER_PROTOCOL_VERSION, removeManagerDiscovery, type ManagerDiscoveryRecord } from './manager-discovery.js'
import { launchServiceManagerProcess } from './manager-launch.js'
import { inspectServiceManager } from './manager-resolution.js'
import {
  createOwnedServiceManagerSession,
  ownedServiceManagerProcesses,
  type OwnedServiceManagerSession
} from './owned-service-manager-session.js'

vi.mock('../process/owned-process.js', () => ({ stopOwnedProcess: vi.fn() }))
vi.mock('../server/runtime-process-identity.js', () => ({ requireRuntimeProcessIdentity: vi.fn() }))
vi.mock('./app-session-reservation.js', () => ({
  acquireAppSessionReservation: vi.fn(),
  canonicalSessionPath: async (path: string) => path,
  AppSessionConflictError: class extends Error {}
}))
vi.mock('./manager-discovery.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./manager-discovery.js')>(),
  defaultKunControlDir: () => '/profile/control',
  defaultProductionSettingsPath: () => '/profile/settings.json',
  removeManagerDiscovery: vi.fn(),
  withManagerStartLock: async (_path: string, run: () => Promise<unknown>) => run()
}))
vi.mock('./manager-launch.js', () => ({ launchServiceManagerProcess: vi.fn() }))
vi.mock('./manager-resolution.js', () => ({ inspectServiceManager: vi.fn() }))
vi.mock('./legacy-manager-retire.js', () => ({ retireVerifiablyIdleLegacyManager: vi.fn() }))

const sessions: OwnedServiceManagerSession[] = []
const unblock: Array<() => void> = []
const profile = {
  dataDir: '/profile/data',
  controlDir: '/profile/control',
  settingsPath: '/profile/settings.json'
}
const logPath = `${profile.controlDir}/manager.log`

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail })
  unblock.push(resolve)
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireRuntimeProcessIdentity).mockReturnValue('verified-owner-identity')
  vi.mocked(stopOwnedProcess).mockImplementation(async (child) => {
    Object.assign(child, { connected: false, exitCode: 0 })
  })
})

afterEach(async () => {
  for (const resolve of unblock.splice(0)) resolve()
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  expect(ownedServiceManagerProcesses()).toEqual([])
})

function fixture() {
  const recording = deferred()
  const registration = deferred()
  const inspecting = deferred()
  const started = deferred()
  const send = vi.fn((message: { type: string }) => {
    if (message.type === 'kun-manager-start') started.resolve()
    if (message.type === 'kun-manager-stop') {
      Object.assign(child, { connected: false, exitCode: 0 })
    }
    return true
  })
  const child = Object.assign(new EventEmitter(), {
    pid: 42042, connected: true, exitCode: null, signalCode: null, send
  }) as unknown as ChildProcess
  const recordProcess = vi.fn(async () => {
    recording.resolve()
    await registration.promise
  })
  const release = vi.fn(async () => undefined)
  const reservation: AppSessionReservation = {
    path: `${profile.dataDir}/.app-session`, profile, recordProcess, release
  }
  let owner: AppSessionOwner
  vi.mocked(acquireAppSessionReservation).mockResolvedValue(reservation)
  vi.mocked(launchServiceManagerProcess).mockImplementation(async (input) => {
    owner = input.appOwner!
    return { child, logPath }
  })
  vi.mocked(inspectServiceManager).mockResolvedValueOnce({ state: 'missing' })
    .mockImplementation(async () => {
      inspecting.resolve()
      await started.promise
      const discovery: ManagerDiscoveryRecord = {
        version: 1, protocolVersion: KUN_MANAGER_PROTOCOL_VERSION, instanceId: 'verified-manager-instance',
        pid: child.pid!, startedAt: '2026-10-19T00:00:00.000Z',
        host: '127.0.0.1', port: 18899, serviceVersion: 'test',
        baseUrl: 'http://127.0.0.1:18899', managerToken: 'test-token',
        appOwner: owner, ...profile
      }
      return { state: 'ready', discovery, health: {
        ...discovery, status: 'ok', service: 'kun-service-manager',
        serviceVersion: 'test', capabilities: []
      } }
    })
  const session = createOwnedServiceManagerSession({ ownerKind: 'gui', ownerSessionId: 'admission-test' })
  sessions.push(session)
  return {
    session, child, send, recording, registration, inspecting, recordProcess, release,
    ensure: () => session.ensure({ ...profile, flavor: 'production', timeoutMs: 1_000 }),
    ready: (override: Partial<AppSessionOwner> = {}) => child.emit('message', {
      type: 'kun-manager-owner-ready', owner: { ...owner, ...override }
    })
  }
}

describe('owned Service Manager identity admission', () => {
  it('never grants startup after failed registration and cleans up only the exact launched child', async () => {
    const f = fixture()
    const failure = f.ensure().catch((error: unknown) => error)
    await f.recording.promise
    f.ready()
    expect(f.send).not.toHaveBeenCalled()
    expect(ownedServiceManagerProcesses()).toEqual([f.child])
    const cause = new Error('Cannot verify process identity for PID 42042: process identity query timed out')
    f.registration.reject(cause)
    const error = await failure
    expect(error).toBeInstanceOf(Error)
    expect(error).toBe(cause)
    expect(error).toHaveProperty('message', `Cannot verify process identity for PID 42042: process identity query timed out; inspect ${logPath}`)
    expect(f.recordProcess).toHaveBeenCalledExactlyOnceWith({ pid: f.child.pid, instanceId: 'manager-1' })
    expect(stopOwnedProcess).toHaveBeenCalledExactlyOnceWith(f.child, { graceMs: 0, timeoutMs: 2_000 })
    expect(removeManagerDiscovery).not.toHaveBeenCalled()
    expect(f.session.current()).toBeUndefined()
    expect(ownedServiceManagerProcesses()).toEqual([])
    f.ready()
    expect(f.send).not.toHaveBeenCalled()
    await f.session.close()
    expect(f.release).toHaveBeenCalledOnce()
    expect(stopOwnedProcess).toHaveBeenCalledTimes(1)
  })

  it('preserves a reservation conflict error and its classification after cleanup', async () => {
    const f = fixture()
    const failure = f.ensure().catch((error: unknown) => error)
    await f.recording.promise
    class ReservationConflict extends Error {
      readonly code = 'app_session_owner_busy'
    }
    const conflict = new ReservationConflict('Application reservation changed')
    f.registration.reject(conflict)
    const error = await failure
    expect(error).toBe(conflict)
    expect(error).toBeInstanceOf(ReservationConflict)
    expect(error).toHaveProperty('code', 'app_session_owner_busy')
    expect(error).toHaveProperty('message', `Application reservation changed; inspect ${logPath}`)
    expect(stopOwnedProcess).toHaveBeenCalledExactlyOnceWith(f.child, { graceMs: 0, timeoutMs: 2_000 })
    expect(f.send).not.toHaveBeenCalled()
  })

  it('waits for completed registration when the matching child reports owner-ready first', async () => {
    const f = fixture()
    const startup = f.ensure()
    await f.recording.promise
    f.ready()
    expect(f.send).not.toHaveBeenCalled()
    f.registration.resolve()
    const connection = await startup
    expect(f.send).toHaveBeenCalledExactlyOnceWith({
      type: 'kun-manager-start', owner: connection.discovery.appOwner
    }, expect.any(Function))
    expect(f.session.current()).toMatchObject({ child: f.child, connection, generation: 1 })
    expect(stopOwnedProcess).not.toHaveBeenCalled()
  })

  it('waits for the matching owner-ready message when registration completes first', async () => {
    const f = fixture()
    const startup = f.ensure()
    await f.recording.promise
    f.registration.resolve()
    await f.inspecting.promise
    expect(f.send).not.toHaveBeenCalled()
    f.ready({ generation: 99 })
    expect(f.send).not.toHaveBeenCalled()
    f.ready()
    const connection = await startup
    expect(f.send).toHaveBeenCalledExactlyOnceWith({
      type: 'kun-manager-start', owner: connection.discovery.appOwner
    }, expect.any(Function))
  })

  it('cancels pending registration without granting startup or releasing before exact-child cleanup', async () => {
    const f = fixture()
    const failure = f.ensure().catch((error: unknown) => error)
    await f.recording.promise
    f.ready()
    const closing = f.session.close()
    expect(f.release).not.toHaveBeenCalled()
    f.registration.resolve()
    const error = await failure
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('Application service session closed')
    expect((error as Error).message).toContain(logPath)
    await closing
    f.ready()
    expect(f.send).not.toHaveBeenCalled()
    expect(stopOwnedProcess).toHaveBeenCalledExactlyOnceWith(f.child, { graceMs: 0, timeoutMs: 2_000 })
    expect(f.release).toHaveBeenCalledOnce()
    expect(stopOwnedProcess).toHaveBeenCalledBefore(f.release)
    expect(f.session.current()).toBeUndefined()
    await expect(f.ensure()).rejects.toThrow('session is stopping')
  })

  it('fails closed before reserving or launching if the application owner identity cannot be verified', () => {
    const cause = new Error('Cannot verify application owner process identity: query timed out')
    vi.mocked(requireRuntimeProcessIdentity).mockImplementation(() => { throw cause })
    expect(() => createOwnedServiceManagerSession({ ownerKind: 'gui' })).toThrow(cause)
    expect(acquireAppSessionReservation).not.toHaveBeenCalled()
    expect(launchServiceManagerProcess).not.toHaveBeenCalled()
    expect(stopOwnedProcess).not.toHaveBeenCalled()
  })
})
