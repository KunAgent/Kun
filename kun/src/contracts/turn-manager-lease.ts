import { z } from 'zod'

/** Manager-authored proof that an execution owner expired for this turn. */
export const ManagerLeaseSettlementSchema = z.object({
  code: z.literal('owner_lease_expired'),
  ownerFlavor: z.enum(['production', 'development']),
  ownerInstanceId: z.string().min(1).max(256),
  fencingToken: z.number().int().positive(),
  settledAt: z.string().datetime()
}).strict()
export type ManagerLeaseSettlement = z.infer<typeof ManagerLeaseSettlementSchema>
