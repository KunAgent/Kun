import { z } from 'zod'

export const DATA_MIGRATION_FORMAT_VERSION = 1 as const
export const DATA_MIGRATION_MINIMUM_READER_VERSION = 1 as const
export const DATA_MIGRATION_BACKUP_RETENTION_DAYS = 7 as const
export const DATA_MIGRATION_DEFAULT_FRAME_BYTES = 4 * 1024 * 1024
export const DATA_MIGRATION_MAX_METADATA_BYTES = 8 * 1024 * 1024
export const DATA_MIGRATION_MAX_ENTRY_COUNT = 1_000_000
export const DATA_MIGRATION_MINIMUM_FREE_SPACE_RATIO = 0.1

export const DATA_MIGRATION_V1_DEFAULTS = Object.freeze({
  encryption: 'optional' as const,
  allowUnencryptedAfterAcknowledgement: true,
  completeIncludesGit: true,
  smallerIncludesGit: false,
  backupRetentionDays: DATA_MIGRATION_BACKUP_RETENTION_DAYS,
  workflowsImportActive: false,
  schedulesImportEnabled: false,
  clearScheduleChannelBindings: true,
  enterprisePolicyGateReserved: true,
  defaultWorkspaceConflictStrategy: 'keep-both' as const
})

export const DataMigrationSourcePlatformSchema = z.enum(['windows', 'macos', 'linux'])
export type DataMigrationSourcePlatform = z.infer<typeof DataMigrationSourcePlatformSchema>

export const DataMigrationPresetSchema = z.enum(['complete', 'smaller'])
export type DataMigrationPreset = z.infer<typeof DataMigrationPresetSchema>

export const DataMigrationCategorySchema = z.enum([
  'workspace-files',
  'thread-history',
  'attachments',
  'artifacts',
  'memory',
  'portable-settings',
  'renderer-state',
  'workflows',
  'schedules'
])
export type DataMigrationCategory = z.infer<typeof DataMigrationCategorySchema>

export const DataMigrationComponentNameSchema = z.enum([
  'manifest',
  'workspace',
  'thread',
  'session',
  'event',
  'attachment',
  'artifact',
  'memory',
  'portable-settings',
  'renderer-state',
  'workflow',
  'schedule'
])
export type DataMigrationComponentName = z.infer<typeof DataMigrationComponentNameSchema>

const MIGRATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export const DataMigrationIdSchema = z.string().regex(MIGRATION_ID_PATTERN)
export const DataMigrationSha256Schema = z.string().regex(SHA256_PATTERN)

function isStrictPackageRelativePath(value: string): boolean {
  if (!value || value.includes('\0') || value.includes('\\')) return false
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) return false
  if (/^[A-Za-z]:/.test(value) || value.startsWith('~')) return false
  const segments = value.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export const PackageRelativePathSchema = z.string().refine(isStrictPackageRelativePath, {
  message: 'expected a non-absolute POSIX path without dot segments'
}).brand<'PackageRelativePath'>()
export type PackageRelativePath = z.infer<typeof PackageRelativePathSchema>

export function parsePackageRelativePath(value: string): PackageRelativePath {
  return PackageRelativePathSchema.parse(value)
}

export const DataMigrationEncryptionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z.object({
    mode: z.literal('passphrase'),
    algorithm: z.literal('aes-256-gcm-framed'),
    kdf: z.literal('scrypt'),
    saltBase64: z.string().min(1),
    noncePrefixBase64: z.string().min(1),
    frameBytes: z.number().int().positive().max(64 * 1024 * 1024),
    cost: z.number().int().positive(),
    blockSize: z.number().int().positive(),
    parallelization: z.number().int().positive()
  }).strict()
])
export type DataMigrationEncryption = z.infer<typeof DataMigrationEncryptionSchema>

export const DataMigrationEnvelopeHeaderV1Schema = z.object({
  envelopeVersion: z.literal(1),
  payloadFormat: z.literal('zip64'),
  formatVersion: z.literal(DATA_MIGRATION_FORMAT_VERSION),
  createdAt: z.string().min(1),
  plainPayloadBytes: z.number().int().nonnegative(),
  plainPayloadSha256: DataMigrationSha256Schema,
  encryption: DataMigrationEncryptionSchema
}).strict()
export type DataMigrationEnvelopeHeaderV1 = z.infer<typeof DataMigrationEnvelopeHeaderV1Schema>

export const DataMigrationSelectionSchema = z.object({
  preset: DataMigrationPresetSchema,
  workspaceIds: z.array(DataMigrationIdSchema).default([]),
  threadIds: z.array(DataMigrationIdSchema).default([]),
  categories: z.array(DataMigrationCategorySchema).min(1),
  sensitiveContentAcknowledged: z.boolean().default(false),
  unencryptedPackageAcknowledged: z.boolean().default(false)
}).strict()
export type DataMigrationSelection = z.infer<typeof DataMigrationSelectionSchema>

