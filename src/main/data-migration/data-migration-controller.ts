import { createReadStream, createWriteStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  DataMigrationImportPlanSchema,
  DataMigrationInspectionSummarySchema,
  DataMigrationOperationStatusSchema,
  DataMigrationPackageEntrySchema,
  DataMigrationProgressSchema,
  DataMigrationReportSchema,
  DataMigrationSelectionSchema,
  DataMigrationWorkspaceConflictStrategySchema,
  type DataMigrationExportOptions,
  type DataMigrationInspectionSummary,
  type DataMigrationOperationStatus,
  type DataMigrationProgress,
  type DataMigrationRendererRequest,
  type DataMigrationRendererResponse,
  type DataMigrationReport
} from '../../shared/data-migration'
import type { JsonSettingsStore } from '../settings-store'
import type { RuntimeThreadForMigration, KunMigrationSnapshotClient } from './export-orchestrator'
import { DataMigrationExportOrchestrator } from './export-orchestrator'
import {
  DataMigrationImportOrchestrator,
  type DataMigrationPackageInspection,
  type KunRuntimeMigrationImportClient,
  type RendererMigrationStateAdapter
} from './import-orchestrator'
import { DataMigrationImportTransactionCoordinator, type RuntimeMigrationCommitResult } from './import-transaction'
import type { ImportApplicationMutationStep } from './import-transaction'
import { MigrationReportStore } from './migration-reports'
import { MigrationJournalStore, type MigrationJournalMutation } from './transaction-journal'
import {
  applyPortableSettingsMigration,
  type ImportedWorkspaceTrustReset,
  type RestoredRendererState
} from './application-state-migration'
import { portableSettingsForMigration } from './export-inventory'
import { reconstructStagedWorkspace } from './workspace-staging'

const operationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/)
const localPathSchema = z.string().min(1).max(32_767).refine((value) => !value.includes('\0'), 'path contains NUL')
const optionalPassphraseSchema = z.string().min(8).max(1_024).optional()

const exportOptionsSchema = z.object({
  operationId: operationIdSchema,
  outputPath: localPathSchema,
  selectedWorkspaceIds: z.array(operationIdSchema).max(10_000),
  selectedThreadIds: z.array(operationIdSchema).max(10_000),
  categories: DataMigrationSelectionSchema.shape.categories,
  preset: DataMigrationSelectionSchema.shape.preset,
  sensitiveContentAcknowledged: z.boolean(),
  unencryptedPackageAcknowledged: z.boolean(),
  passphrase: optionalPassphraseSchema,
  runningThreadPolicy: z.enum(['wait', 'interrupt', 'omit'])
}).strict()

const rendererResponseSchema = z.object({
  requestId: operationIdSchema,
  ok: z.boolean(),
  value: z.unknown().optional(),
  error: z.string().max(2_000).optional()
}).strict()

export type DataMigrationControllerOptions = {
  userDataPath: string
  store: JsonSettingsStore
  getMainWindow: () => BrowserWindow | null
  runtimeFetch: (path: string, init?: RequestInit & { duplex?: 'half' }) => Promise<Response>
  sourceInstallationId: string
  sourceAppVersion: string
  sourceRuntimeVersion: string
  featureEnabled: boolean
}

export class DataMigrationController {
  private readonly journals: MigrationJournalStore
  private readonly reports: MigrationReportStore
  private readonly transactions: DataMigrationImportTransactionCoordinator
  private readonly importer: DataMigrationImportOrchestrator
  private readonly exporter: DataMigrationExportOrchestrator
  private readonly rendererRpc: RendererMigrationRpc
  private readonly inspections = new Map<string, { inspection: DataMigrationPackageInspection; expiresAt: number }>()
  private active: { operationId: string; kind: 'export' | 'import'; abort: AbortController } | null = null
  private progress: DataMigrationProgress | undefined

  constructor(private readonly options: DataMigrationControllerOptions) {
    const migrationRoot = join(options.userDataPath, 'data-migration')
    this.journals = new MigrationJournalStore(join(migrationRoot, 'operations'))
    this.reports = new MigrationReportStore(join(migrationRoot, 'reports'))
    this.transactions = new DataMigrationImportTransactionCoordinator(this.journals, this.reports)
    this.importer = new DataMigrationImportOrchestrator(
      join(migrationRoot, 'temporary'),
      this.journals,
      this.transactions
    )
    this.exporter = new DataMigrationExportOrchestrator(runtimeSnapshotClient(options.runtimeFetch))
    this.rendererRpc = new RendererMigrationRpc(options.getMainWindow)
  }

