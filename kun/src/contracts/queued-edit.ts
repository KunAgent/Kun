import { AttachmentAliasesSchema } from './attachment-aliases.js'
import { z } from 'zod'
/** A staged canonical user-item edit must finish before this queued turn can execute. */
export const QueuedEditSchema = z.object({
  revision: z.number().int().nonnegative(),
  lastOperationId: z.string().optional(),
  lastFingerprint: z.string().optional(),
  pending: z.object({ operationId: z.string().min(1).max(128), fingerprint: z.string(),
    text: z.string().min(1).max(64000), attachmentAliases: AttachmentAliasesSchema.optional(), attachmentIds: z.array(z.string()).max(8) }).strict().optional()
}).strict()
