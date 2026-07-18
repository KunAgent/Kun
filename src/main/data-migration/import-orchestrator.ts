import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  DATA_MIGRATION_MAX_METADATA_BYTES,
  DataMigrationThreadCatalogEntrySchema,
  DataMigrationWorkspaceCatalogEntrySchema,
  type DataMigrationImportPlan,
  type DataMigrationManifestV1,
  type DataMigrationPackageEntry,
  type DataMigrationProgress,
  type DataMigrationReport,
  type DataMigrationThreadCatalogEntry,
  type DataMigrationWorkspaceCatalogEntry,
  type PackageRelativePath,
  parsePackageRelativePath
} from '../../shared/data-migration'
import { DataMigrationErrorSchema } from '../../shared/data-migration'
import type { JsonSettingsStore } from '../settings-store'
import {
  applyPortableSettingsMigration,
  assertNoImportedTrustOrSecrets,
  importDisabledAutomations,
  importedWorkspaceTrustResets,
  restoreSemanticRendererState,
  type ImportedWorkspaceTrustReset,
  type RestoredRendererState
} from './application-state-migration'
import {
  DEFAULT_KUNPACK_INSPECTION_BUDGET,
  validateKunpackArchiveDirectory,
  validateKunpackLinkMetadata
} from './archive-security'
import { portableSettingsForMigration } from './export-inventory'
import { buildDataMigrationImportPlan, probeDestinationFileSystem } from './import-planner'
import {
  DataMigrationImportTransactionCoordinator,
  type ImportApplicationMutationStep,
  type RuntimeMigrationCommitResult,
  type RuntimeMigrationTransactionClient,
  type StagedWorkspaceCommit
} from './import-transaction'
import { verifyKunpackPackage } from './kunpack-container'
import { extractZip64ArchiveEntries, readZip64Directory, readZip64EntryBuffer } from './kunpack-zip'
import type { MigrationJournalStore } from './transaction-journal'
import { stageWorkspaceImport } from './workspace-staging'

export type KunpackCatalogs = {
  workspaces: DataMigrationWorkspaceCatalogEntry[]
  threads: DataMigrationThreadCatalogEntry[]
  portableSettings?: unknown
  rendererState?: unknown
  automations?: unknown
}

export type DataMigrationPackageInspection = {
  inspectionId: string
  packagePath: string
  manifest: DataMigrationManifestV1
  entries: DataMigrationPackageEntry[]
  catalogs: KunpackCatalogs
  encrypted: boolean
  expandedBytes: number
  compressedBytes: number
  warnings: string[]
}

export interface KunRuntimeMigrationImportClient extends RuntimeMigrationTransactionClient {
  preflight(input: {
    operationId: string
    snapshotPath: string
    workspacePathMap: Record<string, string>
    configuredProviderIds: string[]
    signal?: AbortSignal
  }): Promise<{
    importId: string
    threadIdMap: Record<string, string>
    introducedThreadIds: string[]
    deduplicatedThreadIds: string[]
    recordCount: number
    warnings: string[]
  }>
}

export interface RendererMigrationStateAdapter {
  captureState(): Promise<RestoredRendererState>
  replaceState(state: RestoredRendererState): Promise<void>
  replaceTrustResets(workspaceRoots: string[], resets: ImportedWorkspaceTrustReset[]): Promise<void>
  captureTrustResets(workspaceRoots: string[]): Promise<ImportedWorkspaceTrustReset[]>
  refresh(): Promise<void>
}

export type DataMigrationImportRequest = {
  operationId: string
  inspection: DataMigrationPackageInspection
  plan: DataMigrationImportPlan
  passphrase?: string
  settingsStore: JsonSettingsStore
  runtime?: KunRuntimeMigrationImportClient
  renderer?: RendererMigrationStateAdapter
  signal?: AbortSignal
  onProgress?: (progress: DataMigrationProgress) => void
}

export class DataMigrationImportOrchestrator {
  constructor(
    private readonly temporaryRoot: string,
    private readonly journals: MigrationJournalStore,
    private readonly transactions: DataMigrationImportTransactionCoordinator
  ) {}