  registerIpc(): void {
    const handle = <T>(channel: string, handler: (...args: unknown[]) => Promise<T>) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          assertTrustedDataMigrationSender(event, this.options.getMainWindow)
          return await handler(...args)
        } catch (error) {
          throw new Error(publicMigrationError(error, this.progress?.phase))
        }
      })
    }
    handle('data-migration:pick-export', async (raw) => {
      const value = z.object({ defaultPath: z.string().optional() }).strict().parse(raw)
      const result = await dialog.showSaveDialog(this.windowOptions(), {
        title: 'Create migration package',
        defaultPath: value.defaultPath,
        filters: [{ name: 'Kun migration package', extensions: ['kunpack'] }]
      })
      return { canceled: result.canceled, path: result.filePath || null }
    })
    handle('data-migration:pick-import', async (raw) => {
      const value = z.object({ defaultPath: z.string().optional() }).strict().parse(raw)
      const result = await dialog.showOpenDialog(this.windowOptions(), {
        title: 'Select migration package',
        defaultPath: value.defaultPath,
        properties: ['openFile'],
        filters: [{ name: 'Kun migration package', extensions: ['kunpack'] }]
      })
      return { canceled: result.canceled, path: result.filePaths[0] ?? null }
    })
    handle('data-migration:pick-destination', async (raw) => {
      const value = z.object({ defaultPath: z.string().optional() }).strict().parse(raw)
      const result = await dialog.showOpenDialog(this.windowOptions(), {
        title: 'Choose imported workspace location',
        defaultPath: value.defaultPath,
        properties: ['openDirectory', 'createDirectory']
      })
      return { canceled: result.canceled, path: result.filePaths[0] ?? null }
    })
    handle('data-migration:estimate-export', async (raw) => this.estimateExport(raw))
    handle('data-migration:inspect', async (raw) => this.inspect(raw))
    handle('data-migration:plan-import', async (raw) => this.planImport(raw))
    handle('data-migration:start-export', async (raw) => this.startExport(raw))
    handle('data-migration:start-import', async (raw) => this.startImport(raw))
    handle('data-migration:cancel', async (raw) => {
      const { operationId } = z.object({ operationId: operationIdSchema }).strict().parse(raw)
      await this.cancel(operationId)
      return this.status()
    })
    handle('data-migration:recover', async (raw) => {
      const value = z.object({ operationId: operationIdSchema, action: z.enum(['resume', 'rollback']) }).strict().parse(raw)
      await this.recover(value.operationId, value.action)
      return this.status()
    })
    handle('data-migration:status', async () => this.status())
    handle('data-migration:reports:list', async () => this.reports.list())
    handle('data-migration:reports:get', async (raw) => {
      const { operationId } = z.object({ operationId: operationIdSchema }).strict().parse(raw)
      return this.reports.read(operationId)
    })
    handle('data-migration:reports:delete', async (raw) => {
      const { operationId } = z.object({ operationId: operationIdSchema }).strict().parse(raw)
      await this.reports.delete(operationId)
    })
    handle('data-migration:renderer-response', async (raw) => {
      this.rendererRpc.respond(rendererResponseSchema.parse(raw))
    })
  }

  async status(): Promise<DataMigrationOperationStatus> {
    this.expireInspections()
    const recoverable = await this.journals.listIncomplete()
    return DataMigrationOperationStatusSchema.parse({
      featureEnabled: this.options.featureEnabled,
      ...(this.active ? { activeOperationId: this.active.operationId, activeKind: this.active.kind } : {}),
      ...(this.progress ? { progress: this.progress } : {}),
      recoverable: recoverable.map((journal) => ({
        operationId: journal.operationId,
        packageId: journal.packageId,
        phase: journal.phase,
        updatedAt: journal.updatedAt,
        destinationEffect: journal.mutations.length > 0 ? 'partially-committed' : journal.phase === 'staged' ? 'staged-only' : 'untouched',
        ...(journal.error ? { error: journal.error } : {}),
        warnings: journal.warnings,
        manualRecoverySteps: journal.manualRecoverySteps,
        ...(journal.reportPath ? { reportPath: journal.reportPath } : {})
      })),
      recentReports: (await this.reports.list()).slice(0, 20)
    })
  }

  private async estimateExport(raw: unknown) {
    this.assertFeatureEnabled('export')
    const input = z.object({
      operationId: operationIdSchema,
      selectedWorkspaceIds: z.array(operationIdSchema),
      preset: DataMigrationSelectionSchema.shape.preset,
      sensitiveContentAcknowledged: z.boolean()
    }).strict().parse(raw)
    const [settings, runtimeThreads] = await Promise.all([this.options.store.load(), this.listRuntimeThreads()])
    return this.exporter.estimate({
      ...input,
      settings,
      runtimeThreads,
      onProgress: (progress) => this.publishProgress(progress)
    })
  }

  private async inspect(raw: unknown): Promise<DataMigrationInspectionSummary> {
    this.assertFeatureEnabled('import')
    const input = z.object({ packagePath: localPathSchema, passphrase: optionalPassphraseSchema }).strict().parse(raw)
    const inspection = await this.importer.inspect(input)
    this.inspections.set(inspection.inspectionId, { inspection, expiresAt: Date.now() + 30 * 60_000 })
    while (this.inspections.size > 5) this.inspections.delete(this.inspections.keys().next().value!)
    return inspectionSummary(inspection)
  }

  private async planImport(raw: unknown) {
    this.assertFeatureEnabled('import')
    const input = z.object({
      operationId: operationIdSchema,
      inspectionId: operationIdSchema,
      destinationBaseRoot: localPathSchema,
      destinationRoots: z.record(operationIdSchema, localPathSchema).optional(),
      strategies: z.record(operationIdSchema, DataMigrationWorkspaceConflictStrategySchema).optional(),
      skippedWorkspaceIds: z.array(operationIdSchema).optional()
    }).strict().parse(raw)
    const inspection = this.mustInspection(input.inspectionId)
    return this.importer.plan({
      operationId: input.operationId,
      inspection,
      destinationBaseRoot: input.destinationBaseRoot,
      ...(input.destinationRoots ? { destinationRoots: input.destinationRoots } : {}),
      ...(input.strategies ? { strategies: input.strategies } : {}),
      ...(input.skippedWorkspaceIds ? { skippedWorkspaceIds: new Set(input.skippedWorkspaceIds) } : {})
    })
  }

  private async startExport(raw: unknown): Promise<{ packagePath: string; report: DataMigrationReport }> {
    this.assertFeatureEnabled('export')
    const input = exportOptionsSchema.parse(raw) as DataMigrationExportOptions
    return this.runOperation(input.operationId, 'export', async (signal) => {
      const [settings, runtimeThreads, rendererState] = await Promise.all([
        this.options.store.load(),
        this.listRuntimeThreads(),
        input.categories.includes('renderer-state') ? this.rendererRpc.request('capture-state') : undefined
      ])
      const result = await this.exporter.export({
        ...input,
        settings,
        runtimeThreads,
        rendererState,
        sourceInstallationId: this.options.sourceInstallationId,
        sourceAppVersion: this.options.sourceAppVersion,
        sourceRuntimeVersion: this.options.sourceRuntimeVersion,
        signal,
        onProgress: (progress) => this.publishProgress(progress)
      })
      await this.reports.writeImmutable(result.report)
      return { packagePath: result.packagePath, report: DataMigrationReportSchema.parse(result.report) }
    })
  }

  private async startImport(raw: unknown): Promise<{ report: DataMigrationReport; refreshRequired: boolean }> {
    this.assertFeatureEnabled('import')
    const input = z.object({
      operationId: operationIdSchema,
      inspectionId: operationIdSchema,
      packagePath: localPathSchema,
      passphrase: optionalPassphraseSchema,
      plan: DataMigrationImportPlanSchema
    }).strict().parse(raw)
    const inspection = this.mustInspection(input.inspectionId)
    if (inspection.packagePath !== input.packagePath) throw new Error('migration package path differs from the inspected file')
    return this.runOperation(input.operationId, 'import', async (signal) => this.importer.import({
      operationId: input.operationId,
      inspection,
      plan: input.plan,
      ...(input.passphrase ? { passphrase: input.passphrase } : {}),
      settingsStore: this.options.store,
      runtime: runtimeImportClient(this.options.runtimeFetch),
      renderer: rendererStateAdapter(this.rendererRpc),
      signal,
      onProgress: (progress) => this.publishProgress(progress)
    }))
  }

  private async cancel(operationId: string): Promise<void> {
    if (this.active?.operationId === operationId) {
      if (this.active.kind === 'import') await this.transactions.requestCancellation(operationId).catch(() => undefined)
      this.active.abort.abort(new Error('migration cancellation requested'))
      return
    }
    const journal = await this.journals.read(operationId)
    if (journal.phase === 'inspected') await this.transactions.requestCancellation(operationId)
  }

  private async recover(operationId: string, action: 'resume' | 'rollback'): Promise<void> {
    const journal = await this.journals.read(operationId)
    if (action === 'resume') {
      if (journal.phase === 'inspected') {
        throw new Error('This import stopped before staging was complete. Roll it back, then select the original package again; encrypted passphrases are never stored.')
      }
      await this.runOperation(operationId, 'import', async () => {
        const workspaces = await this.recoverStagedWorkspaces(operationId)
        const runtimeArtifact = await this.journals.readArtifact<{
          preflight?: { importId?: string }
        }>(operationId, 'runtime-preflight.json').catch(() => null)
        const runtimeImportId = runtimeArtifact?.preflight?.importId
        const applicationSteps = await this.recoverApplicationSteps(operationId)
        await this.transactions.commit({
          operationId,
          workspaces,
          ...(runtimeImportId ? { runtime: { importId: runtimeImportId, client: runtimeImportClient(this.options.runtimeFetch) } } : {}),
          applicationSteps,
          initialWarnings: journal.warnings,
          onRefresh: () => this.rendererRpc.request('refresh').then(() => undefined)
        })
      })
      return
    }
    if (journal.phase === 'inspected') {
      for (const mapping of journal.plan.mappings) {
        if (!mapping.destinationRoot) continue
        const stagingRoot = join(dirname(mapping.destinationRoot), `.kun-migration-staging-${operationId}-${mapping.workspaceId}`)
        await rm(stagingRoot, { recursive: true, force: true })
      }
      await this.transactions.requestCancellation(operationId)
      return
    }
    await this.transactions.rollback({
      operationId,
      runtime: { client: runtimeImportClient(this.options.runtimeFetch) },
      resolveApplicationStep: async (mutation) => recoveryApplicationStep(mutation, this.options.store, this.rendererRpc, this.journals, operationId)
    })
  }

  private async recoverStagedWorkspaces(operationId: string) {
    const journal = await this.journals.read(operationId)
    const artifact = await this.journals.readArtifact<{
      workspaces?: Array<{ workspaceId?: string; entries?: unknown[] }>
    }>(operationId, 'workspace-staging.json')
    const byId = new Map((artifact.workspaces ?? []).flatMap((workspace) =>
      typeof workspace.workspaceId === 'string' && Array.isArray(workspace.entries)
        ? [[workspace.workspaceId, workspace.entries.map((entry) => DataMigrationPackageEntrySchema.parse(entry))] as const]
        : []
    ))
    return journal.plan.mappings.flatMap((mapping) => {
      if (mapping.strategy === 'skip' || !mapping.destinationRoot) return []
      const entries = byId.get(mapping.workspaceId)
      if (!entries) throw new Error(`staged workspace recovery metadata is missing: ${mapping.workspaceId}`)
      return [{
        workspaceId: mapping.workspaceId,
        staged: reconstructStagedWorkspace({ operationId, workspaceId: mapping.workspaceId, entries, destinationRoot: mapping.destinationRoot }),
        strategy: mapping.strategy,
        resolutions: Object.fromEntries(journal.plan.conflicts.flatMap((conflict) =>
          conflict.workspaceId === mapping.workspaceId && conflict.resolution ? [[conflict.path, conflict.resolution]] : []
        )),
        renamedPaths: Object.fromEntries(journal.plan.conflicts.flatMap((conflict) =>
          conflict.workspaceId === mapping.workspaceId && conflict.renamedPath ? [[conflict.path, conflict.renamedPath]] : []
        ))
      }]
    })
  }

  private async recoverApplicationSteps(operationId: string): Promise<ImportApplicationMutationStep[]> {
    const journal = await this.journals.read(operationId)
    const candidates: MigrationJournalMutation[] = [
      recoveryMutation('settings:portable-and-automations:operation:0', 'settings', 'portable-and-disabled-automations', 'settings-restore.json'),
      recoveryMutation('renderer-state:semantic-restore:operation:0', 'renderer-state', 'semantic-restore', 'renderer-state-restore.json'),
      recoveryMutation('trust:reset-imported-workspaces:operation:0', 'trust', 'reset-imported-workspaces', 'trust-restore.json')
    ]
    const steps: ImportApplicationMutationStep[] = []
    for (const candidate of candidates) {
      const mutation = journal.mutations.find((item) => item.mutationId === candidate.mutationId) ?? candidate
      const step = await recoveryApplicationStep(mutation, this.options.store, this.rendererRpc, this.journals, operationId).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (step) steps.push(step)
    }
    return steps
  }

  private async listRuntimeThreads(): Promise<RuntimeThreadForMigration[]> {
    return listRuntimeThreadsForMigration(this.options.runtimeFetch)
  }

  private async runOperation<T>(operationId: string, kind: 'export' | 'import', task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.active) throw new Error(`another migration operation is active: ${this.active.operationId}`)
    const recoverable = await this.journals.listIncomplete()
    const blocking = recoverable.find((journal) => journal.operationId !== operationId)
    if (blocking) throw new Error(`migration recovery is required before starting another operation: ${blocking.operationId}`)
    const abort = new AbortController()
    this.active = { operationId, kind, abort }
    try {
      return await task(abort.signal)
    } finally {
      this.active = null
    }
  }

  private publishProgress(progress: DataMigrationProgress): void {
    this.progress = DataMigrationProgressSchema.parse(progress)
    const window = this.options.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send('data-migration:progress', this.progress)
  }

  private mustInspection(inspectionId: string): DataMigrationPackageInspection {
    this.expireInspections()
    const item = this.inspections.get(inspectionId)
    if (!item) throw new Error('migration inspection expired; inspect the package again')
    return item.inspection
  }

  private expireInspections(): void {
    for (const [id, value] of this.inspections) if (value.expiresAt <= Date.now()) this.inspections.delete(id)
  }

  private assertFeatureEnabled(kind: 'export' | 'import'): void {
    if (!this.options.featureEnabled) throw new Error(`data migration ${kind} is disabled by the current release policy`)
  }

  private windowOptions(): BrowserWindow {
    const window = this.options.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('main window is unavailable')
    return window
  }
}

