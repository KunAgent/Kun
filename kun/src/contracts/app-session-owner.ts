import { z } from 'zod'

export const KUN_APP_SESSION_OWNER_ENV = 'KUN_APP_SESSION_OWNER'
export const KUN_APP_SESSION_RESERVATION_ENV = 'KUN_APP_SESSION_RESERVATION'

export const AppSessionOwnerKindSchema = z.enum(['gui', 'tui', 'cli'])
export type AppSessionOwnerKind = z.infer<typeof AppSessionOwnerKindSchema>

export const AppSessionOwnerSchema = z.object({
  ownerSessionId: z.string().min(1).max(256),
  ownerKind: AppSessionOwnerKindSchema,
  ownerPid: z.number().int().positive(),
  ownerStartedAt: z.string().datetime(),
  ownerProcessIdentity: z.string().min(1).max(512),
  generation: z.number().int().positive()
}).strict()
export type AppSessionOwner = z.infer<typeof AppSessionOwnerSchema>

export const AppSessionStopResultSchema = z.object({
  stopped: z.boolean(),
  failures: z.array(z.string())
})
export type AppSessionStopResult = z.infer<typeof AppSessionStopResultSchema>

export function sameAppSessionOwner(
  left: AppSessionOwner | undefined,
  right: AppSessionOwner | undefined
): boolean {
  return Boolean(left && right && left.ownerSessionId === right.ownerSessionId &&
    left.ownerPid === right.ownerPid && left.ownerProcessIdentity === right.ownerProcessIdentity &&
    left.ownerStartedAt === right.ownerStartedAt && left.generation === right.generation && left.ownerKind === right.ownerKind)
}

export function appSessionOwnerFromEnvironment(env: NodeJS.ProcessEnv = process.env): AppSessionOwner | undefined {
  const value = env[KUN_APP_SESSION_OWNER_ENV]
  return value ? AppSessionOwnerSchema.parse(JSON.parse(value)) : undefined
}
