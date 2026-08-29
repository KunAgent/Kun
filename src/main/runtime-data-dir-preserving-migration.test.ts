import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  chmod,
  utimes,
  writeFile
} from 'node:fs/promises'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalKunRuntimeMigrationRequiresExclusiveAccess,
  markCanonicalKunRuntimeMigrationRuntimeVerified,
  runCanonicalKunRuntimeDataMigration as runCanonicalKunRuntimeDataMigrationImpl
} from './runtime-data-dir-migration'

const tempRoots: string[] = []
const TEST_TIMESTAMP = '2026-07-26T00:00:00.000Z'
const TEST_AVAILABLE_COPY_BYTES = 100 * 1024 * 1024 * 1024

function runCanonicalKunRuntimeDataMigration(
  input: Parameters<typeof runCanonicalKunRuntimeDataMigrationImpl>[0]
): ReturnType<typeof runCanonicalKunRuntimeDataMigrationImpl> {
  return runCanonicalKunRuntimeDataMigrationImpl({
    availableCopyBytes: () => TEST_AVAILABLE_COPY_BYTES,
    ...input
  })
}

async function fixture(dataDir = '~/.deepseekgui/kun') {
  const root = await mkdtemp(join(tmpdir(), 'kun-runtime-preservation-'))
  tempRoots.push(root)
  const home = join(root, 'home')
  const userData = join(root, 'appData', 'Kun')
  const legacy = join(home, '.deepseekgui', 'kun')
  const current = join(home, '.kun', 'data')
  const settingsPath = join(userData, 'kun-settings.json')
  await mkdir(userData, { recursive: true })
  await writeFile(
    settingsPath,
    JSON.stringify({ version: 1, agents: { kun: { dataDir } } }),
    'utf8'
  )
  return { root, home, userData, legacy, current, settingsPath }
}

async function writeThread(dataDir: string, id: string, title: string): Promise<void> {
  const threadDir = join(dataDir, 'threads', id)
  await mkdir(threadDir, { recursive: true })
  await writeFile(
    join(threadDir, 'metadata.jsonl'),
    `${JSON.stringify({ kind: 'thread_metadata', thread: { id, title } })}\n`,
    'utf8'
  )
  await writeFile(join(threadDir, 'messages.jsonl'), '', 'utf8')
}

async function readSettingsDataDir(path: string): Promise<string> {
  return JSON.parse(await readFile(path, 'utf8')).agents.kun.dataDir
}

function extensionManifest() {
  return {
    publisher: 'acme',
    name: 'demo',
    displayName: 'Demo',
    version: '1.0.0',
    manifestVersion: 1,
    apiVersion: '1.0.0',
    engines: { kun: '*' },
    main: 'dist/main.mjs',
    activationEvents: ['onStartup'],
    contributes: {},
    permissions: [],
    stateSchemaVersion: 0
  }
}

async function writeLegacyExtensionRegistry(dataDir: string): Promise<string> {
  const packagePath = join(dataDir, 'extensions', 'acme.demo', '1.0.0')
  const document = {
    schemaVersion: 1,
    revision: 1,
    updatedAt: TEST_TIMESTAMP,
    extensions: {
      'acme.demo': {
        id: 'acme.demo',
        selectedVersion: '1.0.0',
        globallyEnabled: false,
        workspaceEnablement: {},
        workspacePermissionGrants: {},
        versions: {
          '1.0.0': {
            version: '1.0.0',
            packagePath,
            archiveSha256: 'a'.repeat(64),
            integrity: { algorithm: 'sha256', files: {} },
            source: { type: 'local', locator: 'fixture.kunx' },
            signatureStatus: 'unsigned',
            requestedPermissions: [],
            grantedPermissions: [],
            installedAt: TEST_TIMESTAMP,
            manifest: extensionManifest(),
            mutable: false
          }
        },
        useDevelopment: false
      }
    }
  }
  await mkdir(packagePath, { recursive: true })
  const raw = `${JSON.stringify(document, null, 2)}\n`
  await writeFile(join(dataDir, 'extensions', 'registry.json'), raw, 'utf8')
  return raw
}

