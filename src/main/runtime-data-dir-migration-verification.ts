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

function terminalResult(
  journal: VerificationJournal,
  visibleThreadCount: number
): RuntimeMigrationRuntimeVerification | null {
  if (!journal.runtimeVerifiedAt && !journal.runtimeVerificationStoppedAt) return null
  return {
    status: 'not-needed',
    expectedThreadCount: new Set(journal.sourceThreadIds).size,
    visibleThreadCount,
    missingThreadIds: []
  }
}

function verifyCompletedJournal<T extends VerificationJournal>(
  journal: T,
  visibleIds: Set<string>,
  targetThreadIds: string[],
  now: () => Date,
  operations: JournalOperations<T>
): RuntimeMigrationRuntimeVerification {
  const terminal = terminalResult(journal, visibleIds.size)
  if (terminal) return terminal

  const expectedThreadIds = [...new Set([...journal.sourceThreadIds, ...targetThreadIds])]
  const missingThreadIds = expectedThreadIds.filter((threadId) => !visibleIds.has(threadId))
  const counts = {
    expectedThreadCount: expectedThreadIds.length,
    visibleThreadCount: visibleIds.size
  }
  if (missingThreadIds.length === 0) {
    const verified = operations.update(journal, {
      runtimeVerifiedAt: now().toISOString(),
      runtimeVerificationAttempts: undefined,
      runtimeVerificationLastAttemptAt: undefined,
      runtimeVerificationMissingThreadIds: undefined,
      runtimeVerificationStoppedAt: undefined,
      error: undefined
    } as Partial<T>)
    operations.writeReport(verified)
    return { ...counts, status: 'verified', missingThreadIds: [] }
  }

  const attempt = Math.min(
    (journal.runtimeVerificationAttempts ?? 0) + 1,
    RUNTIME_MIGRATION_VERIFICATION_MAX_ATTEMPTS
  )
  const stopped = attempt >= RUNTIME_MIGRATION_VERIFICATION_MAX_ATTEMPTS
  const updated = operations.update(journal, {
    runtimeVerificationAttempts: attempt,
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

  if (verificationOptions.homeDir) {
    const acceptedRecovery = validateAcceptedRuntimeDataRecovery({
      userDataPath,
      homeDir: verificationOptions.homeDir,
      platform: verificationOptions.platform
    })
    if (acceptedRecovery.status === 'valid') {
      // Recovery seals bind the exact journal bytes, so verification must not
      // mutate the preserved evidence even when the Runtime is healthy.
      return {
        status: 'not-needed',
        expectedThreadCount: 0,
        visibleThreadCount: visibleIds.size,
        missingThreadIds: []
      }
    }
  }

  const preservationJournalPath = join(userDataPath, PRESERVATION_JOURNAL_FILE_NAME)
  const preservationJournal = readPreservationJournal(preservationJournalPath)
  if (preservationJournal?.phase === 'completed') {
    return verifyCompletedJournal(
      preservationJournal,
      visibleIds,
      preservationJournal.runtimeVerifiedAt || preservationJournal.runtimeVerificationStoppedAt
        ? []
        : threadIds(preservationJournal.targetPath),
      now,
      {
        update: (journal, patch) => updatePreservationJournal(
          preservationJournalPath,
          journal,
          patch,
          now
        ),
        writeReport: (journal) => { writePreservationReport(userDataPath, journal) }
      }
    )
  }

  const journalPath = join(userDataPath, JOURNAL_FILE_NAME)
  const journal = readJournal(journalPath)
  if (!journal || journal.phase !== 'completed') {
    return {
      status: 'not-needed',
      expectedThreadCount: 0,
      visibleThreadCount: visibleIds.size,
      missingThreadIds: []
    }
  }
  return verifyCompletedJournal(
    journal,
    visibleIds,
    journal.runtimeVerifiedAt || journal.runtimeVerificationStoppedAt
      ? []
      : threadIds(journal.targetPath),
    now,
    {
      update: (current, patch) => updateJournal(journalPath, current, patch, now),
      writeReport: (current) => { writeReport(userDataPath, current) }
    }
  )
}
