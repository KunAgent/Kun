import {
  GeneratedArtifactIdSchema,
  MediaHandleIdSchema,
  MediaLeaseIdSchema,
  MediaMetadataSchema,
  MediaPickFilesRequestSchema,
  MediaPickFilesResultSchema,
  MediaPickSaveTargetRequestSchema,
  MediaPickSaveTargetResultSchema,
  MediaResourceLeaseSchema
} from '@kun/extension-api'
import { z } from 'zod'

const extensionIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/)
const extensionVersionSchema = z.string().trim().min(1).max(128)
const extensionSessionIdSchema = z.string().trim().min(16).max(256)
const extensionSessionNonceSchema = z.string().min(32).max(256)
const qualifiedContributionIdSchema = z
  .string()
  .trim()
  .regex(/^extension:[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/)
const absolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(16_384)
  .refine(isAbsolutePath, { message: 'Expected an absolute Host path.' })
const safeMimeTypeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/)
const opaqueOperationTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)

/** Sender identity copied from the authenticated Main-owned View Session. */
export const ExtensionMediaViewBindingSchema = z.strictObject({
  sessionId: extensionSessionIdSchema,
  runtimeSessionId: extensionSessionIdSchema,
  sessionNonce: extensionSessionNonceSchema,
  extensionId: extensionIdSchema,
  extensionVersion: extensionVersionSchema,
  contributionId: qualifiedContributionIdSchema,
  workspaceRoot: absolutePathSchema.optional(),
  senderWebContentsId: z.number().int().positive(),
  senderMainFrameProcessId: z.number().int().nonnegative(),
  senderMainFrameRoutingId: z.number().int()
})
export type ExtensionMediaViewBinding = z.infer<typeof ExtensionMediaViewBindingSchema>

/** View -> Main request. It deliberately contains no path or protected token. */
export const ExtensionMediaPickFilesIpcRequestSchema = z.strictObject({
  sessionId: extensionSessionIdSchema,
  sessionNonce: extensionSessionNonceSchema,
  request: MediaPickFilesRequestSchema
})
export type ExtensionMediaPickFilesIpcRequest = z.input<
  typeof ExtensionMediaPickFilesIpcRequestSchema
>

/** View -> Main request. It deliberately contains no destination path. */
export const ExtensionMediaPickSaveTargetIpcRequestSchema = z.strictObject({
  sessionId: extensionSessionIdSchema,
  sessionNonce: extensionSessionNonceSchema,
  request: MediaPickSaveTargetRequestSchema
})
export type ExtensionMediaPickSaveTargetIpcRequest = z.input<
  typeof ExtensionMediaPickSaveTargetIpcRequestSchema
>

export const ExtensionMediaPickFilesIpcResultSchema = MediaPickFilesResultSchema
export const ExtensionMediaPickSaveTargetIpcResultSchema = MediaPickSaveTargetResultSchema

/**
 * Main -> Kun only. Raw paths and the protected operation token MUST NOT be
 * returned to the workbench renderer or Extension View.
 */
export const ExtensionMediaSelectionRegistrationRequestSchema = z.strictObject({
  operationToken: opaqueOperationTokenSchema,
  binding: ExtensionMediaViewBindingSchema,
  mode: z.enum(['read', 'export']),
  selections: z
    .array(
      z.strictObject({
        absolutePath: absolutePathSchema,
        displayName: z.string().trim().min(1).max(256),
        mimeType: safeMimeTypeSchema.optional()
      })
    )
    .min(1)
    .max(128)
})
export type ExtensionMediaSelectionRegistrationRequest = z.infer<
  typeof ExtensionMediaSelectionRegistrationRequestSchema
>

export const ExtensionMediaSelectionRegistrationResultSchema = z.strictObject({
  selections: z.array(MediaMetadataSchema).min(1).max(128)
})
export type ExtensionMediaSelectionRegistrationResult = z.infer<
  typeof ExtensionMediaSelectionRegistrationResultSchema
>