export async function listRuntimeThreadsForMigration(
  runtimeFetch: DataMigrationControllerOptions['runtimeFetch']
): Promise<RuntimeThreadForMigration[]> {
  // The public threads route caps an explicit `limit` at 500. Omitting it asks
  // the store for the complete inventory, including archived and side threads.
  const response = await runtimeFetch('/v1/threads?include_archived=true&include=side')
  if (!response.ok) throw new Error(`Kun thread inventory failed (${response.status})`)
  const value = await response.json() as { threads?: unknown[] }
  return (Array.isArray(value.threads) ? value.threads : []).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const thread = raw as Record<string, unknown>
    if (typeof thread.id !== 'string') return []
    return [{
      id: thread.id,
      title: typeof thread.title === 'string' ? thread.title : '',
      ...(typeof thread.workspace === 'string' ? { workspace: thread.workspace } : {}),
      status: thread.status === 'archived' ? 'archived' as const : thread.status === 'running' ? 'running' as const : 'idle' as const,
      ...(thread.relation === 'fork' || thread.relation === 'side' ? { relation: thread.relation } : {}),
      ...(typeof thread.parentThreadId === 'string' ? { parentThreadId: thread.parentThreadId } : {}),
      ...(typeof thread.model === 'string' ? { model: thread.model } : {}),
      ...(typeof thread.providerId === 'string' ? { providerId: thread.providerId } : {}),
      createdAt: typeof thread.createdAt === 'string' ? thread.createdAt : new Date(0).toISOString(),
      updatedAt: typeof thread.updatedAt === 'string' ? thread.updatedAt : new Date(0).toISOString()
    }]
  })
}

