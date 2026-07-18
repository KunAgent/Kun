import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  DATA_MIGRATION_FORMAT_VERSION,
  DATA_MIGRATION_MINIMUM_READER_VERSION,
  DataMigrationSelectionSchema,
  parsePackageRelativePath,
  type DataMigrationCategory,
  type DataMigrationManifestV1,
  type DataMigrationPreset,
  type DataMigrationProgress,
  type DataMigrationReport
} from '../../shared/data-migration'
import {
  assertMigrationOutputOutsideWorkspaces,
  discoverDataMigrationWorkspaces,
  inventoryDataMigrationFiles,
  portableSettingsForMigration,
  sanitizedAutomationsForMigration,
  workspaceFilesToZipEntries
} from './export-inventory'
import {
  createKunpackPackage,
  serializeKunpackJson,
  type KunpackCatalogInput
} from './kunpack-container'
import type { Zip64ArchiveEntryInput } from './kunpack-zip'

export type RuntimeThreadForMigration = {
  id: string
  title: string
  workspace?: string
  status?: 'idle' | 'archived' | 'running'
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  model?: string
  providerId?: string
  createdAt: string
  updatedAt: string
}

export interface KunMigrationSnapshotClient {
  create(input: {
    threadIds: string[]
    includeAttachments: boolean
    includeArtifacts: boolean
    includeMemory: boolean
    runningThreadPolicy: 'wait' | 'interrupt' | 'omit'
    waitTimeoutMs: number
  }, signal?: AbortSignal): Promise<{
    snapshotId: string
    exportedThreadIds: string[]
    omittedThreadIds: string[]
    contentCounts: { attachments: number; artifacts: number; memories: number }
  }>
  download(snapshotId: string, destinationPath: string, signal?: AbortSignal): Promise<{ byteSize: number; sha256: string }>
  release(snapshotId: string): Promise<void>
}

export type DataMigrationExportRequest = {
  operationId: string
  outputPath: string
  settings: AppSettingsV1
  runtimeThreads: RuntimeThreadForMigration[]
  selectedWorkspaceIds: string[]
  selectedThreadIds: string[]
  categories: DataMigrationCategory[]
  preset: DataMigrationPreset
  sensitiveContentAcknowledged: boolean
  unencryptedPackageAcknowledged: boolean
  passphrase?: string
  runningThreadPolicy: 'wait' | 'interrupt' | 'omit'
  rendererState?: unknown
  sourceInstallationId: string
  sourceAppVersion: string
  sourceRuntimeVersion: string
  signal?: AbortSignal
  onProgress?: (progress: DataMigrationProgress) => void
}

export type DataMigrationExportResult = {
  packagePath: string
  packageId: string
  report: DataMigrationReport
}

export class DataMigrationExportOrchestrator {
  constructor(private readonly runtime: KunMigrationSnapshotClient) {}

  async estimate(input: Pick<
    DataMigrationExportRequest,
    'settings' | 'runtimeThreads' | 'selectedWorkspaceIds' | 'preset' | 'sensitiveContentAcknowledged' | 'signal' | 'onProgress' | 'operationId'
  >) {
    const discovered = await discoverDataMigrationWorkspaces({
      settings: input.settings,
      runtimeThreads: input.runtimeThreads
    })
    const selected = input.selectedWorkspaceIds.length > 0
      ? discovered.filter((workspace) => input.selectedWorkspaceIds.includes(workspace.workspaceId))
      : discovered
    return inventoryDataMigrationFiles({
      workspaces: selected,
      preset: input.preset,
      sensitiveContentAcknowledged: input.sensitiveContentAcknowledged,
      signal: input.signal,
      onProgress: ({ files, bytes, path }) => input.onProgress?.({
        operationId: input.operationId,
        kind: 'export',
        phase: 'scanning',
        completedItems: files,
        completedBytes: bytes,
        currentPath: safeProgressPath(path),
        cancellable: true,
        cancellationEffect: 'cleanup',
        updatedAt: new Date().toISOString()
      })
    })
  }

