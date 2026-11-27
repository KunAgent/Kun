import { join } from 'node:path'
import { validateAcceptedRuntimeDataRecovery } from './runtime-data-dir-recovery'
import {
  JOURNAL_FILE_NAME,
  PRESERVATION_JOURNAL_FILE_NAME,
  type PreservationJournal,
  type RuntimeMigrationJournal
} from './runtime-data-dir-migration-types'
import { readJournal } from './runtime-data-dir-migration-journal-v2'
import {
  readPreservationJournal,
  updateJournal,
  updatePreservationJournal
} from './runtime-data-dir-migration-journal-preservation'
import { threadIds } from './runtime-data-dir-migration-inventory'
import { writeReport } from './runtime-data-dir-migration-salvage'
import { writePreservationReport } from './runtime-data-dir-migration-preservation-validation'

export const RUNTIME_MIGRATION_VERIFICATION_MAX_ATTEMPTS = 3

type VerificationCounts = {
  expectedThreadCount: number
  visibleThreadCount: number
}

export type RuntimeMigrationRuntimeVerification =
  | (VerificationCounts & {
      status: 'not-needed'
      missingThreadIds: []
    })
  | (VerificationCounts & {
      status: 'incomplete'
      missingThreadIds: string[]
      attempt: number
      maxAttempts: number
    })
  | (VerificationCounts & {
      status: 'unresolved'
      missingThreadIds: string[]
      attempt: number
      maxAttempts: number
    })
  | (VerificationCounts & {
      status: 'verified'
      missingThreadIds: []
    })

type VerificationJournal = RuntimeMigrationJournal | PreservationJournal

type JournalOperations<T extends VerificationJournal> = {
  update: (journal: T, patch: Partial<T>) => T
  writeReport: (journal: T) => void
}

type VerificationLocation = { homeDir?: string; platform?: NodeJS.Platform }

function completedVerificationJournal(userDataPath: string, options: VerificationLocation): VerificationJournal | null {
  if (options.homeDir && validateAcceptedRuntimeDataRecovery({
    userDataPath, homeDir: options.homeDir, platform: options.platform
  }).status === 'valid') return null // The recovery seal binds the exact journal bytes.
  const preservation = readPreservationJournal(join(userDataPath, PRESERVATION_JOURNAL_FILE_NAME))
  if (preservation?.phase === 'completed') return preservation
  const legacy = readJournal(join(userDataPath, JOURNAL_FILE_NAME))
  return legacy?.phase === 'completed' ? legacy : null
}

function needsThreadInventory(journal: VerificationJournal): boolean {
  // Older clients stopped after comparing only the first page. Give that
  // journal one complete inventory before honoring its exhausted retry budget.
  return !journal.runtimeVerifiedAt &&
    !(journal.runtimeVerificationStoppedAt && journal.runtimeVerificationInventory === 'paginated')
}

export function runtimeMigrationNeedsThreadInventory(userDataPath: string, options: VerificationLocation): boolean {
  const journal = completedVerificationJournal(userDataPath, options)
  return journal !== null && needsThreadInventory(journal)
}

function verifyCompletedJournal<T extends VerificationJournal>(
  journal: T,
  visibleIds: Set<string>,
  targetThreadIds: string[],
  now: () => Date,
  operations: JournalOperations<T>
): RuntimeMigrationRuntimeVerification {
  const expectedThreadIds = [...new Set([...journal.sourceThreadIds, ...targetThreadIds])]
  const missingThreadIds = expectedThreadIds.filter((threadId) => !visibleIds.has(threadId))
  const counts = {
    expectedThreadCount: expectedThreadIds.length,
    visibleThreadCount: visibleIds.size
  }
  if (missingThreadIds.length === 0) {
    const verified = operations.update(journal, {
      runtimeVerifiedAt: now().toISOString(),
      runtimeVerificationInventory: 'paginated',
      runtimeVerificationAttempts: undefined,
      runtimeVerificationLastAttemptAt: undefined,
      runtimeVerificationMissingThreadIds: undefined,
      runtimeVerificationStoppedAt: undefined,
      error: undefined
    } as Partial<T>)
    operations.writeReport(verified)
    return { ...counts, status: 'verified', missingThreadIds: [] }
  }

  const attempt = journal.runtimeVerificationStoppedAt
    ? RUNTIME_MIGRATION_VERIFICATION_MAX_ATTEMPTS
    : Math.min((journal.runtimeVerificationAttempts ?? 0) + 1, RUNTIME_MIGRATION_VERIFICATION_MAX_ATTEMPTS)
  const stopped = attempt >= RUNTIME_MIGRATION_VERIFICATION_MAX_ATTEMPTS
  const updated = operations.update(journal, {
    runtimeVerificationAttempts: attempt,
    runtimeVerificationInventory: stopped ? 'paginated' : undefined,
    runtimeVerificationLastAttemptAt: now().toISOString(),
    runtimeVerificationMissingThreadIds: missingThreadIds,
    runtimeVerificationStoppedAt: stopped ? now().toISOString() : undefined
  } as Partial<T>)
  operations.writeReport(updated)
  return {
    ...counts,
    status: stopped ? 'unresolved' : 'incomplete',
    missingThreadIds,
    attempt,
    maxAttempts: RUNTIME_MIGRATION_VERIFICATION_MAX_ATTEMPTS
  }
}

export function markCanonicalKunRuntimeMigrationRuntimeVerified(
  userDataPath: string,
  visibleRuntimeThreadIds: Iterable<string>,
  nowOrOptions: (() => Date) | {
    now?: () => Date
    homeDir?: string
    platform?: NodeJS.Platform
  } = () => new Date()
): RuntimeMigrationRuntimeVerification {
  const verificationOptions = typeof nowOrOptions === 'function'
    ? { now: nowOrOptions }
    : nowOrOptions
  const now = verificationOptions.now ?? (() => new Date())
  const visibleIds = new Set(visibleRuntimeThreadIds)

  const journal = completedVerificationJournal(userDataPath, verificationOptions)
  if (!journal || !needsThreadInventory(journal)) {
    return {
      status: 'not-needed',
      expectedThreadCount: new Set(journal?.sourceThreadIds).size,
      visibleThreadCount: visibleIds.size,
      missingThreadIds: []
    }
  }

  const targetThreadIds = threadIds(journal.targetPath)
  if (journal.schemaVersion === 3) {
    return verifyCompletedJournal(
      journal,
      visibleIds,
      targetThreadIds,
      now,
      {
        update: (journal, patch) => updatePreservationJournal(
          join(userDataPath, PRESERVATION_JOURNAL_FILE_NAME),
          journal,
          patch,
          now
        ),
        writeReport: (journal) => { writePreservationReport(userDataPath, journal) }
      }
    )
  }

  return verifyCompletedJournal(
    journal,
    visibleIds,
    targetThreadIds,
    now,
    {
      update: (current, patch) => updateJournal(join(userDataPath, JOURNAL_FILE_NAME), current, patch, now),
      writeReport: (current) => { writeReport(userDataPath, current) }
    }
  )
}
