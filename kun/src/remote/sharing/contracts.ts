import { z } from 'zod'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const Version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const ShareOwnerSchema = z.object({ ownerAccountId: Id, hostDeviceId: Id, controllerId: Id }).strict()
export type ShareOwner = z.infer<typeof ShareOwnerSchema>
export const ShareSummarySchema = z.object({ id: Id, ownerAccountId: Id, hostDeviceId: Id, resourceHandle: Id,
  version: Version, state: z.enum(['active', 'closed', 'expired']), expiresAt: z.number().int().positive() }).strict()
export const ShareMemberSchema = z.object({ id: Id, accountId: Id, mode: z.enum(['read', 'write']), version: Version,
  state: z.enum(['active', 'revoked']) }).strict()
export const ShareActorSchema = z.object({ ownerAccountId: Id, hostDeviceId: Id, resourceHandle: Id, shareId: Id,
  shareVersion: Version, guestAccountId: Id, deviceId: Id, memberId: Id, memberVersion: Version,
  mode: z.enum(['read', 'write']), expiresAt: z.number().int().positive(), sessionId: Id }).strict()
export type ShareActor = z.infer<typeof ShareActorSchema>
export const ShareManageSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), threadId: Id, expiresAt: z.number().int().positive().optional() }).strict(),
  z.object({ action: z.literal('invite'), shareId: Id, expectedVersion: Version, invitationHash: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.enum(['read', 'write']), expiresAt: z.number().int().positive().optional() }).strict(),
  z.object({ action: z.literal('member.update'), shareId: Id, memberId: Id, expectedVersion: Version, mode: z.enum(['read', 'write']) }).strict(),
  z.object({ action: z.literal('revoke'), shareId: Id, memberId: Id, expectedVersion: Version }).strict(),
  z.object({ action: z.literal('close'), shareId: Id, expectedVersion: Version }).strict()
])
export type ShareManage = z.infer<typeof ShareManageSchema>
export const ShareGuestCallSchema = z.object({ method: z.enum(['catalog.get', 'code.history', 'message.search', 'message.get', 'message.source.get',
  'execution.queue.list', 'goal.get', 'request.get', 'code.turn.start', 'execution.queue.enqueue', 'execution.queue.update',
  'execution.queue.remove', 'execution.stop', 'artifact.list', 'attachment.export', 'attachment.receive']), requestId: Id, expiresAt: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()) }).strict()
export type ShareGuestCall = z.infer<typeof ShareGuestCallSchema>
