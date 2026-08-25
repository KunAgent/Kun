import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canIgnoreRuntimeMigrationFsyncError,
  markCanonicalKunRuntimeMigrationRuntimeVerified,
  retryRuntimeMigrationMutation,
  runCanonicalKunRuntimeDataMigration as runCanonicalKunRuntimeDataMigrationWithPreservation
} from './runtime-data-dir-migration'

const tempRoots: string[] = []
const TEST_EXTENSION_ID = 'acme.demo'
const TEST_EXTENSION_VERSION = '1.0.0'
const TEST_TIMESTAMP = '2026-07-26T00:00:00.000Z'

const runCanonicalKunRuntimeDataMigration = (
  input: Parameters<typeof runCanonicalKunRuntimeDataMigrationWithPreservation>[0]
) => runCanonicalKunRuntimeDataMigrationWithPreservation({
  ...input,
  skipHistoryPreservationForTests: true
})

async function fixture(dataDir = '~/.deepseekgui/kun'): Promise<{
  root: string
  home: string
  userData: string
  legacy: string
  current: string
  settingsPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'kun-runtime-dir-migration-'))
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
  const settings = JSON.parse(await readFile(path, 'utf8'))
  return settings.agents.kun.dataDir
}

async function isLinkTo(path: string, target: string): Promise<boolean> {
  const stats = await lstat(path)
  if (!stats.isSymbolicLink()) return false
  // POSIX readlink preserves the absolute target supplied by the migrator.
  return process.platform === 'win32' || (await readlink(path)) === target
}

