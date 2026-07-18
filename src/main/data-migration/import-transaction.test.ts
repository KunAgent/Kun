import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataMigrationImportPlanSchema, parsePackageRelativePath } from '../../shared/data-migration'
import { DataMigrationImportTransactionCoordinator, type RuntimeMigrationTransactionClient } from './import-transaction'
import { MigrationReportStore } from './migration-reports'
import { MigrationJournalStore, migrationMutationId } from './transaction-journal'
import { prepareZip64ArchiveEntries, writeZip64Archive } from './kunpack-zip'
import { commitStagedWorkspace, stageWorkspaceImport } from './workspace-staging'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-import-transaction-'))
  roots.push(root)
  const archivePath = join(root, 'payload.zip')
  const prepared = await prepareZip64ArchiveEntries([{
    path: parsePackageRelativePath('payload/workspaces/ws_test/files/README.md'),
    kind: 'workspace-file' as const,
    ownerId: 'ws_test',
    source: { kind: 'buffer' as const, data: Buffer.from('imported') }
  }])
  await writeZip64Archive({ outputPath: archivePath, entries: prepared })
  const destinationRoot = join(root, 'Project (Imported)')
  const staged = await stageWorkspaceImport({
    operationId: 'import_tx',
    workspaceId: 'ws_test',
    archivePath,
    entries: prepared.map((entry) => entry.metadata),
    destinationRoot,
    destinationPlatform: process.platform === 'win32' ? 'windows' : 'macos',
    supportsSymbolicLinks: false
  })
  const plan = DataMigrationImportPlanSchema.parse({
    operationId: 'import_tx',
    packageId: 'package_tx',
    inspectedAt: '2026-07-15T00:00:00.000Z',
    sourcePlatform: 'windows',
    encrypted: true,
    mappings: [{
      workspaceId: 'ws_test', sourcePathDisplay: 'C:\\Project', destinationRoot,
      strategy: 'keep-both', compatible: true, requiredBytes: 8, unresolvedIssueCount: 0
    }],
    conflicts: [], threadIdMap: {}, unresolvedReferences: [], disabledItems: [],
    estimatedPeakBytes: 1024, fatalIssueCount: 0
  })
  const journals = new MigrationJournalStore(join(root, 'journals'))
  const reports = new MigrationReportStore(join(root, 'reports'))
  const coordinator = new DataMigrationImportTransactionCoordinator(journals, reports)
  await coordinator.begin(plan)
  await coordinator.markStaged(plan.operationId)
  return { root, destinationRoot, staged, plan, journals, reports, coordinator }
}

function runtimeClient(): RuntimeMigrationTransactionClient & {
  commit: ReturnType<typeof vi.fn>
  verify: ReturnType<typeof vi.fn>
  rollback: ReturnType<typeof vi.fn>
} {
  const result = { counts: { threads: 1 }, warnings: [], threadIdMap: { old: 'new' } }
  return {
    commit: vi.fn(async () => result),
    verify: vi.fn(async () => result),
    rollback: vi.fn(async () => ({ ...result, counts: {} }))
  }
}