export const DataMigrationWorkspaceCatalogEntrySchema = z.object({
  workspaceId: DataMigrationIdSchema,
  displayName: z.string().min(1),
  sourcePathDisplay: z.string().min(1),
  sourcePlatform: DataMigrationSourcePlatformSchema,
  fileCount: z.number().int().nonnegative(),
  logicalBytes: z.number().int().nonnegative(),
  relatedThreadIds: z.array(DataMigrationIdSchema).default([]),
  capabilities: z.array(z.enum(['code', 'design', 'write'])).default([]),
  nestedUnderWorkspaceId: DataMigrationIdSchema.optional()
}).strict()
export type DataMigrationWorkspaceCatalogEntry = z.infer<typeof DataMigrationWorkspaceCatalogEntrySchema>

export const DataMigrationThreadCatalogEntrySchema = z.object({
  exportThreadId: DataMigrationIdSchema,
  sourceThreadId: DataMigrationIdSchema,
  title: z.string(),
  workspaceId: DataMigrationIdSchema.optional(),
  status: z.enum(['idle', 'archived']),
  relation: z.enum(['primary', 'fork', 'side']).default('primary'),
  parentExportThreadId: DataMigrationIdSchema.optional(),
  model: z.string().optional(),
  providerId: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  canonicalSha256: DataMigrationSha256Schema
}).strict()
export type DataMigrationThreadCatalogEntry = z.infer<typeof DataMigrationThreadCatalogEntrySchema>

export const DataMigrationPackageEntryKindSchema = z.enum([
  'workspace-file',
  'runtime-record',
  'attachment',
  'artifact',
  'memory',
  'catalog',
  'report'
])
export type DataMigrationPackageEntryKind = z.infer<typeof DataMigrationPackageEntryKindSchema>

export const DataMigrationPackageEntrySchema = z.object({
  path: PackageRelativePathSchema,
  kind: DataMigrationPackageEntryKindSchema,
  ownerId: DataMigrationIdSchema.optional(),
  logicalBytes: z.number().int().nonnegative(),
  compressedBytes: z.number().int().nonnegative().optional(),
  sha256: DataMigrationSha256Schema,
  mode: z.number().int().nonnegative().optional(),
  modifiedAt: z.string().min(1).optional(),
  linkTarget: PackageRelativePathSchema.optional()
}).strict()
export type DataMigrationPackageEntry = z.infer<typeof DataMigrationPackageEntrySchema>

export const DataMigrationManifestV1Schema = z.object({
  formatVersion: z.literal(DATA_MIGRATION_FORMAT_VERSION),
  minimumReaderVersion: z.number().int().positive().max(DATA_MIGRATION_FORMAT_VERSION),
  packageId: DataMigrationIdSchema,
  sourceInstallationId: DataMigrationIdSchema,
  sourceAppVersion: z.string().min(1),
  sourceRuntimeVersion: z.string().min(1),
  sourcePlatform: DataMigrationSourcePlatformSchema,
  sourceArch: z.string().min(1),
  createdAt: z.string().min(1),
  encryption: DataMigrationEncryptionSchema,
  componentVersions: z.record(DataMigrationComponentNameSchema, z.number().int().positive()),
  selection: DataMigrationSelectionSchema,
  counts: z.object({
    workspaces: z.number().int().nonnegative(),
    threads: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    attachments: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative()
  }).strict(),
  expandedBytes: z.number().int().nonnegative(),
  catalogsSha256: DataMigrationSha256Schema,
  checksumsSha256: DataMigrationSha256Schema
}).strict()
export type DataMigrationManifestV1 = z.infer<typeof DataMigrationManifestV1Schema>

export const DataMigrationEstimateSchema = z.object({
  workspaces: z.array(DataMigrationWorkspaceCatalogEntrySchema),
  threadCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  artifactCount: z.number().int().nonnegative(),
  memoryCount: z.number().int().nonnegative(),
  logicalBytes: z.number().int().nonnegative(),
  estimatedPackageBytes: z.number().int().nonnegative(),
  sensitiveFindings: z.array(z.object({
    workspaceId: DataMigrationIdSchema,
    path: PackageRelativePathSchema,
    ruleId: z.string().min(1)
  }).strict()).default([]),
  exclusions: z.array(z.object({
    scope: z.enum(['workspace', 'runtime', 'profile']),
    path: z.string().min(1),
    ruleId: z.string().min(1),
    logicalBytes: z.number().int().nonnegative().default(0)
  }).strict()).default([])
}).strict()
export type DataMigrationEstimate = z.infer<typeof DataMigrationEstimateSchema>

