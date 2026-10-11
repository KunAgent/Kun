import { z } from 'zod'

/**
 * Immutable transport route used by model-controlled approval review for one
 * acting turn. It contains identifiers only; credentials remain host-owned.
 */
export const ActingTurnModelRouteSchema = z.object({
  unresolvedGatewayAlias: z.literal(true).optional(),
  requestedGatewayAlias: z.string().min(1).max(512).optional(),
  model: z.string().trim().min(1),
  providerId: z.string().trim().min(1).optional(),
  accountId: z.string().trim().min(1).optional()
}).strict()
export type ActingTurnModelRoute = Readonly<z.infer<typeof ActingTurnModelRouteSchema>>