  async export(input: DataMigrationExportRequest): Promise<DataMigrationExportResult> {
    input.signal?.throwIfAborted()
    if (!input.passphrase && !input.unencryptedPackageAcknowledged) {
      throw new Error('creating an unencrypted migration package requires explicit acknowledgement')
    }
    const discovered = await discoverDataMigrationWorkspaces({
      settings: input.settings,
      runtimeThreads: input.runtimeThreads
    })
    const selectedWorkspaces = input.selectedWorkspaceIds.length > 0
      ? discovered.filter((workspace) => input.selectedWorkspaceIds.includes(workspace.workspaceId))
      : discovered
    if (selectedWorkspaces.length !== new Set(input.selectedWorkspaceIds).size && input.selectedWorkspaceIds.length > 0) {
      throw new Error('one or more selected workspaces are no longer available')
    }
    const autoSelectedThreadIds = input.selectedWorkspaceIds.length > 0
      ? [...new Set(selectedWorkspaces.flatMap((workspace) => workspace.relatedThreadIds))]
      : input.runtimeThreads.map((thread) => thread.id)
    const requestedThreadIds = input.categories.includes('thread-history')
      ? (input.selectedThreadIds.length > 0 ? input.selectedThreadIds : autoSelectedThreadIds)
      : []
    const selection = DataMigrationSelectionSchema.parse({
      preset: input.preset,
      workspaceIds: selectedWorkspaces.map((workspace) => workspace.workspaceId),
      threadIds: requestedThreadIds,
      categories: input.categories,
      sensitiveContentAcknowledged: input.sensitiveContentAcknowledged,
      unencryptedPackageAcknowledged: input.unencryptedPackageAcknowledged
    })
    assertMigrationOutputOutsideWorkspaces(input.outputPath, selectedWorkspaces)
    const packageId = `pkg_${randomUUID().replaceAll('-', '')}`
    const startedAt = new Date().toISOString()
    const temporaryRoot = join(dirname(input.outputPath), `.kun-migration-staging-${input.operationId}-${randomUUID()}`)
    const runtimeSnapshotPath = join(temporaryRoot, 'runtime-snapshot.jsonl')
    let runtimeSnapshotId: string | undefined
    let omittedThreadIds: string[] = []
    let exportedThreadIds: string[] = []
    let runtimeContentCounts = { attachments: 0, artifacts: 0, memories: 0 }
    try {
      await mkdir(temporaryRoot, { recursive: true, mode: 0o700 })
      this.progress(input, 'snapshotting', 0, 0, true)
      const inventory = await inventoryDataMigrationFiles({
        workspaces: selectedWorkspaces,
        preset: input.preset,
        sensitiveContentAcknowledged: input.sensitiveContentAcknowledged,
        signal: input.signal,
        onProgress: ({ files, bytes, path }) => this.progress(input, 'scanning', files, bytes, true, path)
      })
      if (inventory.estimate.sensitiveFindings.length > 0 && !input.sensitiveContentAcknowledged) {
        throw new Error('sensitive workspace files require explicit acknowledgement before export')
      }

      const entries: Zip64ArchiveEntryInput[] = input.categories.includes('workspace-files')
        ? workspaceFilesToZipEntries(inventory.files)
        : []
      if (input.categories.includes('thread-history') && requestedThreadIds.length > 0) {
        const runtimeSnapshot = await this.runtime.create({
          threadIds: requestedThreadIds,
          includeAttachments: input.categories.includes('attachments'),
          includeArtifacts: input.categories.includes('artifacts'),
          includeMemory: input.categories.includes('memory'),
          runningThreadPolicy: input.runningThreadPolicy,
          waitTimeoutMs: 30_000
        }, input.signal)
        runtimeSnapshotId = runtimeSnapshot.snapshotId
        omittedThreadIds = runtimeSnapshot.omittedThreadIds
        exportedThreadIds = runtimeSnapshot.exportedThreadIds
        runtimeContentCounts = runtimeSnapshot.contentCounts
        const downloaded = await this.runtime.download(runtimeSnapshot.snapshotId, runtimeSnapshotPath, input.signal)
        entries.push({
          path: parsePackageRelativePath('payload/runtime/snapshot.jsonl'),
          kind: 'runtime-record',
          source: { kind: 'file', path: runtimeSnapshotPath },
          logicalBytes: downloaded.byteSize,
          sha256: downloaded.sha256
        })
      }
      const exportedThreadSet = new Set(exportedThreadIds)
      const exportedThreads = input.runtimeThreads.filter((thread) => exportedThreadSet.has(thread.id))

      const catalogs: KunpackCatalogInput[] = [
        {
          path: parsePackageRelativePath('catalog/workspaces.json'),
          value: inventory.estimate.workspaces
        },
        {
          path: parsePackageRelativePath('catalog/threads.json'),
          value: exportedThreads.map((thread) => ({
            exportThreadId: thread.id,
            sourceThreadId: thread.id,
            title: thread.title,
            workspaceId: selectedWorkspaces.find((workspace) => workspace.relatedThreadIds.includes(thread.id))?.workspaceId,
            status: thread.status === 'archived' ? 'archived' : 'idle',
            relation: thread.relation ?? 'primary',
            parentExportThreadId: thread.parentThreadId,
            model: thread.model,
            providerId: thread.providerId,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            canonicalSha256: sha256Json(thread)
          }))
        }
      ]
      if (input.categories.includes('portable-settings')) {
        catalogs.push({
          path: parsePackageRelativePath('catalog/portable-settings.json'),
          value: portableSettingsForMigration(input.settings)
        })
      }
      if (input.categories.includes('renderer-state') && input.rendererState !== undefined) {
        catalogs.push({
          path: parsePackageRelativePath('catalog/renderer-state.json'),
          value: { schemaVersion: 1, value: input.rendererState }
        })
      }
      if (input.categories.includes('workflows') || input.categories.includes('schedules')) {
        catalogs.push({
          path: parsePackageRelativePath('catalog/automations.json'),
          value: sanitizedAutomationsForMigration(input.settings)
        })
      }

      const manifest = baseManifest({
        packageId,
        input,
        selection,
        workspaces: selectedWorkspaces.length,
        threads: exportedThreads.length,
        attachments: runtimeContentCounts.attachments,
        artifacts: runtimeContentCounts.artifacts,
        memories: runtimeContentCounts.memories
      })
      this.progress(input, 'packaging', 0, inventory.estimate.logicalBytes, true)
      await createKunpackPackage({
        outputPath: input.outputPath,
        manifest,
        catalogs,
        entries,
        ...(input.passphrase ? { passphrase: input.passphrase } : {})
      })
      const packageStats = await stat(input.outputPath)
      const finishedAt = new Date().toISOString()
      const report: DataMigrationReport = {
        operationId: input.operationId,
        packageId,
        kind: 'export',
        outcome: omittedThreadIds.length > 0 ? 'completed-with-review' : 'success',
        startedAt,
        finishedAt,
        counts: {
          workspaces: selectedWorkspaces.length,
          workspaceFiles: inventory.files.length,
          threads: exportedThreads.length,
          omittedThreads: omittedThreadIds.length,
          attachments: runtimeContentCounts.attachments,
          artifacts: runtimeContentCounts.artifacts,
          memories: runtimeContentCounts.memories,
          packageBytes: packageStats.size
        },
        workspacePathMap: Object.fromEntries(selectedWorkspaces.map((workspace) => [workspace.workspaceId, workspace.sourcePathDisplay])),
        threadIdMap: Object.fromEntries(exportedThreads.map((thread) => [thread.id, thread.id])),
        exclusions: Object.entries(inventory.exclusionCounts).map(([ruleId, count]) => ({ ruleId, count })),
        warnings: omittedThreadIds.map((id) => `Running thread omitted: ${id}`),
        unresolvedReferences: 0,
        disabledItems: input.settings.workflow.workflows.length + input.settings.schedule.tasks.length
      }
      this.progress(input, 'completed', inventory.files.length, packageStats.size, false)
      return { packagePath: input.outputPath, packageId, report }
    } catch (error) {
      await rm(input.outputPath, { force: true }).catch(() => undefined)
      throw error
    } finally {
      if (runtimeSnapshotId) await this.runtime.release(runtimeSnapshotId).catch(() => undefined)
      await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private progress(
    input: DataMigrationExportRequest,
    phase: DataMigrationProgress['phase'],
    completedItems: number,
    completedBytes: number,
    cancellable: boolean,
    path?: string
  ): void {
    input.onProgress?.({
      operationId: input.operationId,
      kind: 'export',
      phase,
      completedItems,
      completedBytes,
      ...(path ? { currentPath: safeProgressPath(path) } : {}),
      cancellable,
      ...(cancellable ? { cancellationEffect: 'cleanup' } : {}),
      updatedAt: new Date().toISOString()
    })
  }
}

function baseManifest(input: {
  packageId: string
  input: DataMigrationExportRequest
  selection: ReturnType<typeof DataMigrationSelectionSchema.parse>
  workspaces: number
  threads: number
  attachments: number
  artifacts: number
  memories: number
}): DataMigrationManifestV1 {
  return {
    formatVersion: DATA_MIGRATION_FORMAT_VERSION,
    minimumReaderVersion: DATA_MIGRATION_MINIMUM_READER_VERSION,
    packageId: input.packageId,
    sourceInstallationId: normalizeMigrationId(input.input.sourceInstallationId),
    sourceAppVersion: input.input.sourceAppVersion,
    sourceRuntimeVersion: input.input.sourceRuntimeVersion,
    sourcePlatform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
    sourceArch: process.arch,
    createdAt: new Date().toISOString(),
    encryption: { mode: 'none' },
    componentVersions: {
      manifest: 1, workspace: 1, thread: 1, session: 1, event: 1, attachment: 1,
      artifact: 1, memory: 1, 'portable-settings': 1, 'renderer-state': 1, workflow: 1, schedule: 1
    },
    selection: input.selection,
    counts: {
      workspaces: input.workspaces,
      threads: input.threads,
      entries: 0,
      attachments: input.attachments,
      artifacts: input.artifacts,
      memories: input.memories
    },
    expandedBytes: 0,
    catalogsSha256: '0'.repeat(64),
    checksumsSha256: '0'.repeat(64)
  }
}

function normalizeMigrationId(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 128)
  return normalized && /^[A-Za-z0-9]/.test(normalized) ? normalized : `installation_${sha256Json(value).slice(0, 24)}`
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(serializeKunpackJson(value)).digest('hex')
}

function safeProgressPath(value: string) {
  const normalized = value.replaceAll('\\', '/').split('/').filter(Boolean).slice(-4).join('/')
  return parsePackageRelativePath(normalized || 'working')
}