export const DataMigrationReferenceKindSchema = z.enum([
  'workspace-root',
  'workspace-file',
  'thread-id',
  'parent-thread-id',
  'attachment-id',
  'artifact-id',
  'provider-id'
])
export type DataMigrationReferenceKind = z.infer<typeof DataMigrationReferenceKindSchema>

export const DataMigrationReferenceDescriptorSchema = z.object({
  component: DataMigrationComponentNameSchema,
  schemaVersion: z.number().int().positive(),
  kind: DataMigrationReferenceKindSchema,
  jsonPointerPatterns: z.array(z.string().startsWith('/')).min(1),
  required: z.boolean().default(false)
}).strict()
export type DataMigrationReferenceDescriptor = z.infer<typeof DataMigrationReferenceDescriptorSchema>

export const DATA_MIGRATION_REFERENCE_DESCRIPTORS_V1 = Object.freeze([
  { component: 'thread', schemaVersion: 1, kind: 'workspace-root', jsonPointerPatterns: ['/workspace'], required: true },
  { component: 'thread', schemaVersion: 1, kind: 'thread-id', jsonPointerPatterns: ['/id'], required: true },
  { component: 'thread', schemaVersion: 1, kind: 'parent-thread-id', jsonPointerPatterns: ['/parentThreadId', '/forkedFromThreadId'], required: false },
  { component: 'thread', schemaVersion: 1, kind: 'provider-id', jsonPointerPatterns: ['/providerId'], required: false },
  { component: 'session', schemaVersion: 1, kind: 'workspace-root', jsonPointerPatterns: ['/workspace', '/context/workspace'], required: false },
  { component: 'session', schemaVersion: 1, kind: 'thread-id', jsonPointerPatterns: ['/threadId'], required: true },
  { component: 'event', schemaVersion: 1, kind: 'thread-id', jsonPointerPatterns: ['/threadId', '/payload/threadId'], required: false },
  { component: 'event', schemaVersion: 1, kind: 'workspace-file', jsonPointerPatterns: ['/payload/path', '/payload/workspaceRoot', '/payload/localFilePath'], required: false },
  { component: 'attachment', schemaVersion: 1, kind: 'workspace-file', jsonPointerPatterns: ['/localFilePath', '/workspaces/*'], required: false },
  { component: 'attachment', schemaVersion: 1, kind: 'thread-id', jsonPointerPatterns: ['/threadIds/*'], required: false },
  { component: 'memory', schemaVersion: 1, kind: 'workspace-root', jsonPointerPatterns: ['/workspace'], required: false },
  { component: 'renderer-state', schemaVersion: 1, kind: 'workspace-root', jsonPointerPatterns: ['/design/*/workspaceRoot', '/write/*/workspaceRoot', '/plans/*/workspaceRoot', '/sdd/*/workspaceRoot', '/workspaces/*/workspaceRoot'], required: false },
  { component: 'renderer-state', schemaVersion: 1, kind: 'thread-id', jsonPointerPatterns: ['/design/*/threadId', '/write/*/threadId', '/plans/*/threadId', '/sdd/*/threadId', '/sdd/*/threadIds/*', '/sdd/*/publicThreadIds/*', '/forks/*/threadId', '/forks/*/parentThreadId', '/composer/modes/*/threadId'], required: false },
  { component: 'portable-settings', schemaVersion: 1, kind: 'workspace-root', jsonPointerPatterns: ['/workspaceRoot', '/conversationWorkspaceRoot', '/write/workspaceRoot', '/design/workspaceRoot'], required: false },
  { component: 'workflow', schemaVersion: 1, kind: 'workspace-root', jsonPointerPatterns: ['/defaultWorkspaceRoot', '/workflows/*/triggers/*/config/workspaceRoot', '/workflows/*/nodes/*/config/workspaceRoot'], required: false },
  { component: 'schedule', schemaVersion: 1, kind: 'workspace-root', jsonPointerPatterns: ['/tasks/*/workspaceRoot'], required: false },
  { component: 'artifact', schemaVersion: 1, kind: 'artifact-id', jsonPointerPatterns: ['/id'], required: true }
] satisfies readonly DataMigrationReferenceDescriptor[])

export const DataMigrationWorkspaceConflictStrategySchema = z.enum([
  'keep-both',
  'merge',
  'replace',
  'skip'
])
export type DataMigrationWorkspaceConflictStrategy = z.infer<typeof DataMigrationWorkspaceConflictStrategySchema>

export const DataMigrationFileConflictResolutionSchema = z.enum([
  'keep-target',
  'import-sibling',
  'replace-with-backup',
  'skip',
  'rename-source'
])
export type DataMigrationFileConflictResolution = z.infer<typeof DataMigrationFileConflictResolutionSchema>

