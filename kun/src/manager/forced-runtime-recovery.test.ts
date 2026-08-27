import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  consumeForcedRuntimeRecoveryOwners,
  forcedRuntimeRecoveryPath,
  readForcedRuntimeRecovery,
  recordVerifiedForcedRuntimeOwner,
  removeForcedRuntimeRecovery
} from './forced-runtime-recovery.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-forced-runtime-recovery-'))
  roots.push(root)
  return {
    controlDir: root,
    dataDir: join(root, 'data'),
    otherDataDir: join(root, 'other-data')
  }
}

function owner(
  flavor: 'production' | 'development',
  instanceId: string,
  pid: number,
  startedAt = '2026-08-21T00:00:00.000Z'
) {
  return { flavor, instanceId, pid, startedAt }
}

describe('forced Runtime recovery marker', () => {
  it('aggregates exact owners across data directories without persisting secrets', async () => {
    const test = await fixture()
    const first = await recordVerifiedForcedRuntimeOwner({
      controlDir: test.controlDir,
      dataDir: test.dataDir,
      owner: owner('production', 'production-old', 4101),
      now: new Date('2026-08-21T00:02:00.000Z')
    })
    const second = await recordVerifiedForcedRuntimeOwner({
      controlDir: test.controlDir,
      dataDir: test.otherDataDir,
      owner: owner('development', 'development-old', 4102, '2026-08-21T00:00:01.000Z'),
      now: new Date('2026-08-21T00:03:00.000Z')
    })

    expect(second.markerId).toBe(first.markerId)
    expect(second.owners).toEqual([
      { ...owner('production', 'production-old', 4101), dataDir: test.dataDir },
      {
        ...owner('development', 'development-old', 4102, '2026-08-21T00:00:01.000Z'),
        dataDir: test.otherDataDir
      }
    ])
    const serialized = await readFile(forcedRuntimeRecoveryPath(test.controlDir), 'utf8')
    expect(JSON.parse(serialized)).toMatchObject({ version: 2 })
    expect(serialized).not.toMatch(/token|command|settings/iu)
    if (process.platform !== 'win32') {
      expect((await stat(forcedRuntimeRecoveryPath(test.controlDir))).mode & 0o777).toBe(0o600)
    }
    expect(await removeForcedRuntimeRecovery(test.controlDir, second.markerId)).toBe(true)
    expect(await readForcedRuntimeRecovery(test.controlDir)).toBeNull()
  })

  it('deduplicates an owner only within its canonical data directory', async () => {
    const test = await fixture()
    const initial = await recordVerifiedForcedRuntimeOwner({
      controlDir: test.controlDir,
      dataDir: test.dataDir,
      owner: owner('production', 'runtime-old', 4101)
    })
    const updated = await recordVerifiedForcedRuntimeOwner({
      controlDir: test.controlDir,
      dataDir: test.dataDir,
      owner: owner('production', 'runtime-old', 4201, '2026-08-21T00:01:00.000Z'),
      now: new Date('2026-08-21T00:02:00.000Z')
    })
    const otherDirectory = await recordVerifiedForcedRuntimeOwner({
      controlDir: test.controlDir,
      dataDir: test.otherDataDir,
      owner: owner('production', 'runtime-old', 4301, '2026-08-21T00:02:00.000Z'),
      now: new Date('2026-08-21T00:03:00.000Z')
    })

    expect(updated.markerId).toBe(initial.markerId)
    expect(updated.createdAt).toBe(initial.createdAt)
    expect(updated.owners).toHaveLength(1)
    expect(updated.owners[0]).toMatchObject({ pid: 4201 })
    expect(otherDirectory.owners).toHaveLength(2)
    expect(otherDirectory.owners.map((entry) => [entry.dataDir, entry.pid])).toEqual([
      [test.dataDir, 4201],
      [test.otherDataDir, 4301]
    ])
  })

  it('reads a version-1 marker and upgrades it when another directory is recorded', async () => {
    const test = await fixture()
    const legacy = {
      version: 1,
      markerId: 'legacy-marker',
      dataDir: test.dataDir,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      owners: [owner('production', 'production-legacy', 4101)]
    }
    await writeFile(forcedRuntimeRecoveryPath(test.controlDir), JSON.stringify(legacy), 'utf8')

    await expect(readForcedRuntimeRecovery(test.controlDir)).resolves.toMatchObject({
      version: 2,
      markerId: 'legacy-marker',
      owners: [{ ...legacy.owners[0], dataDir: test.dataDir }]
    })
    const upgraded = await recordVerifiedForcedRuntimeOwner({
      controlDir: test.controlDir,
      dataDir: test.otherDataDir,
      owner: owner('development', 'development-current', 4102),
      now: new Date('2026-08-21T00:04:00.000Z')
    })

    expect(upgraded.version).toBe(2)
    expect(upgraded.markerId).toBe('legacy-marker')
    expect(upgraded.owners).toEqual([
      { ...legacy.owners[0], dataDir: test.dataDir },
      { ...owner('development', 'development-current', 4102), dataDir: test.otherDataDir }
    ])
    expect(JSON.parse(await readFile(forcedRuntimeRecoveryPath(test.controlDir), 'utf8')))
      .toMatchObject({ version: 2 })
  })

  it('consumes exact owners without discarding recovery evidence for other directories', async () => {
    const test = await fixture()
    const first = await recordVerifiedForcedRuntimeOwner({
      controlDir: test.controlDir,
      dataDir: test.dataDir,
      owner: owner('production', 'production-old', 4101)
    })
    const second = await recordVerifiedForcedRuntimeOwner({
      controlDir: test.controlDir,
      dataDir: test.otherDataDir,
      owner: owner('development', 'development-old', 4102)
    })

    expect(await consumeForcedRuntimeRecoveryOwners({
      controlDir: test.controlDir,
      markerId: second.markerId,
      owners: [first.owners[0]!]
    })).toBe(true)
    await expect(readForcedRuntimeRecovery(test.controlDir)).resolves.toMatchObject({
      markerId: second.markerId,
      owners: [{ dataDir: test.otherDataDir, instanceId: 'development-old' }]
    })
    expect(await consumeForcedRuntimeRecoveryOwners({
      controlDir: test.controlDir,
      markerId: 'other-marker',
      owners: [second.owners[1]!]
    })).toBe(false)
    expect(await readForcedRuntimeRecovery(test.controlDir)).not.toBeNull()
    expect(await consumeForcedRuntimeRecoveryOwners({
      controlDir: test.controlDir,
      markerId: second.markerId,
      owners: [second.owners[1]!]
    })).toBe(true)
    expect(await readForcedRuntimeRecovery(test.controlDir)).toBeNull()
  })

  it('rejects malformed, oversized, and over-full markers', async () => {
    const test = await fixture()
    const path = forcedRuntimeRecoveryPath(test.controlDir)
    await writeFile(path, '{broken', 'utf8')
    await expect(readForcedRuntimeRecovery(test.controlDir)).rejects.toThrow()
    await writeFile(path, 'x'.repeat(64 * 1024 + 1), 'utf8')
    await expect(readForcedRuntimeRecovery(test.controlDir)).rejects.toThrow(/oversized/u)
    await writeFile(path, JSON.stringify({
      version: 2,
      markerId: 'over-full',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      owners: Array.from({ length: 33 }, (_, index) => ({
        ...owner('production', `production-${index}`, 4101 + index),
        dataDir: test.dataDir
      }))
    }), 'utf8')
    await expect(readForcedRuntimeRecovery(test.controlDir)).rejects.toThrow()
  })
})
