import { z } from 'zod'

export const STORAGE_RELOCATION_SCHEMA_VERSION = 1 as const
export const STORAGE_RELOCATION_MINIMUM_RESERVE_BYTES = 5 * 1024 * 1024 * 1024
export const STORAGE_RELOCATION_RESERVE_RATIO = 0.1
export const STORAGE_RELOCATION_PROGRESS_MESSAGE_MAX_LENGTH = 2_000

export const StorageRelocationPhaseSchema = z.enum([
  'prepared',
  'draining',
  'copying',
  'verifying',
  'cutover',
  'health-check',
  'rolling-back',
  'cleanup-pending',
  'completed',
  'failed',
  'cancelled'
])
export type StorageRelocationPhase = z.infer<typeof StorageRelocationPhaseSchema>

export const StorageRelocationErrorCodeSchema = z.enum([
  'unsupported_platform',
  'feature_disabled',
  'custom_data_dir',
  'invalid_destination',
  'destination_not_empty',
  'destination_not_fixed_ntfs',
  'destination_unavailable',
  'insufficient_space',
  'unsafe_reparse_point',
  'active_work_confirmation_required',
  'active_writer',
  'copy_failed',
  'verification_failed',
  'cutover_failed',
  'health_check_failed',
  'rollback_failed',
  'cleanup_failed',
  'journal_invalid',
  'operation_conflict',
  'cancelled'
])
export type StorageRelocationErrorCode = z.infer<typeof StorageRelocationErrorCodeSchema>

export const StorageRelocationErrorSchema = z.object({
  code: StorageRelocationErrorCodeSchema,
  message: z.string().min(1).max(4_000),
  nextActions: z.array(z.string().min(1).max(1_000)).max(10).default([])
}).strict()
export type StorageRelocationError = z.infer<typeof StorageRelocationErrorSchema>

export const StorageRelocationRootNameSchema = z.enum(['.kun', '.deepseekgui'])
export type StorageRelocationRootName = z.infer<typeof StorageRelocationRootNameSchema>

export const StorageRelocationRootSchema = z.object({
  name: StorageRelocationRootNameSchema,
  logicalPath: z.string().min(1).max(32_767),
  physicalPath: z.string().min(1).max(32_767),
  exists: z.boolean(),
  junction: z.boolean(),
  appOwned: z.boolean(),
  files: z.number().int().nonnegative(),
  directories: z.number().int().nonnegative(),
  links: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative()
}).strict()
export type StorageRelocationRoot = z.infer<typeof StorageRelocationRootSchema>

export const StorageRelocationActiveWorkSchema = z.object({
  kind: z.enum(['turn', 'runtime', 'background-service', 'external-writer']),
  id: z.string().min(1).max(512),
  label: z.string().min(1).max(1_000),
  interruptible: z.boolean()
}).strict()
export type StorageRelocationActiveWork = z.infer<typeof StorageRelocationActiveWorkSchema>

export const StorageRelocationProgressSchema = z.object({
  operationId: z.string().uuid(),
  phase: StorageRelocationPhaseSchema,
  completedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  completedItems: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  currentItem: z.string().max(2_048).optional(),
  cancellable: z.boolean(),
  message: z.string().max(STORAGE_RELOCATION_PROGRESS_MESSAGE_MAX_LENGTH).optional(),
  updatedAt: z.string().datetime()
}).strict()
export type StorageRelocationProgress = z.infer<typeof StorageRelocationProgressSchema>

export const StorageRelocationPreflightPlanSchema = z.object({
  operationId: z.string().uuid(),
  kind: z.enum(['move', 'restore-default']),
  destinationRoot: z.string().min(1).max(32_767),
  targetRoots: z.record(StorageRelocationRootNameSchema, z.string().min(1).max(32_767)),
  sources: z.array(StorageRelocationRootSchema).max(2),
  uniqueBytes: z.number().int().nonnegative(),
  requiredBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
  expectedReleasedBytes: z.number().int().nonnegative(),
  activeWork: z.array(StorageRelocationActiveWorkSchema).default([]),
  warnings: z.array(z.string().min(1).max(2_000)).default([]),
  createdAt: z.string().datetime()
}).strict()
export type StorageRelocationPreflightPlan = z.infer<typeof StorageRelocationPreflightPlanSchema>