export const DataMigrationConflictSchema = z.object({
  conflictId: DataMigrationIdSchema,
  workspaceId: DataMigrationIdSchema,
  path: PackageRelativePathSchema,
  kind: z.enum(['different-content', 'file-directory', 'case-collision', 'unicode-collision', 'invalid-name', 'path-too-long', 'unsafe-link']),
  fatal: z.boolean(),
  sourceSha256: DataMigrationSha256Schema.optional(),
  targetSha256: DataMigrationSha256Schema.optional(),
  sourceBytes: z.number().int().nonnegative().optional(),
  targetBytes: z.number().int().nonnegative().optional(),
  resolution: DataMigrationFileConflictResolutionSchema.optional(),
  renamedPath: PackageRelativePathSchema.optional()
}).strict()
export type DataMigrationConflict = z.infer<typeof DataMigrationConflictSchema>

export const DataMigrationWorkspaceMappingSchema = z.object({
  workspaceId: DataMigrationIdSchema,
  sourcePathDisplay: z.string().min(1),
  destinationRoot: z.string().min(1).optional(),
  strategy: DataMigrationWorkspaceConflictStrategySchema,
  compatible: z.boolean(),
  freeBytes: z.number().int().nonnegative().optional(),
  requiredBytes: z.number().int().nonnegative(),
  unresolvedIssueCount: z.number().int().nonnegative()
}).strict()
export type DataMigrationWorkspaceMapping = z.infer<typeof DataMigrationWorkspaceMappingSchema>

export const DataMigrationImportPlanSchema = z.object({
  operationId: DataMigrationIdSchema,
  packageId: DataMigrationIdSchema,
  inspectedAt: z.string().min(1),
  sourcePlatform: DataMigrationSourcePlatformSchema,
  encrypted: z.boolean(),
  mappings: z.array(DataMigrationWorkspaceMappingSchema),
  conflicts: z.array(DataMigrationConflictSchema),
  threadIdMap: z.record(DataMigrationIdSchema, DataMigrationIdSchema).default({}),
  unresolvedReferences: z.array(z.object({
    component: DataMigrationComponentNameSchema,
    ownerId: DataMigrationIdSchema.optional(),
    pointer: z.string().startsWith('/'),
    originalValue: z.string()
  }).strict()).default([]),
  disabledItems: z.array(z.object({
    component: z.enum(['workflow', 'schedule', 'integration', 'provider']),
    id: z.string().min(1),
    reason: z.string().min(1)
  }).strict()).default([]),
  estimatedPeakBytes: z.number().int().nonnegative(),
  fatalIssueCount: z.number().int().nonnegative()
}).strict()
export type DataMigrationImportPlan = z.infer<typeof DataMigrationImportPlanSchema>

export const DataMigrationOperationKindSchema = z.enum(['export', 'import'])
export type DataMigrationOperationKind = z.infer<typeof DataMigrationOperationKindSchema>

export const DataMigrationOperationPhaseSchema = z.enum([
  'inspecting',
  'inspected',
  'snapshotting',
  'scanning',
  'packaging',
  'staging',
  'staged',
  'committing',
  'verifying',
  'rolling-back',
  'completed',
  'failed',
  'cancelled'
])
export type DataMigrationOperationPhase = z.infer<typeof DataMigrationOperationPhaseSchema>

export const DataMigrationProgressSchema = z.object({
  operationId: DataMigrationIdSchema,
  kind: DataMigrationOperationKindSchema,
  phase: DataMigrationOperationPhaseSchema,
  completedItems: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative().optional(),
  completedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().optional(),
  currentWorkspaceId: DataMigrationIdSchema.optional(),
  currentPath: PackageRelativePathSchema.optional(),
  cancellable: z.boolean(),
  cancellationEffect: z.enum(['stop', 'cleanup', 'rollback']).optional(),
  updatedAt: z.string().min(1)
}).strict()
export type DataMigrationProgress = z.infer<typeof DataMigrationProgressSchema>

export const DATA_MIGRATION_ERROR_CODES = [
  'PACKAGE_NOT_KUNPACK',
  'PACKAGE_PASSWORD_REQUIRED',
  'PACKAGE_PASSWORD_INVALID',
  'PACKAGE_INTEGRITY_FAILED',
  'PACKAGE_UNSAFE_ENTRY',
  'PACKAGE_BUDGET_EXCEEDED',
  'VERSION_UNSUPPORTED',
  'PATH_INVALID',
  'PATH_COLLISION',
  'PATH_UNSAFE_LINK',
  'SPACE_INSUFFICIENT',
  'CONFLICT_UNRESOLVED',
  'RUNTIME_BUSY',
  'RUNTIME_IMPORT_FAILED',
  'IO_PERMISSION_DENIED',
  'IO_SOURCE_CHANGED',
  'RECOVERY_REQUIRED',
  'RECOVERY_MANUAL_INTERVENTION'
] as const
export const DataMigrationErrorCodeSchema = z.enum(DATA_MIGRATION_ERROR_CODES)
export type DataMigrationErrorCode = z.infer<typeof DataMigrationErrorCodeSchema>