export const ExtensionMediaFileIdentitySchema = z.strictObject({
  byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  modifiedAtMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  device: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  inode: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
})
export type ExtensionMediaFileIdentity = z.infer<typeof ExtensionMediaFileIdentitySchema>

/** Main -> Kun request to resolve a handle for one authenticated View. */
export const ExtensionMediaLeaseCreationRequestSchema = z.strictObject({
  binding: ExtensionMediaViewBindingSchema,
  handleId: MediaHandleIdSchema,
  requestedTtlMs: z.number().int().min(1_000).max(60 * 60 * 1_000).optional()
})
export type ExtensionMediaLeaseCreationRequest = z.infer<
  typeof ExtensionMediaLeaseCreationRequestSchema
>

/**
 * Kun -> Main only. `absolutePath` is consumed by the Main lease resolver and
 * never appears in ExtensionMediaLeaseCreationResultSchema.
 */
export const ExtensionMediaLeaseRegistrationSchema = z.strictObject({
  binding: ExtensionMediaViewBindingSchema,
  handleId: MediaHandleIdSchema,
  absolutePath: absolutePathSchema,
  mimeType: safeMimeTypeSchema.optional(),
  fileIdentity: ExtensionMediaFileIdentitySchema,
  expiresAt: z.string().datetime()
})
export type ExtensionMediaLeaseRegistration = z.infer<
  typeof ExtensionMediaLeaseRegistrationSchema
>

export const ExtensionMediaLeaseCreationResultSchema = MediaResourceLeaseSchema
export type ExtensionMediaLeaseCreationResult = z.infer<
  typeof ExtensionMediaLeaseCreationResultSchema
>

/** Kun -> Main only. The absolute path is consumed by the desktop action. */
export const ExtensionArtifactResolutionSchema = z.strictObject({
  artifactId: GeneratedArtifactIdSchema,
  absolutePath: absolutePathSchema,
  displayName: z.string().trim().min(1).max(256),
  mimeType: safeMimeTypeSchema
})
export type ExtensionArtifactResolution = z.infer<
  typeof ExtensionArtifactResolutionSchema
>

export const ExtensionMediaLeaseRevocationReasonSchema = z.enum([
  'released',
  'expired',
  'view-closed',
  'view-crashed',
  'view-navigated',
  'workspace-changed',
  'permission-changed',
  'extension-disabled',
  'extension-updated',
  'extension-rolled-back',
  'extension-uninstalled',
  'file-replaced',
  'runtime-shutdown'
])
export type ExtensionMediaLeaseRevocationReason = z.infer<
  typeof ExtensionMediaLeaseRevocationReasonSchema
>

export const ExtensionMediaLeaseRevocationRequestSchema = z.strictObject({
  leaseId: MediaLeaseIdSchema,
  binding: ExtensionMediaViewBindingSchema.optional(),
  reason: ExtensionMediaLeaseRevocationReasonSchema
})
export type ExtensionMediaLeaseRevocationRequest = z.infer<
  typeof ExtensionMediaLeaseRevocationRequestSchema
>

export const ExtensionMediaLeaseRevocationResultSchema = z.strictObject({
  released: z.boolean()
})

export const ExtensionMediaDiagnosticsSchema = z.strictObject({
  scheme: z.literal('kun-media'),
  preparedViewCount: z.number().int().nonnegative(),
  activeLeaseCount: z.number().int().nonnegative(),
  activeStreamCount: z.number().int().nonnegative(),
  limits: z.strictObject({
    leaseTtlMs: z.number().int().positive(),
    leasesPerView: z.number().int().positive(),
    concurrentStreamsPerLease: z.number().int().positive(),
    concurrentStreamsTotal: z.number().int().positive(),
    rangeBytes: z.number().int().positive()
  }),
  deniedByCode: z.record(z.string().min(1).max(128), z.number().int().nonnegative())
})
export type ExtensionMediaDiagnostics = z.infer<typeof ExtensionMediaDiagnosticsSchema>

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
}
