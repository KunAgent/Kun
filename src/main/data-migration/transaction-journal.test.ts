import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DataMigrationImportPlanSchema } from '../../shared/data-migration'
import { MigrationJournalStore, migrationMutationId } from './transaction-journal'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function plan(operationId = 'import_journal') {
  return DataMigrationImportPlanSchema.parse({
    operationId,
    packageId: 'package_journal',
    inspectedAt: '2026-07-15T00:00:00.000Z',
    sourcePlatform: 'windows',
    encrypted: true,
    mappings: [],
    conflicts: [],
    threadIdMap: {},
    unresolvedReferences: [],
    disabledItems: [],
    estimatedPeakBytes: 0,
    fatalIssueCount: 0
  })
}

describe('durable migration transaction journal', () => {
  it('persists the inspected plan and a mutation before the external action is marked applied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-journal-'))
    roots.push(root)
    let now = new Date('2026-07-15T00:00:00.000Z')
    const store = new MigrationJournalStore(root, () => now)
    await store.createInspected(plan())
    await store.setPhase('import_journal', 'staged')
    const mutationId = migrationMutationId({ target: 'workspace', action: 'create', ownerId: 'ws', ordinal: 1 })
    await store.planMutation('import_journal', {
      mutationId,
      target: 'workspace',
      action: 'create',
      targetPath: '/target/Project',
      sourcePath: '/target/.kun-migration-staging/import/ws',
      expectedAfterIdentity: 'tree:abc',
      details: { workspaceId: 'ws' }
    })

    const onDiskBeforeAction = JSON.parse(await readFile(join(root, 'import_journal', 'journal.json'), 'utf8'))
    expect(onDiskBeforeAction.mutations[0].status).toBe('planned')
    now = new Date('2026-07-15T00:00:01.000Z')
    await store.markMutationApplied('import_journal', mutationId)

    const afterRestart = await new MigrationJournalStore(root).read('import_journal')
    expect(afterRestart.mutations[0]).toMatchObject({ mutationId, status: 'applied' })
  })

  it('enforces phase transitions, records cancellation, and exposes startup recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-recovery-'))
    roots.push(root)
    const store = new MigrationJournalStore(root)
    await store.createInspected(plan('import_recovery'))
    await expect(store.setPhase('import_recovery', 'committing')).rejects.toThrow(/invalid.*transition/)
    await store.setPhase('import_recovery', 'staged')
    await store.setPhase('import_recovery', 'committing')
    const cancelled = await store.requestCancellation('import_recovery')
    expect(cancelled.cancellationRequestedAt).toBeTruthy()
    expect((await new MigrationJournalStore(root).listIncomplete()).map((journal) => journal.operationId)).toEqual([
      'import_recovery'
    ])
  })

  it('serializes concurrent journal updates without dropping recovery findings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-journal-lock-'))
    roots.push(root)
    const store = new MigrationJournalStore(root)
    await store.createInspected(plan('import_parallel'))
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.appendRecoveryFindings('import_parallel', {
      warnings: [`warning-${index}`]
    })))
    expect((await store.read('import_parallel')).warnings).toHaveLength(20)
  })

  it('does not let a mutation id be reused for a different target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-migration-journal-id-'))
    roots.push(root)
    const store = new MigrationJournalStore(root)
    await store.createInspected(plan('import_mutation_id'))
    await store.setPhase('import_mutation_id', 'staged')
    const mutation = {
      mutationId: 'workspace:create:ws:0',
      target: 'workspace' as const,
      action: 'create',
      targetPath: '/first',
      expectedAfterIdentity: 'sha256:first',
      details: {}
    }
    await store.planMutation('import_mutation_id', mutation)
    await expect(store.planMutation('import_mutation_id', { ...mutation, targetPath: '/second' })).rejects.toThrow(
      /reused with different content/
    )
  })
})