export const DataMigrationErrorSchema = z.object({
  code: DataMigrationErrorCodeSchema,
  phase: DataMigrationOperationPhaseSchema,
  message: z.string().min(1),
  destinationEffect: z.enum(['untouched', 'staged-only', 'rolled-back', 'partially-committed', 'committed']),
  retryable: z.boolean(),
  nextActions: z.array(z.string().min(1)).min(1),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
}).strict()
export type DataMigrationError = z.infer<typeof DataMigrationErrorSchema>

export const DataMigrationReportSchema = z.object({
  operationId: DataMigrationIdSchema,
  packageId: DataMigrationIdSchema,
  kind: DataMigrationOperationKindSchema,
  outcome: z.enum(['success', 'completed-with-review', 'rolled-back', 'failed']),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  workspacePathMap: z.record(DataMigrationIdSchema, z.string()),
  threadIdMap: z.record(DataMigrationIdSchema, DataMigrationIdSchema),
  exclusions: z.array(z.object({ ruleId: z.string().min(1), count: z.number().int().nonnegative() }).strict()).default([]),
  warnings: z.array(z.string()).default([]),
  unresolvedReferences: z.number().int().nonnegative(),
  disabledItems: z.number().int().nonnegative(),
  sourcePlatform: DataMigrationSourcePlatformSchema.optional(),
  destinationPlatform: DataMigrationSourcePlatformSchema.optional(),
  conflicts: z.array(z.object({
    workspaceId: DataMigrationIdSchema,
    path: PackageRelativePathSchema,
    kind: DataMigrationConflictSchema.shape.kind,
    resolution: DataMigrationFileConflictResolutionSchema.optional()
  }).strict()).optional(),
  skippedItems: z.array(z.object({
    component: DataMigrationComponentNameSchema,
    id: z.string().min(1),
    reason: z.string().min(1)
  }).strict()).optional(),
  renamedPaths: z.record(PackageRelativePathSchema, PackageRelativePathSchema).optional(),
  disabledItemDetails: z.array(z.object({
    component: z.enum(['workflow', 'schedule', 'integration', 'provider']),
    id: z.string().min(1),
    reason: z.string().min(1)
  }).strict()).optional(),
  unresolvedReferenceDetails: z.array(z.object({
    component: DataMigrationComponentNameSchema,
    ownerId: DataMigrationIdSchema.optional(),
    pointer: z.string().startsWith('/'),
    originalValue: z.string()
  }).strict()).optional(),
  backups: z.array(z.object({
    workspaceId: DataMigrationIdSchema.optional(),
    path: z.string().min(1),
    expiresAt: z.string().min(1).optional()
  }).strict()).optional(),
  timingsMs: z.record(z.string(), z.number().int().nonnegative()).optional(),
  backupExpiresAt: z.string().min(1).optional(),
  error: DataMigrationErrorSchema.optional()
}).strict()
export type DataMigrationReport = z.infer<typeof DataMigrationReportSchema>

export const DataMigrationPolicySchema = z.object({
  exportEnabled: z.boolean().default(true),
  importEnabled: z.boolean().default(true),
  requireEncryption: z.boolean().default(false),
  allowedExportRoots: z.array(z.string().min(1)).default([]),
  allowedImportRoots: z.array(z.string().min(1)).default([]),
  maximumExpandedBytes: z.number().int().positive().optional()
}).strict()
export type DataMigrationPolicy = z.infer<typeof DataMigrationPolicySchema>

export const DataMigrationInspectionSummarySchema = z.object({
  inspectionId: DataMigrationIdSchema,
  packagePath: z.string().min(1),
  packageId: DataMigrationIdSchema,
  sourcePlatform: DataMigrationSourcePlatformSchema,
  sourceArch: z.string().min(1),
  sourceAppVersion: z.string().min(1),
  createdAt: z.string().min(1),
  encrypted: z.boolean(),
  expandedBytes: z.number().int().nonnegative(),
  compressedBytes: z.number().int().nonnegative(),
  categories: z.array(DataMigrationCategorySchema),
  workspaces: z.array(DataMigrationWorkspaceCatalogEntrySchema),
  threads: z.array(DataMigrationThreadCatalogEntrySchema),
  counts: DataMigrationManifestV1Schema.shape.counts,
  warnings: z.array(z.string())
}).strict()
export type DataMigrationInspectionSummary = z.infer<typeof DataMigrationInspectionSummarySchema>

