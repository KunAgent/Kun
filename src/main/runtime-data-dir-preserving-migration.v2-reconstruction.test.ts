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
  it('records Runtime verification in the version-3 journal', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_history', 'history')
    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(result.status).toBe('completed')
    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(
      test.userData,
      [],
      () => new Date('2026-07-26T01:00:00.000Z')
    )).toMatchObject({
      status: 'incomplete',
      missingThreadIds: ['thr_history']
    })
    expect(JSON.parse(await readFile(result.journalPath, 'utf8')).runtimeVerifiedAt)
      .toBeUndefined()

    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(
      test.userData,
      ['thr_history'],
      () => new Date('2026-07-26T01:00:00.000Z')
    )).toMatchObject({
      status: 'verified',
      expectedThreadCount: 1,
      visibleThreadCount: 1
    })
    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(
      test.userData,
      ['thr_history']
    ).status).toBe('not-needed')
    expect(JSON.parse(await readFile(result.journalPath, 'utf8')).runtimeVerifiedAt)
      .toBe('2026-07-26T01:00:00.000Z')
  })

  it('retains successful Runtime verification after migrated history disappears from the API', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_history', 'history')
    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })
    expect(result.status).toBe('completed')
    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(
      test.userData,
      ['thr_history']
    ).status).toBe('verified')
    const verifiedJournal = await readFile(result.journalPath, 'utf8')

    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(
      test.userData,
      []
    )).toMatchObject({ status: 'not-needed', missingThreadIds: [] })
    expect(await readFile(result.journalPath, 'utf8')).toBe(verifiedJournal)
  })

  it('reconstructs an explicitly labeled independent snapshot for a version-2 profile', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.current, 'thr_history', 'history')
    await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
    await symlink(test.current, test.legacy)
    await writeFile(
      join(test.userData, 'kun-runtime-data-migration-v2.json'),
      `${JSON.stringify(completedV2Journal(
        test.legacy,
        test.current,
        ['thr_history']
      ), null, 2)}\n`,
      'utf8'
    )

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect((await lstat(test.legacy)).isDirectory()).toBe(true)
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.provenance).toBe('reconstructed-from-current')
    expect((await lstat(journal.compatibilityLinkBackupPath)).isSymbolicLink()).toBe(true)
    const report = JSON.parse(await readFile(
      join(test.userData, 'kun-runtime-data-migration-v3-report.json'),
      'utf8'
    ))
    expect(report.exactPreMigrationSnapshot).toBe(false)
    expect(report.warning).toContain('reconstructed from the current store')

    await writeFile(
      join(test.current, 'threads', 'thr_history', 'messages.jsonl'),
      'new current write\n',
      'utf8'
    )
    expect(await readFile(
      join(test.legacy, 'threads', 'thr_history', 'messages.jsonl'),
      'utf8'
    )).toBe('')
  })

  it('replaces an incomplete pre-cutover version-2 migration with a preserving copy', async () => {
    const test = await fixture()
    await writeThread(test.legacy, 'thr_history', 'history')
    const v2Journal = completedV2Journal(test.legacy, test.current, ['thr_history'])
    v2Journal.phase = 'prepared'
    await writeFile(
      join(test.userData, 'kun-runtime-data-migration-v2.json'),
      `${JSON.stringify(v2Journal, null, 2)}\n`,
      'utf8'
    )

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect((await lstat(test.legacy)).isDirectory()).toBe(true)
    expect(await readFile(
      join(test.current, 'threads', 'thr_history', 'metadata.jsonl'),
      'utf8'
    )).toContain('history')
    expect(JSON.parse(await readFile(result.journalPath, 'utf8')).provenance)
      .toBe('original-legacy-source')
  })

  it('reconstructs history after version-2 already promoted the source but created no link', async () => {
    const test = await fixture()
    await writeThread(test.current, 'thr_history', 'history')
    const v2Journal = completedV2Journal(test.legacy, test.current, ['thr_history'])
    v2Journal.phase = 'source-promoted'
    await writeFile(
      join(test.userData, 'kun-runtime-data-migration-v2.json'),
      `${JSON.stringify(v2Journal, null, 2)}\n`,
      'utf8'
    )

    const result = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(result.status).toBe('completed')
    expect((await lstat(test.legacy)).isDirectory()).toBe(true)
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.provenance).toBe('reconstructed-from-current')
    expect(journal.compatibilityLinkBackupPath).toBeUndefined()
  })

  it.each([
    'prepared',
    'settings-backed-up',
    'candidate-copied',
    'candidate-verified',
    'legacy-link-backed-up'
  ] as const)(
    'resumes version-2 reconstruction after interruption in phase %s',
    async (phase) => {
      const test = await fixture('~/.kun/data')
      await writeThread(test.current, 'thr_history', 'history')
      await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
      await symlink(test.current, test.legacy)
      await writeFile(
        join(test.userData, 'kun-runtime-data-migration-v2.json'),
        `${JSON.stringify(completedV2Journal(
          test.legacy,
          test.current,
          ['thr_history']
        ), null, 2)}\n`,
        'utf8'
      )
      let interrupted = false
      const first = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined,
        afterPreservationPhase: (currentPhase) => {
          if (!interrupted && currentPhase === phase) {
            interrupted = true
            throw new Error(`interrupted after ${phase}`)
          }
        }
      })
      expect(first.status).toBe('blocked')
      expect((await lstat(test.current)).isDirectory()).toBe(true)

      const resumed = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined
      })
      expect(resumed.status).toBe('completed')
      expect((await lstat(test.legacy)).isDirectory()).toBe(true)
      expect(await readFile(
        join(test.legacy, 'threads', 'thr_history', 'metadata.jsonl'),
        'utf8'
      )).toContain('history')
    }
  )

  it('rebuilds a stale version-2 reconstruction from the latest trusted source', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.current, 'thr_history', 'history')
    await writeFile(join(test.current, 'stale-only.txt'), 'stale\n', 'utf8')
    await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
    await symlink(test.current, test.legacy)
    await writeFile(
      join(test.userData, 'kun-runtime-data-migration-v2.json'),
      `${JSON.stringify(completedV2Journal(
        test.legacy,
        test.current,
        ['thr_history']
      ), null, 2)}\n`,
      'utf8'
    )

    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPreservationPhase: (phase) => {
        if (phase !== 'candidate-copied') return
        writeFileSync(
          join(test.current, 'threads', 'thr_history', 'messages.jsonl'),
          'write-after-first-copy\n',
          'utf8'
        )
        rmSync(join(test.current, 'stale-only.txt'))
      }
    })

    expect(first.status).toBe('blocked')
    expect(first.message).toContain(
      'version-2 history reconstruction source or candidate fingerprint changed'
    )
    const interruptedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    const staleStagingPath = interruptedJournal.stagingPath as string
    expect(interruptedJournal.phase).toBe('candidate-copied')
    expect(await readFile(join(staleStagingPath, 'stale-only.txt'), 'utf8')).toBe('stale\n')

    const resumed = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(resumed.status).toBe('completed')
    const completedJournal = JSON.parse(await readFile(resumed.journalPath, 'utf8'))
    expect(completedJournal.stagingPath).not.toBe(staleStagingPath)
    expect((await lstat(staleStagingPath)).isDirectory()).toBe(true)
    await expect(lstat(join(test.legacy, 'stale-only.txt')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(
      join(test.legacy, 'threads', 'thr_history', 'messages.jsonl'),
      'utf8'
    )).toBe('write-after-first-copy\n')
    expect(await readFile(
      join(test.current, 'threads', 'thr_history', 'messages.jsonl'),
      'utf8'
    )).toBe('write-after-first-copy\n')
  })

  it.each([
    'candidate-verified',
    'legacy-link-backed-up'
  ] as const)(
    'rebuilds a stale version-2 reconstruction after interruption in phase %s',
    async (phase) => {
      const test = await fixture('~/.kun/data')
      await writeThread(test.current, 'thr_history', 'history')
      await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
      await symlink(test.current, test.legacy)
      await writeFile(
        join(test.userData, 'kun-runtime-data-migration-v2.json'),
        `${JSON.stringify(completedV2Journal(
          test.legacy,
          test.current,
          ['thr_history']
        ), null, 2)}\n`,
        'utf8'
      )
      let interrupted = false
      const first = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined,
        afterPreservationPhase: (currentPhase) => {
          if (!interrupted && currentPhase === phase) {
            interrupted = true
            throw new Error(`interrupted after ${phase}`)
          }
        }
      })

      expect(first.status).toBe('blocked')
      const interruptedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
      const staleStagingPath = interruptedJournal.stagingPath as string
      const compatibilityBackupPath = interruptedJournal.compatibilityLinkBackupPath as string
      await writeThread(test.current, 'thr_late', `late after ${phase}`)

      const resumed = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined
      })

      expect(resumed.status).toBe('completed')
      const completedJournal = JSON.parse(await readFile(resumed.journalPath, 'utf8'))
      expect(completedJournal.stagingPath).not.toBe(staleStagingPath)
      expect(completedJournal.compatibilityLinkBackupPath).toBe(compatibilityBackupPath)
      expect((await lstat(staleStagingPath)).isDirectory()).toBe(true)
      expect((await lstat(compatibilityBackupPath)).isSymbolicLink()).toBe(true)
      expect((await lstat(test.legacy)).isDirectory()).toBe(true)
      expect((await readdir(join(test.legacy, 'threads'))).sort())
        .toEqual(['thr_history', 'thr_late'])
    }
  )

  it('does not activate stale version-2 history after the compatibility link was backed up', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.current, 'thr_history', 'history')
    await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
    await symlink(test.current, test.legacy)
    await writeFile(
      join(test.userData, 'kun-runtime-data-migration-v2.json'),
      `${JSON.stringify(completedV2Journal(
        test.legacy,
        test.current,
        ['thr_history']
      ), null, 2)}\n`,
      'utf8'
    )

    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPreservationPhase: (phase) => {
        if (phase === 'legacy-link-backed-up') {
          writeFileSync(
            join(test.current, 'threads', 'thr_history', 'messages.jsonl'),
            'latest before activation\n',
            'utf8'
          )
        }
      }
    })

    expect(first.status).toBe('blocked')
    expect(first.message).toContain('changed before history reconstruction activation')
    const interruptedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    const staleStagingPath = interruptedJournal.stagingPath as string
    const compatibilityBackupPath = interruptedJournal.compatibilityLinkBackupPath as string
    await expect(lstat(test.legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await lstat(compatibilityBackupPath)).isSymbolicLink()).toBe(true)

    const resumed = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(resumed.status).toBe('completed')
    const completedJournal = JSON.parse(await readFile(resumed.journalPath, 'utf8'))
    expect(completedJournal.stagingPath).not.toBe(staleStagingPath)
    expect(completedJournal.compatibilityLinkBackupPath).toBe(compatibilityBackupPath)
    expect((await lstat(staleStagingPath)).isDirectory()).toBe(true)
    expect((await lstat(compatibilityBackupPath)).isSymbolicLink()).toBe(true)
    expect(await readFile(
      join(test.legacy, 'threads', 'thr_history', 'messages.jsonl'),
      'utf8'
    )).toBe('latest before activation\n')
  })

  it('preserves an uncommitted version-2 activation before rebuilding it', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.current, 'thr_history', 'history')
    await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
    await symlink(test.current, test.legacy)
    await writeFile(
      join(test.userData, 'kun-runtime-data-migration-v2.json'),
      `${JSON.stringify(completedV2Journal(
        test.legacy,
        test.current,
        ['thr_history']
      ), null, 2)}\n`,
      'utf8'
    )
    let interrupted = false
    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPreservationPhase: (phase) => {
        if (!interrupted && phase === 'legacy-link-backed-up') {
          interrupted = true
          throw new Error('crash before reconstruction activation')
        }
      }
    })
    expect(first.status).toBe('blocked')
    const interruptedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    const staleStagingPath = interruptedJournal.stagingPath as string
    const compatibilityBackupPath = interruptedJournal.compatibilityLinkBackupPath as string
    await rename(staleStagingPath, test.legacy)
    await writeThread(test.current, 'thr_late', 'late after uncommitted reconstruction')

    const resumed = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(resumed.status).toBe('completed')
    const completed = JSON.parse(await readFile(resumed.journalPath, 'utf8'))
    expect(completed.stagingPath).not.toBe(staleStagingPath)
    expect(completed.compatibilityLinkBackupPath).toBe(compatibilityBackupPath)
    expect((await lstat(staleStagingPath)).isDirectory()).toBe(true)
    expect((await lstat(compatibilityBackupPath)).isSymbolicLink()).toBe(true)
    expect((await readdir(join(test.legacy, 'threads'))).sort())
      .toEqual(['thr_history', 'thr_late'])
  })

  it.each(['bytes', 'thread', 'registry'] as const)(
    'leaves a tampered uncommitted version-2 activation in place when its %s identity changed',
    async (drift) => {
      const test = await fixture('~/.kun/data')
      await writeThread(test.current, 'thr_history', 'history')
      await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
      await symlink(test.current, test.legacy)
      await writeFile(
        join(test.userData, 'kun-runtime-data-migration-v2.json'),
        `${JSON.stringify(completedV2Journal(
          test.legacy,
          test.current,
          ['thr_history']
        ), null, 2)}\n`,
        'utf8'
      )
      let interrupted = false
      const first = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined,
        afterPreservationPhase: (phase) => {
          if (!interrupted && phase === 'legacy-link-backed-up') {
            interrupted = true
            throw new Error('crash before reconstruction activation')
          }
        }
      })
      expect(first.status).toBe('blocked')
      const journal = JSON.parse(await readFile(first.journalPath, 'utf8'))
      const staleStagingPath = journal.stagingPath as string
      await rename(staleStagingPath, test.legacy)
      if (drift === 'bytes') {
        await writeFile(join(test.legacy, 'tampered.txt'), 'tampered\n', 'utf8')
      } else if (drift === 'thread') {
        await writeThread(test.legacy, 'thr_untrusted', 'untrusted')
      } else {
        await mkdir(join(test.legacy, 'extensions'), { recursive: true })
        await writeFile(
          join(test.legacy, 'extensions', 'registry.json'),
          '{"schemaVersion":1,"extensions":{"untrusted":{}}}\n',
          'utf8'
        )
      }
      await writeThread(test.current, 'thr_late', 'trusted source advanced')

      const resumed = runCanonicalKunRuntimeDataMigration({
        userDataPath: test.userData,
        homeDir: test.home,
        sleep: () => undefined
      })

      expect(resumed.status).toBe('blocked')
      expect(resumed.message).toContain(
        'uncommitted version-2 reconstruction activation bytes or identity do not match'
      )
      expect((await lstat(test.legacy)).isDirectory()).toBe(true)
      await expect(lstat(staleStagingPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('does not refresh a stale reconstruction after recorded history disappears', async () => {
    const test = await fixture('~/.kun/data')
    await writeThread(test.current, 'thr_history', 'history')
    await mkdir(join(test.home, '.deepseekgui'), { recursive: true })
    await symlink(test.current, test.legacy)
    await writeFile(
      join(test.userData, 'kun-runtime-data-migration-v2.json'),
      `${JSON.stringify(completedV2Journal(
        test.legacy,
        test.current,
        ['thr_history']
      ), null, 2)}\n`,
      'utf8'
    )

    const first = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined,
      afterPreservationPhase: (phase) => {
        if (phase === 'candidate-copied') {
          rmSync(join(test.current, 'threads', 'thr_history'), {
            recursive: true,
            force: true
          })
        }
      }
    })
    expect(first.status).toBe('blocked')
    const interruptedJournal = JSON.parse(await readFile(first.journalPath, 'utf8'))
    const staleStagingPath = interruptedJournal.stagingPath as string

    const resumed = runCanonicalKunRuntimeDataMigration({
      userDataPath: test.userData,
      homeDir: test.home,
      sleep: () => undefined
    })

    expect(resumed.status).toBe('blocked')
    expect(resumed.message).toContain('missing 1 threads recorded before the rename migration')
    expect(JSON.parse(await readFile(resumed.journalPath, 'utf8')).stagingPath)
      .toBe(staleStagingPath)
    expect((await lstat(staleStagingPath)).isDirectory()).toBe(true)
    expect((await lstat(test.legacy)).isSymbolicLink()).toBe(true)
  })

})
