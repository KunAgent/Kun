import type {
  DataMigrationError,
  DataMigrationImportPlan,
  DataMigrationReport,
  DataMigrationWorkspaceConflictStrategy,
  PackageRelativePath,
  DataMigrationFileConflictResolution
} from '../../shared/data-migration'
import { lstat, rm } from 'node:fs/promises'
import { DataMigrationErrorSchema, DataMigrationReportSchema } from '../../shared/data-migration'
import { defaultMigrationBackupExpiry, MigrationReportStore } from './migration-reports'
import {
  MigrationJournalStore,
  migrationMutationId,
  type MigrationJournalMutation,
  type MigrationOperationJournal,
  type PlannedMigrationMutation
} from './transaction-journal'
import {
  commitStagedWorkspace,
  restoreWorkspaceCommit,
  verifyWorkspaceCommit,
  type StagedWorkspace,
  type WorkspaceCommitMutation
} from './workspace-staging'

export type RuntimeMigrationCommitResult = {
  threadIdMap?: Record<string, string>
  counts: Record<string, number>
  warnings: string[]
}

export interface RuntimeMigrationTransactionClient {
  commit(importId: string): Promise<RuntimeMigrationCommitResult>
  verify(importId: string): Promise<RuntimeMigrationCommitResult>
  rollback(importId: string): Promise<RuntimeMigrationCommitResult>
  finalize?(importId: string): Promise<void>
}

export type ImportApplicationMutationStep = PlannedMigrationMutation & {
  apply: () => Promise<void>
  verify: () => Promise<void>
  /** Returns warnings/manual instructions rather than deleting data whose identity changed. */
  rollback: () => Promise<string[]>
}

export type StagedWorkspaceCommit = {
  workspaceId: string
  staged: StagedWorkspace
  strategy: DataMigrationWorkspaceConflictStrategy
  resolutions?: Readonly<Record<string, DataMigrationFileConflictResolution | undefined>>
  renamedPaths?: Readonly<Record<string, PackageRelativePath | undefined>>
}

export type ImportTransactionCommitInput = {
  operationId: string
  workspaces: readonly StagedWorkspaceCommit[]
  runtime?: { importId: string; client: RuntimeMigrationTransactionClient }
  applicationSteps?: readonly ImportApplicationMutationStep[]
  initialWarnings?: readonly string[]
  onRefresh?: () => Promise<void>
}

export type ImportTransactionRecoveryInput = {
  operationId: string
  runtime?: { client: RuntimeMigrationTransactionClient; importId?: string }
  resolveApplicationStep?: (mutation: MigrationJournalMutation) => Promise<ImportApplicationMutationStep | null>
}

export class DataMigrationImportTransactionCoordinator {
  private activeOperationId: string | null = null
  private activeAbortController: AbortController | null = null