function testExtensionManifest() {
  return {
    publisher: 'acme',
    name: 'demo',
    displayName: 'Demo',
    version: TEST_EXTENSION_VERSION,
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

function testExtensionRegistry(packagePath: string, developmentPath?: string) {
  const manifest = testExtensionManifest()
  return {
    schemaVersion: 1,
    revision: 7,
    updatedAt: TEST_TIMESTAMP,
    extensions: {
      [TEST_EXTENSION_ID]: {
        id: TEST_EXTENSION_ID,
        selectedVersion: TEST_EXTENSION_VERSION,
        globallyEnabled: false,
        workspaceEnablement: {},
        workspacePermissionGrants: {},
        versions: {
          [TEST_EXTENSION_VERSION]: {
            version: TEST_EXTENSION_VERSION,
            packagePath,
            archiveSha256: 'a'.repeat(64),
            integrity: { algorithm: 'sha256', files: {} },
            source: { type: 'local', locator: 'fixture.kunx' },
            signatureStatus: 'unsigned',
            requestedPermissions: [],
            grantedPermissions: [],
            installedAt: TEST_TIMESTAMP,
            manifest,
            mutable: false
          }
        },
        ...(developmentPath
          ? {
              development: {
                path: developmentPath,
                source: { type: 'development', locator: developmentPath },
                digest: 'b'.repeat(64),
                manifest,
                requestedPermissions: [],
                grantedPermissions: [],
                registeredAt: TEST_TIMESTAMP,
                reloadedAt: TEST_TIMESTAMP,
                generation: 1,
                mutable: true
              }
            }
          : {}),
        useDevelopment: false
      }
    }
  }
}

async function writeExtensionRegistry(
  dataDir: string,
  packagePath: string,
  developmentPath?: string
): Promise<{ path: string; document: ReturnType<typeof testExtensionRegistry>; raw: string }> {
  const registryPath = join(dataDir, 'extensions', 'registry.json')
  const document = testExtensionRegistry(packagePath, developmentPath)
  const raw = `${JSON.stringify(document, null, 2)}\n`
  await mkdir(join(dataDir, 'extensions', TEST_EXTENSION_ID, TEST_EXTENSION_VERSION), {
    recursive: true
  })
  await writeFile(registryPath, raw, 'utf8')
  return { path: registryPath, document, raw }
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

describe('canonical Kun Runtime data migration', () => {
  it('blocks migration without moving data when settings use a newer schema', async () => {
    const test = await fixture('~/.deepseekgui/kun')
    await mkdir(test.legacy, { recursive: true })
    await writeThread(test.legacy, 'future-thread', 'future')
    await writeFile(test.settingsPath, JSON.stringify({ version: 2, agents: { kun: { dataDir: '~/.deepseekgui/kun' } }, futureState: { keep: true } }), 'utf8')
    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(result.status).toBe('blocked')
    expect(await readSettingsDataDir(test.settingsPath)).toBe('~/.deepseekgui/kun')
    expect(await readFile(join(test.legacy, 'threads', 'future-thread', 'metadata.jsonl'), 'utf8'))
      .toContain('future')
    await expect(lstat(test.current)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('promotes the complete legacy store and makes the new config authoritative', async () => {
    const test = await fixture()
    await mkdir(test.legacy, { recursive: true })
    await writeThread(test.legacy, 'thr_legacy', 'legacy')
    await writeFile(
      join(test.legacy, 'config.json'),
      JSON.stringify({ models: { profiles: { legacy_model: {} } } }),
      'utf8'
    )

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(await readSettingsDataDir(test.settingsPath)).toBe('~/.kun/data')
    expect(await isLinkTo(test.legacy, test.current)).toBe(true)
    expect(await readFile(join(test.current, 'threads', 'thr_legacy', 'metadata.jsonl'), 'utf8'))
      .toContain('legacy')
    expect(JSON.parse(await readFile(join(test.current, 'config.json'), 'utf8')))
      .toHaveProperty('models.profiles.legacy_model')
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.phase).toBe('completed')
    expect(journal.sourceInventory).toMatchObject({
      files: expect.any(Number),
      directories: expect.any(Number),
      bytes: expect.any(Number)
    })
    expect(journal.targetInventory).toMatchObject({
      files: expect.any(Number),
      directories: expect.any(Number),
      bytes: expect.any(Number)
    })
    expect(journal.sqliteQuickCheck).toBe('missing')
    expect(journal.settingsBackedUp).toBe(true)
    expect(journal.settingsBackupPaths).toHaveLength(1)
    expect(await readSettingsDataDir(journal.settingsBackupPaths[0])).toBe('~/.deepseekgui/kun')
  })

  it('durably rebases installed extension paths and preserves all unrelated registry state', async () => {
    const test = await fixture()
    const legacyPackagePath = join(
      test.legacy,
      'extensions',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    const currentPackagePath = join(
      test.current,
      'extensions',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    const developmentPath = join(test.root, 'development-extension')
    const seeded = await writeExtensionRegistry(
      test.legacy,
      legacyPackagePath,
      developmentPath
    )

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    const migratedRegistryPath = join(test.current, 'extensions', 'registry.json')
    const migrated = JSON.parse(await readFile(migratedRegistryPath, 'utf8'))
    const expected = structuredClone(seeded.document)
    expected.extensions[TEST_EXTENSION_ID].versions[TEST_EXTENSION_VERSION].packagePath =
      currentPackagePath
    expect(migrated).toEqual(expected)
    expect(migrated.extensions[TEST_EXTENSION_ID].development.path).toBe(developmentPath)

    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.extensionRegistryRebasedRecords).toBe(1)
    expect(journal.extensionRegistryRebasedAt).toEqual(expect.any(String))
    expect(journal.extensionRegistryBackupPaths).toHaveLength(1)
    expect(await readFile(journal.extensionRegistryBackupPaths[0], 'utf8')).toBe(seeded.raw)

    const registryBeforeRepeat = await readFile(migratedRegistryPath, 'utf8')
    const repeated = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(repeated.status).toBe('completed')
    expect(await readFile(migratedRegistryPath, 'utf8')).toBe(registryBeforeRepeat)
    expect(JSON.parse(await readFile(result.journalPath, 'utf8')).extensionRegistryBackupPaths)
      .toEqual(journal.extensionRegistryBackupPaths)
  })

  it('does not rewrite or back up an already-canonical extension registry', async () => {
    const test = await fixture()
    const currentPackagePath = join(
      test.current,
      'extensions',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    const seeded = await writeExtensionRegistry(test.legacy, currentPackagePath)

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(await readFile(join(test.current, 'extensions', 'registry.json'), 'utf8'))
      .toBe(seeded.raw)
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.extensionRegistryBackupPaths).toEqual([])
    expect(journal.extensionRegistryRebasedRecords).toBe(0)
  })

  it('blocks without rewriting an extension record outside the canonical migration roots', async () => {
    const test = await fixture()
    const unexpectedPackagePath = join(
      test.root,
      'unrelated-extension-store',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    const seeded = await writeExtensionRegistry(test.legacy, unexpectedPackagePath)

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('blocked')
    expect(result.message).toContain(
      `packagePath is outside the canonical migration roots: ` +
      `${TEST_EXTENSION_ID}@${TEST_EXTENSION_VERSION}`
    )
    expect(await readSettingsDataDir(test.settingsPath)).toBe('~/.deepseekgui/kun')
    expect(await readFile(join(test.current, 'extensions', 'registry.json'), 'utf8'))
      .toBe(seeded.raw)
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.phase).toBe('salvaged')
    expect(journal.extensionRegistryBackupPaths).toEqual([])
  })

  it('blocks on an unsafe extension registry identity without creating a backup', async () => {
    const test = await fixture()
    const unsafeId = '../escape'
    const registry = testExtensionRegistry(join(test.legacy, 'extensions', 'escape', '1.0.0'))
    registry.extensions = {
      [unsafeId]: {
        ...registry.extensions[TEST_EXTENSION_ID],
        id: unsafeId
      }
    } as unknown as typeof registry.extensions
    const registryPath = join(test.legacy, 'extensions', 'registry.json')
    await mkdir(join(test.legacy, 'extensions'), { recursive: true })
    const raw = `${JSON.stringify(registry, null, 2)}\n`
    await writeFile(registryPath, raw, 'utf8')

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('blocked')
    expect(result.message).toContain(`extension registry identity is unsafe: ${unsafeId}`)
    expect(await readFile(join(test.current, 'extensions', 'registry.json'), 'utf8')).toBe(raw)
    expect(JSON.parse(await readFile(result.journalPath, 'utf8')).extensionRegistryBackupPaths)
      .toEqual([])
  })

  it.each([
    'extension-registry-backed-up',
    'extension-registry-rebased'
  ] as const)('resumes extension registry repair after interruption in phase %s', async (phase) => {
    const test = await fixture()
    const legacyPackagePath = join(
      test.legacy,
      'extensions',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    await writeExtensionRegistry(test.legacy, legacyPackagePath)
    let interrupted = false

    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPhase: (currentPhase) => {
        if (!interrupted && currentPhase === phase) {
          interrupted = true
          throw new Error(`simulated interruption after ${phase}`)
        }
      }
    })

    expect(first.status).toBe('blocked')
    const interruptedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    expect(interruptedJournal.phase).toBe(phase)
    expect(interruptedJournal.extensionRegistryBackupPaths).toHaveLength(1)

    const resumed = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(resumed.status).toBe('completed')
    const registry = JSON.parse(await readFile(
      join(test.current, 'extensions', 'registry.json'),
      'utf8'
    ))
    expect(
      registry.extensions[TEST_EXTENSION_ID].versions[TEST_EXTENSION_VERSION].packagePath
    ).toBe(join(test.current, 'extensions', TEST_EXTENSION_ID, TEST_EXTENSION_VERSION))
    expect(JSON.parse(await readFile(first.journalPath, 'utf8')).extensionRegistryBackupPaths)
      .toEqual(interruptedJournal.extensionRegistryBackupPaths)
  })

  it('finishes recovery when the registry rewrite landed before its journal update', async () => {
    const test = await fixture()
    const legacyPackagePath = join(
      test.legacy,
      'extensions',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    await writeExtensionRegistry(test.legacy, legacyPackagePath)

    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPhase: (phase) => {
        if (phase === 'extension-registry-backed-up') {
          throw new Error('simulated interruption before the registry rewrite')
        }
      }
    })
    expect(first.status).toBe('blocked')
    const interruptedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    expect(interruptedJournal.extensionRegistryRebasedRecords).toBe(1)

    // Simulate an atomic registry rename that completed immediately before
    // the process exited and therefore before the journal phase advanced.
    const currentPackagePath = join(
      test.current,
      'extensions',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    await writeExtensionRegistry(test.current, currentPackagePath)

    const resumed = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(resumed.status).toBe('completed')

    const completedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    expect(completedJournal.extensionRegistryRebasedRecords).toBe(1)
    expect(completedJournal.extensionRegistryRebasedAt).toEqual(expect.any(String))
    expect(completedJournal.extensionRegistryBackupPaths)
      .toEqual(interruptedJournal.extensionRegistryBackupPaths)
  })

  it('repairs a legacy extension path left by an already-completed version-2 migration', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_legacy', 'legacy')
    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(first.status).toBe('completed')

    const legacyPackagePath = join(
      test.legacy,
      'extensions',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    const seeded = await writeExtensionRegistry(test.current, legacyPackagePath)
    const oldJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    delete oldJournal.extensionRegistryBackupPaths
    delete oldJournal.extensionRegistryRebasedRecords
    delete oldJournal.extensionRegistryRebasedAt
    await writeFile(first.journalPath, `${JSON.stringify(oldJournal, null, 2)}\n`, 'utf8')

    const repaired = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(repaired.status).toBe('completed')
    const registry = JSON.parse(await readFile(seeded.path, 'utf8'))
    expect(
      registry.extensions[TEST_EXTENSION_ID].versions[TEST_EXTENSION_VERSION].packagePath
    ).toBe(join(test.current, 'extensions', TEST_EXTENSION_ID, TEST_EXTENSION_VERSION))
    const repairedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    expect(repairedJournal.phase).toBe('completed')
    expect(repairedJournal.extensionRegistryRebasedRecords).toBe(1)
    expect(repairedJournal.extensionRegistryBackupPaths).toHaveLength(1)
    expect(await readFile(repairedJournal.extensionRegistryBackupPaths[0], 'utf8'))
      .toBe(seeded.raw)
  })

  it('adopts and repairs a verified canonical layout that predates the migration journal', async () => {
    const test = await fixture('~/.kun/data')
    await mkdir(test.current, { recursive: true })
    await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
    await symlink(test.current, test.legacy, process.platform === 'win32' ? 'junction' : 'dir')
    const legacyPackagePath = join(
      test.legacy,
      'extensions',
      TEST_EXTENSION_ID,
      TEST_EXTENSION_VERSION
    )
    const seeded = await writeExtensionRegistry(test.current, legacyPackagePath)

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect((await lstat(result.journalPath)).isFile()).toBe(true)
    const registry = JSON.parse(await readFile(seeded.path, 'utf8'))
    expect(
      registry.extensions[TEST_EXTENSION_ID].versions[TEST_EXTENSION_VERSION].packagePath
    ).toBe(join(test.current, 'extensions', TEST_EXTENSION_ID, TEST_EXTENSION_VERSION))
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.extensionRegistryRebasedRecords).toBe(1)
    expect(journal.extensionRegistryBackupPaths).toHaveLength(1)
  })

  it('keeps a completed migration blocked when its extension registry is malformed', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_legacy', 'legacy')
    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(first.status).toBe('completed')

    const registryPath = join(test.current, 'extensions', 'registry.json')
    const malformed = `${JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      updatedAt: TEST_TIMESTAMP,
      extensions: {
        [TEST_EXTENSION_ID]: {
          id: TEST_EXTENSION_ID,
          versions: []
        }
      }
    }, null, 2)}\n`
    await mkdir(join(test.current, 'extensions'), { recursive: true })
    await writeFile(registryPath, malformed, 'utf8')
    const oldJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    delete oldJournal.extensionRegistryBackupPaths
    delete oldJournal.extensionRegistryRebasedRecords
    delete oldJournal.extensionRegistryRebasedAt
    await writeFile(first.journalPath, `${JSON.stringify(oldJournal, null, 2)}\n`, 'utf8')

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('blocked')
    expect(result.authority).toBe('current')
    expect(result.message).toContain(`extension registry entry has an invalid shape: ${TEST_EXTENSION_ID}`)
    expect(await readFile(registryPath, 'utf8')).toBe(malformed)
    expect(
      JSON.parse(await readFile(first.journalPath, 'utf8')).extensionRegistryBackupPaths ?? []
    ).toEqual([])
  })

  it('runs SQLite quick_check against a promoted Runtime index', async () => {
    const test = await fixture()
    await mkdir(test.legacy, { recursive: true })
    const database = new DatabaseSync(join(test.legacy, 'index.sqlite3'))
    try {
      database.exec('CREATE TABLE migration_probe (id TEXT PRIMARY KEY)')
      database.prepare('INSERT INTO migration_probe (id) VALUES (?)').run('ok')
    } finally {
      database.close()
    }

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.sqliteQuickCheck).toBe('ok')
    expect((await lstat(join(test.current, 'index.sqlite3'))).isFile()).toBe(true)
  })

  it('preserves an invalid rebuildable SQLite index and records failed validation', async () => {
    const test = await fixture()
    await mkdir(test.legacy, { recursive: true })
    await writeFile(join(test.legacy, 'index.sqlite3'), 'not-a-sqlite-database', 'utf8')

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(await readFile(join(test.current, 'index.sqlite3'), 'utf8'))
      .toBe('not-a-sqlite-database')
    expect(JSON.parse(await readFile(result.journalPath, 'utf8')).sqliteQuickCheck)
      .toBe('invalid')
  // Windows file-system scanning can delay the synchronous promoted-index check.
  }, 20_000)

  it('backs up a populated destination and salvages non-conflicting identity data', async () => {
    const test = await fixture()
    await mkdir(test.legacy, { recursive: true })
    await mkdir(test.current, { recursive: true })
    await writeThread(test.legacy, 'thr_legacy', 'legacy')
    await writeThread(test.current, 'thr_new', 'new')
    await mkdir(join(test.current, 'attachments'), { recursive: true })
    await writeFile(join(test.current, 'attachments', 'att_new.json'), '{"id":"att_new"}', 'utf8')
    await mkdir(join(test.current, 'extensions'), { recursive: true })
    await writeFile(join(test.current, 'extensions', 'accounts.json'), '{"accounts":["new"]}', 'utf8')
    await mkdir(join(test.current, 'credentials'), { recursive: true })
    await writeFile(join(test.current, 'credentials', 'credentials.enc.json'), '{"encrypted":"new"}', 'utf8')
    await writeFile(join(test.current, 'secret.key'), 'new-secret-key', 'utf8')
    await mkdir(join(test.current, 'memory'), { recursive: true })
    await writeFile(join(test.current, 'memory', 'mem_new.json'), '{"id":"mem_new"}', 'utf8')
    await writeFile(join(test.legacy, 'config.json'), '{"source":"legacy"}', 'utf8')
    await writeFile(join(test.current, 'config.json'), '{"source":"new"}', 'utf8')

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(result.destinationBackupPath).toBeTruthy()
    expect(JSON.parse(await readFile(join(test.current, 'config.json'), 'utf8')).source).toBe('legacy')
    expect(JSON.parse(await readFile(join(result.destinationBackupPath!, 'config.json'), 'utf8')).source).toBe('new')
    expect((await readdir(join(test.current, 'threads'))).sort()).toEqual(['thr_legacy', 'thr_new'])
    expect(await readFile(join(test.current, 'attachments', 'att_new.json'), 'utf8')).toContain('att_new')
    expect(await readFile(join(test.current, 'extensions', 'accounts.json'), 'utf8'))
      .toContain('"new"')
    expect(await readFile(join(test.current, 'credentials', 'credentials.enc.json'), 'utf8'))
      .toContain('"new"')
    expect(await readFile(join(test.current, 'secret.key'), 'utf8')).toBe('new-secret-key')
    expect(await readFile(join(test.current, 'memory', 'mem_new.json'), 'utf8')).toContain('mem_new')
    expect((await lstat(result.destinationBackupPath!)).isDirectory()).toBe(true)
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.destinationInventory).toMatchObject({
      files: expect.any(Number),
      directories: expect.any(Number),
      bytes: expect.any(Number)
    })

    const backupEntriesBefore = (await readdir(join(test.home, '.kun'))).sort()
    const repeated = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(repeated.status).toBe('completed')
    expect(repeated.destinationBackupPath).toBe(result.destinationBackupPath)
    expect((await readdir(join(test.home, '.kun'))).sort()).toEqual(backupEntriesBefore)
  })

  it('never overwrites a conflicting destination history', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_same', 'authoritative legacy')
    await writeThread(test.current, 'thr_same', 'alternate new')

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect(await readFile(join(test.current, 'threads', 'thr_same', 'metadata.jsonl'), 'utf8'))
      .toContain('authoritative legacy')
    expect(await readFile(
      join(result.destinationBackupPath!, 'threads', 'thr_same', 'metadata.jsonl'),
      'utf8'
    )).toContain('alternate new')
    const report = JSON.parse(await readFile(result.reportPath!, 'utf8'))
    expect(report.conflicts).toContain('threads/thr_same')
  })

})
