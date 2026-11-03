import { z } from 'zod'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
/** These are source record identities, never a filesystem locator or a native RemoteId. */
export const SourceTurnId = z.string().max(800).regex(/^(codex|claude-code|opencode):[A-Za-z0-9_-]{1,256}:[A-Za-z0-9_.:-]{1,512}$/)
export const SourceItemId = z.string().max(832).regex(/^(codex|claude-code|opencode):[A-Za-z0-9_-]{1,256}:[A-Za-z0-9_.:-]{1,512}:item:(0|[1-9][0-9]{0,14})$/)
export const SourceContentParams = z.object({ resource: z.object({ kind: z.literal('code'), id: Id }).strict(),
  referenceId: Id, historyVersion: z.string().min(1).max(256), turnId: SourceTurnId, messageId: SourceItemId,
  cursor: z.string().min(1).max(2048).optional(), maxChars: z.number().int().min(1).max(16384).default(8192)
}).strict().refine((p) => p.messageId.startsWith(p.turnId + ':item:') &&
  /^(0|[1-9][0-9]{0,14})$/.test(p.messageId.slice(p.turnId.length + 6)), 'Source item must belong to its turn')
export type SourceContentParams = z.input<typeof SourceContentParams>