  constructor(
    private readonly journals: MigrationJournalStore,
    private readonly reports: MigrationReportStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async begin(plan: DataMigrationImportPlan): Promise<MigrationOperationJournal> {
    const incomplete = await this.journals.listIncomplete()
    const blocking = incomplete.find((journal) => journal.operationId !== plan.operationId)
    if (blocking) throw new Error(`migration recovery is required before starting another import: ${blocking.operationId}`)
    return this.journals.createInspected(plan)
  }

  async markStaged(operationId: string): Promise<MigrationOperationJournal> {
    return this.journals.setPhase(operationId, 'staged')
  }

  async commit(input: ImportTransactionCommitInput): Promise<{ journal: MigrationOperationJournal; report: DataMigrationReport }> {
    return this.runExclusive(input.operationId, async (signal) => {
      let runtimeResult: RuntimeMigrationCommitResult | undefined
      try {
        let journal = await this.journals.read(input.operationId)
        if (journal.phase === 'staged') journal = await this.journals.setPhase(input.operationId, 'committing')
        if (journal.phase !== 'committing' && journal.phase !== 'verifying') {
          throw new Error(`migration import cannot resume during ${journal.phase}`)
        }

        if (journal.phase === 'committing') for (const workspace of input.workspaces) {
          await this.throwIfCancellationRequested(input.operationId, signal)
          const completedSourcePaths = await this.recoverWorkspaceMutationMarkers(
            input.operationId,
            workspace.workspaceId
          )
          const recoveredJournal = await this.journals.read(input.operationId)
          const atomicWorkspaceComplete = workspace.strategy === 'keep-both' && recoveredJournal.mutations.some(
            (mutation) => mutation.target === 'workspace' &&
              mutation.details.workspaceId === workspace.workspaceId &&
              mutation.action === 'create' &&
              mutation.targetPath === workspace.staged.destinationRoot &&
              (mutation.status === 'applied' || mutation.status === 'verified')
          )
          if (atomicWorkspaceComplete) {
            await rm(workspace.staged.stagingRoot, { recursive: true, force: true }).catch(() => undefined)
            continue
          }
          const remainingFiles = workspace.staged.files.filter((file) => !completedSourcePaths.has(file.stagedPath))
          if (remainingFiles.length === 0 && completedSourcePaths.size > 0) {
            await rm(workspace.staged.stagingRoot, { recursive: true, force: true }).catch(() => undefined)
            continue
          }
          await commitStagedWorkspace({
            staged: { ...workspace.staged, files: remainingFiles },
            strategy: workspace.strategy,
            ...(workspace.resolutions ? { resolutions: workspace.resolutions } : {}),
            ...(workspace.renamedPaths ? { renamedPaths: workspace.renamedPaths } : {}),
            lifecycle: {
              before: async (mutation, ordinal) => {
                await this.throwIfCancellationRequested(input.operationId, signal)
                await this.journals.planMutation(
                  input.operationId,
                  workspaceJournalMutation(workspace.workspaceId, mutation, ordinal)
                )
              },
              after: async (mutation, ordinal) => {
                await this.journals.markMutationApplied(
                  input.operationId,
                  workspaceMutationId(workspace.workspaceId, mutation, ordinal)
                )
              }
            }
          })
        }

        if (journal.phase === 'committing' && input.runtime) {
          await this.throwIfCancellationRequested(input.operationId, signal)
          const mutation = runtimeJournalMutation(input.runtime.importId)
          await this.journals.planMutation(input.operationId, mutation)
          const current = (await this.journals.read(input.operationId)).mutations.find((item) => item.mutationId === mutation.mutationId)
          if (current?.status !== 'applied' && current?.status !== 'verified') {
            runtimeResult = await input.runtime.client.commit(input.runtime.importId)
            await this.journals.markMutationApplied(input.operationId, mutation.mutationId)
          }
        }

        if (journal.phase === 'committing') for (const step of input.applicationSteps ?? []) {
          await this.throwIfCancellationRequested(input.operationId, signal)
          await this.journals.planMutation(input.operationId, plannedOnly(step))
          const current = (await this.journals.read(input.operationId)).mutations.find((item) => item.mutationId === step.mutationId)
          if (current?.status !== 'applied' && current?.status !== 'verified') {
            await step.apply()
            await this.journals.markMutationApplied(input.operationId, step.mutationId)
          }
        }

        await this.throwIfCancellationRequested(input.operationId, signal)
        if ((await this.journals.read(input.operationId)).phase === 'committing') {
          await this.journals.setPhase(input.operationId, 'verifying')
        }
        const committed = await this.journals.read(input.operationId)
        const workspaceMutations = committed.mutations.filter((mutation) => mutation.target === 'workspace')
        await verifyWorkspaceCommit(workspaceMutations.map(workspaceMutationFromJournal))
        for (const mutation of workspaceMutations) {
          await this.journals.markMutationVerified(input.operationId, mutation.mutationId)
        }
        if (input.runtime) {
          runtimeResult = await input.runtime.client.verify(input.runtime.importId)
          await this.journals.markMutationVerified(input.operationId, runtimeJournalMutation(input.runtime.importId).mutationId)
        }
        for (const step of input.applicationSteps ?? []) {
          await step.verify()
          await this.journals.markMutationVerified(input.operationId, step.mutationId)
        }
        await input.onRefresh?.()

        const finalBeforeReport = await this.journals.read(input.operationId)
        const warnings = unique([
          ...(input.initialWarnings ?? []),
          ...(runtimeResult?.warnings ?? []),
          ...finalBeforeReport.warnings
        ])
        const finishedAt = this.now()
        const backupExpiresAt = defaultMigrationBackupExpiry(finishedAt)
        const generatedReport = buildImportReport({
          journal: { ...finalBeforeReport, backupExpiresAt },
          now: this.now(),
          outcome: warnings.length > 0 || finalBeforeReport.plan.disabledItems.length > 0 || finalBeforeReport.plan.unresolvedReferences.length > 0
            ? 'completed-with-review'
            : 'success',
          warnings,
          runtimeResult
        })
        const existingReport = await this.reports.read(input.operationId).catch(() => null)
        if (existingReport && (existingReport.kind !== 'import' || existingReport.packageId !== finalBeforeReport.packageId)) {
          throw new Error(`existing migration report does not match recoverable operation: ${input.operationId}`)
        }
        const report = existingReport ?? generatedReport
        const reportPath = await this.reports.writeImmutable(report)
        const completed = await this.journals.setPhase(input.operationId, 'completed', {
          outcome: report.outcome,
          reportPath,
          backupExpiresAt: defaultMigrationBackupExpiry(finishedAt)
        })
        await input.runtime?.client.finalize?.(input.runtime.importId).catch(() => undefined)
        return { journal: completed, report }
      } catch (error) {
        const rolledBack = await this.rollbackInternal({
          operationId: input.operationId,
          ...(input.runtime ? { runtime: input.runtime } : {}),
          applicationSteps: input.applicationSteps ?? [],
          cause: error
        })
        return rolledBack
      }
    })
  }

  async requestCancellation(operationId: string): Promise<MigrationOperationJournal> {
    const journal = await this.journals.requestCancellation(operationId)
    if (this.activeOperationId === operationId) this.activeAbortController?.abort(new Error('migration cancellation requested'))
    if (journal.phase === 'inspected') return this.journals.setPhase(operationId, 'cancelled')
    return journal
  }

  async rollback(input: ImportTransactionRecoveryInput): Promise<{ journal: MigrationOperationJournal; report: DataMigrationReport }> {
    return this.runExclusive(input.operationId, async () => {
      const journal = await this.journals.read(input.operationId)
      const steps: ImportApplicationMutationStep[] = []
      for (const mutation of journal.mutations) {
        if (mutation.target !== 'settings' && mutation.target !== 'renderer-state' && mutation.target !== 'trust') continue
        const resolved = await input.resolveApplicationStep?.(mutation)
        if (resolved) steps.push(resolved)
      }
      const runtimeMutation = journal.mutations.find((mutation) => mutation.target === 'runtime')
      const importId = input.runtime?.importId ?? stringDetail(runtimeMutation, 'importId')
      return this.rollbackInternal({
        operationId: input.operationId,
        ...(input.runtime && importId ? { runtime: { client: input.runtime.client, importId } } : {}),
        applicationSteps: steps,
        cause: new Error('migration rollback requested')
      })
    })
  }

  private async rollbackInternal(input: {
    operationId: string
    runtime?: { importId: string; client: RuntimeMigrationTransactionClient }
    applicationSteps: readonly ImportApplicationMutationStep[]
    cause: unknown
  }): Promise<{ journal: MigrationOperationJournal; report: DataMigrationReport }> {
    let journal = await this.journals.read(input.operationId)
    if (journal.phase !== 'rolling-back') {
      journal = await this.journals.setPhase(input.operationId, 'rolling-back')
    }
    const warnings: string[] = []
    const stepsById = new Map(input.applicationSteps.map((step) => [step.mutationId, step]))
    for (const mutation of [...journal.mutations].reverse()) {
      if (mutation.status === 'rolled-back') continue
      try {
        if (mutation.target === 'workspace') {
          const mutationWarnings = await restoreWorkspaceCommit([workspaceMutationFromJournal(mutation)])
          warnings.push(...mutationWarnings)
          await this.journals.markMutationRolledBack(input.operationId, mutation.mutationId, mutationWarnings[0])
        } else if (mutation.target === 'runtime') {
          const importId = input.runtime?.importId ?? stringDetail(mutation, 'importId')
          if (!input.runtime || !importId) throw new Error('runtime rollback requires recovered runtime import state')
          await input.runtime.client.rollback(importId)
          await this.journals.markMutationRolledBack(input.operationId, mutation.mutationId)
        } else {
          const step = stepsById.get(mutation.mutationId)
          if (!step) throw new Error(`application rollback adapter is unavailable: ${mutation.mutationId}`)
          const stepWarnings = await step.rollback()
          warnings.push(...stepWarnings)
          await this.journals.markMutationRolledBack(input.operationId, mutation.mutationId, stepWarnings[0])
        }
      } catch (error) {
        const warning = `Manual recovery required for ${mutation.target}/${mutation.action}: ${safeErrorMessage(error)}`
        warnings.push(warning)
        await this.journals.markMutationRolledBack(input.operationId, mutation.mutationId, warning)
      }
    }

    const manualRecoverySteps = warnings.filter((warning) => /manual|preserved|unavailable/i.test(warning))
    if (warnings.length > 0) {
      journal = await this.journals.appendRecoveryFindings(input.operationId, {
        warnings,
        manualRecoverySteps
      })
    } else {
      journal = await this.journals.read(input.operationId)
    }
    const error = recoveryDataMigrationError(input.cause, manualRecoverySteps.length > 0)
    let outcome: 'failed' | 'rolled-back' = 'rolled-back'
    if (manualRecoverySteps.length > 0) outcome = 'failed'
    const report = buildImportReport({ journal, now: this.now(), outcome, warnings: unique([...journal.warnings, ...warnings]), error })
    let reportPath = journal.reportPath
    if (!reportPath) reportPath = await this.reports.writeImmutable(report)
    const completed = await this.journals.setPhase(input.operationId, manualRecoverySteps.length > 0 ? 'failed' : 'completed', {
      outcome,
      error,
      reportPath
    })
    if (completed.phase === 'completed' && input.runtime) {
      await input.runtime.client.finalize?.(input.runtime.importId).catch(() => undefined)
    }
    return { journal: completed, report }
  }

  private async throwIfCancellationRequested(operationId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if ((await this.journals.read(operationId)).cancellationRequestedAt) {
      throw new Error('migration cancellation requested')
    }
  }

  private async recoverWorkspaceMutationMarkers(operationId: string, workspaceId: string): Promise<Set<string>> {
    let journal = await this.journals.read(operationId)
    const candidates = journal.mutations.filter(
      (mutation) => mutation.target === 'workspace' && mutation.details.workspaceId === workspaceId
    )
    for (const mutation of candidates) {
      if (mutation.status !== 'planned') continue
      const candidate = workspaceMutationFromJournal(mutation)
      const actionPath = mutation.action === 'backup' ? mutation.backupPath : mutation.targetPath
      const actionExists = actionPath ? await lstat(actionPath).then(() => true).catch(() => false) : false
      const sourceExists = mutation.sourcePath
        ? await lstat(mutation.sourcePath).then(() => true).catch(() => false)
        : false
      if (mutation.action === 'skip') {
        if (!sourceExists) await this.journals.markMutationApplied(operationId, mutation.mutationId)
        continue
      }
      if (!actionExists) continue
      await verifyWorkspaceCommit([candidate])
      await this.journals.markMutationApplied(operationId, mutation.mutationId)
    }
    journal = await this.journals.read(operationId)
    return new Set(journal.mutations.flatMap((mutation) =>
      mutation.target === 'workspace' &&
      mutation.details.workspaceId === workspaceId &&
      mutation.action !== 'backup' &&
      (mutation.status === 'applied' || mutation.status === 'verified') &&
      mutation.sourcePath
        ? [mutation.sourcePath]
        : []
    ))
  }

  private async runExclusive<T>(operationId: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.activeOperationId) throw new Error(`another migration mutation is already active: ${this.activeOperationId}`)
    this.activeOperationId = operationId
    this.activeAbortController = new AbortController()
    try {
      return await task(this.activeAbortController.signal)
    } finally {
      this.activeOperationId = null
      this.activeAbortController = null
    }
  }
}