class RendererMigrationRpc {
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  request(action: DataMigrationRendererRequest['action'], payload?: unknown): Promise<unknown> {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed()) return Promise.reject(new Error('renderer is unavailable for migration state coordination'))
    const requestId = `renderer_${randomUUID().replaceAll('-', '')}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`renderer migration request timed out: ${action}`))
      }, 30_000)
      this.pending.set(requestId, { resolve, reject, timer })
      window.webContents.send('data-migration:renderer-request', { requestId, action, ...(payload !== undefined ? { payload } : {}) })
    })
  }

  respond(response: DataMigrationRendererResponse): void {
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    this.pending.delete(response.requestId)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response.value)
    else pending.reject(new Error(response.error || 'renderer migration request failed'))
  }
}

export function assertTrustedDataMigrationSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): void {
  const window = getMainWindow()
  const senderFrame = event.senderFrame
  const mainFrame = window?.webContents.mainFrame
  if (
    !window ||
    window.isDestroyed() ||
    event.sender.id !== window.webContents.id ||
    !senderFrame ||
    !mainFrame ||
    senderFrame.processId !== mainFrame.processId ||
    senderFrame.routingId !== mainFrame.routingId
  ) {
    throw new Error('Data migration IPC sender is not the trusted workbench frame')
  }
}

function runtimeSnapshotClient(runtimeFetch: DataMigrationControllerOptions['runtimeFetch']): KunMigrationSnapshotClient {
  return {
    create: async (input, signal) => {
      const value = await fetchJson(runtimeFetch, '/v1/migrations/exports', {
        method: 'POST', body: JSON.stringify(input), signal, headers: { 'content-type': 'application/json' }
      }) as { snapshot: {
        snapshotId: string
        exportedThreadIds: string[]
        omittedThreadIds: string[]
        contentCounts: { attachments: number; artifacts: number; memories: number }
      } }
      return value.snapshot
    },
    download: async (snapshotId, destinationPath, signal) => {
      const response = await runtimeFetch(`/v1/migrations/exports/${encodeURIComponent(snapshotId)}`, { signal })
      if (!response.ok || !response.body) throw new Error(`Kun snapshot download failed (${response.status})`)
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }), ...(signal ? [{ signal }] : []))
      const { stat } = await import('node:fs/promises')
      const { sha256File } = await import('./kunpack-zip')
      return { byteSize: (await stat(destinationPath)).size, sha256: await sha256File(destinationPath) }
    },
    release: async (snapshotId) => {
      await fetchJson(runtimeFetch, `/v1/migrations/exports/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' })
    }
  }
}

