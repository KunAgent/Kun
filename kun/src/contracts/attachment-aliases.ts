import { z } from 'zod'
export const AttachmentAliasSchema = z.object({ attachmentId: z.string().regex(/^att_[a-f0-9]{24}$/),
  // eslint-disable-next-line no-control-regex -- display names reject separators and ASCII controls
  displayName: z.string().min(1).max(180).refine((value) => !/[/\\\u0000-\u001f\u007f]/.test(value)),
  mimeType: z.string().min(1).max(120).optional(), byteSize: z.number().int().nonnegative().optional() }).strict()
/** Host-authored shared provenance. Undefined preserves ordinary attachment behavior; [] still restricts fallback metadata. */
export const AttachmentAliasesSchema = z.array(AttachmentAliasSchema).max(8)
export type AttachmentAlias = z.infer<typeof AttachmentAliasSchema>
export type AttachmentAliases = z.infer<typeof AttachmentAliasesSchema>
export function validateAttachmentAliases(raw: unknown, ids: readonly string[]): AttachmentAliases | undefined {
  if (raw === undefined) return undefined
  const value = AttachmentAliasesSchema.parse(raw), selected = new Set(ids)
  if (new Set(value.map((alias) => alias.attachmentId)).size !== value.length || value.some((alias) => !selected.has(alias.attachmentId)) ||
      [...selected].some((id) => !value.some((alias) => alias.attachmentId === id))) throw new Error('INVALID_ATTACHMENT_ALIASES')
  return value
}