function workspaceJournalMutation(
  workspaceId: string,
  mutation: WorkspaceCommitMutation,
  ordinal: number
): PlannedMigrationMutation {
  return {
    mutationId: workspaceMutationId(workspaceId, mutation, ordinal),
    target: 'workspace',
    action: mutation.kind,
    targetPath: mutation.destinationPath,
    ...(mutation.sourcePath ? { sourcePath: mutation.sourcePath } : {}),
    ...(mutation.backupPath ? { backupPath: mutation.backupPath } : {}),
    ...(mutation.originalSha256 ? { expectedBeforeIdentity: mutation.originalSha256 } : {}),
    ...(mutation.expectedSha256 ? { expectedAfterIdentity: mutation.expectedSha256 } : {}),
    details: { workspaceId, ordinal }
  }
}

function workspaceMutationId(workspaceId: string, mutation: WorkspaceCommitMutation, ordinal: number): string {
  return migrationMutationId({ target: 'workspace', action: mutation.kind, ownerId: workspaceId, ordinal })
}

function workspaceMutationFromJournal(mutation: MigrationJournalMutation): WorkspaceCommitMutation {
  if (!mutation.targetPath) throw new Error(`workspace journal mutation has no target path: ${mutation.mutationId}`)
  if (!['create', 'replace', 'backup', 'skip', 'identical', 'sibling'].includes(mutation.action)) {
    throw new Error(`unsupported workspace journal mutation: ${mutation.action}`)
  }
  return {
    kind: mutation.action as WorkspaceCommitMutation['kind'],
    destinationPath: mutation.targetPath,
    ...(mutation.sourcePath ? { sourcePath: mutation.sourcePath } : {}),
    ...(mutation.backupPath ? { backupPath: mutation.backupPath } : {}),
    ...(mutation.expectedAfterIdentity ? { expectedSha256: mutation.expectedAfterIdentity } : {}),
    ...(mutation.expectedBeforeIdentity ? { originalSha256: mutation.expectedBeforeIdentity } : {})
  }
}

