import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  runtimeDataDirClaimsPath,
  runtimeDataDirMigrationLockPath
} from '../../kun/src/server/runtime-data-dir-migration-lock.js'
import {
  acquireRuntimeDataDirLease,
  withRuntimeDataDirAncillaryWriter
} from '../../kun/src/server/runtime-data-dir-lease.js'
import { createKunServeRuntime } from '../../kun/src/server/runtime-factory.js'
import {
  syncGuiProviderCatalogToConfig,
  type GuiSharedSettings
} from '../../kun/src/cli/gui-settings-bridge.js'
import {
  acquireCanonicalRuntimeMigrationLock,
  runtimeMigrationAllowsPostMigrationSettingsWrite
} from './runtime-data-dir-migration-lock'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('canonical Runtime migration startup lock', () => {
  it('does not permit settings rewrites after a blocked drain or migration', () => {
    expect(runtimeMigrationAllowsPostMigrationSettingsWrite('blocked')).toBe(false)
    expect(runtimeMigrationAllowsPostMigrationSettingsWrite('completed')).toBe(true)
    expect(runtimeMigrationAllowsPostMigrationSettingsWrite('not-needed')).toBe(true)
  })
  it('acquires roots in one transaction and releases token-matched files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-migration-lock-'))
    roots.push(root)
    const legacy = join(root, '.deepseekgui', 'kun')
    const current = join(root, '.kun', 'data')
    const lock = acquireCanonicalRuntimeMigrationLock([legacy, current], {
      pid: 101,
      processIsAlive: (pid) => pid === 101,
      now: () => new Date('2026-08-05T00:00:00.000Z')
    })

    expect(lock.paths).toHaveLength(2)
    await expect(readFile(runtimeDataDirMigrationLockPath(legacy), 'utf8'))
      .resolves.toContain('2026-08-05T00:00:00.000Z')
    expect(() => acquireCanonicalRuntimeMigrationLock([current], {
      pid: 202,
      processIsAlive: (pid) => pid === 101
    })).toThrow(/already active in process 101/)
    lock.release()
    await expect(readFile(runtimeDataDirMigrationLockPath(current), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers a dead owner but never accepts an invalid record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    const stale = acquireCanonicalRuntimeMigrationLock([dataDir], {
      pid: 303,
      processIsAlive: () => false
    })
    const replacement = acquireCanonicalRuntimeMigrationLock([dataDir], {
      pid: 404,
      processIsAlive: () => false
    })
    stale.release()
    expect(JSON.parse(await readFile(replacement.paths[0]!, 'utf8')).pid).toBe(404)
    replacement.release()

    const path = runtimeDataDirMigrationLockPath(dataDir)
    await writeFile(path, '{')
    expect(() => acquireCanonicalRuntimeMigrationLock([dataDir], {
      processIsAlive: () => false
    })).toThrow(/lock is invalid/)
  })

  it('does not acquire over an active Runtime owner lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    const lease = await acquireRuntimeDataDirLease(dataDir, {
      pid: 501,
      processIsAlive: (pid) => pid === 501
    })

    expect(() => acquireCanonicalRuntimeMigrationLock([dataDir], {
      pid: 502,
      processIsAlive: (pid) => pid === 501
    })).toThrow(/already owned by active process 501/)
    await expect(readFile(runtimeDataDirMigrationLockPath(dataDir), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await lease.release()
  })

  it('blocks Main migration while a direct CLI-style Runtime composition is alive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'token',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:9',
      model: 'test-model',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false,
      storage: { backend: 'file' }
    })

    try {
      expect(() => acquireCanonicalRuntimeMigrationLock([dataDir]))
        .toThrow(/already owned by active process/)
    } finally {
      await runtime.shutdown?.()
    }

    const migration = acquireCanonicalRuntimeMigrationLock([dataDir])
    migration.release()
  })

  it('blocks Main migration for the full config synchronization transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-config-sync-lock-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    const settings: GuiSharedSettings = {
      settingsPath: join(root, 'kun-settings.json'),
      dataDir,
      defaultProviderId: 'deepseek',
      defaultModel: 'deepseek-chat',
      providers: [{
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        kind: 'http',
        models: ['deepseek-chat']
      }],
      legacyRuntimePort: 18899,
      legacyRuntimeToken: ''
    }
    let entered!: () => void
    const claimEntered = new Promise<void>((resolve) => { entered = resolve })
    let continueSync!: () => void
    const mayContinue = new Promise<void>((resolve) => { continueSync = resolve })
    const synchronization = syncGuiProviderCatalogToConfig(dataDir, settings, {
      afterWriterClaimAcquired: async () => {
        entered()
        await mayContinue
      }
    })
    await claimEntered

    try {
      expect(() => acquireCanonicalRuntimeMigrationLock([dataDir]))
        .toThrow(/config synchronization is active/)
    } finally {
      continueSync()
    }
    await expect(synchronization).resolves.toMatchObject({ changed: true })
    const migration = acquireCanonicalRuntimeMigrationLock([dataDir])
    migration.release()
  })

  it('blocks Main migration for the full ancillary write transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-ancillary-lock-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    let entered!: () => void
    const claimEntered = new Promise<void>((resolve) => { entered = resolve })
    let continueWrite!: () => void
    const mayContinue = new Promise<void>((resolve) => { continueWrite = resolve })
    const write = withRuntimeDataDirAncillaryWriter(
      dataDir,
      async () => 'written',
      {
        afterClaimAcquired: async () => {
          entered()
          await mayContinue
        }
      }
    )
    await claimEntered

    try {
      expect(() => acquireCanonicalRuntimeMigrationLock([dataDir]))
        .toThrow(/ancillary data write is active/)
    } finally {
      continueWrite()
    }
    await expect(write).resolves.toBe('written')
    const migration = acquireCanonicalRuntimeMigrationLock([dataDir])
    migration.release()
  })

  it('ignores non-canonical common claim names but fails closed on canonical directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    const claimsPath = runtimeDataDirClaimsPath(dataDir)
    await mkdir(claimsPath, { recursive: true })
    const unknown = join(
      claimsPath,
      'claim-551-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json.stale'
    )
    await writeFile(unknown, '{}')

    const migration = acquireCanonicalRuntimeMigrationLock([dataDir], {
      pid: 551,
      processIsAlive: () => false
    })
    await expect(readFile(unknown, 'utf8')).resolves.toBe('{}')
    migration.release()

    await rm(unknown, { force: true })
    await mkdir(join(
      claimsPath,
      'claim-552-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'
    ))
    expect(() => acquireCanonicalRuntimeMigrationLock([dataDir], {
      pid: 553,
      processIsAlive: () => false
    })).toThrow(/claim is not a regular file/)
  })

  it('reclaims a common writer claim after its PID is reused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    const claimsPath = runtimeDataDirClaimsPath(dataDir)
    const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const stalePath = join(claimsPath, `claim-561-${token}.json`)
    await mkdir(claimsPath, { recursive: true })
    await writeFile(stalePath, JSON.stringify({
      schemaVersion: 1,
      kind: 'runtime',
      pid: 561,
      token,
      startedAt: '2026-08-16T00:00:00.000Z',
      processIdentity: 'win32-v1:original-process',
      dataDir
    }))
    let inspectedIdentity: string | undefined

    const migration = acquireCanonicalRuntimeMigrationLock([dataDir], {
      pid: 562,
      processIsAlive: (pid, record) => {
        if (pid === 561) {
          inspectedIdentity = record?.processIdentity
          return record?.processIdentity === 'win32-v1:reused-process'
        }
        return pid === 562
      }
    })

    expect(inspectedIdentity).toBe('win32-v1:original-process')
    await expect(readFile(stalePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    migration.release()
  })

  it('preserves a replacement lock observed during stale reclamation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-migration-lock-'))
    roots.push(root)
    const dataDir = join(root, '.kun', 'data')
    const path = runtimeDataDirMigrationLockPath(dataDir)
    const stale = {
      schemaVersion: 1,
      pid: 601,
      token: 'stale-token',
      startedAt: '2026-08-05T00:00:00.000Z',
      dataDir
    }
    const replacement = { ...stale, pid: 602, token: 'replacement-token' }
    await mkdir(join(root, '.kun'), { recursive: true })
    await writeFile(path, JSON.stringify(stale))
    let replaced = false

    expect(() => acquireCanonicalRuntimeMigrationLock([dataDir], {
      pid: 603,
      processIsAlive: (pid) => pid === replacement.pid,
      beforeStaleReclaim: (lockPath) => {
        if (replaced) return
        replaced = true
        rmSync(lockPath, { force: true })
        writeFileSync(lockPath, JSON.stringify(replacement), 'utf8')
      }
    })).toThrow(/owner changed during stale-owner recovery/)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      pid: replacement.pid,
      token: replacement.token
    })
  })

  it('attempts every owned-root release when one unlink fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-main-migration-lock-'))
    roots.push(root)
    const first = join(root, '.deepseekgui', 'kun')
    const second = join(root, '.kun', 'data')
    let attempts = 0
    const lock = acquireCanonicalRuntimeMigrationLock([first, second], {
      unlinkLock: (path) => {
        attempts += 1
        if (attempts === 1) throw new Error('injected unlink failure')
        unlinkSync(path)
      }
    })

    expect(() => lock.release()).toThrow('injected unlink failure')
    expect(attempts).toBe(4)
    const remaining = await Promise.all([...lock.paths, ...lock.claimPaths].map(async (path) =>
      readFile(path, 'utf8').then(() => true, () => false)
    ))
    expect(remaining.filter(Boolean)).toHaveLength(1)
  })
})
