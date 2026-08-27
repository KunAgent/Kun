import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  markCanonicalKunRuntimeMigrationRuntimeVerified,
  runCanonicalKunRuntimeDataMigration
} from './runtime-data-dir-migration'

const tempRoots: string[] = []
const NOW = () => new Date('2026-08-25T15:00:00.000Z')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-runtime-verification-'))
  tempRoots.push(root)
  const home = join(root, 'home')
  const userData = join(root, 'appData', 'Kun')
  const legacy = join(home, '.deepseekgui', 'kun')
  await mkdir(userData, { recursive: true })
  await writeFile(
    join(userData, 'kun-settings.json'),
    JSON.stringify({ version: 1, agents: { kun: { dataDir: '~/.deepseekgui/kun' } } }),
    'utf8'
  )
  return { home, legacy, userData }
}

async function writeThread(dataDir: string, id: string): Promise<void> {
  const threadDir = join(dataDir, 'threads', id)
  await mkdir(threadDir, { recursive: true })
  await writeFile(join(threadDir, 'metadata.jsonl'), `${JSON.stringify({ id })}\n`, 'utf8')
  await writeFile(join(threadDir, 'messages.jsonl'), '', 'utf8')
}

async function migrate(
  test: Awaited<ReturnType<typeof fixture>>,
  skipHistoryPreservationForTests = false
) {
  await writeThread(test.legacy, 'thr_history')
  const result = runCanonicalKunRuntimeDataMigration({
    userDataPath: test.userData,
    homeDir: test.home,
    sleep: () => undefined,
    availableCopyBytes: () => Number.MAX_SAFE_INTEGER,
    skipHistoryPreservationForTests
  })
  expect(result.status).toBe('completed')
  return result
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

describe('Runtime migration history verification retries', () => {
  it('stops a legacy version-2 journal after bounded missing-thread retries', async () => {
    const test = await fixture()
    const result = await migrate(test, true)

    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(test.userData, [], NOW))
      .toMatchObject({ status: 'incomplete', attempt: 1, maxAttempts: 3 })
    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(test.userData, [], NOW))
      .toMatchObject({ status: 'incomplete', attempt: 2, maxAttempts: 3 })
    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(test.userData, [], NOW))
      .toMatchObject({ status: 'unresolved', attempt: 3, maxAttempts: 3 })

    const unresolvedJournal = await readFile(result.journalPath, 'utf8')
    expect(JSON.parse(unresolvedJournal)).toMatchObject({
      runtimeVerificationAttempts: 3,
      runtimeVerificationMissingThreadIds: ['thr_history'],
      runtimeVerificationStoppedAt: NOW().toISOString()
    })
    expect(JSON.parse(await readFile(result.reportPath!, 'utf8'))).toMatchObject({
      runtimeVerificationAttempts: 3,
      runtimeVerificationMissingThreadIds: ['thr_history'],
      runtimeVerificationStoppedAt: NOW().toISOString()
    })

    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(test.userData, [], NOW))
      .toMatchObject({ status: 'not-needed' })
    expect(await readFile(result.journalPath, 'utf8')).toBe(unresolvedJournal)
  })

  it('verifies a version-3 journal when a missing thread becomes visible before the limit', async () => {
    const test = await fixture()
    const result = await migrate(test)

    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(test.userData, [], NOW))
      .toMatchObject({ status: 'incomplete', attempt: 1 })
    expect(markCanonicalKunRuntimeMigrationRuntimeVerified(test.userData, ['thr_history'], NOW))
      .toMatchObject({ status: 'verified', missingThreadIds: [] })
    expect(JSON.parse(await readFile(result.journalPath, 'utf8'))).toMatchObject({
      runtimeVerifiedAt: NOW().toISOString()
    })
    const journal = JSON.parse(await readFile(result.journalPath, 'utf8'))
    expect(journal.runtimeVerificationAttempts).toBeUndefined()
    expect(journal.runtimeVerificationMissingThreadIds).toBeUndefined()
    expect(journal.runtimeVerificationStoppedAt).toBeUndefined()
  })
})
