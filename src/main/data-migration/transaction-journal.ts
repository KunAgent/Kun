import { randomUUID } from 'node:crypto'
import { open, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import {
  DataMigrationErrorSchema,
  DataMigrationImportPlanSchema,
  type DataMigrationError,
  type DataMigrationImportPlan
} from '../../shared/data-migration'

const JOURNAL_SCHEMA_VERSION = 1 as const

export const MigrationJournalPhaseSchema = z.enum([
  'inspected',
  'staged',
  'committing',
  'verifying',
  'rolling-back',
  'completed',
  'failed',
  'cancelled'
])
export type MigrationJournalPhase = z.infer<typeof MigrationJournalPhaseSchema>

export const MigrationJournalMutationSchema = z.object({
  mutationId: z.string().min(1),
  target: z.enum(['workspace', 'runtime', 'settings', 'renderer-state', 'trust']),
  action: z.string().min(1),
  status: z.enum(['planned', 'applied', 'verified', 'rolled-back', 'manual-recovery']),
  targetPath: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  backupPath: z.string().min(1).optional(),
  expectedBeforeIdentity: z.string().min(1).optional(),
  expectedAfterIdentity: z.string().min(1).optional(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  plannedAt: z.string().min(1),
  appliedAt: z.string().min(1).optional(),
  verifiedAt: z.string().min(1).optional(),
  rolledBackAt: z.string().min(1).optional(),
  warning: z.string().min(1).optional()
}).strict()
export type MigrationJournalMutation = z.infer<typeof MigrationJournalMutationSchema>

export const MigrationOperationJournalSchema = z.object({
  schemaVersion: z.literal(JOURNAL_SCHEMA_VERSION),
  operationId: z.string().min(1),
  packageId: z.string().min(1),
  kind: z.literal('import'),
  phase: MigrationJournalPhaseSchema,
  outcome: z.enum(['success', 'completed-with-review', 'rolled-back', 'failed']).optional(),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
  backupExpiresAt: z.string().min(1).optional(),
  cancellationRequestedAt: z.string().min(1).optional(),
  plan: DataMigrationImportPlanSchema,
  mutations: z.array(MigrationJournalMutationSchema),
  warnings: z.array(z.string()),
  manualRecoverySteps: z.array(z.string()),
  error: DataMigrationErrorSchema.optional(),
  reportPath: z.string().min(1).optional()
}).strict()
export type MigrationOperationJournal = z.infer<typeof MigrationOperationJournalSchema>

export type PlannedMigrationMutation = Omit<
  MigrationJournalMutation,
  'status' | 'plannedAt' | 'appliedAt' | 'verifiedAt' | 'rolledBackAt' | 'warning'
>

const ALLOWED_PHASE_TRANSITIONS: Readonly<Record<MigrationJournalPhase, readonly MigrationJournalPhase[]>> = {
  inspected: ['staged', 'cancelled', 'failed'],
  staged: ['committing', 'rolling-back', 'cancelled', 'failed'],
  committing: ['verifying', 'rolling-back', 'failed'],
  verifying: ['completed', 'rolling-back', 'failed'],
  'rolling-back': ['completed', 'failed'],
  completed: [],
  failed: ['rolling-back'],
  cancelled: []
}

export class MigrationJournalStore {
  private readonly operationLocks = new Map<string, Promise<void>>()

  constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {}

  async createInspected(plan: DataMigrationImportPlan): Promise<MigrationOperationJournal> {
    const parsedPlan = DataMigrationImportPlanSchema.parse(plan)
    await mkdir(this.operationDirectory(parsedPlan.operationId), { recursive: true, mode: 0o700 })
    if (await this.exists(parsedPlan.operationId)) {
      const existing = await this.read(parsedPlan.operationId)
      if (JSON.stringify(existing.plan) !== JSON.stringify(parsedPlan)) {
        throw new Error(`migration journal already exists with a different plan: ${parsedPlan.operationId}`)
      }
      return existing
    }
    const now = this.now().toISOString()
    const journal = MigrationOperationJournalSchema.parse({
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      operationId: parsedPlan.operationId,
      packageId: parsedPlan.packageId,
      kind: 'import',
      phase: 'inspected',
      startedAt: now,
      updatedAt: now,
      plan: parsedPlan,
      mutations: [],
      warnings: [],
      manualRecoverySteps: []
    })
    await atomicDurableJson(this.journalPath(parsedPlan.operationId), journal)
    return journal
  }

  async read(operationId: string): Promise<MigrationOperationJournal> {
    const raw = await readFile(this.journalPath(operationId), 'utf8')
    return MigrationOperationJournalSchema.parse(JSON.parse(raw))
  }

  async list(): Promise<MigrationOperationJournal[]> {
    const names = await readdir(this.root, { withFileTypes: true }).catch(() => [])
    const journals: MigrationOperationJournal[] = []
    for (const entry of names) {
      if (!entry.isDirectory() || !isSafeId(entry.name)) continue
      try {
        journals.push(await this.read(entry.name))
      } catch {
        // A malformed journal is not silently treated as complete. Surface a synthetic
        // recovery record through the startup audit instead of executing its contents.
      }
    }
    return journals.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async listIncomplete(): Promise<MigrationOperationJournal[]> {
    return (await this.list()).filter((journal) => {
      if (journal.phase === 'completed' || journal.phase === 'cancelled') return false
      if (journal.phase === 'failed' && journal.mutations.length === 0) return false
      return true
    })
  }

  async setPhase(
    operationId: string,
    phase: MigrationJournalPhase,
    patch: Partial<Pick<MigrationOperationJournal, 'outcome' | 'error' | 'reportPath' | 'backupExpiresAt'>> = {}
  ): Promise<MigrationOperationJournal> {
    return this.update(operationId, (journal) => {
      if (journal.phase !== phase && !ALLOWED_PHASE_TRANSITIONS[journal.phase].includes(phase)) {
        throw new Error(`invalid migration journal phase transition: ${journal.phase} -> ${phase}`)
      }
      const now = this.now().toISOString()
      return {
        ...journal,
        ...patch,
        phase,
        updatedAt: now,
        ...((phase === 'completed' || phase === 'cancelled') ? { completedAt: now } : {})
      }
    })
  }

  async planMutation(operationId: string, mutation: PlannedMigrationMutation): Promise<MigrationJournalMutation> {
    let result: MigrationJournalMutation | undefined
    await this.update(operationId, (journal) => {
      if (!['staged', 'committing', 'rolling-back'].includes(journal.phase)) {
        throw new Error(`cannot plan migration mutation during ${journal.phase}`)
      }
      const existing = journal.mutations.find((item) => item.mutationId === mutation.mutationId)
      if (existing) {
        if (JSON.stringify(plannedMutationShape(existing)) !== JSON.stringify(plannedMutationShape(mutation))) {
          throw new Error(`migration mutation id was reused with different content: ${mutation.mutationId}`)
        }
        result = existing
        return journal
      }
      result = MigrationJournalMutationSchema.parse({
        ...mutation,
        status: 'planned',
        plannedAt: this.now().toISOString(),
        details: mutation.details ?? {}
      })
      return { ...journal, mutations: [...journal.mutations, result!] }
    })
    return result!
  }

  async markMutationApplied(operationId: string, mutationId: string): Promise<MigrationOperationJournal> {
    return this.updateMutation(operationId, mutationId, (mutation) => ({
      ...mutation,
      status: mutation.status === 'verified' ? 'verified' : 'applied',
      appliedAt: mutation.appliedAt ?? this.now().toISOString()
    }))
  }

  async markMutationVerified(operationId: string, mutationId: string): Promise<MigrationOperationJournal> {
    return this.updateMutation(operationId, mutationId, (mutation) => ({
      ...mutation,
      status: 'verified',
      appliedAt: mutation.appliedAt ?? this.now().toISOString(),
      verifiedAt: this.now().toISOString()
    }))
  }

  async markMutationRolledBack(
    operationId: string,
    mutationId: string,
    warning?: string
  ): Promise<MigrationOperationJournal> {
    return this.updateMutation(operationId, mutationId, (mutation) => ({
      ...mutation,
      status: warning ? 'manual-recovery' : 'rolled-back',
      rolledBackAt: this.now().toISOString(),
      ...(warning ? { warning } : {})
    }))
  }

  async requestCancellation(operationId: string): Promise<MigrationOperationJournal> {
    return this.update(operationId, (journal) => ({
      ...journal,
      cancellationRequestedAt: journal.cancellationRequestedAt ?? this.now().toISOString()
    }))
  }

  async appendRecoveryFindings(
    operationId: string,
    input: { warnings?: readonly string[]; manualRecoverySteps?: readonly string[] }
  ): Promise<MigrationOperationJournal> {
    return this.update(operationId, (journal) => ({
      ...journal,
      warnings: unique([...journal.warnings, ...(input.warnings ?? [])]),
      manualRecoverySteps: unique([...journal.manualRecoverySteps, ...(input.manualRecoverySteps ?? [])])
    }))
  }

  async writeArtifact(operationId: string, name: string, value: unknown): Promise<string> {
    if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(name) || basename(name) !== name) {
      throw new Error(`unsafe migration journal artifact name: ${name}`)
    }
    const path = join(this.operationDirectory(operationId), name)
    await atomicDurableJson(path, value)
    return path
  }

  async readArtifact<T>(operationId: string, name: string): Promise<T> {
    if (!/^[a-z0-9][a-z0-9._-]*\.json$/i.test(name) || basename(name) !== name) {
      throw new Error(`unsafe migration journal artifact name: ${name}`)
    }
    return JSON.parse(await readFile(join(this.operationDirectory(operationId), name), 'utf8')) as T
  }

  async removeCompletedOperation(operationId: string): Promise<void> {
    const journal = await this.read(operationId)
    if (!['completed', 'cancelled'].includes(journal.phase)) {
      throw new Error(`cannot remove recoverable migration journal: ${operationId}`)
    }
    await rm(this.operationDirectory(operationId), { recursive: true, force: true })
  }

  operationDirectory(operationId: string): string {
    if (!isSafeId(operationId)) throw new Error(`unsafe migration operation id: ${operationId}`)
    return join(this.root, operationId)
  }

  private journalPath(operationId: string): string {
    return join(this.operationDirectory(operationId), 'journal.json')
  }

  private async exists(operationId: string): Promise<boolean> {
    return readFile(this.journalPath(operationId)).then(() => true).catch(() => false)
  }

  private async update(
    operationId: string,
    updater: (journal: MigrationOperationJournal) => MigrationOperationJournal
  ): Promise<MigrationOperationJournal> {
    return this.withOperationLock(operationId, async () => {
      const current = await this.read(operationId)
      const next = MigrationOperationJournalSchema.parse({
        ...updater(current),
        updatedAt: this.now().toISOString()
      })
      await atomicDurableJson(this.journalPath(operationId), next)
      return next
    })
  }

  private async updateMutation(
    operationId: string,
    mutationId: string,
    updater: (mutation: MigrationJournalMutation) => MigrationJournalMutation
  ): Promise<MigrationOperationJournal> {
    return this.update(operationId, (journal) => {
      let found = false
      const mutations = journal.mutations.map((mutation) => {
        if (mutation.mutationId !== mutationId) return mutation
        found = true
        return MigrationJournalMutationSchema.parse(updater(mutation))
      })
      if (!found) throw new Error(`migration mutation not found: ${mutationId}`)
      return { ...journal, mutations }
    })
  }

  private async withOperationLock<T>(operationId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.operationLocks.get(operationId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.operationLocks.set(operationId, queued)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.operationLocks.get(operationId) === queued) this.operationLocks.delete(operationId)
    }
  }
}

export function migrationMutationId(input: {
  target: MigrationJournalMutation['target']
  action: string
  ownerId?: string
  ordinal?: number
}): string {
  const parts = [input.target, input.action, input.ownerId ?? 'operation', String(input.ordinal ?? 0)]
  return parts.map((part) => part.replace(/[^a-zA-Z0-9_.-]+/g, '_')).join(':')
}

export function migrationRecoveryError(input: {
  phase: DataMigrationError['phase']
  message: string
  destinationEffect: DataMigrationError['destinationEffect']
  manual: boolean
}): DataMigrationError {
  return DataMigrationErrorSchema.parse({
    code: input.manual ? 'RECOVERY_MANUAL_INTERVENTION' : 'RECOVERY_REQUIRED',
    phase: input.phase,
    message: input.message,
    destinationEffect: input.destinationEffect,
    retryable: !input.manual,
    nextActions: input.manual
      ? ['Review the migration report and preserve every path marked as independently modified.']
      : ['Resume the import or roll it back before starting another migration.']
  })
}

async function atomicDurableJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, path)
    const directoryHandle = await open(directory, 'r').catch(() => null)
    try {
      await directoryHandle?.sync().catch(() => undefined)
    } finally {
      await directoryHandle?.close().catch(() => undefined)
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

function isSafeId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function plannedMutationShape(value: PlannedMigrationMutation | MigrationJournalMutation): PlannedMigrationMutation {
  return {
    mutationId: value.mutationId,
    target: value.target,
    action: value.action,
    ...(value.targetPath ? { targetPath: value.targetPath } : {}),
    ...(value.sourcePath ? { sourcePath: value.sourcePath } : {}),
    ...(value.backupPath ? { backupPath: value.backupPath } : {}),
    ...(value.expectedBeforeIdentity ? { expectedBeforeIdentity: value.expectedBeforeIdentity } : {}),
    ...(value.expectedAfterIdentity ? { expectedAfterIdentity: value.expectedAfterIdentity } : {}),
    details: value.details ?? {}
  }
}