function runtimeImportClient(runtimeFetch: DataMigrationControllerOptions['runtimeFetch']): KunRuntimeMigrationImportClient {
  const result = async (path: string, method = 'POST'): Promise<RuntimeMigrationCommitResult> => {
    const value = await fetchJson(runtimeFetch, path, { method }) as { result: RuntimeMigrationCommitResult }
    return value.result
  }
  return {
    preflight: async (input) => {
      const control = JSON.stringify({
        schemaVersion: 1,
        type: 'import-control',
        value: {
          operationId: input.operationId,
          workspacePathMap: input.workspacePathMap,
          configuredProviderIds: input.configuredProviderIds
        }
      }) + '\n'
      const body = Readable.from((async function *() {
        yield Buffer.from(control)
        for await (const chunk of createReadStream(input.snapshotPath)) yield chunk
      })())
      const value = await fetchJson(runtimeFetch, '/v1/migrations/imports/preflight', {
        method: 'POST',
        body: Readable.toWeb(body) as never,
        duplex: 'half',
        signal: input.signal,
        headers: { 'content-type': 'application/x-ndjson' }
      }) as { preflight: Awaited<ReturnType<KunRuntimeMigrationImportClient['preflight']>> }
      return value.preflight
    },
    commit: (importId) => result(`/v1/migrations/imports/${encodeURIComponent(importId)}/commit`),
    verify: (importId) => result(`/v1/migrations/imports/${encodeURIComponent(importId)}/verify`),
    rollback: (importId) => result(`/v1/migrations/imports/${encodeURIComponent(importId)}/rollback`),
    finalize: async (importId) => {
      await fetchJson(runtimeFetch, `/v1/migrations/imports/${encodeURIComponent(importId)}`, { method: 'DELETE' })
    }
  }
}