export const DataMigrationOperationStatusSchema = z.object({
  featureEnabled: z.boolean(),
  activeOperationId: DataMigrationIdSchema.optional(),
  activeKind: DataMigrationOperationKindSchema.optional(),
  progress: DataMigrationProgressSchema.optional(),
  recoverable: z.array(z.object({
    operationId: DataMigrationIdSchema,
    packageId: DataMigrationIdSchema,
    phase: DataMigrationOperationPhaseSchema,
    updatedAt: z.string().min(1),
    destinationEffect: z.enum(['untouched', 'staged-only', 'partially-committed']),
    error: DataMigrationErrorSchema.optional(),
    warnings: z.array(z.string()).default([]),
    manualRecoverySteps: z.array(z.string()).default([]),
    reportPath: z.string().min(1).optional()
  }).strict()),
  recentReports: z.array(DataMigrationReportSchema)
}).strict()
export type DataMigrationOperationStatus = z.infer<typeof DataMigrationOperationStatusSchema>

export type DataMigrationPathPickResult = { canceled: boolean; path: string | null }

export type DataMigrationExportOptions = {
  operationId: string
  outputPath: string
  selectedWorkspaceIds: string[]
  selectedThreadIds: string[]
  categories: DataMigrationCategory[]
  preset: DataMigrationPreset
  sensitiveContentAcknowledged: boolean
  unencryptedPackageAcknowledged: boolean
  passphrase?: string
  runningThreadPolicy: 'wait' | 'interrupt' | 'omit'
}

export type DataMigrationImportOptions = {
  operationId: string
  inspectionId: string
  packagePath: string
  passphrase?: string
  plan: DataMigrationImportPlan
}

export type DataMigrationRendererRequest = {
  requestId: string
  action: 'capture-state' | 'replace-state' | 'capture-trust' | 'apply-trust' | 'refresh'
  payload?: unknown
}

export type DataMigrationRendererResponse = {
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
}

export type ImportedWorkspaceTrustReset = {
  workspaceRoot: string
  trusted: false
  disabledCapabilities: Array<
    'hooks' | 'commands' | 'extensions' | 'schedules' | 'workflows' | 'connect-channels' | 'external-actions'
  >
}

export type RestoredRendererState = {
  schemaVersion: 1
  design: unknown[]
  write: unknown[]
  plans: unknown[]
  sdd: unknown[]
  forks: unknown[]
  threads: unknown[]
  composer: Record<string, unknown>
  workspaces: unknown[]
  unresolvedReferences: Array<{ pointer: string; originalValue: string }>
}

export const DEFAULT_DATA_MIGRATION_POLICY: DataMigrationPolicy = Object.freeze(
  DataMigrationPolicySchema.parse({})
)

export type DataMigrationPathScope = 'workspace' | 'runtime' | 'profile'
export type DataMigrationPathPolicyDecision =
  | { action: 'include'; ruleId: 'include' | 'portable-artifact' }
  | { action: 'hard-exclude'; ruleId: string }
  | { action: 'preset-exclude'; ruleId: string }
  | { action: 'require-sensitive-acknowledgement'; ruleId: string }

type MigrationPathRule = Readonly<{
  id: string
  scopes: readonly DataMigrationPathScope[]
  kind: 'segment' | 'basename' | 'prefix' | 'suffix'
  value: string
}>

export const DATA_MIGRATION_HARD_EXCLUSION_RULES: readonly MigrationPathRule[] = Object.freeze([
  { id: 'runtime-secret-key', scopes: ['runtime', 'profile'], kind: 'basename', value: 'secret.key' },
  { id: 'runtime-credentials', scopes: ['runtime', 'profile'], kind: 'segment', value: 'credentials' },
  { id: 'runtime-oauth', scopes: ['runtime', 'profile'], kind: 'segment', value: 'mcp-oauth' },
  { id: 'application-logs', scopes: ['runtime', 'profile'], kind: 'segment', value: 'logs' },
  { id: 'observability', scopes: ['runtime', 'profile'], kind: 'segment', value: 'observability' },
  { id: 'local-models', scopes: ['runtime', 'profile'], kind: 'segment', value: 'models' },
  { id: 'downloaded-binaries', scopes: ['runtime', 'profile'], kind: 'segment', value: 'agent-sdk' },
  { id: 'opaque-extension-data', scopes: ['runtime', 'profile'], kind: 'segment', value: 'extension-data' },
  { id: 'migration-staging', scopes: ['workspace', 'runtime', 'profile'], kind: 'segment', value: '.kun-migration-staging' },
  { id: 'migration-backup', scopes: ['workspace', 'runtime', 'profile'], kind: 'segment', value: '.kun-migration-backup' },
  { id: 'migration-temporary', scopes: ['workspace', 'runtime', 'profile'], kind: 'suffix', value: '.kunpack.tmp' }
])

