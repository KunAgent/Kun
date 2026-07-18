import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { JsonSettingsStore } from '../settings-store'
import { DataMigrationExportOrchestrator, type KunMigrationSnapshotClient } from './export-orchestrator'
import { DataMigrationImportOrchestrator, type RendererMigrationStateAdapter } from './import-orchestrator'
import { DataMigrationImportTransactionCoordinator } from './import-transaction'
import { MigrationReportStore } from './migration-reports'
import { MigrationJournalStore } from './transaction-journal'
import type { ImportedWorkspaceTrustReset, RestoredRendererState } from './application-state-migration'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function settings(workspaceRoot: string, locale: 'en' | 'zh', theme: 'system' | 'light' | 'dark'): AppSettingsV1 {
  const base = normalizeAppSettings({} as AppSettingsV1)
  return normalizeAppSettings({
    ...base,
    locale,
    theme,
    workspaceRoot,
    conversationWorkspaceRoot: join(workspaceRoot, 'conversations'),
    write: { ...base.write, defaultWorkspaceRoot: workspaceRoot },
    design: { ...base.design, defaultWorkspaceRoot: workspaceRoot }
  })
}

function noRuntimeExport(): KunMigrationSnapshotClient {
  return {
    create: vi.fn(async () => { throw new Error('runtime export should not run') }),
    download: vi.fn(async () => { throw new Error('runtime export should not run') }),
    release: vi.fn(async () => undefined)
  }
}

function emptyRendererState(): RestoredRendererState {
  return {
    schemaVersion: 1,
    design: [], write: [], plans: [], sdd: [], forks: [], threads: [], composer: {}, workspaces: [],
    unresolvedReferences: []
  }
}

describe('data migration import orchestration', () => {
  it('inspects, plans, stages, commits, verifies, and restores portable state end to end', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-import-orchestrator-'))
    roots.push(root)
    const sourceRoot = join(root, 'source-project')
    const destinationBaseRoot = join(root, 'destination')
    const packagePath = join(root, 'transfer.kunpack')
    await mkdir(sourceRoot, { recursive: true })
    await mkdir(destinationBaseRoot, { recursive: true })
    await writeFile(join(sourceRoot, 'README.md'), '# Migrated\n')
    const sourceSettings = settings(sourceRoot, 'zh', 'dark')
    await new DataMigrationExportOrchestrator(noRuntimeExport()).export({
      operationId: 'export_e2e',
      outputPath: packagePath,
      settings: sourceSettings,
      runtimeThreads: [],
      selectedWorkspaceIds: [],
      selectedThreadIds: [],
      categories: ['workspace-files', 'portable-settings', 'renderer-state'],
      preset: 'complete',
      sensitiveContentAcknowledged: false,
      unencryptedPackageAcknowledged: true,
      runningThreadPolicy: 'wait',
      rendererState: { design: [{ workspaceRoot: sourceRoot, label: 'Imported design' }] },
      sourceInstallationId: 'installation_e2e',
      sourceAppVersion: 'test',
      sourceRuntimeVersion: 'test'
    })

    const userData = join(root, 'user-data')
    const targetSettings = settings(join(root, 'target-local-root'), 'en', 'light')
    const settingsStore = new JsonSettingsStore(userData)
    await settingsStore.save(targetSettings)
    const journals = new MigrationJournalStore(join(userData, 'migration-operations'))
    const reports = new MigrationReportStore(join(userData, 'migration-reports'))
    const transactions = new DataMigrationImportTransactionCoordinator(journals, reports)
    const orchestrator = new DataMigrationImportOrchestrator(join(userData, 'migration-temp'), journals, transactions)
    const inspection = await orchestrator.inspect({ packagePath })
    const plan = await orchestrator.plan({
      operationId: 'import_e2e',
      inspection,
      destinationBaseRoot
    })

    let rendererState = emptyRendererState()
    let trust: ImportedWorkspaceTrustReset[] = []
    const renderer: RendererMigrationStateAdapter = {
      captureState: async () => structuredClone(rendererState),
      replaceState: async (state) => { rendererState = structuredClone(state) },
      replaceTrustResets: async (_workspaceRoots, resets) => { trust = structuredClone(resets) },
      captureTrustResets: async (rootsToRead) => trust.filter((item) => rootsToRead.includes(item.workspaceRoot)),
      refresh: vi.fn(async () => undefined)
    }
    const progress: string[] = []
    const result = await orchestrator.import({
      operationId: 'import_e2e',
      inspection,
      plan,
      settingsStore,
      renderer,
      onProgress: (value) => progress.push(value.phase)
    })

    const sourceWorkspaceId = inspection.catalogs.workspaces.find((workspace) => workspace.sourcePathDisplay === sourceRoot)!.workspaceId
    const destination = plan.mappings.find((mapping) => mapping.workspaceId === sourceWorkspaceId)!.destinationRoot!
    expect(result.report.outcome).toBe('completed-with-review')
    expect(await readFile(join(destination, 'README.md'), 'utf8')).toBe('# Migrated\n')
    const migratedSettings = await settingsStore.load()
    expect(migratedSettings).toMatchObject({ locale: 'zh', theme: 'dark' })
    expect(migratedSettings.workspaceRoot).toBe(targetSettings.workspaceRoot)
    expect(migratedSettings.provider).toEqual(targetSettings.provider)
    expect(rendererState.design).toContainEqual({ workspaceRoot: destination, label: 'Imported design' })
    expect(trust).toContainEqual(expect.objectContaining({ workspaceRoot: destination, trusted: false }))
    expect(progress).toEqual(expect.arrayContaining(['staging', 'completed']))
    expect((await journals.listIncomplete())).toEqual([])
    expect((await reports.list())).toHaveLength(1)
  })

  it('rejects an inspected package that tries to smuggle credential or trust fields through semantic catalogs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-import-orchestrator-deny-'))
    roots.push(root)
    const sourceRoot = join(root, 'source-project')
    const packagePath = join(root, 'unsafe.kunpack')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(sourceRoot, 'README.md'), 'unsafe')
    const sourceSettings = settings(sourceRoot, 'en', 'light')
    await new DataMigrationExportOrchestrator(noRuntimeExport()).export({
      operationId: 'export_unsafe', outputPath: packagePath, settings: sourceSettings,
      runtimeThreads: [], selectedWorkspaceIds: [], selectedThreadIds: [],
      categories: ['workspace-files', 'renderer-state'], preset: 'complete',
      sensitiveContentAcknowledged: false, unencryptedPackageAcknowledged: true,
      runningThreadPolicy: 'wait', rendererState: { design: [{ apiKey: 'must-not-import' }] },
      sourceInstallationId: 'installation_unsafe', sourceAppVersion: 'test', sourceRuntimeVersion: 'test'
    })
    const journals = new MigrationJournalStore(join(root, 'journals'))
    const reports = new MigrationReportStore(join(root, 'reports'))
    const orchestrator = new DataMigrationImportOrchestrator(
      join(root, 'tmp'), journals, new DataMigrationImportTransactionCoordinator(journals, reports)
    )
    await expect(orchestrator.inspect({ packagePath })).rejects.toThrow(/forbidden trust or secret fields/)
  })
})