function runtimeJournalMutation(importId: string): PlannedMigrationMutation {
  return {
    mutationId: migrationMutationId({ target: 'runtime', action: 'additive-import', ownerId: 'kun' }),
    target: 'runtime',
    action: 'additive-import',
    details: { importId }
  }
}

function plannedOnly(step: ImportApplicationMutationStep): PlannedMigrationMutation {
  return {
    mutationId: step.mutationId,
    target: step.target,
    action: step.action,
    ...(step.targetPath ? { targetPath: step.targetPath } : {}),
    ...(step.sourcePath ? { sourcePath: step.sourcePath } : {}),
    ...(step.backupPath ? { backupPath: step.backupPath } : {}),
    ...(step.expectedBeforeIdentity ? { expectedBeforeIdentity: step.expectedBeforeIdentity } : {}),
    ...(step.expectedAfterIdentity ? { expectedAfterIdentity: step.expectedAfterIdentity } : {}),
    details: step.details
  }
}

function buildImportReport(input: {
  journal: MigrationOperationJournal
  now: Date
  outcome: DataMigrationReport['outcome']
  warnings: readonly string[]
  runtimeResult?: RuntimeMigrationCommitResult
  error?: DataMigrationError
}): DataMigrationReport {
  const workspacePathMap = Object.fromEntries(input.journal.plan.mappings.flatMap((mapping) =>
    mapping.destinationRoot ? [[mapping.workspaceId, mapping.destinationRoot]] : []
  ))
  const mutationCounts = input.journal.mutations.reduce<Record<string, number>>((counts, mutation) => {
    counts[`${mutation.target}.${mutation.action}`] = (counts[`${mutation.target}.${mutation.action}`] ?? 0) + 1
    return counts
  }, {})
  return DataMigrationReportSchema.parse({
    operationId: input.journal.operationId,
    packageId: input.journal.packageId,
    kind: 'import',
    outcome: input.outcome,
    startedAt: input.journal.startedAt,
    finishedAt: input.now.toISOString(),
    counts: { ...mutationCounts, ...(input.runtimeResult?.counts ?? {}) },
    workspacePathMap,
    threadIdMap: input.runtimeResult?.threadIdMap ?? input.journal.plan.threadIdMap,
    exclusions: [],
    warnings: [...input.warnings],
    unresolvedReferences: input.journal.plan.unresolvedReferences.length,
    disabledItems: input.journal.plan.disabledItems.length,
    sourcePlatform: input.journal.plan.sourcePlatform,
    destinationPlatform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
    conflicts: input.journal.plan.conflicts.map((conflict) => ({
      workspaceId: conflict.workspaceId,
      path: conflict.path,
      kind: conflict.kind,
      ...(conflict.resolution ? { resolution: conflict.resolution } : {})
    })),
    skippedItems: input.journal.plan.mappings.flatMap((mapping) => mapping.strategy === 'skip'
      ? [{ component: 'workspace' as const, id: mapping.workspaceId, reason: 'workspace mapping skipped' }]
      : []),
    renamedPaths: Object.fromEntries(input.journal.plan.conflicts.flatMap((conflict) =>
      conflict.renamedPath ? [[conflict.path, conflict.renamedPath]] : []
    )),
    disabledItemDetails: input.journal.plan.disabledItems,
    unresolvedReferenceDetails: input.journal.plan.unresolvedReferences,
    backups: input.journal.mutations.flatMap((mutation) => mutation.backupPath ? [{
      ...(typeof mutation.details.workspaceId === 'string' ? { workspaceId: mutation.details.workspaceId } : {}),
      path: mutation.backupPath,
      ...(input.journal.backupExpiresAt ? { expiresAt: input.journal.backupExpiresAt } : {})
    }] : []),
    timingsMs: {
      total: Math.max(0, input.now.getTime() - new Date(input.journal.startedAt).getTime())
    },
    ...(input.journal.backupExpiresAt ? { backupExpiresAt: input.journal.backupExpiresAt } : {}),
    ...(input.error ? { error: input.error } : {})
  })
}

function recoveryDataMigrationError(error: unknown, manual: boolean): DataMigrationError {
  return DataMigrationErrorSchema.parse({
    code: manual ? 'RECOVERY_MANUAL_INTERVENTION' : 'RECOVERY_REQUIRED',
    phase: 'rolling-back',
    message: safeErrorMessage(error),
    destinationEffect: manual ? 'partially-committed' : 'rolled-back',
    retryable: !manual,
    nextActions: manual
      ? ['Review the local migration report before changing any preserved destination paths.']
      : ['Review the rollback report and retry the import when ready.']
  })
}

function stringDetail(mutation: MigrationJournalMutation | undefined, key: string): string | undefined {
  const value = mutation?.details[key]
  return typeof value === 'string' ? value : undefined
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500) || 'migration operation failed'
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