export const DATA_MIGRATION_SMALLER_PRESET_RULES: readonly MigrationPathRule[] = Object.freeze([
  { id: 'git-metadata', scopes: ['workspace'], kind: 'segment', value: '.git' },
  { id: 'node-dependencies', scopes: ['workspace'], kind: 'segment', value: 'node_modules' },
  { id: 'python-venv', scopes: ['workspace'], kind: 'segment', value: '.venv' },
  { id: 'python-venv-plain', scopes: ['workspace'], kind: 'segment', value: 'venv' },
  { id: 'build-dist', scopes: ['workspace'], kind: 'segment', value: 'dist' },
  { id: 'build-output', scopes: ['workspace'], kind: 'segment', value: 'build' },
  { id: 'build-out', scopes: ['workspace'], kind: 'segment', value: 'out' },
  { id: 'next-cache', scopes: ['workspace'], kind: 'segment', value: '.next' },
  { id: 'coverage-output', scopes: ['workspace'], kind: 'segment', value: 'coverage' },
  { id: 'generic-cache', scopes: ['workspace'], kind: 'segment', value: '.cache' },
  { id: 'python-cache', scopes: ['workspace'], kind: 'segment', value: '__pycache__' },
  { id: 'rust-target', scopes: ['workspace'], kind: 'segment', value: 'target' }
])

const SENSITIVE_BASENAME_RULES: readonly { id: string; pattern: RegExp }[] = Object.freeze([
  { id: 'environment-file', pattern: /^\.env(?:\..+)?$/i },
  { id: 'private-key-file', pattern: /\.(?:pem|key|p12|pfx)$/i },
  { id: 'ssh-private-key', pattern: /^id_(?:rsa|dsa|ecdsa|ed25519)$/i },
  { id: 'package-registry-auth', pattern: /^(?:\.npmrc|\.pypirc|\.netrc)$/i },
  { id: 'git-credentials', pattern: /^\.git-credentials$/i },
  { id: 'credential-json', pattern: /^(?:credentials?|service-account).+\.json$/i }
])

const PORTABLE_ARTIFACT_SEGMENTS = new Set(['.kun-design', '.kunsdd'])

export function classifyDataMigrationPath(input: {
  path: string
  scope: DataMigrationPathScope
  preset: DataMigrationPreset
}): DataMigrationPathPolicyDecision {
  const normalized = normalizePolicyPath(input.path)
  const basename = normalized.split('/').at(-1) ?? ''
  const segments = normalized.split('/').filter(Boolean)

  const hardRule = DATA_MIGRATION_HARD_EXCLUSION_RULES.find((rule) =>
    rule.scopes.includes(input.scope) && migrationPathRuleMatches(rule, normalized, basename, segments)
  )
  if (hardRule) return { action: 'hard-exclude', ruleId: hardRule.id }

  if (input.scope === 'workspace') {
    const sensitiveRule = SENSITIVE_BASENAME_RULES.find((rule) => rule.pattern.test(basename))
    if (sensitiveRule) {
      return { action: 'require-sensitive-acknowledgement', ruleId: sensitiveRule.id }
    }
    if (segments.some((segment) => PORTABLE_ARTIFACT_SEGMENTS.has(segment))) {
      return { action: 'include', ruleId: 'portable-artifact' }
    }
  }

  if (input.preset === 'smaller') {
    const presetRule = DATA_MIGRATION_SMALLER_PRESET_RULES.find((rule) =>
      rule.scopes.includes(input.scope) && migrationPathRuleMatches(rule, normalized, basename, segments)
    )
    if (presetRule) return { action: 'preset-exclude', ruleId: presetRule.id }
  }

  return { action: 'include', ruleId: 'include' }
}

function normalizePolicyPath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/')
}

function migrationPathRuleMatches(
  rule: MigrationPathRule,
  normalized: string,
  basename: string,
  segments: readonly string[]
): boolean {
  const value = rule.value.toLowerCase()
  switch (rule.kind) {
    case 'segment':
      return segments.some((segment) => segment.toLowerCase() === value)
    case 'basename':
      return basename.toLowerCase() === value
    case 'prefix':
      return normalized.toLowerCase().startsWith(value)
    case 'suffix':
      return normalized.toLowerCase().endsWith(value)
  }
}

export type ParsedMigrationSourcePath = {
  platform: DataMigrationSourcePlatform
  kind: 'drive' | 'unc' | 'absolute' | 'home' | 'relative'
  root: string
  segments: string[]
}

