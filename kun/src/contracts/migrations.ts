import { z } from 'zod'

export const RuntimeMigrationRunningThreadPolicy = z.enum(['wait', 'interrupt', 'omit'])
export type RuntimeMigrationRunningThreadPolicy = z.infer<typeof RuntimeMigrationRunningThreadPolicy>

export const RuntimeMigrationExportCreateRequest = z.object({
  threadIds: z.array(z.string().min(1).max(128)).min(1).max(10_000).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: 'threadIds must not contain duplicates' }
  ),
  includeAttachments: z.boolean().default(true),
  includeArtifacts: z.boolean().default(true),
  includeMemory: z.boolean().default(true),
  runningThreadPolicy: RuntimeMigrationRunningThreadPolicy,
  waitTimeoutMs: z.number().int().min(0).max(120_000).default(30_000),
  snapshotTtlMs: z.number().int().min(60_000).max(24 * 60 * 60 * 1_000).default(15 * 60 * 1_000)
}).strict()
export type RuntimeMigrationExportCreateRequest = z.infer<typeof RuntimeMigrationExportCreateRequest>

export const RuntimeMigrationExportSnapshot = z.object({
  snapshotId: z.string().min(1),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  selectedThreadIds: z.array(z.string()),
  exportedThreadIds: z.array(z.string()),
  omittedThreadIds: z.array(z.string()),
  contentCounts: z.object({
    attachments: z.number().int().nonnegative(),
    artifacts: z.number().int().nonnegative(),
    memories: z.number().int().nonnegative()
  }).strict(),
  recordCount: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()
export type RuntimeMigrationExportSnapshot = z.infer<typeof RuntimeMigrationExportSnapshot>

export const RuntimeMigrationSnapshotRecord = z.object({
  schemaVersion: z.literal(1),
  type: z.enum([
    'metadata',
    'thread',
    'session',
    'item',
    'event',
    'historical-approval',
    'historical-user-input',
    'attachment',
    'artifact',
    'content-chunk',
    'memory',
    'footer'
  ]),
  ownerId: z.string().optional(),
  contentId: z.string().optional(),
  value: z.unknown()
}).strict()
export type RuntimeMigrationSnapshotRecord = z.infer<typeof RuntimeMigrationSnapshotRecord>

export const RuntimeMigrationImportControl = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('import-control'),
  value: z.object({
    operationId: z.string().min(1).max(128),
    workspacePathMap: z.record(z.string(), z.string().min(1)),
    configuredProviderIds: z.array(z.string().min(1)).default([])
  }).strict()
}).strict()
export type RuntimeMigrationImportControl = z.infer<typeof RuntimeMigrationImportControl>

export const RuntimeMigrationImportPreflight = z.object({
  importId: z.string().min(1),
  operationId: z.string().min(1),
  threadIdMap: z.record(z.string(), z.string()),
  introducedThreadIds: z.array(z.string()),
  deduplicatedThreadIds: z.array(z.string()),
  recordCount: z.number().int().nonnegative(),
  warnings: z.array(z.string())
}).strict()
export type RuntimeMigrationImportPreflight = z.infer<typeof RuntimeMigrationImportPreflight>

export const RuntimeMigrationImportResult = z.object({
  importId: z.string().min(1),
  status: z.enum(['preflighted', 'committed', 'verified', 'rolled-back']),
  introducedThreadIds: z.array(z.string()),
  deduplicatedThreadIds: z.array(z.string()),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  warnings: z.array(z.string())
}).strict()
export type RuntimeMigrationImportResult = z.infer<typeof RuntimeMigrationImportResult>