function rendererStateAdapter(rpc: RendererMigrationRpc): RendererMigrationStateAdapter {
  return {
    captureState: async () => normalizeRendererState(await rpc.request('capture-state')),
    replaceState: async (state) => { await rpc.request('replace-state', state) },
    replaceTrustResets: async (workspaceRoots, resets) => {
      await rpc.request('apply-trust', { workspaceRoots, resets })
    },
    captureTrustResets: async (workspaceRoots) => normalizeTrustResets(await rpc.request('capture-trust', workspaceRoots)),
    refresh: async () => { await rpc.request('refresh') }
  }
}

async function recoveryApplicationStep(
  mutation: MigrationJournalMutation,
  store: JsonSettingsStore,
  rpc: RendererMigrationRpc,
  journals: MigrationJournalStore,
  operationId: string
): Promise<ImportApplicationMutationStep | null> {
  const artifactName = typeof mutation.details.artifact === 'string' ? mutation.details.artifact : ''
  if (mutation.target === 'settings' && artifactName === 'settings-restore.json') {
    const artifact = await journals.readArtifact<{
      beforePortable: unknown
      afterPortable: unknown
      introducedWorkflowIds: string[]
      introducedScheduleIds: string[]
      introducedWorkflows: AppSettingsV1['workflow']['workflows']
      introducedSchedules: AppSettingsV1['schedule']['tasks']
    }>(operationId, artifactName)
    const apply = async () => {
      const current = await store.load()
      const workflowIds = new Set(artifact.introducedWorkflowIds)
      const scheduleIds = new Set(artifact.introducedScheduleIds)
      const next = applyPortableSettingsMigration(current, artifact.afterPortable)
      await store.save({
        ...next,
        workflow: {
          ...next.workflow,
          workflows: [...next.workflow.workflows.filter((item) => !workflowIds.has(item.id)), ...artifact.introducedWorkflows]
        },
        schedule: {
          ...next.schedule,
          tasks: [...next.schedule.tasks.filter((item) => !scheduleIds.has(item.id)), ...artifact.introducedSchedules]
        }
      })
    }
    const verify = async () => {
      const current = await store.load()
      if (stateIdentity(portableSettingsForMigration(current)) !== stateIdentity(artifact.afterPortable)) {
        throw new Error('portable settings verification failed during migration recovery')
      }
      if (artifact.introducedWorkflowIds.some((id) => current.workflow.workflows.find((item) => item.id === id)?.enabled !== false)) {
        throw new Error('recovered imported workflow unexpectedly became active')
      }
      if (artifact.introducedScheduleIds.some((id) => current.schedule.tasks.find((item) => item.id === id)?.enabled !== false)) {
        throw new Error('recovered imported schedule unexpectedly became active')
      }
    }
    return recoveryStep(mutation, { apply, verify, rollback: async () => {
      const current = await store.load()
      const warnings: string[] = []
      const portableUnchanged = stateIdentity(portableSettingsForMigration(current)) === stateIdentity(artifact.afterPortable)
      if (!portableUnchanged) warnings.push('Preserved portable settings modified after import; restore them manually if needed.')
      const workflowIdsToRemove = new Set(artifact.introducedWorkflowIds.filter((id) => {
        const workflow = current.workflow.workflows.find((item) => item.id === id)
        if (workflow?.enabled || workflow?.callableByAgent) {
          warnings.push(`Preserved independently activated imported workflow: ${id}`)
          return false
        }
        return Boolean(workflow)
      }))
      const scheduleIdsToRemove = new Set(artifact.introducedScheduleIds.filter((id) => {
        const task = current.schedule.tasks.find((item) => item.id === id)
        if (task?.enabled) {
          warnings.push(`Preserved independently activated imported schedule: ${id}`)
          return false
        }
        return Boolean(task)
      }))
      const restoredPortable = portableUnchanged
        ? applyPortableSettingsMigration(current, artifact.beforePortable)
        : current
      await store.save({
        ...restoredPortable,
        workflow: {
          ...restoredPortable.workflow,
          workflows: restoredPortable.workflow.workflows.filter((item) => !workflowIdsToRemove.has(item.id))
        },
        schedule: {
          ...restoredPortable.schedule,
          tasks: restoredPortable.schedule.tasks.filter((item) => !scheduleIdsToRemove.has(item.id))
        }
      } as AppSettingsV1)
      return warnings
    } })
  }
  if (mutation.target === 'renderer-state' && artifactName === 'renderer-state-restore.json') {
    const artifact = await journals.readArtifact<{ before: unknown; after: unknown }>(operationId, artifactName)
    const before = normalizeRendererState(artifact.before)
    const after = normalizeRendererState(artifact.after)
    return recoveryStep(mutation, {
      apply: async () => { await rpc.request('replace-state', after) },
      verify: async () => {
        const current = normalizeRendererState(await rpc.request('capture-state'))
        if (stateIdentity(current) !== stateIdentity(after)) throw new Error('renderer state verification failed during recovery')
      },
      rollback: async () => {
      const current = normalizeRendererState(await rpc.request('capture-state'))
      if (stateIdentity(current) !== stateIdentity(after)) {
        return ['Preserved renderer state modified after import; restore registries manually if needed.']
      }
      await rpc.request('replace-state', before)
      return []
      }
    })
  }
  if (mutation.target === 'trust' && artifactName === 'trust-restore.json') {
    const artifact = await journals.readArtifact<{ beforeTrust: unknown; afterTrust: unknown }>(operationId, artifactName)
    const beforeTrust = normalizeTrustResets(artifact.beforeTrust)
    const afterTrust = normalizeTrustResets(artifact.afterTrust)
    const workspaceRoots = afterTrust.map((item) => item.workspaceRoot)
    return recoveryStep(mutation, {
      apply: async () => { await rpc.request('apply-trust', { workspaceRoots, resets: afterTrust }) },
      verify: async () => {
        const current = normalizeTrustResets(await rpc.request('capture-trust', workspaceRoots))
        if (stateIdentity(current) !== stateIdentity(afterTrust)) throw new Error('trust reset verification failed during recovery')
      },
      rollback: async () => {
      const current = normalizeTrustResets(await rpc.request('capture-trust', workspaceRoots))
      if (stateIdentity(current) !== stateIdentity(afterTrust)) {
        return ['Preserved workspace trust state modified after import.']
      }
      await rpc.request('apply-trust', { workspaceRoots, resets: beforeTrust })
      return []
      }
    })
  }
  return null
}