function completedV2Journal(sourcePath: string, targetPath: string, threadIds: string[]) {
  return {
    schemaVersion: 2,
    phase: 'completed',
    sourcePath,
    targetPath,
    cutoverConflictBackupPaths: [],
    settingsBackupPaths: [],
    settingsBackedUp: true,
    extensionRegistryBackupPaths: [],
    sourceThreadIds: threadIds,
    sourceInventory: { files: 1, directories: 2, symlinks: 0, bytes: 1 },
    targetInventory: { files: 1, directories: 2, symlinks: 0, bytes: 1 },
    sqliteQuickCheck: 'missing',
    salvaged: 0,
    conflicts: [],
    startedAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    completedAt: TEST_TIMESTAMP
  }
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

describe('history-preserving Kun Runtime migration', () => {
  it('requires writer drainage only while canonical migration can mutate data', async () => {
    const test = await fixture()
    expect(canonicalKunRuntimeMigrationRequiresExclusiveAccess({
      userDataPath: test.userData,
      homeDir: test.home
    })).toBe(true)

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(result.status).toBe('completed')
    expect(canonicalKunRuntimeMigrationRequiresExclusiveAccess({
      userDataPath: test.userData,
      homeDir: test.home
    })).toBe(false)

    await writeFile(result.journalPath, '{', 'utf8')
    expect(canonicalKunRuntimeMigrationRequiresExclusiveAccess({
      userDataPath: test.userData,
      homeDir: test.home
    })).toBe(false)
  })

  it('performs an empty cutover without creating a legacy compatibility link', async () => {
    const test = await fixture()

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect((await lstat(test.current)).isDirectory()).toBe(true)
    await expect(lstat(test.legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readSettingsDataDir(test.settingsPath)).toBe('~/.kun/data')
    expect(JSON.parse(await readFile(result.journalPath, 'utf8')).provenance)
      .toBe('no-legacy-source')
  })

  it('adopts the only existing current store without creating a legacy link', async () => {
    const test = await fixture()
    await writeThread(test.current, 'thr_current', 'current')

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    await expect(lstat(test.legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(
      join(test.current, 'threads', 'thr_current', 'metadata.jsonl'),
      'utf8'
    )).toContain('current')
    expect(await readSettingsDataDir(test.settingsPath)).toBe('~/.kun/data')
  })

  it('recovers preserved history when settings select a missing current store', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.legacy, 'thr_history', 'preserved history')
    const sourceBytes = await readFile(
      join(test.legacy, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(result.authority).toBe('current')
    expect((await lstat(test.legacy)).isDirectory()).toBe(true)
    expect((await lstat(test.legacy)).isSymbolicLink()).toBe(false)
    expect((await lstat(test.current)).isDirectory()).toBe(true)
    expect(await readFile(
      join(test.current, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )).toBe(sourceBytes)
    expect(await readFile(
      join(test.legacy, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )).toBe(sourceBytes)
    expect(await readSettingsDataDir(test.settingsPath)).toBe('~/.kun/data')
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.activationFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    if (result.status !== 'completed') throw new Error(result.message)
    if (!result.reportPath) throw new Error('completed migration did not write a report')
    const report = JSON.parse(await readFile(result.reportPath, 'utf8'))
    expect(report.activationFingerprint).toBe(journal.activationFingerprint)
  })

  it('reconstructs an independent legacy directory from an unjournaled compatibility link', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.current, 'thr_history', 'linked history')
    await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
    await symlink(test.current, test.legacy)

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect((await lstat(test.legacy)).isDirectory()).toBe(true)
    expect((await lstat(test.legacy)).isSymbolicLink()).toBe(false)
    expect(await realpath(test.legacy)).not.toBe(await realpath(test.current))
    expect(await readFile(
      join(test.legacy, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )).toContain('linked history')
    expect(await readFile(
      join(test.current, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )).toContain('linked history')
  })

  it('adds missing preserved history without overwriting the explicitly selected current store', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.legacy, 'thr_preserved_only', 'preserved')
    await writeThread(test.current, 'thr_current_only', 'current')
    const legacyBytes = await readFile(
      join(test.legacy, 'threads', 'thr_preserved_only', 'metadata.jsonl'),
      'utf8'
    )
    const currentBytes = await readFile(
      join(test.current, 'threads', 'thr_current_only', 'metadata.jsonl'),
      'utf8'
    )

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect((await readdir(join(test.legacy, 'threads')))).toEqual(['thr_preserved_only'])
    expect((await readdir(join(test.current, 'threads'))).sort()).toEqual([
      'thr_current_only',
      'thr_preserved_only'
    ])
    expect(await readFile(
      join(test.legacy, 'threads', 'thr_preserved_only', 'metadata.jsonl'),
      'utf8'
    )).toBe(legacyBytes)
    expect(await readFile(
      join(test.current, 'threads', 'thr_current_only', 'metadata.jsonl'),
      'utf8'
    )).toBe(currentBytes)
  })

  it.each([
    'prepared',
    'settings-backed-up',
    'destination-salvaged'
  ] as const)(
    'resumes an interrupted additive history merge after phase %s',
    async (interruptedPhase) => {
      const test = await fixture('~/.kun/data')
      await writeThread(test.legacy, 'thr_preserved_only', 'preserved')
      await writeThread(test.current, 'thr_current_only', 'current')
      const sourceBytes = await readFile(
        join(test.legacy, 'threads', 'thr_preserved_only', 'metadata.jsonl'),
        'utf8'
      )

      const interrupted = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined,
        afterPreservationPhase: (phase) => {
          if (phase === interruptedPhase) throw new Error(`interrupt after ${phase}`)
        }
      })
      expect(interrupted.status).toBe('blocked')
      expect(await readFile(
        join(test.legacy, 'threads', 'thr_preserved_only', 'metadata.jsonl'),
        'utf8'
      )).toBe(sourceBytes)

      const resumed = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined
      })
      expect(resumed.status).toBe('completed')
      expect((await readdir(join(test.current, 'threads'))).sort()).toEqual([
        'thr_current_only',
        'thr_preserved_only'
      ])
      expect(await readFile(
        join(test.legacy, 'threads', 'thr_preserved_only', 'metadata.jsonl'),
        'utf8'
      )).toBe(sourceBytes)
    }
  )

  it.each([
    'prepared',
    'settings-backed-up',
    'destination-salvaged'
  ] as const)(
    'refreshes a trusted additive merge source after interruption in phase %s',
    async (interruptedPhase) => {
      const test = await fixture('~/.kun/data')
      await writeThread(test.legacy, 'thr_preserved_only', 'preserved')
      await writeThread(test.current, 'thr_current_only', 'current')
      let interrupted = false
      const first = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined,
        afterPreservationPhase: (phase) => {
          if (!interrupted && phase === interruptedPhase) {
            interrupted = true
            throw new Error(`interrupt after ${phase}`)
          }
        }
      })
      expect(first.status).toBe('blocked')
      const journalPath = join(test.userData, 'kun-runtime-data-migration-v3.json')
      const beforeRefresh = JSON.parse(await readFile(journalPath, 'utf8'))
      const settingsBackupPaths = beforeRefresh.settingsBackupPaths as string[]
      await writeThread(test.legacy, 'thr_late', `late after ${interruptedPhase}`)

      const resumed = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined
      })

      expect(resumed.status).toBe('completed')
      expect((await readdir(join(test.current, 'threads'))).sort()).toEqual([
        'thr_current_only',
        'thr_late',
        'thr_preserved_only'
      ])
      const completed = JSON.parse(await readFile(journalPath, 'utf8'))
      expect(completed.sourceThreadIds.sort()).toEqual([
        'thr_late',
        'thr_preserved_only'
      ])
      expect(completed.settingsBackupPaths).toEqual(
        expect.arrayContaining(settingsBackupPaths)
      )
    }
  )

  it('fails closed with merged data intact when the original additive thread disappears', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.legacy, 'thr_preserved_only', 'preserved')
    await writeThread(test.current, 'thr_current_only', 'current')
    let interrupted = false
    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPreservationPhase: (phase) => {
        if (!interrupted && phase === 'destination-salvaged') {
          interrupted = true
          throw new Error('interrupt after additive merge')
        }
      }
    })
    expect(first.status).toBe('blocked')
    const journalBefore = JSON.parse(await readFile(first.journalPath, 'utf8'))
    await rm(join(test.legacy, 'threads', 'thr_preserved_only'), {
      recursive: true,
      force: true
    })

    const resumed = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(resumed.status).toBe('blocked')
    expect(resumed.message).toContain(
      'missing 1 thread directories recorded before incremental merge'
    )
    const blockedJournal = JSON.parse(await readFile(resumed.journalPath, 'utf8'))
    expect(blockedJournal.phase).toBe('destination-salvaged')
    expect(blockedJournal.sourceFingerprint).toBe(journalBefore.sourceFingerprint)
    expect((await readdir(join(test.current, 'threads'))).sort()).toEqual([
      'thr_current_only',
      'thr_preserved_only'
    ])
  })

  it('stops an interrupted migration when the user selects a custom Runtime store', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_history', 'history')
    const customDataDir = join(test.root, 'custom-runtime')

    const interrupted = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPreservationPhase: (phase) => {
        if (phase !== 'prepared') return
        writeFileSync(
          test.settingsPath,
          JSON.stringify({
            version: 1,
            agents: { kun: { dataDir: customDataDir } }
          }),
          'utf8'
        )
      }
    })

    expect(interrupted.status).toBe('blocked')
    expect(interrupted.message).toContain('active settings source changed')
    expect(await readSettingsDataDir(test.settingsPath)).toBe(customDataDir)
    expect(canonicalKunRuntimeMigrationRequiresExclusiveAccess({
      userDataPath: test.userData,
      homeDir: test.home
    })).toBe(false)
    const journalBefore = await readFile(interrupted.journalPath, 'utf8')
    const resumedWithCustomAuthority = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(resumedWithCustomAuthority).toMatchObject({
      status: 'not-needed',
      authority: 'custom'
    })
    expect(await readFile(interrupted.journalPath, 'utf8')).toBe(journalBefore)
    expect((await lstat(test.legacy)).isDirectory()).toBe(true)
    await expect(lstat(test.current)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  for (const version of [2, 3] as const) {
    it(`ignores an invalid version-${version} canonical journal for an explicit custom store`, async () => {
      const test = await fixture()
      const customDataDir = join(test.root, 'custom-runtime')
      await writeFile(
        test.settingsPath,
        JSON.stringify({ version: 1, agents: { kun: { dataDir: customDataDir } } }),
        'utf8'
      )
      await mkdir(customDataDir, { recursive: true })
      await writeThread(customDataDir, 'thr_custom', 'custom history')
      await writeThread(test.legacy, 'thr_canonical', 'preserved canonical history')
      const journalPath = join(
        test.userData,
        `kun-runtime-data-migration-v${version}.json`
      )
      const journalBytes = '{"schemaVersion":"invalid","mustRemain":true}\n'
      await writeFile(journalPath, journalBytes, 'utf8')

      expect(canonicalKunRuntimeMigrationRequiresExclusiveAccess({
        userDataPath: test.userData,
        homeDir: test.home
      })).toBe(false)
      const result = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined
      })

      expect(result).toMatchObject({ status: 'not-needed', authority: 'custom' })
      expect(await readFile(journalPath, 'utf8')).toBe(journalBytes)
      expect(await readFile(
        join(customDataDir, 'threads', 'thr_custom', 'metadata.jsonl'),
        'utf8'
      )).toContain('custom history')
      expect(await readFile(
        join(test.legacy, 'threads', 'thr_canonical', 'metadata.jsonl'),
        'utf8'
      )).toContain('preserved canonical history')
      await expect(lstat(test.current)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  }

  it('keeps the legacy store real and byte-independent after migration', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_history', 'immutable history')
    await writeFile(join(test.legacy, 'config.json'), '{"source":"legacy"}', 'utf8')
    const sourceBytes = await readFile(
      join(test.legacy, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(result.journalPath).toContain('migration-v3.json')
    expect((await lstat(test.legacy)).isDirectory()).toBe(true)
    expect((await lstat(test.legacy)).isSymbolicLink()).toBe(false)
    expect(await readSettingsDataDir(test.settingsPath)).toBe('~/.kun/data')
    expect(await readFile(
      join(test.legacy, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )).toBe(sourceBytes)
    expect(await readFile(
      join(test.current, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )).toBe(sourceBytes)

    await writeFile(
      join(test.current, 'threads', 'thr_history', 'metadata.jsonl'),
      'new-side-only\n',
      'utf8'
    )
    expect(await readFile(
      join(test.legacy, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )).toBe(sourceBytes)
  })

  it('preserves regular-file mode and timestamps in the verified candidate', async () => {
    const test = await fixture()
    const sourceFile = join(test.legacy, 'history.bin')
    await mkdir(test.legacy, { recursive: true })
    await writeFile(sourceFile, 'history-bytes', 'utf8')
    await chmod(sourceFile, 0o640)
    const timestamp = new Date('2025-01-02T03:04:05.000Z')
    await utimes(sourceFile, timestamp, timestamp)

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    const sourceMetadata = await stat(sourceFile)
    const targetMetadata = await stat(join(test.current, 'history.bin'))
    expect(targetMetadata.mode & 0o777).toBe(sourceMetadata.mode & 0o777)
    expect(Math.trunc(targetMetadata.mtimeMs)).toBe(Math.trunc(sourceMetadata.mtimeMs))
  })

  it('copies immutable package directories before restoring their read-only mode', async () => {
    const test = await fixture()
    const sourcePackage = join(test.legacy, 'extensions', 'acme.demo', '1.0.0')
    const targetPackage = join(test.current, 'extensions', 'acme.demo', '1.0.0')
    await mkdir(sourcePackage, { recursive: true })
    const sourceLicense = join(sourcePackage, 'LICENSE')
    const targetLicense = join(targetPackage, 'LICENSE')
    await writeFile(sourceLicense, 'immutable package', 'utf8')
    if (process.platform !== 'win32') await chmod(sourceLicense, 0o444)
    if (process.platform !== 'win32') await chmod(sourcePackage, 0o555)

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(await readFile(targetLicense, 'utf8')).toBe('immutable package')
    if (process.platform !== 'win32') {
      expect((await stat(sourcePackage)).mode & 0o777).toBe(0o555)
      expect((await stat(targetPackage)).mode & 0o777).toBe(0o555)
      expect((await stat(sourceLicense)).mode & 0o777).toBe(0o444)
      expect((await stat(targetLicense)).mode & 0o777).toBe(0o444)
    }
    if (process.platform !== 'win32') await chmod(sourcePackage, 0o755)
    if (process.platform !== 'win32') await chmod(targetPackage, 0o755)
  })

  it('rebases only the candidate extension registry', async () => {
    const test = await fixture()
    const sourceRaw = await writeLegacyExtensionRegistry(test.legacy)

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(await readFile(join(test.legacy, 'extensions', 'registry.json'), 'utf8'))
      .toBe(sourceRaw)
    const current = JSON.parse(
      await readFile(join(test.current, 'extensions', 'registry.json'), 'utf8')
    )
    expect(current.extensions['acme.demo'].versions['1.0.0'].packagePath)
      .toBe(join(test.current, 'extensions', 'acme.demo', '1.0.0'))
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.extensionRegistryRebasedRecords).toBe(1)
  })

  it('rejects an unexpected candidate extension path without changing the source', async () => {
    const test = await fixture()
    const sourceRaw = await writeLegacyExtensionRegistry(test.legacy)
    const registryPath = join(test.legacy, 'extensions', 'registry.json')
    const unexpected = JSON.parse(sourceRaw)
    unexpected.extensions['acme.demo'].versions['1.0.0'].packagePath =
      join(test.root, 'unrelated', 'acme.demo', '1.0.0')
    const unexpectedRaw = `${JSON.stringify(unexpected, null, 2)}\n`
    await writeFile(registryPath, unexpectedRaw, 'utf8')

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('blocked')
    expect(result.message).toContain('packagePath is outside the canonical migration roots')
    expect(await readFile(registryPath, 'utf8')).toBe(unexpectedRaw)
    await expect(lstat(test.current)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a corrupted verified candidate before activation', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_history', 'history')
    await writeFile(join(test.legacy, 'config.json'), '{"valid":true}', 'utf8')

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPreservationPhase: (phase) => {
        if (phase !== 'candidate-rebased') return
        const journal = JSON.parse(readFileSync(
          join(test.userData, 'kun-runtime-data-migration-v3.json'),
          'utf8'
        ))
        writeFileSync(join(journal.stagingPath, 'config.json'), '{', 'utf8')
      }
    })

    expect(result.status).toBe('blocked')
    expect(result.message).toContain('candidate config is not valid JSON')
    expect(await readFile(join(test.legacy, 'config.json'), 'utf8')).toBe('{"valid":true}')
    await expect(lstat(test.current)).rejects.toMatchObject({ code: 'ENOENT' })
  })

})
