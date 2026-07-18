import { z } from 'zod'
import { ExtensionIdSchema, JsonObjectSchema, SemverSchema } from './common.js'

const OpaqueReferenceSchema = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/, 'Expected an opaque reference')

const OpaqueInvocationReferenceSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9._~-]+$/, 'Expected an opaque invocation reference')

export const GeneratedArtifactIdSchema = OpaqueReferenceSchema
export type GeneratedArtifactId = z.infer<typeof GeneratedArtifactIdSchema>

/**
 * A user-initiated desktop action for a durable generated artifact. The View
 * supplies only the opaque artifact identity; the Host re-derives ownership,
 * extension version, and workspace scope from the authenticated View Session.
 */
export const ArtifactHostActionSchema = z.enum(['open', 'reveal'])
export type ArtifactHostAction = z.infer<typeof ArtifactHostActionSchema>

export const ArtifactHostActionRequestSchema = z.strictObject({
  artifactId: GeneratedArtifactIdSchema,
  action: ArtifactHostActionSchema
})
export type ArtifactHostActionRequest = z.infer<typeof ArtifactHostActionRequestSchema>

export const ArtifactHostActionResultSchema = z.strictObject({
  performed: z.literal(true)
})
export type ArtifactHostActionResult = z.infer<typeof ArtifactHostActionResultSchema>

export const ArtifactMediaHandleIdSchema = OpaqueReferenceSchema
export type ArtifactMediaHandleId = z.infer<typeof ArtifactMediaHandleIdSchema>

export const GeneratedArtifactMediaKindSchema = z.enum([
  'video',
  'audio',
  'image',
  'subtitle',
  'document',
  'data',
  'other'
])
export type GeneratedArtifactMediaKind = z.infer<typeof GeneratedArtifactMediaKindSchema>

export const GeneratedArtifactAvailabilitySchema = z.enum(['available', 'unavailable'])
export type GeneratedArtifactAvailability = z.infer<typeof GeneratedArtifactAvailabilitySchema>

export const GeneratedArtifactProvenanceSchema = z
  .strictObject({
    jobId: OpaqueInvocationReferenceSchema.optional(),
    invocationId: z.string().min(1).max(256).optional(),
    operation: z.string().min(1).max(128),
    metadata: JsonObjectSchema.optional()
  })
  .refine((value) => value.jobId !== undefined || value.invocationId !== undefined, {
    message: 'Artifact provenance requires a jobId or invocationId'
  })
export type GeneratedArtifactProvenance = z.infer<typeof GeneratedArtifactProvenanceSchema>

/**
 * Durable generated-output identity. It deliberately contains neither a local
 * path nor a short-lived View resource URL.
 */
export const GeneratedArtifactSchema = z.strictObject({
  schemaVersion: z.literal(1),
  artifactId: GeneratedArtifactIdSchema,
  ownerExtensionId: ExtensionIdSchema,
  ownerExtensionVersion: SemverSchema,
  workspaceId: z.string().min(1).max(256),
  mediaHandleId: ArtifactMediaHandleIdSchema,
  displayName: z.string().min(1).max(256),
  mediaKind: GeneratedArtifactMediaKindSchema,
  mimeType: z
    .string()
    .min(3)
    .max(128)
    .regex(new RegExp('^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$')),
  byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completionIdentity: z.string().min(1).max(512),
  availability: GeneratedArtifactAvailabilitySchema.default('available'),
  width: z.number().int().positive().max(1_000_000).optional(),
  height: z.number().int().positive().max(1_000_000).optional(),
  durationMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  provenance: GeneratedArtifactProvenanceSchema
})
export type GeneratedArtifact = z.infer<typeof GeneratedArtifactSchema>
export type GeneratedArtifactInput = z.input<typeof GeneratedArtifactSchema>

export const GeneratedArtifactsSchema = z.array(GeneratedArtifactSchema).max(64)
export type GeneratedArtifacts = z.infer<typeof GeneratedArtifactsSchema>
