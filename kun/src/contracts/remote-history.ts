import { z } from 'zod'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
/** Host-only provenance; remote visibility additionally requires the matching Manager proof. */
export const RemoteForkSchema = z.object({ requestKey: Id, sourceThreadId: Id, sourceTurnId: Id,
  sourceRevision: z.number().int().nonnegative(), historyVersion: z.string().min(1).max(256), beforeTurn: z.boolean() }).strict()
export type RemoteFork = z.infer<typeof RemoteForkSchema>
export const RewindDraftSchema = z.object({ text: z.string().max(64000), attachmentIds: z.array(Id).max(8),
  complete: z.boolean(), totalChars: z.number().int().nonnegative(), totalAttachments: z.number().int().nonnegative() }).strict()
export const RemoteRewindSchema = z.object({ operationKey: Id, turnId: Id, sourceRevision: z.number().int().nonnegative(),
  historyVersion: z.string().min(1).max(256), itemRevision: z.number().int().nonnegative(),
  beforeHash: z.string().regex(/^[a-f0-9]{64}$/), afterHash: z.string().regex(/^[a-f0-9]{64}$/),
  keepTurnIds: z.array(Id), removedTurns: z.number().int().nonnegative(), remainingTurns: z.number().int().nonnegative(),
  draft: RewindDraftSchema, phase: z.enum(['pending', 'applied']) }).strict()
export type RemoteRewind = z.infer<typeof RemoteRewindSchema>
