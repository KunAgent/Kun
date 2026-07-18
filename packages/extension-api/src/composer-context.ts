import { z } from 'zod'
import {
  ContributionIdSchema,
  ExtensionIdSchema,
  JsonObjectSchema,
  SemverSchema,
  type JsonObject,
  type JsonValue
} from './common.js'

export const MAX_COMPOSER_CONTEXT_ATTACHMENTS = 8
export const MAX_COMPOSER_CONTEXT_REFERENCE_BYTES = 16 * 1024
const MAX_REFERENCE_DEPTH = 8
const MAX_REFERENCE_ENTRIES = 512
const MAX_REFERENCE_KEY_LENGTH = 128
const MAX_REFERENCE_STRING_LENGTH = 2_048

const FORBIDDEN_PATH_KEYS = new Set([
  'absolutepath',
  'entrypath',
  'filepath',
  'localfilepath',
  'packageroot',
  'path',
  'relativepath',
  'resourceroot',
  'workspacerelativepath',
  'workspaceroot'
])

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function looksLikeAbsoluteFilesystemPath(value: string): boolean {
  const trimmed = value.trim()
  return /^(?:file:|\/|\\\\|[A-Za-z]:[\\/])/i.test(trimmed)
}

function validateReference(
  value: JsonValue,
  context: z.RefinementCtx,
  path: PropertyKey[] = [],
  depth = 0,
  state = { entries: 0 }
): void {
  if (depth > MAX_REFERENCE_DEPTH) {
    context.addIssue({
      code: 'custom',
      message: `Composer context reference exceeds depth ${MAX_REFERENCE_DEPTH}`,
      path
    })
    return
  }
  state.entries += 1
  if (state.entries > MAX_REFERENCE_ENTRIES) {
    context.addIssue({
      code: 'custom',
      message: `Composer context reference exceeds ${MAX_REFERENCE_ENTRIES} entries`,
      path
    })
    return
  }
  if (typeof value === 'string') {
    if (value.length > MAX_REFERENCE_STRING_LENGTH) {
      context.addIssue({
        code: 'custom',
        message: `Composer context reference strings are limited to ${MAX_REFERENCE_STRING_LENGTH} characters`,
        path
      })
    }
    if (looksLikeAbsoluteFilesystemPath(value)) {
      context.addIssue({
        code: 'custom',
        message: 'Composer context references cannot contain absolute filesystem paths',
        path
      })
    }
    return
  }
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateReference(entry, context, [...path, index], depth + 1, state))
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key.length > MAX_REFERENCE_KEY_LENGTH) {
      context.addIssue({
        code: 'custom',
        message: `Composer context reference keys are limited to ${MAX_REFERENCE_KEY_LENGTH} characters`,
        path: [...path, key]
      })
    }
    if (FORBIDDEN_PATH_KEYS.has(key.replace(/[-_]/g, '').toLowerCase())) {
      context.addIssue({
        code: 'custom',
        message: 'Composer context references cannot expose filesystem path fields',
        path: [...path, key]
      })
    }
    validateReference(entry, context, [...path, key], depth + 1, state)
  }
}

export const ComposerContextReferenceSchema: z.ZodType<JsonObject> = JsonObjectSchema.superRefine(
  (reference, context) => {
    validateReference(reference, context)
    if (utf8Bytes(JSON.stringify(reference)) > MAX_COMPOSER_CONTEXT_REFERENCE_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `Composer context reference is limited to ${MAX_COMPOSER_CONTEXT_REFERENCE_BYTES} UTF-8 bytes`
      })
    }
  }
)

export const ComposerContextAttachmentRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/, 'Expected an opaque context identifier'),
  title: z.string().trim().min(1).max(128),
  summary: z.string().trim().min(1).max(1_024),
  reference: ComposerContextReferenceSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
})
export type ComposerContextAttachmentRequest = z.infer<typeof ComposerContextAttachmentRequestSchema>

export const ComposerContextProvenanceSchema = z.strictObject({
  extensionId: ExtensionIdSchema,
  extensionVersion: SemverSchema,
  viewContributionId: ContributionIdSchema,
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/)
})
export type ComposerContextProvenance = z.infer<typeof ComposerContextProvenanceSchema>

export const ComposerContextAttachmentSchema = ComposerContextAttachmentRequestSchema.extend({
  attachmentId: z.string().regex(/^extension-context:[a-f0-9]{64}$/),
  provenance: ComposerContextProvenanceSchema
})
export type ComposerContextAttachment = z.infer<typeof ComposerContextAttachmentSchema>