const StorageRelocationJournalRootSchema = z.object({
  name: StorageRelocationRootNameSchema,
  logicalPath: z.string().min(1).max(32_767),
  sourcePhysicalPath: z.string().min(1).max(32_767),
  targetPath: z.string().min(1).max(32_767),
  stagingPath: z.string().min(1).max(32_767),
  sourceWasJunction: z.boolean(),
  sourceLinkTarget: z.string().max(32_767).optional(),
  sourceBackupPath: z.string().max(32_767).optional(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  activated: z.boolean(),
  cleaned: z.boolean()
}).strict()
export type StorageRelocationJournalRoot = z.infer<typeof StorageRelocationJournalRootSchema>

export const StorageRelocationOperationJournalSchema = z.object({
  schemaVersion: z.literal(STORAGE_RELOCATION_SCHEMA_VERSION),
  operationId: z.string().uuid(),
  kind: z.enum(['move', 'restore-default']),
  phase: StorageRelocationPhaseSchema,
  sourceHome: z.string().min(1).max(32_767),
  destinationRoot: z.string().min(1).max(32_767),
  controlRoot: z.string().min(1).max(32_767),
  roots: z.array(StorageRelocationJournalRootSchema).max(2),
  uniqueBytes: z.number().int().nonnegative(),
  requiredBytes: z.number().int().nonnegative(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  error: StorageRelocationErrorSchema.optional()
}).strict()
export type StorageRelocationOperationJournal = z.infer<typeof StorageRelocationOperationJournalSchema>

export const StorageRelocationReportSchema = z.object({
  schemaVersion: z.literal(STORAGE_RELOCATION_SCHEMA_VERSION),
  operationId: z.string().uuid(),
  kind: z.enum(['move', 'restore-default']),
  outcome: z.enum(['success', 'cleanup-pending', 'rolled-back', 'failed', 'cancelled']),
  sourcePaths: z.array(z.string().min(1).max(32_767)).max(2),
  destinationRoot: z.string().min(1).max(32_767),
  movedBytes: z.number().int().nonnegative(),
  releasedBytes: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1).max(2_000)).default([]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  error: StorageRelocationErrorSchema.optional()
}).strict()
export type StorageRelocationReport = z.infer<typeof StorageRelocationReportSchema>

export const StorageRelocationStatusSchema = z.object({
  supported: z.boolean(),
  enabled: z.boolean(),
  platform: z.string().min(1),
  state: z.enum(['default', 'relocated', 'pending', 'broken', 'unsupported']),
  roots: z.array(StorageRelocationRootSchema).max(2),
  totalUniqueBytes: z.number().int().nonnegative(),
  currentDestinationRoot: z.string().max(32_767).optional(),
  pending: StorageRelocationProgressSchema.optional(),
  recentReport: StorageRelocationReportSchema.optional(),
  disabledReason: z.string().max(2_000).optional(),
  recoveryRequired: z.boolean()
}).strict()
export type StorageRelocationStatus = z.infer<typeof StorageRelocationStatusSchema>

export type StorageRelocationPathPickResult = {
  canceled: boolean
  path: string | null
}

export type StorageRelocationScheduleInput = {
  plan: StorageRelocationPreflightPlan
  interruptActiveWork: boolean
}

export type StorageRelocationApi = {
  getStatus: () => Promise<StorageRelocationStatus>
  pickDestination: (defaultPath?: string) => Promise<StorageRelocationPathPickResult>
  preflight: (destinationRoot: string) => Promise<StorageRelocationPreflightPlan>
  schedule: (input: StorageRelocationScheduleInput) => Promise<StorageRelocationStatus>
  restoreDefault: (interruptActiveWork: boolean) => Promise<StorageRelocationStatus>
  cancel: (operationId: string) => Promise<StorageRelocationStatus>
  retry: (operationId: string) => Promise<StorageRelocationStatus>
  rollback: (operationId: string) => Promise<StorageRelocationStatus>
  onProgress: (handler: (progress: StorageRelocationProgress) => void) => () => void
}

export type StorageRelocationRecoveryApi = Pick<
  StorageRelocationApi,
  'getStatus' | 'cancel' | 'retry' | 'rollback' | 'onProgress'
>

export function storageRelocationRequiredBytes(uniqueBytes: number): number {
  const bytes = Number.isSafeInteger(uniqueBytes) && uniqueBytes > 0 ? uniqueBytes : 0
  return bytes + Math.max(
    STORAGE_RELOCATION_MINIMUM_RESERVE_BYTES,
    Math.ceil(bytes * STORAGE_RELOCATION_RESERVE_RATIO)
  )
}

const STORAGE_RELOCATION_PHASE_TRANSITIONS: Record<StorageRelocationPhase, readonly StorageRelocationPhase[]> = {
  prepared: ['draining', 'copying', 'failed', 'cancelled', 'rolling-back'],
  draining: ['copying', 'failed', 'cancelled', 'rolling-back'],
  copying: ['verifying', 'failed', 'cancelled', 'rolling-back'],
  verifying: ['cutover', 'failed', 'cancelled', 'rolling-back'],
  cutover: ['health-check', 'failed', 'rolling-back'],
  'health-check': ['completed', 'cleanup-pending', 'failed', 'rolling-back'],
  'rolling-back': ['failed'],
  'cleanup-pending': ['health-check', 'failed', 'rolling-back'],
  completed: [],
  failed: ['copying', 'rolling-back'],
  cancelled: []
}

export function isStorageRelocationPhaseTransitionAllowed(
  from: StorageRelocationPhase,
  to: StorageRelocationPhase
): boolean {
  return from === to || STORAGE_RELOCATION_PHASE_TRANSITIONS[from].includes(to)
}
