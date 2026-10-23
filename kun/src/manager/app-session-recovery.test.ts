import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireAppSessionReservation } from './app-session-reservation.js'
import { retireOrphanedAppSessionManager } from './app-session-recovery.js'
import { publishManagerDiscovery, readManagerHandoffDiscoveryStrict } from './manager-discovery.js'
import * as identity from '../server/runtime-process-identity.js'

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function childProcess(ignoreTerm = false): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', `
    process.on('SIGTERM', () => ${ignoreTerm ? '{}' : 'process.exit(0)'});
    setInterval(() => {}, 1000);
    process.send('ready');
  `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  children.push(child)
  await once(child, 'message')
  return child
}

async function fixture(options: { liveOwner?: boolean; ignoreTerm?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kun-orphan-recovery-'))
  roots.push(root)
  const profile = { dataDir: join(root, 'data'), controlDir: join(root, 'control'), settingsPath: join(root, 'settings.json') }
  const owner = {
    ownerSessionId: randomUUID(), ownerKind: 'gui' as const,
    ownerPid: options.liveOwner ? process.pid : 4_000_000,
    ownerStartedAt: new Date().toISOString(),
    ownerProcessIdentity: options.liveOwner ? identity.requireRuntimeProcessIdentity() : 'exited-owner',
    generation: 1
  }
  const reservation = await acquireAppSessionReservation({ ...profile, owner })
  const child = await childProcess(options.ignoreTerm)
  await reservation.recordProcess({ pid: child.pid!, instanceId: 'manager-1' })
  const manager = await publishManagerDiscovery(profile.controlDir, {
    instanceId: randomUUID(), pid: child.pid!, startedAt: new Date().toISOString(),
    host: '127.0.0.1', port: 19999, baseUrl: 'http://127.0.0.1:19999', managerToken: 'fixture-only',
    serviceVersion: '0.4.1', dataDir: profile.dataDir, settingsPath: profile.settingsPath, appOwner: owner
  })
  await writeFile(join(profile.dataDir, 'history.json'), 'saved conversations')
  await writeFile(profile.settingsPath, 'saved settings')
  const claims = [join(profile.dataDir, '.app-session'), join(profile.controlDir, '.app-session'), `${profile.settingsPath}.kun-app-session`]
  const recover = () => retireOrphanedAppSessionManager({ ...profile, graceMs: 50, exitTimeoutMs: 1_000 })
  return { profile, owner, child, reservation, manager, claims, recover }
}

describe('orphaned application Manager recovery', () => {
  it('terminates an unresponsive recorded orphan and permits a new owner without changing saved data', async () => {
    const f = await fixture({ ignoreTerm: true })
    await f.recover()
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(false)
    expect(f.child.signalCode).toBe('SIGKILL')
    expect(await readManagerHandoffDiscoveryStrict(f.profile.controlDir)).toBeNull()
    expect(await readFile(join(f.profile.dataDir, 'history.json'), 'utf8')).toBe('saved conversations')
    expect(await readFile(f.profile.settingsPath, 'utf8')).toBe('saved settings')
    const next = await acquireAppSessionReservation({ ...f.profile, owner: {
      ...f.owner, ownerSessionId: randomUUID(), ownerPid: process.pid,
      ownerProcessIdentity: identity.requireRuntimeProcessIdentity()
    } })
    await next.release()
  })

  it('allows graceful exit before escalation', async () => {
    const f = await fixture()
    await f.recover()
    expect(f.child.exitCode).toBe(0)
    expect(f.child.signalCode).toBeNull()
  })

  it('refuses to stop a live application owner', async () => {
    const f = await fixture({ liveOwner: true })
    await expect(f.recover()).rejects.toThrow('still running')
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(true)
  })

  it('preserves the Manager while any recorded Runtime is still alive', async () => {
    const f = await fixture()
    const runtime = await childProcess()
    await f.reservation.recordProcess({ pid: runtime.pid!, instanceId: 'runtime-instance' })
    await expect(f.recover()).rejects.toThrow('Runtime processes are still running')
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(true)
    expect(identity.runtimeProcessIsAlive(runtime.pid!)).toBe(true)
  })

  it('refuses mismatched Manager owner evidence', async () => {
    const f = await fixture()
    await publishManagerDiscovery(f.profile.controlDir, {
      ...f.manager, appOwner: { ...f.owner, ownerSessionId: randomUUID() }
    })
    await expect(f.recover()).rejects.toThrow('does not match')
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(true)
  })

  it('refuses a different canonical profile even when it shares the control directory', async () => {
    const f = await fixture()
    await expect(retireOrphanedAppSessionManager({ ...f.profile, dataDir: join(f.profile.dataDir, 'other') }))
      .rejects.toThrow('all profile reservations')
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(true)
  })

  it('does not signal a recycled participant PID', async () => {
    const f = await fixture()
    for (const path of f.claims) {
      const file = join(path, 'process-manager-1.json')
      const participant = JSON.parse(await readFile(file, 'utf8'))
      await writeFile(file, JSON.stringify({ ...participant, processIdentity: 'previous-process-birth' }))
    }
    await f.recover()
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(true)
    expect(await readManagerHandoffDiscoveryStrict(f.profile.controlDir)).not.toBeNull()
  })

  it('requires a positive process identity before signalling despite fail-closed liveness', async () => {
    const f = await fixture()
    vi.spyOn(identity, 'requireRuntimeProcessIdentity').mockImplementation(() => { throw new Error('identity unavailable') })
    await expect(f.recover()).rejects.toThrow('identity unavailable')
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(true)
  })

  it('rechecks reservation identity before escalating a stuck Manager', async () => {
    const f = await fixture({ ignoreTerm: true })
    const kill = process.kill.bind(process)
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === f.child.pid && signal === 'SIGTERM') {
        // Change evidence immediately after the initial signal, before escalation.
        const path = join(f.claims[0]!, 'owner.json')
        writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), token: 'changed' }))
      }
      return kill(pid, signal)
    })
    await expect(retireOrphanedAppSessionManager({ ...f.profile, graceMs: 200 }))
      .rejects.toThrow('Application session changed')
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(true)
  })

  it('does not stop anything after recovery is cancelled', async () => {
    const f = await fixture()
    await expect(retireOrphanedAppSessionManager({ ...f.profile, signal: AbortSignal.abort(new Error('cancelled')) }))
      .rejects.toThrow('cancelled')
    expect(identity.runtimeProcessIsAlive(f.child.pid!)).toBe(true)
  })
})