export function parseMigrationSourcePath(
  value: string,
  platform: DataMigrationSourcePlatform
): ParsedMigrationSourcePath {
  const trimmed = value.trim()
  if (!trimmed) return { platform, kind: 'relative', root: '', segments: [] }

  if (platform === 'windows') {
    const normalized = trimmed.replaceAll('/', '\\')
    if (normalized.startsWith('\\\\')) {
      const parts = normalized.slice(2).split(/\\+/).filter(Boolean)
      if (parts.length < 2) return { platform, kind: 'relative', root: '', segments: parts }
      return {
        platform,
        kind: 'unc',
        root: `\\\\${parts[0]}\\${parts[1]}`,
        segments: parts.slice(2)
      }
    }
    const drive = /^([A-Za-z]:)\\(.*)$/.exec(normalized)
    if (drive) {
      return {
        platform,
        kind: 'drive',
        root: drive[1].toUpperCase(),
        segments: splitMigrationSegments(drive[2], /\\+/)
      }
    }
    if (/^~(?:\\|$)/.test(normalized)) {
      return {
        platform,
        kind: 'home',
        root: '~',
        segments: splitMigrationSegments(normalized.slice(1), /\\+/)
      }
    }
    return { platform, kind: 'relative', root: '', segments: splitMigrationSegments(normalized, /\\+/) }
  }

  const normalized = trimmed.replaceAll('\\', '/')
  if (normalized === '~' || normalized.startsWith('~/')) {
    return {
      platform,
      kind: 'home',
      root: '~',
      segments: splitMigrationSegments(normalized.slice(1), /\/+/)
    }
  }
  if (normalized.startsWith('/')) {
    return {
      platform,
      kind: 'absolute',
      root: '/',
      segments: splitMigrationSegments(normalized, /\/+/)
    }
  }
  return { platform, kind: 'relative', root: '', segments: splitMigrationSegments(normalized, /\/+/) }
}

function splitMigrationSegments(value: string, separator: RegExp): string[] {
  return value.split(separator).filter((segment) => segment && segment !== '.')
}

export function migrationPathRelativeToWorkspace(input: {
  path: string
  workspaceRoot: string
  sourcePlatform: DataMigrationSourcePlatform
}): PackageRelativePath | null {
  const path = parseMigrationSourcePath(input.path, input.sourcePlatform)
  const workspace = parseMigrationSourcePath(input.workspaceRoot, input.sourcePlatform)
  if (path.kind !== workspace.kind || migrationComparable(path.root, input.sourcePlatform) !== migrationComparable(workspace.root, input.sourcePlatform)) {
    return null
  }
  if (path.segments.length <= workspace.segments.length) return null
  for (let index = 0; index < workspace.segments.length; index += 1) {
    if (migrationComparable(path.segments[index] ?? '', input.sourcePlatform) !== migrationComparable(workspace.segments[index] ?? '', input.sourcePlatform)) {
      return null
    }
  }
  return parsePackageRelativePath(path.segments.slice(workspace.segments.length).join('/'))
}

function migrationComparable(value: string, platform: DataMigrationSourcePlatform): string {
  return platform === 'windows' ? value.toLocaleLowerCase('en-US') : value
}

export function buildMigrationDestinationPath(input: {
  destinationRoot: string
  relativePath: PackageRelativePath
  destinationPlatform: DataMigrationSourcePlatform
}): string {
  const separator = input.destinationPlatform === 'windows' ? '\\' : '/'
  const trimmedRoot = input.destinationRoot.trim().replace(/[\\/]+$/, '')
  if (!trimmedRoot) throw new Error('destination root is required')
  return `${trimmedRoot}${separator}${input.relativePath.split('/').join(separator)}`
}

export type DataMigrationComponentEnvelope = {
  component: DataMigrationComponentName
  schemaVersion: number
  data: unknown
}

export type DataMigrationComponentMigrator = Readonly<{
  component: DataMigrationComponentName
  fromVersion: number
  toVersion: number
  migrate: (data: unknown) => unknown
}>

export const DATA_MIGRATION_V1_FIXTURE_CONVENTION = Object.freeze({
  directory: 'src/shared/__fixtures__/data-migration/v1',
  immutable: true,
  manifestFile: 'manifest.json',
  expectedReportFile: 'expected-report.json'
})

export function migrateDataMigrationComponent(
  envelope: DataMigrationComponentEnvelope,
  targetVersion: number,
  migrators: readonly DataMigrationComponentMigrator[]
): DataMigrationComponentEnvelope {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) throw new Error('target version must be a positive integer')
  if (envelope.schemaVersion > targetVersion) throw new Error('component downgrade is not supported')
  let current = { ...envelope }
  const seen = new Set<number>()
  while (current.schemaVersion < targetVersion) {
    if (seen.has(current.schemaVersion)) throw new Error('component migrator cycle detected')
    seen.add(current.schemaVersion)
    const matches = migrators.filter((candidate) =>
      candidate.component === current.component && candidate.fromVersion === current.schemaVersion
    )
    if (matches.length !== 1) {
      throw new Error(matches.length === 0 ? 'missing component migrator' : 'ambiguous component migrator')
    }
    const migrator = matches[0]!
    if (migrator.toVersion <= migrator.fromVersion || migrator.toVersion > targetVersion) {
      throw new Error('invalid component migrator version range')
    }
    current = {
      component: current.component,
      schemaVersion: migrator.toVersion,
      data: migrator.migrate(current.data)
    }
  }
  return current
}