function recoveryStep(
  mutation: MigrationJournalMutation,
  actions: Pick<ImportApplicationMutationStep, 'apply' | 'verify' | 'rollback'>
): ImportApplicationMutationStep {
  return {
    mutationId: mutation.mutationId,
    target: mutation.target,
    action: mutation.action,
    ...(mutation.targetPath ? { targetPath: mutation.targetPath } : {}),
    ...(mutation.sourcePath ? { sourcePath: mutation.sourcePath } : {}),
    ...(mutation.backupPath ? { backupPath: mutation.backupPath } : {}),
    ...(mutation.expectedBeforeIdentity ? { expectedBeforeIdentity: mutation.expectedBeforeIdentity } : {}),
    ...(mutation.expectedAfterIdentity ? { expectedAfterIdentity: mutation.expectedAfterIdentity } : {}),
    details: mutation.details,
    ...actions
  }
}

function recoveryMutation(
  mutationId: string,
  target: Extract<MigrationJournalMutation['target'], 'settings' | 'renderer-state' | 'trust'>,
  action: string,
  artifact: string
): MigrationJournalMutation {
  return {
    mutationId,
    target,
    action,
    status: 'planned',
    details: { artifact },
    plannedAt: new Date(0).toISOString()
  }
}

function inspectionSummary(inspection: DataMigrationPackageInspection): DataMigrationInspectionSummary {
  return DataMigrationInspectionSummarySchema.parse({
    inspectionId: inspection.inspectionId,
    packagePath: inspection.packagePath,
    packageId: inspection.manifest.packageId,
    sourcePlatform: inspection.manifest.sourcePlatform,
    sourceArch: inspection.manifest.sourceArch,
    sourceAppVersion: inspection.manifest.sourceAppVersion,
    createdAt: inspection.manifest.createdAt,
    encrypted: inspection.encrypted,
    expandedBytes: inspection.expandedBytes,
    compressedBytes: inspection.compressedBytes,
    categories: inspection.manifest.selection.categories,
    workspaces: inspection.catalogs.workspaces,
    threads: inspection.catalogs.threads,
    counts: inspection.manifest.counts,
    warnings: inspection.warnings
  })
}