  async inspect(input: {
    packagePath: string
    passphrase?: string
    signal?: AbortSignal
  }): Promise<DataMigrationPackageInspection> {
    input.signal?.throwIfAborted()
    const inspectionId = `inspect_${randomUUID().replaceAll('-', '')}`
    const root = join(this.temporaryRoot, inspectionId)
    const zipPath = join(root, 'payload.zip')
    await mkdir(root, { recursive: true, mode: 0o700 })
    try {
      const verified = await verifyKunpackPackage({
        packagePath: input.packagePath,
        materializedZipPath: zipPath,
        cleanupMaterialized: false,
        ...(input.passphrase ? { passphrase: input.passphrase } : {})
      })
      const directory = await readZip64Directory(zipPath)
      validateKunpackArchiveDirectory(directory, verified.entries, DEFAULT_KUNPACK_INSPECTION_BUDGET)
      validateKunpackLinkMetadata(verified.entries)
      const catalogs = await readCatalogs(zipPath, verified.entries)
      assertNoImportedTrustOrSecrets({
        portableSettings: catalogs.portableSettings,
        rendererState: catalogs.rendererState,
        automations: catalogs.automations
      })
      return {
        inspectionId,
        packagePath: input.packagePath,
        manifest: verified.manifest,
        entries: verified.entries,
        catalogs,
        encrypted: verified.header.encryption.mode === 'passphrase',
        expandedBytes: verified.manifest.expandedBytes,
        compressedBytes: directory.reduce((total, entry) => total + entry.compressedBytes, 0),
        warnings: verified.header.encryption.mode === 'none'
          ? ['This unencrypted package has integrity protection but no sender authenticity.']
          : []
      }
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async plan(input: {
    operationId: string
    inspection: DataMigrationPackageInspection
    destinationBaseRoot: string
    destinationRoots?: Readonly<Record<string, string | undefined>>
    strategies?: Parameters<typeof buildDataMigrationImportPlan>[0]['strategies']
    skippedWorkspaceIds?: ReadonlySet<string>
  }): Promise<DataMigrationImportPlan> {
    return buildDataMigrationImportPlan({
      operationId: input.operationId,
      packageId: input.inspection.manifest.packageId,
      inspectedAt: new Date().toISOString(),
      sourcePlatform: input.inspection.manifest.sourcePlatform,
      encrypted: input.inspection.encrypted,
      workspaces: input.inspection.catalogs.workspaces,
      entries: input.inspection.entries,
      destinationBaseRoot: input.destinationBaseRoot,
      ...(input.destinationRoots ? { destinationRoots: input.destinationRoots } : {}),
      ...(input.strategies ? { strategies: input.strategies } : {}),
      ...(input.skippedWorkspaceIds ? { skippedWorkspaceIds: input.skippedWorkspaceIds } : {})
    })
  }

  async import(input: DataMigrationImportRequest): Promise<{ report: DataMigrationReport; refreshRequired: boolean }> {
    input.signal?.throwIfAborted()
    if (input.plan.operationId !== input.operationId) throw new Error('migration plan operation id mismatch')
    if (input.plan.packageId !== input.inspection.manifest.packageId) throw new Error('migration plan package id mismatch')
    if (input.plan.fatalIssueCount > 0 || input.plan.mappings.some((mapping) => !mapping.compatible)) {
      throw new Error('migration plan contains unresolved fatal or incompatible targets')
    }
    await this.transactions.begin(input.plan)
    const operationRoot = this.journals.operationDirectory(input.operationId)
    const zipPath = join(operationRoot, 'payload.zip')
    const stagedWorkspaces: StagedWorkspaceCommit[] = []
    let runtimeImport: { importId: string; client: RuntimeMigrationTransactionClient } | undefined
    let runtimePreflight: Awaited<ReturnType<KunRuntimeMigrationImportClient['preflight']>> | undefined
    try {
      this.progress(input, 'staging', 0, 0, true)
      const verified = await verifyKunpackPackage({
        packagePath: input.inspection.packagePath,
        materializedZipPath: zipPath,
        cleanupMaterialized: false,
        ...(input.passphrase ? { passphrase: input.passphrase } : {})
      })
      if (verified.manifest.packageId !== input.plan.packageId) throw new Error('migration package changed after inspection')
      const workspacePathMap: Record<string, string> = {}
      for (const mapping of input.plan.mappings) {
        input.signal?.throwIfAborted()
        if (mapping.strategy === 'skip' || !mapping.destinationRoot) continue
        const catalog = input.inspection.catalogs.workspaces.find((workspace) => workspace.workspaceId === mapping.workspaceId)
        if (!catalog) throw new Error(`migration workspace catalog is missing: ${mapping.workspaceId}`)
        const probe = await probeDestinationFileSystem(join(mapping.destinationRoot, '..'))
        const staged = await stageWorkspaceImport({
          operationId: input.operationId,
          workspaceId: mapping.workspaceId,
          archivePath: zipPath,
          entries: input.inspection.entries,
          destinationRoot: mapping.destinationRoot,
          destinationPlatform: probe.platform,
          supportsSymbolicLinks: probe.supportsSymbolicLinks,
          signal: input.signal,
          onProgress: ({ path, bytes, entries }) => this.progress(input, 'staging', entries, bytes, true, path)
        })
        stagedWorkspaces.push({
          workspaceId: mapping.workspaceId,
          staged,
          strategy: mapping.strategy,
          resolutions: conflictResolutions(input.plan, mapping.workspaceId),
          renamedPaths: renamedConflictPaths(input.plan, mapping.workspaceId)
        })
        workspacePathMap[catalog.sourcePathDisplay] = mapping.destinationRoot
      }

      const settings = await input.settingsStore.load()
      const runtimeEntry = input.inspection.entries.find((entry) => entry.path === 'payload/runtime/snapshot.jsonl')
      if (runtimeEntry && input.runtime) {
        const runtimeRoot = join(operationRoot, 'runtime')
        const runtimeSnapshotPath = join(runtimeRoot, 'snapshot.jsonl')
        await extractZip64ArchiveEntries({
          archivePath: zipPath,
          destinationRoot: runtimeRoot,
          entries: [runtimeEntry],
          destinationPath: () => runtimeSnapshotPath,
          signal: input.signal
        })
        runtimePreflight = await input.runtime.preflight({
          operationId: input.operationId,
          snapshotPath: runtimeSnapshotPath,
          workspacePathMap,
          configuredProviderIds: settings.provider.providers.map((provider) => provider.id),
          signal: input.signal
        })
        const runtimeClient = withPreflightResult(input.runtime, runtimePreflight)
        runtimeImport = { importId: runtimePreflight.importId, client: runtimeClient }
        await this.journals.writeArtifact(input.operationId, 'runtime-preflight.json', {
          snapshotPath: runtimeSnapshotPath,
          workspacePathMap,
          configuredProviderIds: settings.provider.providers.map((provider) => provider.id),
          preflight: runtimePreflight
        })
      } else if (runtimeEntry) {
        throw new Error('Kun runtime import client is unavailable for this package')
      }

      const applicationSteps = await this.applicationSteps({
        input,
        settings,
        workspacePathMap,
        threadIdMap: runtimePreflight?.threadIdMap ?? {}
      })
      await this.journals.writeArtifact(input.operationId, 'workspace-staging.json', {
        workspaces: stagedWorkspaces.map((workspace) => ({
          workspaceId: workspace.workspaceId,
          entries: workspace.staged.files.map((file) => file.entry)
        }))
      })
      await this.transactions.markStaged(input.operationId)
      const result = await this.transactions.commit({
        operationId: input.operationId,
        workspaces: stagedWorkspaces,
        ...(runtimeImport ? { runtime: runtimeImport } : {}),
        applicationSteps,
        initialWarnings: [...input.inspection.warnings, ...(runtimePreflight?.warnings ?? [])],
        onRefresh: input.renderer ? () => input.renderer!.refresh() : undefined
      })
      this.progress(input, result.journal.phase === 'completed' ? 'completed' : 'failed', 1, input.inspection.expandedBytes, false)
      return { report: result.report, refreshRequired: Boolean(input.renderer) }
    } catch (error) {
      await Promise.all(stagedWorkspaces.map((workspace) =>
        rm(workspace.staged.stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      ))
      const journal = await this.journals.read(input.operationId).catch(() => null)
      if (journal?.phase === 'inspected') {
        if (input.signal?.aborted) {
          await this.journals.setPhase(input.operationId, 'cancelled')
        } else {
          await this.journals.setPhase(input.operationId, 'failed', {
            outcome: 'failed',
            error: DataMigrationErrorSchema.parse({
              code: migrationIoErrorCode(error),
              phase: 'staging',
              message: safeMigrationError(error),
              destinationEffect: stagedWorkspaces.length > 0 ? 'staged-only' : 'untouched',
              retryable: true,
              nextActions: ['Review destination permissions and free space, then retry the import.']
            })
          })
        }
      }
      throw error
    } finally {
      await rm(zipPath, { force: true }).catch(() => undefined)
    }
  }

  private async applicationSteps(input: {
    input: DataMigrationImportRequest
    settings: AppSettingsV1
    workspacePathMap: Record<string, string>
    threadIdMap: Record<string, string>
  }): Promise<ImportApplicationMutationStep[]> {
    const steps: ImportApplicationMutationStep[] = []
    const importedPortable = input.input.inspection.catalogs.portableSettings
    const importedAutomations = input.input.inspection.catalogs.automations
    if (importedPortable !== undefined || importedAutomations !== undefined) {
      let next = importedPortable === undefined
        ? input.settings
        : applyPortableSettingsMigration(input.settings, importedPortable)
      if (importedAutomations !== undefined) {
        next = importDisabledAutomations({
          current: next,
          automations: importedAutomations,
          workspacePathMap: input.workspacePathMap,
          nowIso: new Date().toISOString()
        })
      }
      const beforePortable = portableSettingsForMigration(input.settings)
      const afterPortable = portableSettingsForMigration(next)
      const introducedWorkflowIds = next.workflow.workflows
        .filter((workflow) => !input.settings.workflow.workflows.some((current) => current.id === workflow.id))
        .map((workflow) => workflow.id)
      const introducedScheduleIds = next.schedule.tasks
        .filter((task) => !input.settings.schedule.tasks.some((current) => current.id === task.id))
        .map((task) => task.id)
      await this.journals.writeArtifact(input.input.operationId, 'settings-restore.json', {
        beforePortable,
        afterPortable,
        introducedWorkflowIds,
        introducedScheduleIds,
        introducedWorkflows: next.workflow.workflows.filter((workflow) => introducedWorkflowIds.includes(workflow.id)),
        introducedSchedules: next.schedule.tasks.filter((task) => introducedScheduleIds.includes(task.id))
      })
      steps.push({
        mutationId: 'settings:portable-and-automations:operation:0',
        target: 'settings',
        action: 'portable-and-disabled-automations',
        expectedBeforeIdentity: stateIdentity({ beforePortable, workflowIds: input.settings.workflow.workflows.map((item) => item.id), scheduleIds: input.settings.schedule.tasks.map((item) => item.id) }),
        expectedAfterIdentity: stateIdentity({ afterPortable, introducedWorkflowIds, introducedScheduleIds }),
        details: { artifact: 'settings-restore.json' },
        apply: async () => input.input.settingsStore.save(next),
        verify: async () => {
          const current = await input.input.settingsStore.load()
          if (stateIdentity(portableSettingsForMigration(current)) !== stateIdentity(afterPortable)) {
            throw new Error('portable settings verification failed after migration import completed')
          }
          if (introducedWorkflowIds.some((id) => current.workflow.workflows.find((item) => item.id === id)?.enabled !== false)) {
            throw new Error('imported workflow unexpectedly became active')
          }
          if (introducedScheduleIds.some((id) => current.schedule.tasks.find((item) => item.id === id)?.enabled !== false)) {
            throw new Error('imported schedule unexpectedly became active')
          }
        },
        rollback: async () => {
          const current = await input.input.settingsStore.load()
          const warnings: string[] = []
          const portableUnchanged = stateIdentity(portableSettingsForMigration(current)) === stateIdentity(afterPortable)
          if (!portableUnchanged) warnings.push('Preserved portable settings modified after import; restore them manually if needed.')
          const workflowIdsToRemove = new Set(introducedWorkflowIds.filter((id) => {
            const workflow = current.workflow.workflows.find((item) => item.id === id)
            if (workflow?.enabled || workflow?.callableByAgent) {
              warnings.push(`Preserved independently activated imported workflow: ${id}`)
              return false
            }
            return Boolean(workflow)
          }))
          const scheduleIdsToRemove = new Set(introducedScheduleIds.filter((id) => {
            const task = current.schedule.tasks.find((item) => item.id === id)
            if (task?.enabled) {
              warnings.push(`Preserved independently activated imported schedule: ${id}`)
              return false
            }
            return Boolean(task)
          }))
          const restoredPortable = portableUnchanged ? applyPortableSettingsMigration(current, beforePortable) : current
          await input.input.settingsStore.save({
            ...restoredPortable,
            workflow: {
              ...restoredPortable.workflow,
              workflows: restoredPortable.workflow.workflows.filter((item) => !workflowIdsToRemove.has(item.id))
            },
            schedule: {
              ...restoredPortable.schedule,
              tasks: restoredPortable.schedule.tasks.filter((item) => !scheduleIdsToRemove.has(item.id))
            }
          })
          return warnings
        }
      })
    }

    if (input.input.renderer && input.input.inspection.catalogs.rendererState !== undefined) {
      const catalog = asRecord(input.input.inspection.catalogs.rendererState)
      const imported = restoreSemanticRendererState({
        state: catalog.value,
        workspacePathMap: input.workspacePathMap,
        threadIdMap: input.threadIdMap,
        sourcePlatform: input.input.inspection.manifest.sourcePlatform
      })
      const before = await input.input.renderer.captureState()
      const after = mergeRendererStates(before, imported)
      await this.journals.writeArtifact(input.input.operationId, 'renderer-state-restore.json', { before, after })
      steps.push({
        mutationId: 'renderer-state:semantic-restore:operation:0',
        target: 'renderer-state',
        action: 'semantic-restore',
        expectedBeforeIdentity: stateIdentity(before),
        expectedAfterIdentity: stateIdentity(after),
        details: { artifact: 'renderer-state-restore.json' },
        apply: () => input.input.renderer!.replaceState(after),
        verify: async () => {
          if (stateIdentity(await input.input.renderer!.captureState()) !== stateIdentity(after)) {
            throw new Error('renderer semantic state verification failed after migration import completed')
          }
        },
        rollback: async () => {
          const current = await input.input.renderer!.captureState()
          if (stateIdentity(current) !== stateIdentity(after)) {
            return ['Preserved renderer state modified after import; restore registries manually if needed.']
          }
          await input.input.renderer!.replaceState(before)
          return []
        }
      })
    }

    if (input.input.renderer) {
      const workspaceRoots = Object.values(input.workspacePathMap)
      const beforeTrust = await input.input.renderer.captureTrustResets(workspaceRoots)
      const afterTrust = importedWorkspaceTrustResets(workspaceRoots)
      await this.journals.writeArtifact(input.input.operationId, 'trust-restore.json', { beforeTrust, afterTrust })
      steps.push({
        mutationId: 'trust:reset-imported-workspaces:operation:0',
        target: 'trust',
        action: 'reset-imported-workspaces',
        expectedBeforeIdentity: stateIdentity(beforeTrust),
        expectedAfterIdentity: stateIdentity(afterTrust),
        details: { artifact: 'trust-restore.json' },
        apply: () => input.input.renderer!.replaceTrustResets(workspaceRoots, afterTrust),
        verify: async () => {
          if (stateIdentity(await input.input.renderer!.captureTrustResets(workspaceRoots)) !== stateIdentity(afterTrust)) {
            throw new Error('imported workspace trust reset verification failed')
          }
        },
        rollback: async () => {
          const current = await input.input.renderer!.captureTrustResets(workspaceRoots)
          if (stateIdentity(current) !== stateIdentity(afterTrust)) {
            return ['Preserved workspace trust state modified after import.']
          }
          await input.input.renderer!.replaceTrustResets(workspaceRoots, beforeTrust)
          return []
        }
      })
    }
    return steps
  }

  private progress(
    input: Pick<DataMigrationImportRequest, 'operationId' | 'onProgress'>,
    phase: DataMigrationProgress['phase'],
    completedItems: number,
    completedBytes: number,
    cancellable: boolean,
    currentPath?: PackageRelativePath
  ): void {
    input.onProgress?.({
      operationId: input.operationId,
      kind: 'import',
      phase,
      completedItems,
      completedBytes,
      ...(currentPath ? { currentPath } : {}),
      cancellable,
      ...(cancellable ? { cancellationEffect: phase === 'staging' ? 'cleanup' : 'rollback' } : {}),
      updatedAt: new Date().toISOString()
    })
  }
}

async function readCatalogs(zipPath: string, entries: readonly DataMigrationPackageEntry[]): Promise<KunpackCatalogs> {
  const has = (path: string) => entries.some((entry) => entry.path === path)
  const read = async (path: string) => JSON.parse((await readZip64EntryBuffer(
    zipPath,
    parsePackageRelativePath(path),
    DATA_MIGRATION_MAX_METADATA_BYTES
  )).toString('utf8'))
  const workspaces = has('catalog/workspaces.json') ? await read('catalog/workspaces.json') : []
  const threads = has('catalog/threads.json') ? await read('catalog/threads.json') : []
  return {
    workspaces: DataMigrationWorkspaceCatalogEntrySchema.array().parse(workspaces),
    threads: DataMigrationThreadCatalogEntrySchema.array().parse(threads),
    ...(has('catalog/portable-settings.json') ? { portableSettings: await read('catalog/portable-settings.json') } : {}),
    ...(has('catalog/renderer-state.json') ? { rendererState: await read('catalog/renderer-state.json') } : {}),
    ...(has('catalog/automations.json') ? { automations: await read('catalog/automations.json') } : {})
  }
}

function conflictResolutions(plan: DataMigrationImportPlan, workspaceId: string) {
  return Object.fromEntries(plan.conflicts.flatMap((conflict) =>
    conflict.workspaceId === workspaceId && conflict.resolution ? [[conflict.path, conflict.resolution]] : []
  ))
}

function renamedConflictPaths(plan: DataMigrationImportPlan, workspaceId: string) {
  return Object.fromEntries(plan.conflicts.flatMap((conflict) =>
    conflict.workspaceId === workspaceId && conflict.renamedPath ? [[conflict.path, conflict.renamedPath]] : []
  ))
}

function withPreflightResult(
  client: KunRuntimeMigrationImportClient,
  preflight: Awaited<ReturnType<KunRuntimeMigrationImportClient['preflight']>>
): RuntimeMigrationTransactionClient {
  const enrich = (result: RuntimeMigrationCommitResult): RuntimeMigrationCommitResult => ({
    ...result,
    threadIdMap: preflight.threadIdMap,
    warnings: [...new Set([...preflight.warnings, ...result.warnings])],
    counts: {
      ...result.counts,
      deduplicatedThreads: preflight.deduplicatedThreadIds.length,
      introducedThreads: preflight.introducedThreadIds.length
    }
  })
  return {
    commit: async (importId) => enrich(await client.commit(importId)),
    verify: async (importId) => enrich(await client.verify(importId)),
    rollback: async (importId) => enrich(await client.rollback(importId)),
    ...(client.finalize ? { finalize: (importId: string) => client.finalize!(importId) } : {})
  }
}

function mergeRendererStates(before: RestoredRendererState, imported: RestoredRendererState): RestoredRendererState {
  return {
    schemaVersion: 1,
    design: mergeSemanticArray(before.design, imported.design),
    write: mergeSemanticArray(before.write, imported.write),
    plans: mergeSemanticArray(before.plans, imported.plans),
    sdd: mergeSemanticArray(before.sdd, imported.sdd),
    forks: mergeSemanticArray(before.forks, imported.forks),
    threads: mergeSemanticArray(before.threads, imported.threads),
    composer: { ...before.composer, ...imported.composer },
    workspaces: mergeSemanticArray(before.workspaces, imported.workspaces),
    unresolvedReferences: [...before.unresolvedReferences, ...imported.unresolvedReferences]
  }
}

function mergeSemanticArray(before: unknown[], imported: unknown[]): unknown[] {
  const values = new Map<string, unknown>()
  for (const value of [...before, ...imported]) values.set(semanticKey(value), value)
  return [...values.values()]
}

function semanticKey(value: unknown): string {
  const record = asRecord(value)
  const id = ['id', 'threadId', 'draftId', 'workspaceRoot', 'path'].map((key) => record[key]).find((item) => typeof item === 'string')
  return typeof id === 'string' ? `${id}:${stateIdentity(value)}` : stateIdentity(value)
}

function stateIdentity(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonical(child)]))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function migrationIoErrorCode(error: unknown): 'SPACE_INSUFFICIENT' | 'IO_PERMISSION_DENIED' | 'PACKAGE_INTEGRITY_FAILED' {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return 'SPACE_INSUFFICIENT'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'IO_PERMISSION_DENIED'
  return 'PACKAGE_INTEGRITY_FAILED'
}

function safeMigrationError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ').slice(0, 500) || 'migration staging failed'
}
