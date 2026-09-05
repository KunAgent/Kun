import { z } from 'zod'

export const RuntimeClientOwnerKindSchema = z.enum(['gui', 'tui'])
export type RuntimeClientOwnerKind = z.infer<typeof RuntimeClientOwnerKindSchema>

export const KUN_RUNTIME_CLIENT_OWNER_KIND_ENV = 'KUN_RUNTIME_CLIENT_OWNER_KIND'
