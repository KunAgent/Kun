import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireRuntimeDataDirMigrationLock,
  assertRuntimeDataDirMigrationInactive,
  runtimeDataDirClaimsPath,
  runtimeDataDirMigrationLockPath
} from './runtime-data-dir-migration-lock.js'
import { acquireRuntimeDataDirLease, RUNTIME_DATA_DIR_OWNER_FILE } from './runtime-data-dir-lease.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Runtime data migration lock', () => {
  it('fences a missing data directory without creating it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'missing', 'data')
    const lock = await acquireRuntimeDataDirMigrationLock(dataDir, {
      pid: 101,
      processIsAlive: (pid) => pid === 101,
      now: () => new Date('2026-08-05T00:00:00.000Z')
    })

    expect(await readFile(lock.path, 'utf8')).toContain('2026-08-05T00:00:00.000Z')
    await expect(readFile(join(dataDir, RUNTIME_DATA_DIR_OWNER_FILE), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(assertRuntimeDataDirMigrationInactive(dataDir, {
      pid: 202,
      processIsAlive: (pid) => pid === 101
    })).rejects.toThrow(/migration is active in process 101/)
    await lock.release()
  })

  it('prevents a Runtime lease while migration owns the directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'runtime')
    const lock = await acquireRuntimeDataDirMigrationLock(dataDir, {
      pid: 303,
      processIsAlive: (pid) => pid === 303
    })

    await expect(acquireRuntimeDataDirLease(dataDir, {
      pid: 404,
      processIsAlive: (pid) => pid === 303
    })).rejects.toThrow(/migration is active/)
    await lock.release()
  })

  it('prevents a migration lock while a Runtime lease owns the directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'runtime')
    const lease = await acquireRuntimeDataDirLease(dataDir, {
      pid: 405,
      processIsAlive: (pid) => pid === 405
    })

    await expect(acquireRuntimeDataDirMigrationLock(dataDir, {
      pid: 406,
      processIsAlive: (pid) => pid === 405
    })).rejects.toThrow(/already owned by active process 405/)
    await expect(readFile(runtimeDataDirMigrationLockPath(dataDir), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await lease.release()
  })

  it('never lets concurrent lease and migration contenders both acquire', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'runtime')
    const processIsAlive = (pid: number) => pid === 451 || pid === 452
    const contenders = await Promise.allSettled([
      acquireRuntimeDataDirLease(dataDir, { pid: 451, processIsAlive }),
      acquireRuntimeDataDirMigrationLock(dataDir, { pid: 452, processIsAlive })
    ])
    const acquired = contenders.filter((result) => result.status === 'fulfilled')

    expect(acquired.length).toBeLessThanOrEqual(1)
    await Promise.all(acquired.map((result) =>
      result.status === 'fulfilled' ? result.value.release() : Promise.resolve()
    ))
  })

  it('reclaims a writer claim after its PID is reused by another process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'runtime')
    const claimsPath = runtimeDataDirClaimsPath(dataDir)
    const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const stalePath = join(claimsPath, `claim-701-${token}.json`)
    await mkdir(claimsPath, { recursive: true })
    await writeFile(stalePath, JSON.stringify({
      schemaVersion: 1,
      kind: 'runtime',
      pid: 701,
      token,
      startedAt: '2026-08-16T00:00:00.000Z',
      processIdentity: 'win32-v1:original-process',
      dataDir
    }))
    let inspectedIdentity: string | undefined

    const lock = await acquireRuntimeDataDirMigrationLock(dataDir, {
      pid: 702,
      processIsAlive: (pid, record) => {
        if (pid === 701) {
          inspectedIdentity = record?.processIdentity
          return record?.processIdentity === 'win32-v1:reused-process'
        }
        return pid === 702
      }
    })

    expect(inspectedIdentity).toBe('win32-v1:original-process')
    await expect(readFile(stalePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await lock.release()
  })

  it('ignores non-canonical claim names but fails closed on canonical directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'runtime')
    const claimsPath = runtimeDataDirClaimsPath(dataDir)
    await mkdir(claimsPath, { recursive: true })
    const unknown = join(
      claimsPath,
      'claim-461-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json.stale'
    )
    await writeFile(unknown, '{}')

    const lease = await acquireRuntimeDataDirLease(dataDir, {
      pid: 461,
      processIsAlive: () => false
    })
    await expect(readFile(unknown, 'utf8')).resolves.toBe('{}')
    await lease.release()

    await rm(unknown, { force: true })
    await mkdir(join(
      claimsPath,
      'claim-462-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'
    ))
    await expect(acquireRuntimeDataDirMigrationLock(dataDir, {
      pid: 463,
      processIsAlive: () => false
    })).rejects.toThrow(/claim is not a regular file/)
  })

  it('keeps a third Runtime fenced while a stale cleaner displaces the compatibility lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'runtime')
    const migration = await acquireRuntimeDataDirMigrationLock(dataDir, {
      pid: 471,
      processIsAlive: (pid) => pid === 471
    })

    // Simulate an old A contender creating the ABA window by taking the
    // shared-path compatibility marker away. B's unique writer claim remains.
    await rm(migration.path, { force: true })
    await expect(acquireRuntimeDataDirLease(dataDir, {
      pid: 472,
      processIsAlive: (pid) => pid === 471
    })).rejects.toThrow(/migration is active in process 471/)
    await expect(readFile(migration.claimPath, 'utf8')).resolves.toContain('471')
    await migration.release()
  })

  it('reclaims only dead locks and fails closed on invalid records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'runtime')
    const path = runtimeDataDirMigrationLockPath(dataDir)
    await mkdir(root, { recursive: true })
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      pid: 505,
      token: 'stale-token',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir
    }))
    await expect(assertRuntimeDataDirMigrationInactive(dataDir, {
      processIsAlive: () => false
    })).resolves.toBeUndefined()

    await writeFile(path, '{')
    await expect(assertRuntimeDataDirMigrationInactive(dataDir, {
      processIsAlive: () => false
    })).rejects.toThrow(/lock is invalid/)
  })

  it('never deletes a live lock that replaces stale bytes during reclamation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, 'runtime')
    const path = runtimeDataDirMigrationLockPath(dataDir)
    const stale = {
      schemaVersion: 1,
      pid: 601,
      token: 'stale-token',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir
    }
    const replacement = {
      ...stale,
      pid: 602,
      token: 'live-replacement'
    }
    await writeFile(path, JSON.stringify(stale))
    let replaced = false

    await expect(assertRuntimeDataDirMigrationInactive(dataDir, {
      pid: 603,
      processIsAlive: (pid) => pid === replacement.pid,
      beforeStaleReclaim: async (lockPath) => {
        if (replaced) return
        replaced = true
        await rm(lockPath, { force: true })
        await writeFile(lockPath, JSON.stringify(replacement))
      }
    })).rejects.toThrow(/owner changed during stale-owner recovery/)

    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      pid: replacement.pid,
      token: replacement.token
    })
  })
})
