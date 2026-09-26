import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppSessionOwner } from '../contracts/app-session-owner.js'
import { runtimeProcessIdentity } from '../server/runtime-process-identity.js'
import { acquireAppSessionReservation, type AppSessionReservation } from './app-session-reservation.js'

const roots: string[] = []
const reservations: AppSessionReservation[] = []
afterEach(async () => {
  await Promise.all(reservations.splice(0).map((reservation) => reservation.release()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
function owner(generation = 1): AppSessionOwner {
  return { ownerSessionId: randomUUID(), ownerKind: 'gui', ownerPid: process.pid,
    ownerStartedAt: new Date().toISOString(), ownerProcessIdentity: runtimeProcessIdentity()!, generation }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-session-profile-'))
  roots.push(root)
  return { root, dataDir: join(root, 'data'), controlDir: join(root, 'control'), settingsPath: join(root, 'settings.json') }
}

describe('application session profile reservation', () => {
  it('excludes a different owner across flavors/control directories while a Manager generation is absent', async () => {
    const profile = await fixture()
    reservations.push(await acquireAppSessionReservation({ ...profile, owner: owner() }))
    await expect(acquireAppSessionReservation({ ...profile, controlDir: join(profile.root, 'other-control'), owner: owner(2) }))
      .rejects.toThrow('already owned')
  })

  it('rejects distinct data directories sharing the settings profile', async () => {
    const profile = await fixture()
    reservations.push(await acquireAppSessionReservation({ ...profile, owner: owner() }))
    await expect(acquireAppSessionReservation({ ...profile, dataDir: join(profile.root, 'other-data'),
      controlDir: join(profile.root, 'other-control'), owner: owner() })).rejects.toThrow('already owned')
  })

  it.skipIf(process.platform === 'win32')('resolves a symlink alias before claiming a data directory', async () => {
    const profile = await fixture()
    reservations.push(await acquireAppSessionReservation({ ...profile, owner: owner() }))
    const alias = join(profile.root, 'alias')
    await symlink(profile.dataDir, alias, 'dir')
    await expect(acquireAppSessionReservation({ ...profile, dataDir: alias,
      controlDir: join(profile.root, 'other-control'), settingsPath: join(profile.root, 'other-settings'), owner: owner() }))
      .rejects.toThrow('already owned')
  })

  it('allows independent profiles and permits a sequential owner after release', async () => {
    const first = await fixture()
    const second = await fixture()
    const reservation = await acquireAppSessionReservation({ ...first, owner: owner() })
    reservations.push(await acquireAppSessionReservation({ ...second, owner: owner() }))
    await reservation.release()
    reservations.push(await acquireAppSessionReservation({ ...first, owner: owner() }))
  })
})
