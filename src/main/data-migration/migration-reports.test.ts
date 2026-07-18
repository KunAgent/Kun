import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataMigrationImportPlanSchema, DataMigrationReportSchema } from '../../shared/data-migration'
import { cleanupMigrationBackups, MigrationReportStore, sanitizeDataMigrationReport } from './migration-reports'
import { MigrationOperationJournalSchema } from './transaction-journal'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function report() {
  return DataMigrationReportSchema.parse({
    operationId: 'import_report',
    packageId: 'package_report',
    kind: 'import',
    outcome: 'completed-with-review',
    startedAt: '2026-07-15T00:00:00.000Z',
    finishedAt: '2026-07-15T00:01:00.000Z',
    counts: { imported: 2, skipped: 1 },
    workspacePathMap: { ws: '/Users/bob/Imported' },
    threadIdMap: { old: 'new' },
    warnings: [
      'provider apiKey=sk-source must be configured again',
      'Remote https://alice:password@example.com/repo.git was retained as metadata'
    ],
    unresolvedReferences: 1,
    disabledItems: 2,
    error: {
      code: 'RECOVERY_REQUIRED',
      phase: 'verifying',
      message: 'Bearer abc.def was rejected',
      destinationEffect: 'committed',
      retryable: true,
      nextActions: ['Do not paste passphrase=hunter2 into support.'],
      details: { runtimeToken: 'token-value', safeCount: 2 }
    }
  })
}

function journal(input: { operationId: string; phase: 'completed' | 'committing'; backupPath: string; completedAt?: string }) {
  const plan = DataMigrationImportPlanSchema.parse({
    operationId: input.operationId,
    packageId: 'package_report',
    inspectedAt: '2026-07-01T00:00:00.000Z',
    sourcePlatform: 'macos',
    encrypted: true,
    mappings: [], conflicts: [], threadIdMap: {}, unresolvedReferences: [], disabledItems: [],
    estimatedPeakBytes: 0, fatalIssueCount: 0
  })
  return MigrationOperationJournalSchema.parse({
    schemaVersion: 1,
    operationId: input.operationId,
    packageId: 'package_report',
    kind: 'import',
    phase: input.phase,
    ...(input.phase === 'completed' ? { outcome: 'success', completedAt: input.completedAt ?? '2026-07-01T00:00:00.000Z' } : {}),
    startedAt: '2026-07-01T00:00:00.000Z',
    updatedAt: input.completedAt ?? '2026-07-01T00:00:00.000Z',
    plan,
    mutations: [{
      mutationId: 'workspace:replace:ws:0', target: 'workspace', action: 'replace', status: 'applied',
      backupPath: input.backupPath, plannedAt: '2026-07-01T00:00:00.000Z', details: {}
    }],
    warnings: [], manualRecoverySteps: []
  })
}

describe('migration reports and backup retention', () => {
  it('writes immutable local reports and redacts credentials from user-facing strings and detail keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-reports-'))
    roots.push(root)
    const store = new MigrationReportStore(root)
    const path = await store.writeImmutable(report())
    expect(path).toBe(join(root, 'import_report.json'))
    const saved = await store.read('import_report')
    expect(saved.warnings.join(' ')).not.toContain('sk-source')
    expect(saved.warnings.join(' ')).not.toContain('alice:password')
    expect(saved.error?.message).not.toContain('abc.def')
    expect(saved.error?.nextActions[0]).not.toContain('hunter2')
    expect(saved.error?.details).not.toHaveProperty('runtimeToken')
    expect(Object.values(saved.error?.details ?? {})).not.toContain('token-value')
    await expect(store.writeImmutable(report())).resolves.toBe(path)
    await expect(store.writeImmutable({ ...report(), warnings: ['different immutable content'] })).rejects.toThrow(
      'already exists with different content'
    )
  })

  it('sanitizes in memory before data reaches logs or UI', () => {
    const sanitized = sanitizeDataMigrationReport(report())
    expect(JSON.stringify(sanitized)).not.toMatch(/sk-source|hunter2|abc\.def|alice:password|token-value/)
  })

  it('removes expired completed-operation backups but never active or recoverable data', async () => {
    const removePath = vi.fn(async () => undefined)
    const expired = journal({ operationId: 'import_expired', phase: 'completed', backupPath: '/backup/expired' })
    const active = journal({ operationId: 'import_active', phase: 'committing', backupPath: '/backup/active' })
    const result = await cleanupMigrationBackups({
      journals: [expired, active],
      now: new Date('2026-07-15T00:00:00.000Z'),
      removePath
    })
    expect(result.removed).toEqual(['/backup/expired'])
    expect(result.retainedRecoverable).toEqual(['/backup/active'])
    expect(removePath).toHaveBeenCalledTimes(1)
  })

  it('allows disk-pressure cleanup only for terminal journals', async () => {
    const removePath = vi.fn(async () => undefined)
    const recent = journal({
      operationId: 'import_recent', phase: 'completed', backupPath: '/backup/recent',
      completedAt: '2026-07-14T00:00:00.000Z'
    })
    const active = journal({ operationId: 'import_active_pressure', phase: 'committing', backupPath: '/backup/active' })
    await cleanupMigrationBackups({ journals: [recent, active], diskPressure: true, removePath })
    expect(removePath).toHaveBeenCalledWith('/backup/recent')
    expect(removePath).not.toHaveBeenCalledWith('/backup/active')
  })
})