async function fetchJson(
  runtimeFetch: DataMigrationControllerOptions['runtimeFetch'],
  path: string,
  init?: RequestInit & { duplex?: 'half' }
): Promise<unknown> {
  const response = await runtimeFetch(path, init)
  const text = await response.text()
  let value: unknown
  try { value = text ? JSON.parse(text) : {} } catch { value = {} }
  if (!response.ok) {
    const message = value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string'
      ? (value as { message: string }).message
      : `Kun migration request failed (${response.status})`
    throw new Error(message)
  }
  return value
}

function normalizeRendererState(value: unknown): RestoredRendererState {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const array = (key: string) => Array.isArray(record[key]) ? record[key] as unknown[] : []
  return {
    schemaVersion: 1,
    design: array('design'), write: array('write'), plans: array('plans'), sdd: array('sdd'),
    forks: array('forks'), threads: array('threads'),
    composer: record.composer && typeof record.composer === 'object' && !Array.isArray(record.composer)
      ? record.composer as Record<string, unknown>
      : {},
    workspaces: array('workspaces'),
    unresolvedReferences: Array.isArray(record.unresolvedReferences)
      ? record.unresolvedReferences as RestoredRendererState['unresolvedReferences']
      : []
  }
}

function normalizeTrustResets(value: unknown): ImportedWorkspaceTrustReset[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ImportedWorkspaceTrustReset => Boolean(
    item && typeof item === 'object' && (item as { trusted?: unknown }).trusted === false &&
    typeof (item as { workspaceRoot?: unknown }).workspaceRoot === 'string'
  ))
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

export function publicMigrationError(error: unknown, phase?: DataMigrationProgress['phase']): string {
  const raw = (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, ' ')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [REDACTED]')
    .replace(/\b(pass(?:word|phrase)?|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|runtime[_-]?token)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .slice(0, 700)
  const lower = raw.toLowerCase()
  const code = lower.includes('passphrase') || lower.includes('password')
    ? (lower.includes('required') ? 'PACKAGE_PASSWORD_REQUIRED' : 'PACKAGE_PASSWORD_INVALID')
    : lower.includes('space') || lower.includes('enospc')
      ? 'SPACE_INSUFFICIENT'
      : lower.includes('permission') || lower.includes('eacces') || lower.includes('eperm') || lower.includes('read-only')
        ? 'IO_PERMISSION_DENIED'
        : lower.includes('conflict') || lower.includes('incompatible')
          ? 'CONFLICT_UNRESOLVED'
          : lower.includes('recovery') || lower.includes('recoverable') || lower.includes('interrupted')
            ? 'RECOVERY_REQUIRED'
            : lower.includes('runtime')
              ? 'RUNTIME_IMPORT_FAILED'
              : lower.includes('version')
                ? 'VERSION_UNSUPPORTED'
                : lower.includes('path')
                  ? 'PATH_INVALID'
                  : 'PACKAGE_INTEGRITY_FAILED'
  const destinationEffect = phase === 'staging'
    ? 'staged temporary data only'
    : phase === 'committing' || phase === 'verifying' || phase === 'rolling-back'
      ? 'changes may have started; Kun will use the operation journal to roll back or recover'
      : 'no destination changes'
  const nextAction = code === 'SPACE_INSUFFICIENT'
    ? 'Free space on every target volume, then run the preflight again.'
    : code === 'IO_PERMISSION_DENIED'
      ? 'Choose a writable local destination or correct its permissions, then retry.'
      : code === 'PACKAGE_PASSWORD_REQUIRED' || code === 'PACKAGE_PASSWORD_INVALID'
        ? 'Enter the package passphrase again; Kun never stores it.'
        : code === 'RECOVERY_REQUIRED'
          ? 'Open Data migration and resolve the interrupted operation before starting another.'
          : 'Review the package and selected destinations, then retry or use the recovery action shown.'
  return `${code}: ${raw || 'Data migration failed.'} Destination impact: ${destinationEffect}. Next action: ${nextAction}`
}