describe('migration import transaction coordination', () => {
  it('commits workspaces, runtime, and application state in order and verifies before completion', async () => {
    const value = await fixture()
    const runtime = runtimeClient()
    let applicationState = 'before'
    const result = await value.coordinator.commit({
      operationId: value.plan.operationId,
      workspaces: [{ workspaceId: 'ws_test', staged: value.staged, strategy: 'keep-both' }],
      runtime: { importId: 'runtime_import', client: runtime },
      applicationSteps: [{
        mutationId: 'settings:portable:operation:0', target: 'settings', action: 'portable-apply', details: {},
        expectedBeforeIdentity: 'before', expectedAfterIdentity: 'after',
        apply: async () => { applicationState = 'after' },
        verify: async () => { expect(applicationState).toBe('after') },
        rollback: async () => { applicationState = 'before'; return [] }
      }],
      onRefresh: async () => { expect(applicationState).toBe('after') }
    })

    expect(result.journal).toMatchObject({ phase: 'completed', outcome: 'success' })
    expect(result.report.threadIdMap).toEqual({ old: 'new' })
    expect(await readFile(join(value.destinationRoot, 'README.md'), 'utf8')).toBe('imported')
    expect(runtime.commit).toHaveBeenCalledBefore(runtime.verify)
    expect((await value.reports.list())).toHaveLength(1)
  })

  it('rolls back earlier targets when a later application mutation fails', async () => {
    const value = await fixture()
    let rollbackCalled = false
    const result = await value.coordinator.commit({
      operationId: value.plan.operationId,
      workspaces: [{ workspaceId: 'ws_test', staged: value.staged, strategy: 'keep-both' }],
      applicationSteps: [{
        mutationId: 'renderer-state:apply:operation:0', target: 'renderer-state', action: 'apply', details: {},
        apply: async () => { throw new Error('injected renderer failure') },
        verify: async () => undefined,
        rollback: async () => { rollbackCalled = true; return [] }
      }]
    })

    expect(result.journal).toMatchObject({ phase: 'completed', outcome: 'rolled-back' })
    expect(rollbackCalled).toBe(true)
    await expect(readFile(join(value.destinationRoot, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves independently modified imported data and requires manual recovery', async () => {
    const value = await fixture()
    const importedPath = join(value.destinationRoot, 'README.md')
    const result = await value.coordinator.commit({
      operationId: value.plan.operationId,
      workspaces: [{ workspaceId: 'ws_test', staged: value.staged, strategy: 'keep-both' }],
      applicationSteps: [{
        mutationId: 'settings:fail:operation:0', target: 'settings', action: 'fail', details: {},
        apply: async () => {
          await writeFile(importedPath, 'user modified after workspace commit')
          throw new Error('injected settings failure')
        },
        verify: async () => undefined,
        rollback: async () => []
      }]
    })

    expect(result.journal).toMatchObject({ phase: 'failed', outcome: 'failed' })
    expect(result.journal.manualRecoverySteps.join(' ')).toMatch(/Preserved independently modified path/)
    expect(await readFile(importedPath, 'utf8')).toBe('user modified after workspace commit')
  })

  it('finishes the current runtime action and rolls the whole transaction back after commit-phase cancellation', async () => {
    const value = await fixture()
    const runtime = runtimeClient()
    runtime.commit.mockImplementation(async () => {
      await value.coordinator.requestCancellation(value.plan.operationId)
      return { counts: { threads: 1 }, warnings: [] }
    })
    const result = await value.coordinator.commit({
      operationId: value.plan.operationId,
      workspaces: [{ workspaceId: 'ws_test', staged: value.staged, strategy: 'keep-both' }],
      runtime: { importId: 'runtime_cancel', client: runtime }
    })

    expect(result.journal).toMatchObject({ phase: 'completed', outcome: 'rolled-back' })
    expect(runtime.rollback).toHaveBeenCalledWith('runtime_cancel')
    await expect(readFile(join(value.destinationRoot, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resumes idempotently when a crash lands after an atomic rename but before its applied marker', async () => {
    const value = await fixture()
    await value.journals.setPhase(value.plan.operationId, 'committing')
    await expect(commitStagedWorkspace({
      staged: value.staged,
      strategy: 'keep-both',
      lifecycle: {
        before: async (mutation, ordinal) => {
          await value.journals.planMutation(value.plan.operationId, {
            mutationId: migrationMutationId({ target: 'workspace', action: mutation.kind, ownerId: 'ws_test', ordinal }),
            target: 'workspace', action: mutation.kind, targetPath: mutation.destinationPath,
            ...(mutation.sourcePath ? { sourcePath: mutation.sourcePath } : {}),
            ...(mutation.expectedSha256 ? { expectedAfterIdentity: mutation.expectedSha256 } : {}),
            details: { workspaceId: 'ws_test', ordinal }
          })
        },
        after: async () => { throw new Error('simulated process crash before applied marker') }
      }
    })).rejects.toThrow(/simulated process crash/)
    expect((await value.journals.read(value.plan.operationId)).mutations[0]?.status).toBe('planned')

    const resumed = await value.coordinator.commit({
      operationId: value.plan.operationId,
      workspaces: [{ workspaceId: 'ws_test', staged: value.staged, strategy: 'keep-both' }]
    })
    expect(resumed.journal).toMatchObject({ phase: 'completed', outcome: 'success' })
    expect(resumed.journal.mutations[0]?.status).toBe('verified')
    expect(await readFile(join(value.destinationRoot, 'README.md'), 'utf8')).toBe('imported')
  })

  it('resumes directly from verification without applying application state twice', async () => {
    const value = await fixture()
    await value.journals.setPhase(value.plan.operationId, 'committing')
    await value.journals.planMutation(value.plan.operationId, {
      mutationId: 'settings:resume:operation:0', target: 'settings', action: 'resume', details: {}
    })
    await value.journals.markMutationApplied(value.plan.operationId, 'settings:resume:operation:0')
    await value.journals.setPhase(value.plan.operationId, 'verifying')
    const apply = vi.fn(async () => undefined)
    const verify = vi.fn(async () => undefined)
    const result = await value.coordinator.commit({
      operationId: value.plan.operationId,
      workspaces: [],
      applicationSteps: [{
        mutationId: 'settings:resume:operation:0', target: 'settings', action: 'resume', details: {},
        apply, verify, rollback: async () => []
      }]
    })
    expect(result.journal).toMatchObject({ phase: 'completed', outcome: 'success' })
    expect(apply).not.toHaveBeenCalled()
    expect(verify).toHaveBeenCalledOnce()
  })
})
